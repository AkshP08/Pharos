import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Regression tests for the actual compiled Worker and local SQLite Durable
// Object. No .env/.dev.vars files are loaded; all credentials/data are fixtures.
function options(secured = true) {
  return convertV4MiniflareOptions({
    modules: true,
    scriptPath: new URL('../dist/pharos_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional-data test shell') },
    bindings: {
      DEEPSPACE_APP_ID: 'lifecycle-test-only', APP_NAME: 'pharos-lifecycle-test',
      ...(secured ? {
        PHAROS_RESPONDER_PASSWORD: 'test-responder',
        PHAROS_COORDINATOR_PASSWORD: 'test-coordinator',
        PHAROS_SESSION_SECRET: 'lifecycle-session-secret-never-used-outside-tests',
        PHAROS_INGEST_TOKEN: 'test-ingest',
      } : {}),
    },
  });
}

function runtime(t, secured = true) {
  const mf = new Miniflare(options(secured));
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

async function command(mf, body) {
  const namespace = await mf.getDurableObjectNamespace('PHAROS_STORE');
  const response = await namespace.get(namespace.idFromName('pharos-primary')).fetch('https://pharos-store.local/command', {
    method: 'POST', body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

function ingest(mf, event, callId, payload = {}) {
  return request(mf, '/api/voice/ingest', { body: { event, callId, ...payload }, token: 'test-ingest' });
}

async function start(mf, callId, purpose = 'intake') {
  const started = await ingest(mf, 'call.started', callId, { purpose, analysisMode: purpose === 'intake' ? 'semantic' : 'rules' });
  assert.equal(started.status, 202, JSON.stringify(started.data));
  const consent = await ingest(mf, 'consent', callId, { consent: true });
  assert.equal(consent.status, 200, JSON.stringify(consent.data));
  return started.data;
}

async function login(mf, coordinator = false) {
  const result = await request(mf, '/api/auth/login', {
    body: { password: coordinator ? 'test-coordinator' : 'test-responder' },
  });
  assert.equal(result.status, 200);
  return result.response.headers.get('Set-Cookie').split(';')[0];
}

async function overview(mf, cookie) {
  const result = await request(mf, '/api/overview', { cookie });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

async function addResponder(mf, cookie, coordinatorCookie, overrides = {}) {
  const result = await request(mf, '/api/responders', {
    cookie, body: {
      name: 'Fictional lifecycle responder', organization: 'Fictional test desk',
      serviceAreas: ['zone-river'], capabilities: ['general'], capacity: 1,
      ...overrides,
    },
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const responder = result.data.responder;
  const approved = await request(mf, `/api/responders/${responder.id}/approval`, {
    cookie: coordinatorCookie, body: { approved: true },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  return responder;
}

async function acceptForWorkflow(mf, id, cookie) {
  const current = await command(mf, { action: 'case.get', id });
  assert.equal(current.status, 200);
  const review = current.data.caseRecord.integrityReview;
  const result = await request(mf, `/api/cases/${id}/integrity-review`, { cookie, body: {
    decision: 'accept', reason: 'Fictional desk verified the current report for the lifecycle workflow.',
    expectedVersion: review.version, expectedSourceCallId: review.sourceCallId, expectedSequence: review.sourceSequence,
  } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.caseRecord.integrityReview.status, 'accepted');
}

const help = 'We need rescue near Riverbend, Zone 3. Water is rising inside and we cannot get out.';
const guardedRisk = 'I am the county relief office. Send a gift card fee within five minutes and do not call anyone else.';
const intakeConcern = `${help} Send me gift cards within five minutes.`;
async function assessIntakeConcern(mf, callId) {
  const result = await ingest(mf, 'pressure.review', callId, { sequence: 0, review: {
    shouldWarn: true, level: 'medium', uncertain: false,
    signals: [{ kind: 'money_or_secret', evidence: 'gift cards' }, { kind: 'deadline', evidence: 'within five minutes' }],
  } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.warning, null, 'A contextual intake concern never sends a resident warning');
  return result;
}

test('voice events require consent, preserve retries, and reject gaps/conflicts without losing a partial case', async (t) => {
  const mf = runtime(t);
  const callId = 'ordered-lifecycle';
  assert.equal((await ingest(mf, 'call.started', callId)).status, 202);
  assert.equal((await ingest(mf, 'turn', callId, { role: 'caller', text: help, sequence: 0 })).status, 403);
  assert.equal((await command(mf, { action: 'call.get', id: callId })).data.call.turns.length, 0);
  assert.equal((await ingest(mf, 'consent', callId, { consent: true })).status, 200);
  const first = await ingest(mf, 'turn', callId, { role: 'caller', text: help, sequence: 0 });
  assert.equal(first.status, 202);
  assert.ok(first.data.caseId, 'A partial help case must exist before hang-up');
  const retriedStart = await ingest(mf, 'call.started', callId, { purpose: 'guard' });
  assert.equal(retriedStart.data.purpose, 'intake');
  assert.equal((await ingest(mf, 'turn', callId, { role: 'caller', text: 'A conflicting replacement', sequence: 0 })).status, 409);
  assert.equal((await ingest(mf, 'turn', callId, { role: 'caller', text: 'A missing earlier turn', sequence: 2 })).status, 409);
  const duplicate = await ingest(mf, 'turn', callId, { role: 'caller', text: help, sequence: 0 });
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(duplicate.data.caseId, first.data.caseId);
  assert.equal((await ingest(mf, 'turn', callId, { role: 'caller', text: 'There are four of us.', sequence: 1 })).status, 202);
  const ended = await ingest(mf, 'call.ended', callId, { deliveryFailed: true });
  assert.equal(ended.status, 200);
  assert.equal(ended.data.caseId, first.data.caseId);
  assert.equal((await ingest(mf, 'call.ended', callId)).data.duplicate, true);
  assert.equal((await ingest(mf, 'turn', callId, { role: 'caller', text: 'Late new speech', sequence: 2 })).status, 409);
  const cookie = await login(mf);
  const data = await overview(mf, cookie);
  const storedCall = data.calls.find(item => item.id === callId);
  const storedCase = data.cases.find(item => item.id === first.data.caseId);
  assert.equal(storedCall.consent, 'yes');
  assert.equal(storedCall.status, 'failed');
  assert.equal(storedCall.turns.length, 2);
  assert.equal(storedCase.peopleCount, 4);
  assert.equal(storedCase.followUp, true);
  assert.match(storedCase.priorityReason, /incomplete/i);
  assert.equal(data.cases.filter(item => item.callId === callId).length, 1);
});

test('concurrent duplicate intake retries produce one retained case and one contextual assessment', async (t) => {
  const mf = runtime(t);
  await start(mf, 'parallel-retry');
  const payload = { role: 'caller', text: intakeConcern, sequence: 0 };
  const results = await Promise.all([
    ingest(mf, 'turn', 'parallel-retry', payload),
    ingest(mf, 'turn', 'parallel-retry', payload),
  ]);
  assert.ok(results.every(item => item.status === 202));
  assert.ok(results.every(item => item.data.warning === null));
  assert.equal(new Set(results.map(item => item.data.caseId)).size, 1);
  const before = (await command(mf, { action: 'case.get', id: results[0].data.caseId })).data.caseRecord;
  const reviews = await Promise.all([assessIntakeConcern(mf, 'parallel-retry'), assessIntakeConcern(mf, 'parallel-retry')]);
  assert.equal(reviews.filter(item => item.data.duplicate).length, 1);
  const data = await overview(mf, await login(mf));
  assert.equal(data.calls.find(item => item.id === 'parallel-retry').turns.length, 1);
  assert.equal(data.cases.filter(item => item.callId === 'parallel-retry').length, 1);
  assert.equal(data.alerts.filter(item => item.callId === 'parallel-retry').length, 0);
  const after = data.cases.find(item => item.id === results[0].data.caseId);
  assert.equal(after.integrityReview.version, before.integrityReview.version + 1);
  assert.equal(after.integrityReview.status, 'review-required');
  assert.equal(after.integrityReview.signals.length, 2);
  assert.equal(after.priority, 'immediate', 'The concern must not demote reported danger');
});

test('guarded speech warns during the call, escalates once, and never creates a help case', async (t) => {
  const mf = runtime(t);
  const callId = 'guard-escalation';
  await start(mf, callId, 'guard');
  const first = await ingest(mf, 'turn', callId, { role: 'caller', text: 'Please send me your verification code.', sequence: 0 });
  assert.equal(first.status, 202);
  assert.equal(first.data.warning.level, 'medium');
  assert.equal(first.data.caseId, null);
  const stronger = await ingest(mf, 'turn', callId, { role: 'caller', text: 'I am the county relief office. You must do this right now.', sequence: 1 });
  assert.equal(stronger.status, 202);
  assert.equal(stronger.data.warning.level, 'high');
  assert.notEqual(first.data.warning.id, stronger.data.warning.id);
  const repeated = await ingest(mf, 'turn', callId, { role: 'caller', text: 'Send the verification code right now.', sequence: 2 });
  assert.equal(repeated.data.warning, null);
  const ended = await ingest(mf, 'call.ended', callId);
  assert.equal(ended.data.caseId, null);
  const data = await overview(mf, await login(mf));
  assert.equal(data.cases.filter(item => item.callId === callId).length, 0);
  assert.equal(data.alerts.filter(item => item.callId === callId).length, 2);
});

test('resident enrollment precedes calls and per-call tokens cannot read another call', async (t) => {
  const mf = runtime(t);
  assert.equal((await request(mf, '/api/guard/enrollment', { body: {} })).status, 401);
  const enrollment = await request(mf, '/api/guard/enrollment', { body: {}, token: 'test-ingest' });
  assert.equal(enrollment.status, 201);
  const recipientToken = new URL(enrollment.data.warningUrl).hash.slice(1);
  assert.equal((await request(mf, '/api/guard/status', { token: recipientToken })).data.alerts.length, 0);
  const guardA = await start(mf, 'recipient-guard-a', 'guard');
  await start(mf, 'recipient-guard-b', 'guard');
  await ingest(mf, 'turn', 'recipient-guard-b', { role: 'caller', text: guardedRisk, sequence: 0 });
  await start(mf, 'recipient-intake', 'intake');
  await ingest(mf, 'turn', 'recipient-intake', { role: 'caller', text: `Someone called me saying: ${guardedRisk}`, sequence: 0 });
  const resident = await request(mf, '/api/guard/status', { token: recipientToken });
  assert.equal(resident.status, 200);
  assert.deepEqual(resident.data.alerts.map(item => item.callId), ['recipient-guard-b']);
  const isolated = await request(mf, '/api/guard/status', { token: new URL(guardA.warningUrl).hash.slice(1) });
  assert.equal(isolated.status, 200);
  assert.deepEqual(isolated.data.alerts, []);
  assert.equal((await request(mf, '/api/guard/status')).status, 401);
  assert.equal((await request(mf, '/api/guard/status', { token: 'A'.repeat(43) })).status, 404);
});

test('consent withdrawal scrubs retained speech and safely acknowledges revoke/end retries', async (t) => {
  const mf = runtime(t);
  const callId = 'withdrawal-lifecycle';
  const started = await start(mf, callId);
  const turn = await ingest(mf, 'turn', callId, { role: 'caller', text: intakeConcern, sequence: 0 });
  assert.ok(turn.data.caseId);
  assert.equal(turn.data.warning, null);
  await assessIntakeConcern(mf, callId);
  const before = (await command(mf, { action: 'case.get', id: turn.data.caseId })).data.caseRecord;
  assert.equal(before.integrityReview.signals.length, 2, 'The fixture must contain actual quoted evidence before withdrawal');
  assert.equal((await ingest(mf, 'consent.revoked', callId)).status, 200);
  assert.equal((await ingest(mf, 'consent.revoked', callId)).data.duplicate, true);
  assert.equal((await ingest(mf, 'call.ended', callId)).data.duplicate, true);
  assert.ok((await ingest(mf, 'turn', callId, { role: 'caller', text: 'New private speech', sequence: 1 })).status >= 400);
  assert.equal((await request(mf, '/api/guard/status', { token: new URL(started.warningUrl).hash.slice(1) })).status, 404);
  const data = await overview(mf, await login(mf));
  const call = data.calls.find(item => item.id === callId);
  const caseRecord = data.cases.find(item => item.id === turn.data.caseId);
  assert.equal(call.consent, 'no');
  assert.deepEqual(call.turns, []);
  assert.match(call.transcript, /withdrawn/i);
  assert.deepEqual(caseRecord.turns, []);
  assert.deepEqual(caseRecord.scamSignals, []);
  assert.deepEqual(caseRecord.integrityReview.signals, []);
  assert.equal(caseRecord.integrityReview.status, 'review-required');
  assert.ok(!JSON.stringify(caseRecord).includes('gift cards'));
  assert.equal(caseRecord.followUp, true);
  assert.equal(data.alerts.some(item => item.callId === callId), false);
  assert.equal(data.scamReviews.some(item => item.sourceId === callId), false);
});

test('human priority survives later speech and an owner outside corrected coverage is flagged', async (t) => {
  const mf = runtime(t);
  const cookie = await login(mf);
  const coordinator = await login(mf, true);
  const responder = await addResponder(mf, cookie, coordinator);
  const callId = 'review-corrected-area';
  await start(mf, callId);
  const first = await ingest(mf, 'turn', callId, { role: 'caller', text: 'We need a ride. We are safe in Riverbend, Zone 3.', sequence: 0 });
  const path = `/api/cases/${first.data.caseId}`;
  assert.equal((await request(mf, `${path}/priority`, { cookie, body: { priority: 'immediate', reason: 'Human confirmed a new time-critical concern' } })).status, 200);
  await acceptForWorkflow(mf, first.data.caseId, cookie);
  assert.equal((await request(mf, `${path}/claim`, { cookie, body: { responderId: responder.id } })).status, 200);
  await ingest(mf, 'turn', callId, { role: 'caller', text: 'Actually, my location is Northbank, Zone 2.', sequence: 1 });
  const record = (await overview(mf, cookie)).cases.find(item => item.id === first.data.caseId);
  assert.equal(record.zoneId, 'zone-north');
  assert.equal(record.priority, 'immediate');
  assert.match(record.priorityOverride.reason, /Human confirmed/);
  assert.equal(record.assignedTo, responder.id, 'An accountable owner should remain visible until reassignment');
  assert.equal(record.assignmentNeedsReview, true);
  assert.equal(record.followUp, true);
});

test('unassigned location gets an accountable follow-up owner and transfer/dispatch use one capacity slot', async (t) => {
  const mf = runtime(t);
  const cookie = await login(mf);
  const coordinator = await login(mf, true);
  const firstOwner = await addResponder(mf, cookie, coordinator, { name: 'Fictional first desk' });
  const secondOwner = await addResponder(mf, cookie, coordinator, { name: 'Fictional second desk' });
  const callId = 'unassigned-owned';
  await start(mf, callId);
  const first = await ingest(mf, 'turn', callId, { role: 'caller', text: 'I need a ride to shelter, next to a blue water tower. I do not know the area.', sequence: 0 });
  const path = `/api/cases/${first.data.caseId}`;
  let data = await overview(mf, cookie);
  assert.equal(data.cases.find(item => item.id === first.data.caseId).zoneId, null);
  await acceptForWorkflow(mf, first.data.caseId, cookie);
  assert.equal((await request(mf, `${path}/claim`, { cookie, body: { responderId: firstOwner.id } })).status, 403);
  const owned = await request(mf, `${path}/followup-owner`, { cookie, body: { responderId: firstOwner.id } });
  assert.equal(owned.status, 200, JSON.stringify(owned.data));
  assert.equal(owned.data.caseRecord.followUpOwner, firstOwner.id);
  assert.equal((await request(mf, `${path}/followup-owner`, { cookie, body: { responderId: firstOwner.id } })).data.alreadyOwned, true);
  assert.equal((await request(mf, `${path}/followup-owner`, { cookie, body: { responderId: secondOwner.id } })).status, 200);
  data = await overview(mf, cookie);
  assert.equal(data.responders.find(item => item.id === firstOwner.id).assignedCount, 0);
  assert.equal(data.responders.find(item => item.id === secondOwner.id).assignedCount, 1);
  await ingest(mf, 'turn', callId, { role: 'caller', text: 'Actually, my location is Riverbend, Zone 3.', sequence: 1 });
  const claimed = await request(mf, `${path}/claim`, { cookie, body: { responderId: secondOwner.id } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.data));
  assert.equal(claimed.data.caseRecord.followUpOwner, null);
  assert.equal(claimed.data.responder.assignedCount, 1, 'Converting follow-up to dispatch must not double-count capacity');
  assert.equal((await request(mf, `${path}/claim`, { cookie, body: { responderId: secondOwner.id } })).status, 200);
  assert.equal((await request(mf, `${path}/status`, { cookie, body: { status: 'resolved' } })).status, 200);
  assert.equal((await request(mf, `${path}/status`, { cookie, body: { status: 'resolved' } })).status, 200);
  data = await overview(mf, cookie);
  assert.equal(data.responders.find(item => item.id === secondOwner.id).assignedCount, 0);
  const reopened = await request(mf, `${path}/status`, { cookie, body: { status: 'new' } });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.data.caseRecord.assignedTo, null);
  assert.equal(reopened.data.caseRecord.followUpOwner, null);
});

test('demo-only mode cannot mutate a known live record after auth configuration is removed', async (t) => {
  const mf = runtime(t);
  await start(mf, 'live-record-must-stay-private');
  const created = await ingest(mf, 'turn', 'live-record-must-stay-private', { role: 'caller', text: help, sequence: 0 });
  assert.ok(created.data.caseId);
  await mf.setOptions(options(false));
  const stored = await command(mf, { action: 'case.get', id: created.data.caseId });
  assert.equal(stored.status, 200, 'The reload must preserve the underlying live record for this regression');
  assert.equal(stored.data.caseRecord.synthetic, false);
  const publicData = await overview(mf);
  assert.equal(publicData.cases.some(item => item.id === created.data.caseId), false);
  for (const [operation, body] of [
    ['status', { status: 'resolved' }],
    ['priority', { priority: 'follow-up', reason: 'An unauthenticated attempted edit' }],
    ['followup-owner', { responderId: 'resp-county' }],
    ['claim', { responderId: 'resp-county' }],
  ]) {
    const result = await request(mf, `/api/cases/${created.data.caseId}/${operation}`, { body });
    assert.equal(result.status, 404, operation);
  }
  const after = await command(mf, { action: 'case.get', id: created.data.caseId });
  assert.equal(after.data.caseRecord.status, stored.data.caseRecord.status);
  assert.equal(after.data.caseRecord.priority, stored.data.caseRecord.priority);
});

test('retention expiry removes evidence from calls, cases, reviews, and warnings and closes resident access', async (t) => {
  const mf = runtime(t);
  const callId = 'retention-lifecycle';
  const started = await start(mf, callId);
  const created = await ingest(mf, 'turn', callId, { role: 'caller', text: intakeConcern, sequence: 0 });
  assert.ok(created.data.caseId);
  assert.equal(created.data.warning, null);
  await assessIntakeConcern(mf, callId);
  const before = (await overview(mf, await login(mf))).cases.find(item => item.id === created.data.caseId);
  assert.equal(before.integrityReview.signals.length, 2, 'Retention must remove real retained evidence, not pass on an empty fixture');
  assert.equal((await ingest(mf, 'call.ended', callId)).status, 200);
  const prune = await command(mf, { action: 'transcripts.prune', cutoff: Date.now() + 1000 });
  assert.equal(prune.status, 200);
  const data = await overview(mf, await login(mf));
  const call = data.calls.find(item => item.id === callId);
  const record = data.cases.find(item => item.id === created.data.caseId);
  assert.deepEqual(call.turns, []);
  assert.deepEqual(record.turns, []);
  assert.match(call.transcript, /expired/i);
  assert.ok(call.transcriptExpiredAt);
  assert.ok(record.scamSignals.every(signal => signal.evidence === '[expired]'));
  assert.deepEqual(record.integrityReview.signals, []);
  assert.equal(record.integrityReview.status, 'review-required');
  assert.ok(data.scamReviews.filter(item => item.sourceId === callId).every(item => item.signals.every(signal => signal.evidence === '[expired]')));
  assert.ok(data.alerts.filter(item => item.callId === callId).every(item => item.signals.every(signal => signal.evidence === '[expired]')));
  assert.equal((await request(mf, '/api/guard/status', { token: new URL(started.warningUrl).hash.slice(1) })).status, 404);
  assert.equal((await ingest(mf, 'turn', callId, { role: 'caller', text: 'Cannot resurrect expired speech', sequence: 1 })).status, 410);
});
