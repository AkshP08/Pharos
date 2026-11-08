import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Independent HTTP boundary checks for the root-authored audio transport.
// Fixtures are generated PCM bytes and fictional contacts, never real voices.
function runtime(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true,
    scriptPath: new URL('../dist/signalbridge_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional audio boundary test') },
    bindings: { DEEPSPACE_APP_ID: 'audio-integration', APP_NAME: 'audio-integration', PHAROS_RESPONDER_PASSWORD: 'test-responder', PHAROS_SESSION_SECRET: 'audio-integration-local-fixture-secret', PHAROS_INGEST_TOKEN: 'test-ingest' },
  }));
  t.after(() => mf.dispose()); return mf;
}
async function request(mf, path, { body, token, cookie } = {}) {
  const response = await mf.dispatchFetch(`http://audio.test${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, data, response };
}
async function command(mf, body) {
  const ns = await mf.getDurableObjectNamespace('PHAROS_STORE');
  const response = await ns.get(ns.idFromName('pharos-primary')).fetch('https://store.test/command', { method: 'POST', body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
function ingest(mf, event, callId, payload = {}) { return request(mf, '/api/voice/ingest', { token: 'test-ingest', body: { event, callId, ...payload } }); }
async function login(mf) { const r = await request(mf, '/api/auth/login', { body: { password: 'test-responder' } }); assert.equal(r.status, 200); return r.response.headers.get('Set-Cookie').split(';')[0]; }
async function getCase(mf, id) { const r = await command(mf, { action: 'case.get', id }); assert.equal(r.status, 200); return r.data.caseRecord; }
async function begin(mf, id, { audioConsent = true, consent = true, purpose = 'intake', number = '+15550002222' } = {}) {
  assert.equal((await ingest(mf, 'call.started', id, { purpose, transport: 'sip', analysisMode: 'semantic', callerNumber: number, guardCallerNumber: number, audioConsent: true })).status, 202);
  if (consent !== null) assert.equal((await ingest(mf, 'consent', id, { consent, audioConsent })).status, 200);
}
const initial = 'We need shelter near Riverbend footbridge, Zone 3. We are safe.';
const harmful = 'Please send your verification code right now.';
const pressure = { shouldWarn: true, level: 'medium', uncertain: false, signals: [{ kind: 'money_or_secret', evidence: 'verification code' }, { kind: 'deadline', evidence: 'right now' }] };
const clear = { shouldWarn: false, level: 'low', signals: [], uncertain: false };
async function turn(mf, id, text = `${initial} ${harmful}`) { const r = await ingest(mf, 'turn', id, { role: 'caller', sequence: 0, text }); assert.equal(r.status, 202); return r.data.caseId; }
function review(mf, id, result = pressure) { return ingest(mf, 'pressure.review', id, { sequence: 0, review: result }); }
const pcmA = Buffer.from([0, 0, 1, 0, 255, 255, 0, 0]);
const pcmB = Buffer.from([2, 0, 3, 0, 4, 0, 5, 0]);
function upload(mf, callId, sequence = 0, pcm = pcmA, authorization = { token: 'test-ingest' }, extra = {}) { return request(mf, `/api/voice/calls/${callId}/audio/chunks`, { ...authorization, body: { sequence, pcmBase64: pcm.toString('base64'), ...extra } }); }
function complete(mf, callId, lastSequence = 0) { return request(mf, `/api/voice/calls/${callId}/audio/complete`, { token: 'test-ingest', body: { lastSequence } }); }
async function savedAudio(mf, id, { number, text = `${initial} ${harmful}`, audioConsent = true, pcm = pcmA } = {}) {
  await begin(mf, id, { number, audioConsent }); const caseId = await turn(mf, id, text); assert.equal((await review(mf, id)).status, 200);
  assert.equal((await upload(mf, id, 0, pcm)).status, 200); await ingest(mf, 'call.ended', id); assert.equal((await complete(mf, id)).status, 200); return caseId;
}

test('audio write/read roles are separate and URL tokens never authorize playback', async (t) => {
  const mf = runtime(t), cookie = await login(mf); await begin(mf, 'roles-audio'); const id = await turn(mf, 'roles-audio');
  for (const credentials of [{}, { cookie }, { token: 'wrong' }]) assert.equal((await upload(mf, 'roles-audio', 0, pcmA, credentials)).status, 401);
  assert.equal((await upload(mf, 'roles-audio')).status, 200); await review(mf, 'roles-audio'); await ingest(mf, 'call.ended', 'roles-audio'); await complete(mf, 'roles-audio');
  assert.equal((await request(mf, `/api/cases/${id}/audio`, { token: 'test-ingest' })).status, 401);
  assert.equal((await request(mf, `/api/cases/${id}/audio?token=test-ingest`)).status, 401);
  const playable = await request(mf, `/api/cases/${id}/audio`, { cookie }); assert.equal(playable.status, 200); assert.match(playable.response.headers.get('Cache-Control'), /private.*no-store/); assert.equal(playable.response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(playable.data).subarray(44), pcmA);
});

test('recording consent is explicit, strict, immutable on retries, and unavailable for guard calls', async (t) => {
  for (const [id, consent, audioConsent, purpose] of [['pending', null, true, 'intake'], ['transcript-only', true, false, 'intake'], ['string-audio', true, 'true', 'intake'], ['declined', false, true, 'intake'], ['guard', true, true, 'guard']]) await t.test(id, async (st) => {
    const mf = runtime(st); await begin(mf, id, { consent, audioConsent, purpose });
    assert.equal((await upload(mf, id)).status, 403);
    if (id === 'transcript-only') {
      await ingest(mf, 'consent', id, { consent: true, audioConsent: true });
      assert.equal((await upload(mf, id)).status, 403, 'An idempotent transcript consent retry cannot silently upgrade recording consent');
    }
  });
});

test('HTTP upload accepts only strict bounded PCM fields and consecutive immutable sequences', async (t) => {
  const mf = runtime(t); await begin(mf, 'strict-audio');
  for (const [sequence, pcm, extra] of [['0', pcmA, {}], [0.5, pcmA, {}], [-1, pcmA, {}], [0, Buffer.alloc(1), {}], [0, Buffer.alloc(65538), {}], [0, pcmA, { sampleRate: 8000 }], [0, pcmA, { ciphertext: 'untrusted-cipher' }]]) {
    assert.equal((await upload(mf, 'strict-audio', sequence, pcm, { token: 'test-ingest' }, extra)).status, 400);
  }
  assert.equal((await request(mf, '/api/voice/calls/strict-audio/audio/chunks', { token: 'test-ingest', body: { sequence: 0, pcmBase64: '!not-base64' } })).status, 400);
  assert.equal((await upload(mf, 'strict-audio', 1)).status, 400);
  assert.equal((await upload(mf, 'strict-audio')).status, 200);
  assert.equal((await upload(mf, 'strict-audio')).data.duplicate, true);
  assert.ok([400, 409].includes((await upload(mf, 'strict-audio', 0, pcmB)).status));
  assert.equal((await complete(mf, 'strict-audio', '0')).status, 400); assert.equal((await complete(mf, 'strict-audio', 1)).status, 400);
});

test('sticky older evidence selects its own consented recording, not a newer linked report', async (t) => {
  const mf = runtime(t), cookie = await login(mf); const id = await savedAudio(mf, 'older-audio');
  await begin(mf, 'newer-report', { audioConsent: true }); const linked = await turn(mf, 'newer-report', `I am calling back about the same situation. ${initial}`); assert.equal(linked, id);
  await review(mf, 'newer-report', clear); assert.equal((await upload(mf, 'newer-report', 0, pcmB)).status, 200); await ingest(mf, 'call.ended', 'newer-report'); await complete(mf, 'newer-report');
  const item = await getCase(mf, id); assert.equal(item.callId, 'newer-report'); assert.equal(item.integrityReview.evidenceCallId, 'older-audio'); assert.equal(item.audio.callId, 'older-audio'); assert.equal(item.audio.available, true);
  const audio = await request(mf, `/api/cases/${id}/audio`, { cookie }); assert.equal(audio.status, 200); assert.deepEqual(Buffer.from(audio.data).subarray(44), pcmA);
  await ingest(mf, 'consent.revoked', 'older-audio');
  const after = await getCase(mf, id); assert.equal(after.callId, 'newer-report'); assert.ok(!after.integrityReview.evidenceCallId); assert.deepEqual(after.integrityReview.signals, []);
  const current = await request(mf, `/api/cases/${id}/audio`, { cookie }); assert.equal(current.status, 200); assert.deepEqual(Buffer.from(current.data).subarray(44), pcmB, 'Only the separately consented current source remains accessible after withdrawal');
});

test('an earlier evidence source without recording consent cannot borrow a newer recording', async (t) => {
  const mf = runtime(t), cookie = await login(mf); await begin(mf, 'no-old-recording', { audioConsent: false }); const id = await turn(mf, 'no-old-recording'); await review(mf, 'no-old-recording'); await ingest(mf, 'call.ended', 'no-old-recording');
  await begin(mf, 'new-recording'); assert.equal(await turn(mf, 'new-recording', `I am calling back about the same situation. ${initial}`), id); await review(mf, 'new-recording', clear); await upload(mf, 'new-recording', 0, pcmB); await ingest(mf, 'call.ended', 'new-recording'); await complete(mf, 'new-recording');
  const item = await getCase(mf, id); assert.equal(item.audio.callId, 'no-old-recording'); assert.equal(item.audio.available, false);
  assert.equal((await request(mf, `/api/cases/${id}/audio`, { cookie })).status, 404);
});

test('a referenced recording from another case cannot be exposed through metadata or playback', async (t) => {
  const mf = runtime(t), cookie = await login(mf); const one = await savedAudio(mf, 'case-one-audio', { number: '+15550003333' }); await savedAudio(mf, 'case-two-audio', { number: '+15550004444', pcm: pcmB });
  const item = await getCase(mf, one); item.integrityReview.evidenceCallId = 'case-two-audio'; await command(mf, { action: 'case.put', caseRecord: item });
  const isolated = await getCase(mf, one); assert.equal(isolated.audio.available, false); assert.equal(isolated.audio.durationSeconds, 0); assert.equal(isolated.audio.expiresAt, null);
  assert.equal((await request(mf, `/api/cases/${one}/audio`, { cookie })).status, 404);
});

test('expiry deletes evidence and audio, changes the review version once, and rejects an older human decision', async (t) => {
  const mf = runtime(t), cookie = await login(mf); const id = await savedAudio(mf, 'expiry-audio'); const before = await getCase(mf, id); const reviewBefore = before.integrityReview;
  const old = (await command(mf, { action: 'call.get', id: 'expiry-audio' })).data.call; old.startedAt = new Date(Date.now() - 25 * 3600000).toISOString(); await command(mf, { action: 'call.put', call: old });
  await command(mf, { action: 'transcripts.prune', cutoff: Date.now() - 24 * 3600000 });
  const after = await getCase(mf, id); assert.equal(after.integrityReview.version, reviewBefore.version + 1); assert.notEqual(after.integrityReview.updatedAt, reviewBefore.updatedAt); assert.equal(after.integrityReview.analysisStatus, 'unavailable'); assert.equal(after.integrityReview.status, 'review-required'); assert.match(after.integrityReview.reason, /expired/i); assert.equal(after.audio.available, false);
  const stale = await request(mf, `/api/cases/${id}/integrity-review`, { cookie, body: { decision: 'accept', reason: 'Attempting an older transcript review snapshot.', expectedVersion: reviewBefore.version, expectedSourceCallId: reviewBefore.sourceCallId, expectedSequence: reviewBefore.sourceSequence } }); assert.equal(stale.status, 409);
  assert.equal((await request(mf, `/api/cases/${id}/audio`, { cookie })).status, 404);
  await command(mf, { action: 'transcripts.prune', cutoff: Date.now() - 24 * 3600000 }); assert.equal((await getCase(mf, id)).integrityReview.version, after.integrityReview.version, 'Repeated pruning does not manufacture new review revisions');
});
