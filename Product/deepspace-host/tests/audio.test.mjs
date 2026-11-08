import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createDecipheriv, hkdfSync } from 'node:crypto';
import { CallerAudioStore, sealAudioChunk, audioWave, maximumAudioBytes, maximumChunkBytes } from '../pharos-audio.ts';

const secret = 'fictional-audio-test-secret-not-a-provider-key';
const start = Date.now() - 1000;
const pcm = Buffer.from([0, 0, 90, 0, 166, 255, 0, 0]);
const b64 = value => Buffer.from(value).toString('base64');
function fixture(t, retention = 24 * 3600000) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  let now = start;
  const sql = { exec(query, ...bindings) {
    if (!bindings.length && /CREATE TABLE/.test(query)) { db.exec(query); return { toArray: () => [] }; }
    const statement = db.prepare(query);
    const rows = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows };
  } };
  const store = new CallerAudioStore(sql, retention, () => now);
  return { store, db, setNow(value) { now = value; } };
}
function input(chunk, overrides = {}) { return { callId: 'fictional-audio-call', startedAt: start, consent: true, audioConsent: true, chunk, ...overrides }; }

test('audio ciphertext independently decrypts with call/sequence AAD and a purpose-separated key', async () => {
  const chunk = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm));
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('pharos.audio.v1'), Buffer.from('caller-only.pcm.encryption'), 32));
  const cipher = Buffer.from(chunk.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(chunk.nonce, 'base64'));
  decipher.setAAD(Buffer.from('pharos.audio.v1:fictional-audio-call:0:16000:1:16'));
  decipher.setAuthTag(cipher.subarray(-16));
  assert.deepEqual(Buffer.concat([decipher.update(cipher.subarray(0, -16)), decipher.final()]), pcm);
  const second = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm));
  assert.notEqual(chunk.nonce, second.nonce); assert.notEqual(chunk.ciphertext, second.ciphertext);
});

test('audio cannot be persisted without both transcript and explicit audio consent', async t => {
  const { store, db } = fixture(t);
  const chunk = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm));
  for (const consent of [false, 'true', undefined]) assert.throws(() => store.put(input(chunk, { consent })), /unavailable/);
  for (const audioConsent of [false, 'true', undefined]) assert.throws(() => store.put(input(chunk, { audioConsent })), /unavailable/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM call_audio_manifests').get().count, 0);
});

test('chunk retries are immutable, ordered, and do not extend retention', async t => {
  const { store, db } = fixture(t, 60000);
  const chunk = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm));
  assert.deepEqual(store.put(input(chunk)), { accepted: true, duplicate: false });
  const retry = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm));
  assert.deepEqual(store.put(input(retry)), { accepted: true, duplicate: true });
  const wrong = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(Buffer.alloc(8, 1)));
  assert.throws(() => store.put(input(wrong)), /conflicts/);
  const outOfOrder = await sealAudioChunk(secret, 'fictional-audio-call', 2, b64(pcm));
  assert.throws(() => store.put(input(outOfOrder)), /unavailable/);
  assert.equal(store.nextExpiry(), start + 60000);
  assert.equal(db.prepare('SELECT ciphertext FROM call_audio_chunks').get().ciphertext, chunk.ciphertext);
  assert.throws(() => store.put(input(chunk, { startedAt: start - 100 })), /unavailable/);
});

test('only a complete recording can be read and WAV preserves exact PCM and duration', async t => {
  const { store } = fixture(t);
  const first = await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm));
  const second = await sealAudioChunk(secret, 'fictional-audio-call', 1, b64(pcm));
  store.put(input(first)); assert.equal(store.read('fictional-audio-call'), null);
  store.put(input(second)); assert.throws(() => store.complete('fictional-audio-call', 0), /unavailable/);
  assert.equal(store.complete('fictional-audio-call', 1).durationSeconds, pcm.length * 2 / 32000);
  const wave = Buffer.from(await audioWave(secret, store.read('fictional-audio-call')));
  assert.equal(wave.toString('ascii', 0, 4), 'RIFF'); assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wave.readUInt32LE(24), 16000); assert.equal(wave.readUInt16LE(22), 1); assert.equal(wave.readUInt16LE(34), 16);
  assert.equal(wave.readUInt32LE(40), pcm.length * 2); assert.deepEqual(wave.subarray(44), Buffer.concat([pcm, pcm]));
  assert.equal(store.metadata('fictional-audio-call').available, true);
  const third = await sealAudioChunk(secret, 'fictional-audio-call', 2, b64(pcm));
  assert.throws(() => store.put(input(third)), /unavailable/);
});

test('wrong keys, changed call identity, tampered ciphertext, and expired playback fail without data leaks', async t => {
  const { store } = fixture(t);
  store.put(input(await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm)))); store.complete('fictional-audio-call', 0);
  const retained = store.read('fictional-audio-call');
  await assert.rejects(audioWave(secret + 'wrong', retained), /^Error: Invalid or unavailable caller audio$/);
  await assert.rejects(audioWave(secret, { ...retained, callId: 'other-call' }), /unavailable/);
  await assert.rejects(audioWave(secret, { ...retained, expiresAt: Date.now() - 1 }), /unavailable/);
  const corrupted = structuredClone(retained); const cipher = Buffer.from(corrupted.chunks[0].ciphertext, 'base64'); cipher[0] ^= 1; corrupted.chunks[0].ciphertext = b64(cipher);
  await assert.rejects(audioWave(secret, corrupted), /unavailable/);
});

test('revocation and scheduled expiry remove both manifest and encrypted chunks', async t => {
  const { store, db, setNow } = fixture(t, 60000);
  store.put(input(await sealAudioChunk(secret, 'fictional-audio-call', 0, b64(pcm)))); store.complete('fictional-audio-call', 0);
  setNow(start + 60000); assert.equal(store.read('fictional-audio-call'), null); assert.equal(store.metadata('fictional-audio-call').available, false);
  store.prune(); assert.equal(store.nextExpiry(), null); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM call_audio_chunks').get().n, 0);
  assert.throws(() => store.put(input(awaitableChunk)), /unavailable/);
  const other = await sealAudioChunk(secret, 'another-call', 0, b64(pcm));
  setNow(start); store.put(input(other, { callId: 'another-call' })); store.revoke('another-call');
  assert.equal(store.read('another-call'), null); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM call_audio_manifests').get().n, 0);
});

const awaitableChunk = { sequence: 0, bytes: 8, nonce: '', ciphertext: '', digest: '' };
test('recording duration and per-chunk size are bounded independently of client metadata', async t => {
  const { store } = fixture(t);
  await assert.rejects(sealAudioChunk(secret, 'fictional-audio-call', 0, b64(Buffer.alloc(maximumChunkBytes + 2))), /unavailable/);
  await assert.rejects(sealAudioChunk(secret, 'fictional-audio-call', 0, b64(Buffer.alloc(3))), /unavailable/);
  await assert.rejects(sealAudioChunk(secret, 'fictional-audio-call', 0, 'not base64'), /unavailable/);
  let remaining = maximumAudioBytes;
  for (let sequence = 0; remaining; sequence++) {
    const bytes = Math.min(maximumChunkBytes, remaining);
    store.put(input(await sealAudioChunk(secret, 'fictional-audio-call', sequence, b64(Buffer.alloc(bytes))))); remaining -= bytes;
  }
  assert.equal(store.complete('fictional-audio-call', 87).durationSeconds, 180);
  await assert.rejects(sealAudioChunk(secret, 'fictional-audio-call', 88, b64(pcm)), /unavailable/);
});
