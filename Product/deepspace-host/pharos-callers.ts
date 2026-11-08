/**
 * Short-lived caller contacts and prior wording-risk observations.
 *
 * A provider-observed caller ID is a routing hint, not authenticated identity.
 * Help and risk lookups are purpose separated. No raw phone number belongs in
 * SQLite, public responses, logs, warnings, or risk observations.
 *
 * The enclosing Durable Object must call mutation methods within its existing
 * transactionSync boundary. WebCrypto preparation happens before that boundary.
 */
export type CallerPurpose = 'help' | 'risk'
export interface CallerContact { lookup: string; encryptedPhone: string }
export type CallerSqlValue = string | number | null
export interface CallerSql {
  exec(query: string, ...bindings: CallerSqlValue[]): { toArray(): unknown[] }
}

export interface ContactCall {
  callId: string
  purpose: CallerPurpose
  contact: CallerContact
  startedAt: number
  consent: boolean
  transport: string
  synthetic: boolean
}

export interface PriorCallerRisk {
  priorWarnedCalls: number
  shouldCaution: boolean
  identityVerified: false
  analysisRequired: true
  lastWarnedAt: string | null
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const maximumRetentionMs = 24 * 3_600_000
const keySalt = encoder.encode('pharos.caller-contact.v1')

function invalidContact(): never { throw new Error('Invalid caller contact') }
function validPurpose(value: unknown): value is CallerPurpose { return value === 'help' || value === 'risk' }
function validCallId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value) }

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unbase64Url(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) invalidContact()
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (base64Url(bytes) !== value) invalidContact()
  return bytes
}

/** Syntax normalization only. It cannot establish ownership or stop spoofing. */
export function normalizeProviderPhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !/^\s*\+[0-9(). -]+\s*$/.test(value)) return null
  const number = value.trim().replace(/[(). -]/g, '')
  return /^\+[1-9]\d{6,14}$/.test(number) ? number : null
}

async function derivedKey(secret: string, purpose: CallerPurpose, usage: 'lookup' | 'encryption'): Promise<CryptoKey> {
  if (typeof secret !== 'string' || secret.length < 16 || secret.length > 1024 || !validPurpose(purpose)) invalidContact()
  const root = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  const params = { name: 'HKDF', hash: 'SHA-256', salt: keySalt, info: encoder.encode(`pharos.caller.${purpose}.${usage}.v1`) }
  return usage === 'lookup'
    ? crypto.subtle.deriveKey(params, root, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
    : crypto.subtle.deriveKey(params, root, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function callerLookup(secret: string, phone: unknown, purpose: CallerPurpose): Promise<string> {
  try {
    const normalized = normalizeProviderPhone(phone)
    if (!normalized) invalidContact()
    const key = await derivedKey(secret, purpose, 'lookup')
    return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(normalized))))
  } catch { return invalidContact() }
}

function associatedData(lookup: string, purpose: CallerPurpose): Uint8Array {
  return encoder.encode(`pharos.caller-contact.v1:${purpose}:${lookup}`)
}

function validatePrepared(contact: unknown, purpose?: CallerPurpose): contact is CallerContact {
  if (!contact || typeof contact !== 'object' || Array.isArray(contact)) return false
  const value = contact as Record<string, unknown>
  if (typeof value.lookup !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.lookup)
    || typeof value.encryptedPhone !== 'string' || value.encryptedPhone.length > 128) return false
  try {
    const parts = value.encryptedPhone.split('.')
    return parts.length === 4 && parts[0] === 'v1' && validPurpose(parts[1]) && (purpose === undefined || parts[1] === purpose)
      && unbase64Url(parts[2]).length === 12 && unbase64Url(parts[3]).length >= 24 && unbase64Url(parts[3]).length <= 32
  } catch { return false }
}

