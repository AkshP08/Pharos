import type { CallerSql, CallerSqlValue } from './pharos-callers'

// Caller-only PCM, never a public object URL. Crypto runs outside synchronous
// SQLite mutations; the enclosing store checks current call consent in-transaction.
export const audioFormat = { sampleRate: 16000, channels: 1, bitsPerSample: 16 } as const
export const maximumAudioBytes = 180 * 16000 * 2
export const maximumChunkBytes = 65536
const maximumChunks = Math.ceil(maximumAudioBytes / maximumChunkBytes)
const encoder = new TextEncoder()
const day = 24 * 3600000

export interface SealedAudioChunk { sequence: number; bytes: number; nonce: string; ciphertext: string; digest: string }
export interface RetainedAudio { callId: string; chunks: SealedAudioChunk[]; totalBytes: number; expiresAt: number; complete: true }

function invalid(): never { throw new Error('Invalid or unavailable caller audio') }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value) }
function base64(bytes: Uint8Array): string {
  let text = ''
  for (const value of bytes) text += String.fromCharCode(value)
  return btoa(text)
}
function decode(value: unknown, limit: number): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(limit / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) invalid()
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0))
  if (bytes.length > limit || base64(bytes) !== value) invalid()
  return bytes
}
function validChunk(value: SealedAudioChunk): boolean {
  try {
    return Number.isSafeInteger(value.sequence) && value.sequence >= 0 && value.sequence < maximumChunks
      && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= maximumChunkBytes && value.bytes % 2 === 0
      && decode(value.nonce, 12).length === 12 && decode(value.ciphertext, maximumChunkBytes + 16).length === value.bytes + 16
      && /^[a-f0-9]{64}$/.test(value.digest)
  } catch { return false }
}
async function keyFor(secret: string): Promise<CryptoKey> {
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 1024) invalid()
  const root = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('pharos.audio.v1'), info: encoder.encode('caller-only.pcm.encryption') }, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
function aad(callId: string, sequence: number): Uint8Array { return encoder.encode(`pharos.audio.v1:${callId}:${sequence}:16000:1:16`) }
function hex(bytes: Uint8Array): string { return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') }

export async function sealAudioChunk(secret: string, callId: string, sequence: number, pcmBase64: unknown): Promise<SealedAudioChunk> {
  try {
    if (!validId(callId) || !Number.isSafeInteger(sequence) || sequence < 0 || sequence >= maximumChunks) invalid()
    const pcm = decode(pcmBase64, maximumChunkBytes)
    if (!pcm.length || pcm.length % 2) invalid()
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(callId, sequence) }, await keyFor(secret), pcm))
    return { sequence, bytes: pcm.length, nonce: base64(nonce), ciphertext: base64(ciphertext), digest: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', pcm))) }
  } catch { return invalid() }
}

export async function audioWave(secret: string, audio: RetainedAudio): Promise<Uint8Array> {
  try {
    if (!audio || !validId(audio.callId) || audio.complete !== true || audio.expiresAt <= Date.now()
      || !Number.isSafeInteger(audio.totalBytes) || audio.totalBytes <= 0 || audio.totalBytes > maximumAudioBytes
      || !Array.isArray(audio.chunks) || !audio.chunks.length || audio.chunks.length > maximumChunks) invalid()
    const wav = new Uint8Array(44 + audio.totalBytes)
    const view = new DataView(wav.buffer)
    for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) wav.set(encoder.encode(text), offset)
    view.setUint32(4, 36 + audio.totalBytes, true); view.setUint32(16, 16, true)
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true)
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, audio.totalBytes, true)
    const key = await keyFor(secret)
    let cursor = 44
    for (const [sequence, chunk] of audio.chunks.entries()) {
      if (!validChunk(chunk) || sequence !== chunk.sequence || cursor + chunk.bytes > wav.length) invalid()
      const pcm = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(chunk.nonce, 12), additionalData: aad(audio.callId, sequence) }, key, decode(chunk.ciphertext, maximumChunkBytes + 16)))
      if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', pcm))) !== chunk.digest) invalid()
      wav.set(pcm, cursor); cursor += pcm.length
    }
    if (cursor !== wav.length) invalid()
    return wav
  } catch { return invalid() }
}

