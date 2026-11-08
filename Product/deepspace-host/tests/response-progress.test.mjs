import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Local compiled Worker/SQLite tests only. Phone identifiers and credentials are
// fictional, and no telephone, model, push, or SMS provider is configured.
function options(secured = true) {
  return convertV4MiniflareOptions({
    modules: true,
    scriptPath: new URL('../dist/signalbridge_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional progress test shell') },
    bindings: { DEEPSPACE_APP_ID: 'response-progress-test', APP_NAME: 'response-progress-test', ...(secured ? {
      PHAROS_RESPONDER_PASSWORD: 'test-responder', PHAROS_COORDINATOR_PASSWORD: 'test-coordinator',
      PHAROS_SESSION_SECRET: 'response-progress-local-fixture-secret', PHAROS_INGEST_TOKEN: 'test-ingest',
    } : {}) },
  });
}

function runtime(t) {
  const mf = new Miniflare(options());
  t.after(() => mf.dispose());
  return mf;
}

async function request(mf, path, { body, token, cookie } = {}) {
  const response = await mf.dispatchFetch(`http://pharos.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

async function login(mf, coordinator = false) {
  const result = await request(mf, '/api/auth/login', { body: { password: coordinator ? 'test-coordinator' : 'test-responder' } });
  assert.equal(result.status, 200);
  return result.response.headers.get('Set-Cookie').split(';')[0];
}

const safe = 'We need drinking water near the Riverbend footbridge, Zone 3. We are safe.';

async function begin(mf, id, { purpose = 'intake', consent = true } = {}) {
  assert.equal((await ingest(mf, 'call.started', id, { purpose, transport: 'sip', analysisMode: 'semantic', callerNumber: '+15550001111' })).status, 202);
  if (consent !== null) assert.equal((await ingest(mf, 'consent', id, { consent })).status, 200);
}

async function turn(mf, id, text, sequence = 0) {
  const result = await ingest(mf, 'turn', id, { role: 'caller', text, sequence });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  return result.data;
}

async function getCase(mf, id) {
  const result = await command(mf, { action: 'case.get', id });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.caseRecord;
}

async function responder(mf, cookie, overrides = {}) {
  const result = await request(mf, '/api/responders', { cookie, body: {
    name: 'Fictional travel responder', organization: 'Fictional desk', serviceAreas: ['zone-river'],
    capabilities: ['general'], capacity: 3, ...overrides,
  } });
  assert.equal(result.status, 201);
  assert.equal((await request(mf, `/api/responders/${result.data.responder.id}/approval`, {
    cookie: await login(mf, true), body: { approved: true },
  })).status, 200);
  return result.data.responder;
}

async function acceptForProgress(mf, id, cookie) {
  const { integrityReview: review } = await getCase(mf, id);
  const result = await request(mf, `/api/cases/${id}/integrity-review`, { cookie, body: {
    decision: 'accept', reason: 'Fictional desk verified this report before testing response progress.',
    expectedVersion: review.version, expectedSourceCallId: review.sourceCallId, expectedSequence: review.sourceSequence,
  } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.caseRecord.integrityReview.status, 'accepted');
}

async function assigned(mf, callId = 'progress-call') {
  const cookie = await login(mf);
  await begin(mf, callId);
  const id = (await turn(mf, callId, safe)).caseId;
  await acceptForProgress(mf, id, cookie);
  const owner = await responder(mf, cookie);
  assert.equal((await request(mf, `/api/cases/${id}/claim`, { cookie, body: { responderId: owner.id } })).status, 200);
  return { id, owner, cookie, callId };
}

async function write(mf, setup, progress) {
  const current = await getCase(mf, setup.id);
  return request(mf, `/api/cases/${setup.id}/progress`, { cookie: setup.cookie, body: {
    responderId: setup.owner.id, expectedUpdatedAt: current.updatedAt, ...progress,
  } });
}

function read(mf, callId, authorization = { token: 'test-ingest' }) {
  return request(mf, `/api/voice/calls/${callId}/progress`, authorization);
}

test('voice progress distinguishes collecting details from a desk receipt and never invents an ETA', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'progress-collecting');
  const collecting = await read(mf, 'progress-collecting');
  assert.equal(collecting.status, 200);
  assert.equal(collecting.data.accepted, true);
  assert.equal(collecting.data.state, 'pending');
  assert.equal(collecting.data.announce, false);
  assert.match(collecting.data.message, /still being collected/i);
  assert.match(collecting.data.message, /arrival time.*not confirmed/i);
  await turn(mf, 'progress-collecting', safe);
  const receipt = await read(mf, 'progress-collecting');
  assert.equal(receipt.data.state, 'review-needed', 'A pending contextual review is held for human verification, even when its reported facts are nonurgent');
  assert.equal(receipt.data.announce, false);
  assert.match(receipt.data.message, /(?:desk|review)/i);
  assert.match(receipt.data.message, /(?:not confirmed|isn't confirmed|unconfirmed)/i);
  assert.ok(!/\b\d+\s*minutes?\b|on (?:the|their) way|has arrived/i.test(receipt.data.message));
  for (const key of ['transcript', 'turns', 'caseRecord', 'callerNumber', 'callerRef', 'responders']) assert.equal(receipt.data[key], undefined);
});

test('only ingest credentials can read voice progress and responder authentication is required to write', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-auth');
  assert.equal((await read(mf, setup.callId, {})).status, 401);
  assert.equal((await read(mf, setup.callId, { cookie: setup.cookie })).status, 401);
  assert.equal((await read(mf, setup.callId, { token: 'wrong-token' })).status, 401);
  const current = await getCase(mf, setup.id);
  assert.equal((await request(mf, `/api/cases/${setup.id}/progress`, { body: {
    responderId: setup.owner.id, expectedUpdatedAt: current.updatedAt, state: 'en-route', etaMinutes: 10,
  } })).status, 401);
  assert.equal((await getCase(mf, setup.id)).responseProgress, undefined);
});

test('an assigned responder supplies an explicit estimate, delay, and self-reported arrival', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf);
  const before = Date.now();
  const written = await write(mf, setup, { state: 'en-route', etaMinutes: 12 });
  assert.equal(written.status, 200, JSON.stringify(written.data));
  const progress = (await getCase(mf, setup.id)).responseProgress;
  assert.equal(progress.state, 'en-route');
  assert.equal(progress.responderId, setup.owner.id);
  assert.ok(Date.parse(progress.etaAt) >= before + 12 * 60_000);
  assert.ok(Date.parse(progress.etaAt) <= Date.now() + 12 * 60_000);
  const first = await read(mf, setup.callId);
  assert.equal(first.data.state, 'en-route');
  assert.equal(first.data.announce, true);
  assert.match(first.data.message, /12/);
  assert.match(first.data.message, /(?:estimate|estimated)/i);
  assert.equal((await read(mf, setup.callId)).data.revision, first.data.revision);
  assert.ok((await getCase(mf, setup.id)).history.some(entry => /(?:progress|en.route|arrival)/i.test(`${entry.summary} ${entry.reason}`)));
  assert.equal((await write(mf, setup, { state: 'delayed', etaMinutes: 20 })).status, 200);
  const delayed = await read(mf, setup.callId);
  assert.equal(delayed.data.state, 'delayed');
  assert.notEqual(delayed.data.revision, first.data.revision);
  assert.match(delayed.data.message, /20/);
  assert.equal((await write(mf, setup, { state: 'arrived' })).status, 200);
  const arrived = await read(mf, setup.callId);
  assert.equal(arrived.data.state, 'arrived');
  assert.equal((await getCase(mf, setup.id)).responseProgress.etaAt, null);
  assert.match(arrived.data.message, /(?:reported|reports|desk)/i, 'Arrival must be attributed to the responder, not verified by Pharos');
});

test('progress rejects missing versions and invalid estimates, and derives ownership from the assignment', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-invalid');
  const other = await responder(mf, setup.cookie);
  const cases = [
    { state: 'en-route' }, { state: 'en-route', etaMinutes: 0 }, { state: 'en-route', etaMinutes: 181 },
    { state: 'en-route', etaMinutes: 1.5 }, { state: 'en-route', etaMinutes: '10' },
    { state: 'en-route', etaMinutes: true }, { state: 'delayed' },
    { state: 'arrived', etaMinutes: 10 }, { state: 'unable', etaMinutes: 10 }, { state: 'flying', etaMinutes: 10 },
  ];
  for (const value of cases) {
    const result = await write(mf, setup, value);
    assert.equal(result.status, 400, JSON.stringify({ value, result: result.data }));
    assert.equal((await getCase(mf, setup.id)).responseProgress, undefined);
  }
  const current = await getCase(mf, setup.id);
  assert.equal((await request(mf, `/api/cases/${setup.id}/progress`, { cookie: setup.cookie, body: {
    responderId: setup.owner.id, state: 'en-route', etaMinutes: 10,
  } })).status, 409);
  const attributed = await request(mf, `/api/cases/${setup.id}/progress`, { cookie: setup.cookie, body: {
    responderId: other.id, expectedUpdatedAt: current.updatedAt, state: 'en-route', etaMinutes: 10,
  } });
  assert.equal(attributed.status, 200, JSON.stringify(attributed.data));
  assert.equal((await getCase(mf, setup.id)).responseProgress.responderId, setup.owner.id);
});

test('fresh danger invalidates an estimate and a stale form cannot restore it', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-danger');
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 10 })).status, 200);
  const old = await getCase(mf, setup.id);
  await turn(mf, setup.callId, 'Now water is rising inside our house and we cannot get out.', 1);
  const updated = await getCase(mf, setup.id);
  assert.equal(updated.assignedTo, setup.owner.id);
  assert.equal(updated.responseProgress.state, 'review-needed');
  assert.equal(updated.responseProgress.etaAt, null);
  assert.equal((await read(mf, setup.callId)).data.state, 'review-needed');
  const stale = await request(mf, `/api/cases/${setup.id}/progress`, { cookie: setup.cookie, body: {
    responderId: setup.owner.id, expectedUpdatedAt: old.updatedAt, state: 'en-route', etaMinutes: 10,
  } });
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.equal((await getCase(mf, setup.id)).responseProgress.state, 'review-needed');
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 15 })).status, 200);
  const reviewed = (await getCase(mf, setup.id)).responseProgress;
  await turn(mf, setup.callId, 'There are three of us now.', 2);
  assert.deepEqual((await getCase(mf, setup.id)).responseProgress, reviewed, 'A people-count update must not masquerade as fresh worsening danger');
});

test('location correction invalidates travel, while unrelated additional facts preserve it', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-location');
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 10 })).status, 200);
  const before = (await getCase(mf, setup.id)).responseProgress;
  await turn(mf, setup.callId, 'There are three of us.', 1);
  assert.deepEqual((await getCase(mf, setup.id)).responseProgress, before);
  await turn(mf, setup.callId, 'Actually we are near the Northbank water tower, Zone 2.', 2);
  const corrected = await getCase(mf, setup.id);
  assert.equal(corrected.responseProgress.state, 'review-needed');
  assert.equal(corrected.responseProgress.etaAt, null);
  assert.equal(corrected.assignedTo, setup.owner.id);
  assert.equal(corrected.assignmentNeedsReview, true);
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 10 })).status, 409);
});

test('an elapsed estimate changes revision and never becomes zero minutes or an automatic arrival', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-expired-eta');
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 1 })).status, 200);
  const first = await read(mf, setup.callId);
  const record = await getCase(mf, setup.id);
  record.responseProgress.etaAt = new Date(Date.now() - 60_000).toISOString();
  assert.equal((await command(mf, { action: 'case.put', caseRecord: record })).status, 200);
  const expired = await read(mf, setup.callId);
  assert.equal(expired.data.state, 'delayed');
  assert.equal(expired.data.announce, true);
  assert.notEqual(expired.data.revision, first.data.revision);
  assert.match(expired.data.message, /(?:estimate|estimated).*(?:passed|expired)/i);
  assert.ok(!/\b0\s*minutes?\b|has arrived|have arrived/i.test(expired.data.message));
});

test('approval withdrawal suppresses a former estimate, and follow-up ownership cannot claim travel', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-approved');
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 10 })).status, 200);
  assert.equal((await request(mf, `/api/responders/${setup.owner.id}/approval`, {
    cookie: await login(mf, true), body: { approved: false },
  })).status, 200);
  assert.equal((await read(mf, setup.callId)).data.state, 'review-needed');
  assert.equal((await write(mf, setup, { state: 'arrived' })).status, 409);
  await begin(mf, 'progress-followup');
  const id = (await turn(mf, 'progress-followup', 'We need shelter but I do not know where we are.')).caseId;
  await acceptForProgress(mf, id, setup.cookie);
  const owner = await responder(mf, setup.cookie);
  assert.equal((await request(mf, `/api/cases/${id}/followup-owner`, { cookie: setup.cookie, body: { responderId: owner.id } })).status, 200);
  assert.equal((await write(mf, { id, owner, cookie: setup.cookie }, { state: 'en-route', etaMinutes: 10 })).status, 409);
  assert.equal((await read(mf, 'progress-followup')).data.state, 'pending');
});

test('releasing or resolving a case clears prior travel and a new assignee receives no inherited ETA', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-release');
  assert.equal((await write(mf, setup, { state: 'en-route', etaMinutes: 10 })).status, 200);
  assert.equal((await request(mf, `/api/cases/${setup.id}/status`, { cookie: setup.cookie, body: { status: 'new' } })).status, 200);
  assert.ok(!(await getCase(mf, setup.id)).responseProgress);
  assert.equal((await read(mf, setup.callId)).data.state, 'pending');
  const next = await responder(mf, setup.cookie);
  assert.equal((await request(mf, `/api/cases/${setup.id}/claim`, { cookie: setup.cookie, body: { responderId: next.id } })).status, 200);
  assert.ok(!(await getCase(mf, setup.id)).responseProgress);
  assert.equal((await write(mf, { ...setup, owner: next }, { state: 'unable' })).status, 200);
  const unable = await read(mf, setup.callId);
  assert.equal(unable.data.state, 'unable');
  assert.ok(!/on (?:the|their) way/i.test(unable.data.message));
  assert.equal((await request(mf, `/api/cases/${setup.id}/status`, { cookie: setup.cookie, body: { status: 'resolved' } })).status, 200);
  assert.ok(!(await getCase(mf, setup.id)).responseProgress);
  const resolved = await read(mf, setup.callId);
  assert.equal(resolved.data.state, 'resolved');
  assert.match(resolved.data.message, /(?:marked|desk|reported)/i);
  assert.ok(!/on (?:the|their) way/i.test(resolved.data.message));
  assert.equal((await write(mf, { ...setup, owner: next }, { state: 'arrived' })).status, 409);
});

test('one of two concurrent progress forms wins and the other must refresh its version', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-version');
  const current = await getCase(mf, setup.id);
  const results = await Promise.all([10, 20].map(etaMinutes => request(mf, `/api/cases/${setup.id}/progress`, {
    cookie: setup.cookie, body: { responderId: setup.owner.id, expectedUpdatedAt: current.updatedAt, state: 'en-route', etaMinutes },
  })));
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  assert.notEqual((await getCase(mf, setup.id)).updatedAt, current.updatedAt);
});

test('guard, declined, revoked, and expired calls cannot retrieve a distress response', async (t) => {
  const mf = runtime(t);
  await begin(mf, 'progress-guard', { purpose: 'guard' });
  assert.equal((await read(mf, 'progress-guard')).status, 403);
  await begin(mf, 'progress-declined', { consent: false });
  assert.equal((await read(mf, 'progress-declined')).status, 403);
  await begin(mf, 'progress-revoked');
  await turn(mf, 'progress-revoked', safe);
  assert.equal((await ingest(mf, 'consent.revoked', 'progress-revoked')).status, 200);
  assert.ok([403, 410].includes((await read(mf, 'progress-revoked')).status));
  await begin(mf, 'progress-retained');
  await turn(mf, 'progress-retained', safe);
  assert.equal((await command(mf, { action: 'transcripts.prune', cutoff: Date.now() + 1 })).status, 200);
  assert.equal((await read(mf, 'progress-retained')).status, 410);
});

test('demo mode cannot update a known live response estimate', async (t) => {
  const mf = runtime(t);
  const setup = await assigned(mf, 'progress-demo-isolation');
  const current = await getCase(mf, setup.id);
  await mf.setOptions(options(false));
  const denied = await request(mf, `/api/cases/${setup.id}/progress`, { body: {
    responderId: setup.owner.id, expectedUpdatedAt: current.updatedAt, state: 'en-route', etaMinutes: 10,
  } });
  assert.equal(denied.status, 404);
  assert.equal((await getCase(mf, setup.id)).responseProgress, undefined);
});