export async function createCallerContact(secret: string, phone: unknown, purpose: CallerPurpose): Promise<CallerContact> {
  try {
    const normalized = normalizeProviderPhone(phone)
    if (!normalized) invalidContact()
    const lookup = await callerLookup(secret, normalized, purpose)
    const key = await derivedKey(secret, purpose, 'encryption')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData(lookup, purpose) }, key, encoder.encode(normalized)))
    return { lookup, encryptedPhone: `v1.${purpose}.${base64Url(iv)}.${base64Url(ciphertext)}` }
  } catch { return invalidContact() }
}

/** Server-only callback access; never call this while constructing an overview. */
export async function decryptCallerPhone(secret: string, contact: CallerContact, purpose: CallerPurpose): Promise<string> {
  try {
    if (!validPurpose(purpose) || !validatePrepared(contact, purpose)) invalidContact()
    const [, , nonce, ciphertext] = contact.encryptedPhone.split('.')
    const key = await derivedKey(secret, purpose, 'encryption')
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64Url(nonce), additionalData: associatedData(contact.lookup, purpose) }, key, unbase64Url(ciphertext))
    const number = decoder.decode(plaintext)
    if (normalizeProviderPhone(number) !== number || await callerLookup(secret, number, purpose) !== contact.lookup) invalidContact()
    return number
  } catch { return invalidContact() }
}

export class CallerStore {
  private readonly sql: CallerSql
  private readonly retentionMs: number
  private readonly clock: () => number

  constructor(sql: CallerSql, retentionMs = maximumRetentionMs, clock: () => number = Date.now) {
    if (!Number.isFinite(retentionMs) || retentionMs < 1) throw new Error('Invalid caller retention')
    this.sql = sql
    this.retentionMs = Math.min(Math.floor(retentionMs), maximumRetentionMs)
    this.clock = clock
    sql.exec(`
      CREATE TABLE IF NOT EXISTS caller_contacts (
        lookup TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK(purpose IN ('help', 'risk')),
        encrypted_phone TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS caller_contact_calls (
        call_id TEXT PRIMARY KEY,
        lookup TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('help', 'risk')),
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS caller_contact_lookup ON caller_contact_calls(lookup, expires_at);
      CREATE TABLE IF NOT EXISTS caller_risk_events (
        call_id TEXT PRIMARY KEY,
        lookup TEXT NOT NULL,
        warned_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('medium', 'high'))
      );
      CREATE INDEX IF NOT EXISTS caller_risk_lookup ON caller_risk_events(lookup, expires_at);
    `)
  }

  private rows<T>(query: string, ...bindings: CallerSqlValue[]): T[] { return this.sql.exec(query, ...bindings).toArray() as T[] }

  registerCall(input: ContactCall): { registered: true; duplicate: boolean; expiresAt: number } {
    if (!input || input.consent !== true || input.transport !== 'sip' || input.synthetic !== false) throw new Error('Caller contact requires a consented live SIP call')
    if (!validCallId(input.callId) || !validPurpose(input.purpose) || !validatePrepared(input.contact, input.purpose)) invalidContact()
    const now = this.clock()
    if (!Number.isSafeInteger(input.startedAt) || input.startedAt <= 0 || input.startedAt > now) throw new Error('Invalid caller call time')
    const expiresAt = input.startedAt + this.retentionMs
    if (expiresAt <= now) throw new Error('Caller contact has expired')
    const previous = this.rows<{ lookup: string; purpose: string; started_at: number; expires_at: number }>('SELECT lookup, purpose, started_at, expires_at FROM caller_contact_calls WHERE call_id = ?', input.callId)[0]
    if (previous) {
      if (previous.lookup !== input.contact.lookup || previous.purpose !== input.purpose || previous.started_at !== input.startedAt) throw new Error('Caller contact call conflicts with an earlier record')
      return { registered: true, duplicate: true, expiresAt: previous.expires_at }
    }
    const stored = this.rows<{ purpose: string }>('SELECT purpose FROM caller_contacts WHERE lookup = ?', input.contact.lookup)[0]
    if (stored && stored.purpose !== input.purpose) throw new Error('Caller contact purpose conflicts with an earlier record')
    this.sql.exec(`INSERT INTO caller_contacts (lookup, purpose, encrypted_phone, first_seen_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(lookup) DO UPDATE SET
      encrypted_phone = CASE WHEN excluded.last_seen_at >= caller_contacts.last_seen_at THEN excluded.encrypted_phone ELSE caller_contacts.encrypted_phone END,
      first_seen_at = MIN(caller_contacts.first_seen_at, excluded.first_seen_at),
      last_seen_at = MAX(caller_contacts.last_seen_at, excluded.last_seen_at),
      expires_at = MAX(caller_contacts.expires_at, excluded.expires_at)`,
    input.contact.lookup, input.purpose, input.contact.encryptedPhone, input.startedAt, input.startedAt, expiresAt)
    this.sql.exec('INSERT INTO caller_contact_calls (call_id, lookup, purpose, started_at, expires_at) VALUES (?, ?, ?, ?, ?)', input.callId, input.contact.lookup, input.purpose, input.startedAt, expiresAt)
    return { registered: true, duplicate: false, expiresAt }
  }

