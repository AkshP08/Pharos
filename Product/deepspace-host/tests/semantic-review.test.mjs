import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Test the compiled Worker and SQLite Durable Object using fictional text and
// local credentials only. No model, telephone, SMS, or push provider is called.
function runtime(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: new URL('../dist/signalbridge_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional semantic-review test shell') },
    bindings: {
      DEEPSPACE_APP_ID: 'semantic-review-test', APP_NAME: 'semantic-review-test',
      PHAROS_RESPONDER_PASSWORD: 'test-responder',
      PHAROS_COORDINATOR_PASSWORD: 'test-coordinator',
      PHAROS_SESSION_SECRET: 'semantic-review-local-fixture-secret-only',
      PHAROS_INGEST_TOKEN: 'test-ingest',
    },
  }));
  t.after(() => mf.dispose());
  return mf;
}

async function request(mf, path, { body, cookie, token } = {}) {
  const response = await mf.dispatchFetch(`http://pharos.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), response };
}

function ingest(mf, event, callId, payload = {}) {
  return request(mf, '/api/voice/ingest', { body: { event, callId, ...payload }, token: 'test-ingest' });
}

async function command(mf, body) {
  const namespace = await mf.getDurableObjectNamespace('PHAROS_STORE');
  const response = await namespace.get(namespace.idFromName('pharos-primary')).fetch('https://pharos-store.local/command', {
    method: 'POST', body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

async function getCall(mf, id) {
  const result = await command(mf, { action: 'call.get', id });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.call;
}

async function overview(mf) {
  const login = await request(mf, '/api/auth/login', { body: { password: 'test-responder' } });
  assert.equal(login.status, 200);
  const cookie = login.response.headers.get('Set-Cookie').split(';')[0];
  const result = await request(mf, '/api/overview', { cookie });
  assert.equal(result.status, 200);
  return result.data;
}

async function begin(mf, id, { purpose = 'guard', analysisMode = 'semantic', consent = true } = {}) {
  const started = await ingest(mf, 'call.started', id, { purpose, analysisMode, transport: 'sip' });
  assert.equal(started.status, 202, JSON.stringify(started.data));
  if (consent !== null) {
    const accepted = await ingest(mf, 'consent', id, { consent });
    assert.equal(accepted.status, 200);
  }
  return started.data;
}

async function turn(mf, id, text, sequence = 0, role = 'caller') {
  const result = await ingest(mf, 'turn', id, { role, text, sequence });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  return result.data;
}

function review(mf, id, sequence, decision) {
  return ingest(mf, 'pressure.review', id, { sequence, review: decision });
}

const clear = { shouldWarn: false, level: 'low', signals: [] };
const codeText = 'Please send me your verification code right now.';
const medium = { shouldWarn: true, level: 'medium', signals: [
  { kind: 'money_or_secret', evidence: 'verification code' },
  { kind: 'deadline', evidence: 'right now' },
] };

test('semantic guard waits for context and does not emit an early wording warning', async (t) => {
  const mf = runtime(t);
  const started = await begin(mf, 'semantic-first');
  const text = 'The county emergency office says leave immediately. Open the link to the official evacuation notice.';
  assert.equal((await turn(mf, 'semantic-first', text)).warning, null);
  assert.equal((await getCall(mf, 'semantic-first')).reviewStatus, 'pending');
  const token = new URL(started.warningUrl).hash.slice(1);
  const pending = await request(mf, '/api/guard/status', { token });
  assert.equal(pending.data.reviewStatus, 'pending');
  assert.deepEqual(pending.data.alerts, []);
  const result = await review(mf, 'semantic-first', 0, clear);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.reviewStatus, 'completed');
  assert.equal(result.data.warning, null);
  const data = await overview(mf);
  assert.equal(data.alerts.filter(item => item.callId === 'semantic-first').length, 0);
  assert.equal(data.cases.filter(item => item.callId === 'semantic-first').length, 0);
  assert.equal((await request(mf, '/api/guard/status', { token })).data.reviewStatus, 'completed');
});

test('semantic review uses cumulative caller quotes with exact UTF-16 spans and explicit provenance', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'semantic-evidence');
  const first = '😀 I am the county relief office.';
  const second = 'Send me your verification code right now.';
  await turn(mf, 'semantic-evidence', first);
  await turn(mf, 'semantic-evidence', second, 1);
  const decision = { shouldWarn: true, level: 'high', signals: [
    { kind: 'authority', evidence: 'county relief office' },
    { kind: 'money_or_secret', evidence: 'verification code' },
  ] };
  const result = await review(mf, 'semantic-evidence', 1, decision);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.warning.level, 'high');
  assert.equal(result.data.warning.analysisSource, 'context-model');
  const combined = `${first} ${second}`;
  for (const signal of result.data.warning.signals) {
    assert.equal(signal.start, combined.indexOf(signal.evidence));
    assert.equal(signal.end, signal.start + signal.evidence.length);
    assert.equal(combined.slice(signal.start, signal.end), signal.evidence);
    assert.ok(signal.label && signal.psychology && signal.explanation);
  }
  assert.match(result.data.warning.confidence, /not a fraud probability/i);
  const data = await overview(mf);
  const stored = data.scamReviews.find(item => item.sourceId === 'semantic-evidence');
  assert.equal(stored.analysisSource, 'context-model');
  assert.equal(stored.text, combined);
  assert.equal(data.cases.filter(item => item.callId === 'semantic-evidence').length, 0);
});

test('semantic decisions are idempotent, reject conflicts, and escalate only once per severity', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'semantic-escalate');
  await turn(mf, 'semantic-escalate', codeText);
  const first = await review(mf, 'semantic-escalate', 0, medium);
  assert.equal(first.status, 200);
  assert.equal(first.data.warning.level, 'medium');
  const repeated = await review(mf, 'semantic-escalate', 0, medium);
  assert.equal(repeated.data.duplicate, true);
  assert.equal(repeated.data.warning, null);
  assert.equal((await review(mf, 'semantic-escalate', 0, clear)).status, 409);
  await turn(mf, 'semantic-escalate', 'Read the verification code to me.', 1);
  assert.equal((await review(mf, 'semantic-escalate', 1, medium)).data.warning, null);
  await turn(mf, 'semantic-escalate', 'I am from the county relief office. Do this right now.', 2);
  const high = { shouldWarn: true, level: 'high', signals: [
    { kind: 'money_or_secret', evidence: 'verification code' },
    { kind: 'authority', evidence: 'county relief office' },
  ] };
  const escalated = await review(mf, 'semantic-escalate', 2, high);
  assert.equal(escalated.data.warning.level, 'high');
  assert.notEqual(escalated.data.warning.id, first.data.warning.id);
  const reordered = await review(mf, 'semantic-escalate', 2, { ...high, signals: [...high.signals].reverse() });
  assert.equal(reordered.data.duplicate, true, 'Signal order must not create a conflicting semantic decision');
  await turn(mf, 'semantic-escalate', 'Please send the code.', 3);
  assert.equal((await review(mf, 'semantic-escalate', 3, medium)).data.warning, null);
  assert.equal((await overview(mf)).alerts.filter(item => item.callId === 'semantic-escalate').length, 2);
});

test('a review must target the latest caller index even with intervening agent turns', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'semantic-sequence');
  await turn(mf, 'semantic-sequence', 'Do not send passwords. Is someone asking you for a code?', 0, 'agent');
  await turn(mf, 'semantic-sequence', codeText, 1);
  await turn(mf, 'semantic-sequence', 'A brief connection message.', 2, 'agent');
  assert.equal((await review(mf, 'semantic-sequence', 2, medium)).status, 409);
  assert.equal((await review(mf, 'semantic-sequence', '1', medium)).status, 409);
  assert.equal((await review(mf, 'semantic-sequence', 1, medium)).status, 200);
  await turn(mf, 'semantic-sequence', 'Now I need your password as well.', 3);
  assert.equal((await review(mf, 'semantic-sequence', 1, medium)).status, 409);
  assert.equal((await getCall(mf, 'semantic-sequence')).reviewStatus, 'pending');
  assert.equal((await review(mf, 'semantic-sequence', 3, medium)).status, 200);
});

test('invalid model decisions never become alerts or overwrite the pending state', async (t) => {
  const mf = runtime(t);
  const longQuote = 'x'.repeat(301);
  const invalid = [
    ['not-an-object', []],
    ['missing-boolean', { level: 'medium', signals: medium.signals }],
    ['string-boolean', { ...medium, shouldWarn: 'true' }],
    ['unknown-level', { ...medium, level: 'critical' }],
    ['low-warning', { ...medium, level: 'low' }],
    ['high-without-warning', { ...medium, level: 'high', shouldWarn: false }],
    ['benign-with-signals', { ...medium, level: 'low', shouldWarn: false }],
    ['no-evidence', { ...medium, signals: [] }],
    ['single-medium-signal', { ...medium, signals: [medium.signals[0]] }],
    ['single-high-signal', { ...medium, level: 'high', signals: [medium.signals[0]] }],
    ['pressure-without-action', { ...medium, signals: [{ kind: 'authority', evidence: 'county office' }, medium.signals[1]] }],
    ['action-without-pressure', { ...medium, signals: [medium.signals[0], { kind: 'link', evidence: 'send' }] }],
    ['unknown-kind', { ...medium, signals: [{ kind: 'accent', evidence: 'county' }] }],
    ['duplicated-kind', { ...medium, signals: [...medium.signals, ...medium.signals] }],
    ['invented-quote', { ...medium, signals: [{ kind: 'money_or_secret', evidence: 'send bitcoin' }] }],
    ['blank-quote', { ...medium, signals: [{ kind: 'money_or_secret', evidence: ' ' }] }],
    ['oversized-quote', { ...medium, signals: [{ kind: 'money_or_secret', evidence: longQuote }] }],
    ['too-many-signals', { ...medium, signals: Array(9).fill(medium.signals[0]) }],
    ['model-probability', { ...medium, probability: 0.99 }],
    ['model-offsets', { ...medium, signals: [{ ...medium.signals[0], start: 99999, end: 100000 }] }],
    ['model-explanation', { ...medium, signals: [{ ...medium.signals[0], explanation: 'This proves the caller is a scammer.' }] }],
  ];
  for (const [name, decision] of invalid) {
    await t.test(name, async () => {
      const id = `semantic-invalid-${name}`;
      await begin(mf, id);
      await turn(mf, id, `${codeText} The county office is here. ${longQuote}`);
      const result = await review(mf, id, 0, decision);
      assert.equal(result.status, 400, JSON.stringify(result.data));
      assert.equal((await getCall(mf, id)).reviewStatus, 'pending');
    });
  }
  assert.equal((await overview(mf)).alerts.filter(item => item.callId.startsWith('semantic-invalid-')).length, 0);
  assert.equal((await review(mf, `semantic-invalid-${invalid.at(-1)[0]}`, 0, medium)).status, 200, 'Invalid attempts must not consume the valid review slot');
});

test('agent-only evidence and evidence from a different call are rejected', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'semantic-other');
  await turn(mf, 'semantic-other', codeText);
  await begin(mf, 'semantic-agent-evidence');
  await turn(mf, 'semantic-agent-evidence', codeText, 0, 'agent');
  await turn(mf, 'semantic-agent-evidence', 'Hello, we are discussing shelter hours.', 1);
  assert.equal((await review(mf, 'semantic-agent-evidence', 1, medium)).status, 400);
  assert.equal((await overview(mf)).alerts.filter(item => item.callId === 'semantic-agent-evidence').length, 0);
});

test('semantic intake review retains the request and factual urgency without a resident warning', async (t) => {
  const mf = runtime(t);
  const id = 'eligible-responder-intake';
  await begin(mf, id, { purpose: 'intake' });
  const created = await turn(mf, id, `We need rescue near Riverbend, Zone 3. Water is rising inside and we cannot get out. ${codeText}`);
  assert.ok(created.caseId);
  assert.equal(created.warning, null);
  const before = (await overview(mf)).cases.find(item => item.id === created.caseId);
  assert.equal(before.priority, 'immediate');
  assert.equal(before.integrityReview.status, 'pending');
  const result = await review(mf, id, 0, { ...medium, uncertain: false });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.warning, null);
  const data = await overview(mf);
  const after = data.cases.find(item => item.id === created.caseId);
  assert.equal(after.integrityReview.status, 'review-required');
  assert.equal(after.integrityReview.signals.length, 2);
  assert.equal(after.priority, before.priority);
  assert.equal(after.immediateDanger, 'yes');
  assert.equal(after.zoneId, before.zoneId);
  assert.deepEqual(after.eligibleResponders, []);
  assert.equal(data.alerts.filter(item => item.callId === id).length, 0);
});

test('review eligibility is enforced after call mode, consent, closure, or revocation changes', async (t) => {
  const mf = runtime(t);
  const scenarios = [
    ['legacy-wording', { analysisMode: 'wording' }, 409],
    ['pending-consent', { consent: null }, 409],
    ['declined-consent', { consent: false }, 409],
    ['ended', {}, 409],
    ['revoked', {}, 410],
  ];
  for (const [name, options, expected] of scenarios) {
    await begin(mf, `ineligible-${name}`, options);
    if (!['pending-consent', 'declined-consent'].includes(name)) await turn(mf, `ineligible-${name}`, codeText);
    if (name === 'ended') assert.equal((await ingest(mf, 'call.ended', `ineligible-${name}`)).status, 200);
    if (name === 'revoked') assert.equal((await ingest(mf, 'consent.revoked', `ineligible-${name}`)).status, 200);
    const result = await review(mf, `ineligible-${name}`, 0, medium);
    assert.equal(result.status, expected, `${name}: ${JSON.stringify(result.data)}`);
  }
  const data = await overview(mf);
  assert.ok(data.alerts.filter(item => /^ineligible-/.test(item.callId)).every(item => item.analysisSource !== 'context-model'));
});

test('concurrent retries record only one semantic warning and preserve one decision', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'semantic-concurrent');
  await turn(mf, 'semantic-concurrent', codeText);
  const results = await Promise.all([
    review(mf, 'semantic-concurrent', 0, medium),
    review(mf, 'semantic-concurrent', 0, medium),
  ]);
  assert.ok(results.every(item => item.status === 200));
  assert.equal(results.filter(item => item.data.warning).length, 1);
  assert.equal(results.filter(item => item.data.duplicate).length, 1);
  assert.equal((await overview(mf)).alerts.filter(item => item.callId === 'semantic-concurrent').length, 1);
});

test('unavailable review stays explicit and cannot trigger fallback or overwrite a completed newer review', async (t) => {
  const mf = runtime(t);
  const started = await begin(mf, 'semantic-unavailable');
  await turn(mf, 'semantic-unavailable', 'I am from the county. Send gift cards right now and do not contact anyone else.');
  const unavailable = await ingest(mf, 'pressure.unavailable', 'semantic-unavailable', { sequence: 0 });
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.data.reviewStatus, 'unavailable');
  assert.equal(unavailable.data.warning, null);
  const token = new URL(started.warningUrl).hash.slice(1);
  const resident = await request(mf, '/api/guard/status', { token });
  assert.equal(resident.data.reviewStatus, 'unavailable');
  assert.deepEqual(resident.data.alerts, []);
  assert.equal((await review(mf, 'semantic-unavailable', 0, clear)).status, 200);
  assert.equal((await ingest(mf, 'pressure.unavailable', 'semantic-unavailable', { sequence: 0 })).data.reviewStatus, 'completed');
  await turn(mf, 'semantic-unavailable', 'We are still talking.', 1);
  assert.equal((await ingest(mf, 'pressure.unavailable', 'semantic-unavailable', { sequence: 0 })).status, 409);
  assert.equal((await getCall(mf, 'semantic-unavailable')).reviewStatus, 'pending');
  assert.equal((await overview(mf)).alerts.filter(item => item.callId === 'semantic-unavailable').length, 0);
});

test('start retries cannot switch semantic monitoring to wording rules', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'semantic-mode-fixed');
  assert.equal((await ingest(mf, 'call.started', 'semantic-mode-fixed', { purpose: 'guard', analysisMode: 'wording' })).status, 202);
  assert.equal((await getCall(mf, 'semantic-mode-fixed')).analysisMode, 'semantic');
  assert.equal((await turn(mf, 'semantic-mode-fixed', 'The county office says send gift cards immediately.')).warning, null);
  assert.equal((await overview(mf)).alerts.filter(item => item.callId === 'semantic-mode-fixed').length, 0);
});

test('ending with a pending semantic review reports unavailable rather than reviewing forever', async (t) => {
  const mf = runtime(t);
  const id = 'semantic-ended-pending';
  const started = await begin(mf, id);
  await turn(mf, id, codeText);
  const token = new URL(started.warningUrl).hash.slice(1);
  assert.equal((await request(mf, '/api/guard/status', { token })).data.reviewStatus, 'pending');
  assert.equal((await ingest(mf, 'call.ended', id)).status, 200);
  const status = await request(mf, '/api/guard/status', { token });
  assert.equal(status.status, 200);
  assert.equal(status.data.status, 'completed');
  assert.equal(status.data.analysisMode, 'semantic');
  assert.equal(status.data.reviewStatus, 'unavailable');
  assert.deepEqual(status.data.alerts, []);
  assert.equal((await review(mf, id, 0, medium)).status, 409, 'A late result cannot turn a closed call into a completed review');
});

test('revocation and retention scrub semantic evidence and prevent late review resurrection', async (t) => {
  for (const action of ['revoke', 'expire']) {
    await t.test(action, async (t) => {
      const mf = runtime(t);
      const id = `semantic-scrub-${action}`;
      const started = await begin(mf, id);
      await turn(mf, id, codeText);
      assert.equal((await review(mf, id, 0, medium)).status, 200);
      if (action === 'revoke') assert.equal((await ingest(mf, 'consent.revoked', id)).status, 200);
      else assert.equal((await command(mf, { action: 'transcripts.prune', cutoff: Date.now() + 1 })).status, 200);
      const call = await getCall(mf, id);
      assert.deepEqual(call.turns, []);
      assert.ok(!JSON.stringify(call).includes('verification code'));
      assert.equal(call.reviewIdentity, undefined);
      assert.equal(call.reviewStatus, undefined);
      assert.equal((await review(mf, id, 0, medium)).status, 410);
      assert.equal((await request(mf, '/api/guard/status', { token: new URL(started.warningUrl).hash.slice(1) })).status, 404);
      const data = await overview(mf);
      assert.ok(data.scamReviews.filter(item => item.sourceId === id).every(item => !item.text.includes('verification code')));
      assert.ok(data.alerts.filter(item => item.callId === id).every(item => item.signals.every(signal => signal.evidence === '[expired]')));
    });
  }
});

test('recipient-wide review status identifies the newest call while retaining prior-call warnings', async t => {
  const mf = runtime(t);
  const enrollment = await request(mf, '/api/guard/enrollment', { body: {}, token: 'test-ingest' });
  assert.equal(enrollment.status, 201);
  const recipientToken = new URL(enrollment.data.warningUrl).hash.slice(1);
  const beforeCalls = await request(mf, '/api/guard/status', { token: recipientToken });
  assert.equal(beforeCalls.data.currentCallId, null);

  const first = await begin(mf, 'recipient-earlier-risk');
  await turn(mf, 'recipient-earlier-risk', codeText);
  assert.ok((await review(mf, 'recipient-earlier-risk', 0, medium)).data.warning);
  assert.equal((await ingest(mf, 'call.ended', 'recipient-earlier-risk')).status, 200);
  await begin(mf, 'recipient-newest-benign');
  await turn(mf, 'recipient-newest-benign', 'This is the evacuation center. Please follow the posted safety instructions.');
  assert.equal((await review(mf, 'recipient-newest-benign', 0, clear)).status, 200);

  const latest = await request(mf, '/api/guard/status', { token: recipientToken });
  assert.equal(latest.status, 200);
  assert.equal(latest.data.currentCallId, 'recipient-newest-benign');
  assert.equal(latest.data.reviewStatus, 'completed');
  assert.deepEqual(latest.data.alerts.map(alert => alert.callId), ['recipient-earlier-risk']);
  const callBound = await request(mf, '/api/guard/status', { token: new URL(first.warningUrl).hash.slice(1) });
  assert.equal(callBound.data.currentCallId, 'recipient-earlier-risk', 'A call-scoped link keeps its own review/alert provenance');
  assert.deepEqual(callBound.data.alerts.map(alert => alert.callId), ['recipient-earlier-risk']);
});