export class CallerAudioStore {
  private readonly sql: CallerSql
  private readonly retentionMs: number
  private readonly clock: () => number
  constructor(sql: CallerSql, retentionMs = day, clock: () => number = Date.now) {
    if (!Number.isFinite(retentionMs) || retentionMs < 1) invalid()
    this.sql = sql; this.retentionMs = retentionMs; this.clock = clock
    this.sql.exec(`CREATE TABLE IF NOT EXISTS call_audio_manifests (
      call_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      total_bytes INTEGER NOT NULL, chunk_count INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS call_audio_chunks (
      call_id TEXT NOT NULL, sequence INTEGER NOT NULL, bytes INTEGER NOT NULL,
      nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, digest TEXT NOT NULL,
      PRIMARY KEY(call_id, sequence));`)
  }
  private rows<T>(query: string, ...bindings: CallerSqlValue[]): T[] { return this.sql.exec(query, ...bindings).toArray() as T[] }
  put(input: { callId: string; startedAt: number; consent: boolean; audioConsent: boolean; chunk: SealedAudioChunk }): { accepted: true; duplicate: boolean } {
    const { callId, startedAt, chunk } = input
    const expiresAt = startedAt + Math.min(this.retentionMs, day)
    if (!validId(callId) || input.consent !== true || input.audioConsent !== true || !validChunk(chunk)
      || !Number.isSafeInteger(startedAt) || startedAt <= 0 || startedAt > this.clock() || expiresAt <= this.clock()) invalid()
    const previous = this.rows<{ total_bytes: number; chunk_count: number; complete: number; started_at: number }>('SELECT * FROM call_audio_manifests WHERE call_id = ?', callId)[0]
    if (previous && previous.started_at !== startedAt) invalid()
    const duplicate = this.rows<{ digest: string; bytes: number }>('SELECT digest, bytes FROM call_audio_chunks WHERE call_id = ? AND sequence = ?', callId, chunk.sequence)[0]
    if (duplicate) {
      if (duplicate.digest !== chunk.digest || duplicate.bytes !== chunk.bytes) throw new Error('Caller audio chunk conflicts with an earlier upload')
      return { accepted: true, duplicate: true }
    }
    if (previous?.complete || chunk.sequence !== (previous?.chunk_count || 0)
      || (previous?.total_bytes || 0) + chunk.bytes > maximumAudioBytes) invalid()
    if (!previous) this.sql.exec('INSERT INTO call_audio_manifests VALUES (?, ?, ?, 0, 0, 0)', callId, startedAt, expiresAt)
    this.sql.exec('INSERT INTO call_audio_chunks VALUES (?, ?, ?, ?, ?, ?)', callId, chunk.sequence, chunk.bytes, chunk.nonce, chunk.ciphertext, chunk.digest)
    this.sql.exec('UPDATE call_audio_manifests SET total_bytes = total_bytes + ?, chunk_count = chunk_count + 1 WHERE call_id = ?', chunk.bytes, callId)
    return { accepted: true, duplicate: false }
  }
  complete(callId: string, lastSequence: number): { accepted: true; durationSeconds: number } {
    if (!validId(callId) || !Number.isSafeInteger(lastSequence)) invalid()
    const manifest = this.rows<{ chunk_count: number; total_bytes: number; expires_at: number }>('SELECT * FROM call_audio_manifests WHERE call_id = ?', callId)[0]
    if (!manifest || manifest.expires_at <= this.clock() || !manifest.chunk_count || manifest.chunk_count - 1 !== lastSequence) invalid()
    this.sql.exec('UPDATE call_audio_manifests SET complete = 1 WHERE call_id = ?', callId)
    return { accepted: true, durationSeconds: manifest.total_bytes / 32000 }
  }
  read(callId: string): RetainedAudio | null {
    if (!validId(callId)) invalid()
    const manifest = this.rows<{ complete: number; total_bytes: number; expires_at: number }>('SELECT * FROM call_audio_manifests WHERE call_id = ?', callId)[0]
    if (!manifest?.complete || manifest.expires_at <= this.clock()) return null
    const chunks = this.rows<{ sequence: number; bytes: number; nonce: string; ciphertext: string; digest: string }>('SELECT sequence, bytes, nonce, ciphertext, digest FROM call_audio_chunks WHERE call_id = ? ORDER BY sequence', callId)
    return { callId, chunks, totalBytes: manifest.total_bytes, expiresAt: manifest.expires_at, complete: true }
  }
  metadata(callId: string): { available: boolean; durationSeconds: number; expiresAt: string | null } {
    const manifest = this.rows<{ complete: number; total_bytes: number; expires_at: number }>('SELECT * FROM call_audio_manifests WHERE call_id = ?', callId)[0]
    return { available: Boolean(manifest?.complete && manifest.expires_at > this.clock()), durationSeconds: manifest?.complete ? manifest.total_bytes / 32000 : 0, expiresAt: manifest ? new Date(manifest.expires_at).toISOString() : null }
  }
  revoke(callId: string): void { this.sql.exec('DELETE FROM call_audio_chunks WHERE call_id = ?', callId); this.sql.exec('DELETE FROM call_audio_manifests WHERE call_id = ?', callId) }
  prune(): void { this.sql.exec('DELETE FROM call_audio_chunks WHERE call_id IN (SELECT call_id FROM call_audio_manifests WHERE expires_at <= ?)', this.clock()); this.sql.exec('DELETE FROM call_audio_manifests WHERE expires_at <= ?', this.clock()) }
  nextExpiry(): number | null { return this.rows<{ next: number | null }>('SELECT MIN(expires_at) AS next FROM call_audio_manifests')[0]?.next || null }
}