  /** Only validated context-model warnings on retained guard calls qualify. */
  recordRisk(input: { callId: string; level: string; analysisSource: string }): { recorded: boolean; duplicate: boolean } {
    if (!input || !validCallId(input.callId)) invalidContact()
    if (input.analysisSource !== 'context-model' || !['medium', 'high'].includes(input.level)) return { recorded: false, duplicate: false }
    const now = this.clock()
    const contact = this.rows<{ lookup: string; expires_at: number }>(`SELECT c.lookup, c.expires_at FROM caller_contact_calls c
      JOIN caller_contacts p ON p.lookup = c.lookup WHERE c.call_id = ? AND c.purpose = 'risk' AND p.purpose = 'risk'
      AND c.expires_at > ? AND p.expires_at > ?`, input.callId, now, now)[0]
    if (!contact) return { recorded: false, duplicate: false }
    const previous = this.rows<{ lookup: string }>('SELECT lookup FROM caller_risk_events WHERE call_id = ?', input.callId)[0]
    if (previous && previous.lookup !== contact.lookup) throw new Error('Caller risk call conflicts with an earlier record')
    this.sql.exec(`INSERT INTO caller_risk_events (call_id, lookup, warned_at, expires_at, level) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(call_id) DO UPDATE SET level = CASE WHEN excluded.level = 'high' THEN 'high' ELSE caller_risk_events.level END`,
    input.callId, contact.lookup, now, contact.expires_at, input.level)
    return { recorded: true, duplicate: Boolean(previous) }
  }

  /** A caution about prior caller-ID observations; never an identity verdict. */
  priorRisk(lookup: string, options: { excludeCallId?: string } = {}): PriorCallerRisk {
    if (!/^[A-Za-z0-9_-]{43}$/.test(lookup) || options.excludeCallId !== undefined && !validCallId(options.excludeCallId)) invalidContact()
    const now = this.clock()
    const row = this.rows<{ count: number; latest: number | null }>(`SELECT COUNT(DISTINCT r.call_id) AS count, MAX(r.warned_at) AS latest
      FROM caller_risk_events r JOIN caller_contacts p ON p.lookup = r.lookup
      JOIN caller_contact_calls c ON c.call_id = r.call_id AND c.lookup = r.lookup
      WHERE r.lookup = ? AND p.purpose = 'risk' AND c.purpose = 'risk' AND r.expires_at > ?
      AND p.expires_at > ? AND c.expires_at > ? AND r.call_id != ?`, lookup, now, now, now, options.excludeCallId || '')[0]
    const priorWarnedCalls = Number(row?.count || 0)
    return { priorWarnedCalls, shouldCaution: priorWarnedCalls >= 3, identityVerified: false, analysisRequired: true, lastWarnedAt: row?.latest === null || row?.latest === undefined ? null : new Date(row.latest).toISOString() }
  }

