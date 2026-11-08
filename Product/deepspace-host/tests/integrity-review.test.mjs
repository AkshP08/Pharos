import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Real compiled Worker + SQLite, fictional calls only. No phone, model, push,
// or SMS provider is configured. PCM fixtures are generated silence, not people.
function runtime(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: new URL('../dist/pharos_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional integrity test shell') },
    bindings: { DEEPSPACE_APP_ID: 'intake-integrity-test', APP_NAME: 'intake-integrity-test',
      PHAROS_RESPONDER_PASSWORD: 'test-responder', PHAROS_COORDINATOR_PASSWORD: 'test-coordinator',
      PHAROS_SESSION_SECRET: 'intake-integrity-local-test-secret-only', PHAROS_INGEST_TOKEN: 'test-ingest' },
  }));
  t.after(() => mf.dispose()); return mf;
}
async function request(mf, path, { body, cookie, token } = {}) {
  const response = await mf.dispatchFetch(`http://pharos.test${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, data, response };
}
function ingest(mf, event, callId, payload = {}) { return request(mf, '/api/voice/ingest', { body: { event, callId, ...payload }, token: 'test-ingest' }); }
async function command(mf, body) {
  const ns = await mf.getDurableObjectNamespace('PHAROS_STORE');
  const response = await ns.get(ns.idFromName('pharos-primary')).fetch('https://store.test/command', { method: 'POST', body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function login(mf, coordinator = false) {
  const r = await request(mf, '/api/auth/login', { body: { password: coordinator ? 'test-coordinator' : 'test-responder' } });
  assert.equal(r.status, 200); return r.response.headers.get('Set-Cookie').split(';')[0];
}
async function getCase(mf, id) { const r = await command(mf, { action: 'case.get', id }); assert.equal(r.status, 200); return r.data.caseRecord; }
async function begin(mf, id, { audioConsent = false, analysisMode = 'semantic', number = '+15550001111' } = {}) {
  assert.equal((await ingest(mf, 'call.started', id, { purpose: 'intake', transport: 'sip', analysisMode, callerNumber: number, audioConsent: true })).status, 202);
  assert.equal((await ingest(mf, 'consent', id, { consent: true, audioConsent })).status, 200);
}
async function turn(mf, id, text, sequence = 0) {
  const r = await ingest(mf, 'turn', id, { role: 'caller', text, sequence }); assert.equal(r.status, 202, JSON.stringify(r.data)); assert.ok(r.data.caseId); return r.data.caseId;
}
const clear = { shouldWarn: false, level: 'low', signals: [], uncertain: false };
const uncertain = { ...clear, uncertain: true };
const genuine = 'We are safe. We need shelter near Riverbend footbridge, Zone 3. There are three of us.';
const danger = 'We need rescue near Riverbend footbridge, Zone 3. Water is now rising inside and we cannot get out.';
const harmful = 'Please send me your verification code right now.';
const pressure = { shouldWarn: true, level: 'medium', uncertain: false, signals: [{ kind: 'money_or_secret', evidence: 'verification code' }, { kind: 'deadline', evidence: 'right now' }] };
function assess(mf, callId, sequence, review) { return ingest(mf, 'pressure.review', callId, { sequence, review }); }
async function decide(mf, caseId, cookie, decision = 'accept', overrides = {}) {
  const item = await getCase(mf, caseId); const state = item.integrityReview;
  return request(mf, `/api/cases/${caseId}/integrity-review`, { cookie, body: { decision, reason: 'Verified the current request context with the response desk.', expectedVersion: state.version, expectedSourceCallId: state.sourceCallId, expectedSequence: state.sourceSequence, ...overrides } });
}
async function responder(mf, cookie) {
  const r = await request(mf, '/api/responders', { cookie, body: { name: 'Fictional integrity responder', organization: 'Fictional desk', serviceAreas: ['zone-river'], capabilities: ['general'], capacity: 5 } });
  assert.equal(r.status, 201);
  assert.equal((await request(mf, `/api/responders/${r.data.responder.id}/approval`, { cookie: await login(mf, true), body: { approved: true } })).status, 200);
  return r.data.responder;
}
function claim(mf, id, cookie, owner) { return request(mf, `/api/cases/${id}/claim`, { cookie, body: { responderId: owner.id } }); }
async function progress(mf, id, cookie) { const item = await getCase(mf, id); return request(mf, `/api/cases/${id}/progress`, { cookie, body: { state: 'en-route', etaMinutes: 10, expectedUpdatedAt: item.updatedAt } }); }

test('pending content review keeps factual life-safety rank and area visible while assignment and ETA are held', async (t) => {
  const mf = runtime(t), cookie = await login(mf), owner = await responder(mf, cookie);
  await begin(mf, 'pending-intake'); const id = await turn(mf, 'pending-intake', danger);
  const item = await getCase(mf, id);
  assert.equal(item.integrityReview.status, 'pending'); assert.equal(item.priority, 'immediate'); assert.equal(item.priorityRank, 0); assert.equal(item.zoneId, 'zone-river');
  assert.equal((await claim(mf, id, cookie, owner)).status, 409); assert.equal((await progress(mf, id, cookie)).status, 409);
  const overview = await request(mf, '/api/overview', { cookie });
  const held = overview.data.cases.find(x => x.id === id);
  assert.equal(held.priority, 'immediate'); assert.deepEqual(held.eligibleResponders, []);
  const area = await request(mf, '/api/cases?zone=zone-river', { cookie }); assert.ok(area.data.cases.some(x => x.id === id));
});

test('a genuine clear contextual assessment proceeds to normal factual triage and responder ETA', async (t) => {
  const mf = runtime(t), cookie = await login(mf), owner = await responder(mf, cookie);
  await begin(mf, 'genuine-intake'); const id = await turn(mf, 'genuine-intake', genuine);
  assert.equal((await assess(mf, 'genuine-intake', 0, clear)).status, 200);
  const item = await getCase(mf, id); assert.equal(item.integrityReview.status, 'clear'); assert.equal(item.priority, 'urgent');
  assert.equal((await claim(mf, id, cookie, owner)).status, 200); assert.equal((await progress(mf, id, cookie)).status, 200);
});

test('a suspicious call with no help facts is still a durable request requiring human review', async (t) => {
  const mf = runtime(t); await begin(mf, 'pure-pressure'); const id = await turn(mf, 'pure-pressure', harmful);
  assert.equal((await assess(mf, 'pure-pressure', 0, pressure)).status, 200);
  const item = await getCase(mf, id);
  assert.equal(item.integrityReview.status, 'review-required'); assert.equal(item.integrityReview.signals.length, 2);
  assert.equal(item.immediateDanger, 'unknown'); assert.equal(item.priority, 'follow-up');
  const overview = (await request(mf, '/api/overview', { cookie: await login(mf) })).data;
  assert.ok(overview.cases.some(x => x.id === id)); assert.equal(overview.alerts.filter(x => x.callId === 'pure-pressure').length, 0);
});

test('content concerns never lower reported urgency or remove immediate danger', async (t) => {
  const mf = runtime(t); await begin(mf, 'danger-pressure'); const id = await turn(mf, 'danger-pressure', `${danger} ${harmful}`);
  const before = await getCase(mf, id); assert.equal((await assess(mf, 'danger-pressure', 0, pressure)).status, 200);
  const after = await getCase(mf, id);
  assert.equal(after.priority, before.priority); assert.equal(after.priorityRank, 0); assert.equal(after.immediateDanger, 'yes'); assert.equal(after.zoneId, before.zoneId);
  assert.equal(after.integrityReview.status, 'review-required'); assert.equal(after.status, before.status); assert.match(after.integrityReview.reason, /not|verify|verification/i);
});

test('uncertainty, unavailable assessment, and a pending hangup require human verification', async (t) => {
  for (const mode of ['uncertain', 'unavailable', 'hangup']) await t.test(mode, async (st) => {
    const mf = runtime(st); const callId = `uncertain-${mode}`; await begin(mf, callId); const id = await turn(mf, callId, danger);
    const result = mode === 'uncertain' ? await assess(mf, callId, 0, uncertain) : await ingest(mf, mode === 'hangup' ? 'call.ended' : 'pressure.unavailable', callId, { sequence: 0 });
    assert.equal(result.status, 200);
    const item = await getCase(mf, id); assert.equal(item.integrityReview.status, 'review-required'); assert.equal(item.priorityRank, 0);
    assert.equal(item.integrityReview.analysisStatus, mode === 'uncertain' ? 'completed' : 'unavailable');
  });
});

test('later benign results and priority/status actions cannot bypass a latched concern; verification ownership remains allowed', async (t) => {
  const mf = runtime(t), cookie = await login(mf), owner = await responder(mf, cookie);
  await begin(mf, 'latched-intake'); const id = await turn(mf, 'latched-intake', `${genuine} ${harmful}`);
  await assess(mf, 'latched-intake', 0, pressure); await turn(mf, 'latched-intake', 'We are still near Riverbend footbridge, Zone 3.', 1);
  assert.equal((await assess(mf, 'latched-intake', 1, clear)).status, 200);
  assert.equal((await getCase(mf, id)).integrityReview.status, 'review-required');
  assert.equal((await request(mf, `/api/cases/${id}/followup-owner`, { cookie, body: { responderId: owner.id } })).status, 200);
  assert.equal((await request(mf, `/api/cases/${id}/priority`, { cookie, body: { priority: 'immediate', reason: 'Factual urgency remains a separate human decision.' } })).status, 200);
  assert.equal((await request(mf, `/api/cases/${id}/status`, { cookie, body: { status: 'resolved' } })).status, 409);
  assert.equal((await claim(mf, id, cookie, owner)).status, 409);
  assert.equal((await decide(mf, id, cookie)).status, 200); assert.equal((await claim(mf, id, cookie, owner)).status, 200);
  assert.equal((await progress(mf, id, cookie)).status, 200);
});

test('human acceptance covers reviewed text; new pending alone is stable, but a newer concern reopens review', async (t) => {
  const mf = runtime(t), cookie = await login(mf); await begin(mf, 'accepted-scope'); const id = await turn(mf, 'accepted-scope', `${genuine} ${harmful}`);
  assert.equal((await decide(mf, id, cookie)).status, 200);
  assert.equal((await assess(mf, 'accepted-scope', 0, pressure)).status, 200);
  assert.equal((await getCase(mf, id)).integrityReview.status, 'accepted', 'late same-sequence inference cannot overrule human review of that text');
  await turn(mf, 'accepted-scope', 'There are three of us.', 1); assert.equal((await getCase(mf, id)).integrityReview.status, 'accepted');
  assert.equal((await assess(mf, 'accepted-scope', 1, clear)).status, 200); assert.equal((await getCase(mf, id)).integrityReview.status, 'accepted');
  await turn(mf, 'accepted-scope', harmful, 2); await assess(mf, 'accepted-scope', 2, pressure);
  assert.equal((await getCase(mf, id)).integrityReview.status, 'review-required');
});

test('review decision requires authentication, reason, fresh source/version, and wins only once under concurrency', async (t) => {
  const mf = runtime(t), cookie = await login(mf); await begin(mf, 'human-race'); const id = await turn(mf, 'human-race', genuine);
  const item = await getCase(mf, id); const current = item.integrityReview;
  const body = { decision: 'accept', reason: 'Human checked the current request details.', expectedVersion: current.version, expectedSourceCallId: current.sourceCallId, expectedSequence: current.sourceSequence };
  assert.equal((await request(mf, `/api/cases/${id}/integrity-review`, { body })).status, 401);
  for (const change of [{ reason: '' }, { reason: 'short' }, { expectedVersion: current.version + 1 }, { expectedSourceCallId: 'other-call' }, { expectedSequence: 99 }]) {
    const r = await request(mf, `/api/cases/${id}/integrity-review`, { cookie, body: { ...body, ...change } }); assert.ok([400, 409].includes(r.status));
  }
  const results = await Promise.all([request(mf, `/api/cases/${id}/integrity-review`, { cookie, body: { ...body, role: 'coordinator' } }), request(mf, `/api/cases/${id}/integrity-review`, { cookie, body: { ...body, decision: 'dismiss' } })]);
  assert.deepEqual(results.map(x => x.status).sort(), [200, 409]);
  const decided = await getCase(mf, id); assert.equal(decided.integrityReview.version, current.version + 1); assert.equal(decided.integrityReview.decision.role, 'responder');
  assert.equal(decided.priority, item.priority); assert.equal(decided.history.filter(x => /Request review/.test(x.summary)).length, 1);
});

test('dismissal retains the request, facts and ownership, and a fresh danger report needs renewed review', async (t) => {
  const mf = runtime(t), cookie = await login(mf), owner = await responder(mf, cookie);
  await begin(mf, 'dismissed-intake'); const id = await turn(mf, 'dismissed-intake', genuine); await assess(mf, 'dismissed-intake', 0, clear); await claim(mf, id, cookie, owner);
  assert.equal((await decide(mf, id, cookie, 'dismiss')).status, 200);
  let item = await getCase(mf, id); assert.equal(item.integrityReview.status, 'dismissed'); assert.equal(item.assignedTo, owner.id); assert.equal(item.priority, 'urgent');
  assert.equal((await progress(mf, id, cookie)).status, 409);
  await turn(mf, 'dismissed-intake', 'Water is now rising inside and we cannot get out.', 1);
  item = await getCase(mf, id); assert.equal(item.priorityRank, 0); assert.equal(item.integrityReview.status, 'review-required'); assert.equal(item.assignedTo, owner.id);
});

test('a returning report keeps history and urgency while older withdrawn evidence is scrubbed', async (t) => {
  const mf = runtime(t); await begin(mf, 'old-concern'); const id = await turn(mf, 'old-concern', `${genuine} ${harmful}`); await assess(mf, 'old-concern', 0, pressure); await ingest(mf, 'call.ended', 'old-concern');
  await begin(mf, 'latest-report'); const nextId = await turn(mf, 'latest-report', `I am calling back about the same situation. ${danger}`); assert.equal(nextId, id);
  await assess(mf, 'latest-report', 0, clear); let item = await getCase(mf, id); assert.equal(item.integrityReview.status, 'review-required'); assert.equal(item.integrityReview.evidenceCallId, 'old-concern');
  await ingest(mf, 'consent.revoked', 'old-concern'); item = await getCase(mf, id);
  assert.equal(item.callId, 'latest-report'); assert.match(item.transcript, /Water is now rising/); assert.equal(item.priorityRank, 0); assert.equal(item.integrityReview.status, 'review-required');
  assert.deepEqual(item.integrityReview.signals, []); assert.deepEqual(item.scamSignals, []); assert.ok(!JSON.stringify(item).includes('verification code'));
});

test('private audio needs explicit recording consent and is retained only for a held/reviewed request', async (t) => {
  const mf = runtime(t), cookie = await login(mf), pcmBase64 = Buffer.alloc(1024).toString('base64');
  await begin(mf, 'no-audio-consent'); const noId = await turn(mf, 'no-audio-consent', genuine);
  const upload = (callId, sequence = 0) => request(mf, `/api/voice/calls/${callId}/audio/chunks`, { token: 'test-ingest', body: { sequence, pcmBase64 } });
  assert.equal((await upload('no-audio-consent')).status, 403);
  assert.equal((await request(mf, `/api/cases/${noId}/audio`, { cookie })).status, 404);
  await begin(mf, 'private-audio', { audioConsent: true }); const id = await turn(mf, 'private-audio', genuine);
  assert.equal((await upload('private-audio')).status, 200);
  assert.equal((await assess(mf, 'private-audio', 0, clear)).status, 200);
  assert.equal((await upload('private-audio', 1)).status, 200, 'a mid-call clear result cannot discard the next potentially flagged utterance');
  await turn(mf, 'private-audio', harmful, 1); await assess(mf, 'private-audio', 1, pressure); await ingest(mf, 'call.ended', 'private-audio');
  assert.equal((await request(mf, '/api/voice/calls/private-audio/audio/complete', { token: 'test-ingest', body: { lastSequence: 1 } })).status, 200);
  const item = await getCase(mf, id); assert.equal(item.audio.available, true); assert.equal(item.audio.callId, 'private-audio');
  assert.equal((await request(mf, `/api/cases/${id}/audio`)).status, 401);
  const audio = await request(mf, `/api/cases/${id}/audio`, { cookie }); assert.equal(audio.status, 200); assert.equal(audio.response.headers.get('Content-Type'), 'audio/wav'); assert.match(audio.response.headers.get('Cache-Control'), /no-store/);
  assert.equal(Buffer.from(audio.data.subarray(0, 4)).toString(), 'RIFF');
  const overview = await request(mf, '/api/overview', { cookie }); const serialized = JSON.stringify(overview.data);
  for (const privateName of ['encryptedPhone', 'callerContact', 'callerRef', 'ciphertext', 'nonce', 'pcmBase64']) assert.ok(!serialized.includes(privateName), privateName);
  await ingest(mf, 'consent.revoked', 'private-audio'); assert.equal((await getCase(mf, id)).audio.available, false); assert.equal((await request(mf, `/api/cases/${id}/audio`, { cookie })).status, 404);
});

test('a terminal clear call deletes audio instead of leaving a hidden long-term recording', async (t) => {
  const mf = runtime(t), cookie = await login(mf); await begin(mf, 'clean-audio', { audioConsent: true }); const id = await turn(mf, 'clean-audio', genuine);
  assert.equal((await request(mf, '/api/voice/calls/clean-audio/audio/chunks', { token: 'test-ingest', body: { sequence: 0, pcmBase64: Buffer.alloc(1024).toString('base64') } })).status, 200);
  await assess(mf, 'clean-audio', 0, clear); await ingest(mf, 'call.ended', 'clean-audio');
  const sealed = await request(mf, '/api/voice/calls/clean-audio/audio/complete', { token: 'test-ingest', body: { lastSequence: 0 } }); assert.equal(sealed.status, 200); assert.equal(sealed.data.discarded, true);
  assert.equal((await getCase(mf, id)).audio.available, false); assert.equal((await request(mf, `/api/cases/${id}/audio`, { cookie })).status, 404);
});

test('a later integrity hold or dismissal invalidates travel and human reacceptance cannot restore the old ETA', async (t) => {
  for (const trigger of ['concern', 'uncertain', 'unavailable', 'dismiss']) await t.test(trigger, async (st) => {
    const mf = runtime(st), cookie = await login(mf), owner = await responder(mf, cookie), callId = `travel-${trigger}`;
    await begin(mf, callId); const id = await turn(mf, callId, genuine); await assess(mf, callId, 0, clear); await claim(mf, id, cookie, owner);
    assert.equal((await progress(mf, id, cookie)).status, 200); assert.equal((await getCase(mf, id)).responseProgress.state, 'en-route');
    if (trigger === 'dismiss') await decide(mf, id, cookie, 'dismiss');
    else {
      await turn(mf, callId, trigger === 'concern' ? harmful : 'There are still three of us.', 1);
      if (trigger === 'unavailable') await ingest(mf, 'pressure.unavailable', callId, { sequence: 1 });
      else await assess(mf, callId, 1, trigger === 'concern' ? pressure : uncertain);
    }
    let item = await getCase(mf, id); assert.equal(item.assignedTo, owner.id); assert.equal(item.responseProgress.state, 'review-needed'); assert.equal(item.responseProgress.etaAt, null);
    assert.equal((await decide(mf, id, cookie, 'accept')).status, 200);
    item = await getCase(mf, id); assert.equal(item.responseProgress.state, 'review-needed'); assert.equal(item.responseProgress.etaAt, null);
    const spoken = await request(mf, `/api/voice/calls/${callId}/progress`, { token: 'test-ingest' });
    assert.notEqual(spoken.data.state, 'en-route'); assert.doesNotMatch(spoken.data.message, /on the way.*10 minutes/i);
    assert.equal((await progress(mf, id, cookie)).status, 200, 'A new explicit desk report can supply a fresh estimate after acceptance');
  });
});