  /** Internal encrypted contact only. The caller must independently authorize use. */
  contact(lookup: string, purpose: CallerPurpose): (CallerContact & { expiresAt: number; lastSeenAt: number }) | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(lookup) || !validPurpose(purpose)) invalidContact()
    const now = this.clock()
    const row = this.rows<{ encrypted_phone: string; expires_at: number; last_seen_at: number }>(`SELECT p.encrypted_phone, p.expires_at, p.last_seen_at
      FROM caller_contacts p WHERE p.lookup = ? AND p.purpose = ? AND p.expires_at > ?
      AND EXISTS (SELECT 1 FROM caller_contact_calls c WHERE c.lookup = p.lookup AND c.purpose = p.purpose AND c.expires_at > ?)`, lookup, purpose, now, now)[0]
    return row ? { lookup, encryptedPhone: row.encrypted_phone, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at } : null
  }

  revokeCall(callId: string): { removedRisk: number; removedContact: boolean } {
    if (!validCallId(callId)) invalidContact()
    const link = this.rows<{ lookup: string }>('SELECT lookup FROM caller_contact_calls WHERE call_id = ?', callId)[0]
    const risk = this.rows<{ call_id: string }>('SELECT call_id FROM caller_risk_events WHERE call_id = ?', callId)[0]
    this.sql.exec('DELETE FROM caller_risk_events WHERE call_id = ?', callId)
    this.sql.exec('DELETE FROM caller_contact_calls WHERE call_id = ?', callId)
    if (!link) return { removedRisk: risk ? 1 : 0, removedContact: false }
    const remaining = this.rows<{ first: number | null; latest: number | null; expiry: number | null }>(`SELECT MIN(started_at) AS first, MAX(started_at) AS latest, MAX(expires_at) AS expiry
      FROM caller_contact_calls WHERE lookup = ? AND expires_at > ?`, link.lookup, this.clock())[0]
    if (!remaining?.expiry) {
      this.sql.exec('DELETE FROM caller_contacts WHERE lookup = ?', link.lookup)
      return { removedRisk: risk ? 1 : 0, removedContact: true }
    }
    this.sql.exec('UPDATE caller_contacts SET first_seen_at = ?, last_seen_at = ?, expires_at = ? WHERE lookup = ?', remaining.first, remaining.latest, remaining.expiry, link.lookup)
    return { removedRisk: risk ? 1 : 0, removedContact: false }
  }

  prune(): { removedRisk: number; removedCalls: number; removedContacts: number } {
    const now = this.clock()
    const expiredRisk = this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM caller_risk_events WHERE expires_at <= ?', now)[0].count
    const expiredCalls = this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM caller_contact_calls WHERE expires_at <= ?', now)[0].count
    const expiredContacts = this.rows<{ count: number }>(`SELECT COUNT(*) AS count FROM caller_contacts p
      WHERE p.expires_at <= ? OR NOT EXISTS (SELECT 1 FROM caller_contact_calls c WHERE c.lookup = p.lookup AND c.expires_at > ?)`, now, now)[0].count
    this.sql.exec('DELETE FROM caller_risk_events WHERE expires_at <= ?', now)
    this.sql.exec('DELETE FROM caller_contact_calls WHERE expires_at <= ?', now)
    this.sql.exec(`DELETE FROM caller_contacts WHERE expires_at <= ? OR NOT EXISTS
      (SELECT 1 FROM caller_contact_calls c WHERE c.lookup = caller_contacts.lookup AND c.expires_at > ?)`, now, now)
    return { removedRisk: Number(expiredRisk), removedCalls: Number(expiredCalls), removedContacts: Number(expiredContacts) }
  }

  nextExpiry(): number | null {
    const times = ['caller_contacts', 'caller_contact_calls', 'caller_risk_events'].map(table => this.rows<{ next: number | null }>(`SELECT MIN(expires_at) AS next FROM ${table}`)[0]?.next).filter((value): value is number => value !== null && value !== undefined)
    return times.length ? Math.min(...times) : null
  }
}
