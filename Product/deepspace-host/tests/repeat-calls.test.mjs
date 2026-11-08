import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Exercise the compiled Worker and SQLite Durable Object. These fixture numbers
// are never dialled, and this runtime has no notification/provider credentials.
function runtime(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: new URL('../dist/signalbridge_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional repeat-call test shell') },
    bindings: {
      DEEPSPACE_APP_ID: 'repeat-calls-test', APP_NAME: 'repeat-calls-test',
      PHAROS_RESPONDER_PASSWORD: 'test-responder',
      PHAROS_COORDINATOR_PASSWORD: 'test-coordinator',
      PHAROS_SESSION_SECRET: 'repeat-call-session-secret-for-local-fixtures-only',
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

const number = '+15550001111';
const location = 'near the Riverbend footbridge, Zone 3';
const initial = `We need drinking water ${location}. We are safe. There are four of us.`;
const repeatSafe = `I am calling back about the same request ${location}. We are safe and still need drinking water.`;
const repeatDanger = `I am calling back about the same request ${location}. Now water is rising inside our house and we cannot get out.`;

async function begin(mf, id, { callerNumber = number, transport = 'sip', purpose = 'intake', consent = true } = {}) {
  const started = await ingest(mf, 'call.started', id, { transport, purpose, ...(callerNumber ? { callerNumber } : {}) });
  assert.equal(started.status, 202, JSON.stringify(started.data));
  if (consent !== undefined) {
    const accepted = await ingest(mf, 'consent', id, { consent });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  }
  return started.data;
}

async function turn(mf, id, text, sequence = 0) {
  const result = await ingest(mf, 'turn', id, { role: 'caller', text, sequence });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  return result.data;
}

async function report(mf, id, { text = initial, end = true, ...options } = {}) {
  await begin(mf, id, options);
  const result = await turn(mf, id, text);
  if (end) assert.equal((await ingest(mf, 'call.ended', id)).status, 200);
  return result.caseId;
}

async function login(mf, coordinator = false) {
  const result = await request(mf, '/api/auth/login', { body: { password: coordinator ? 'test-coordinator' : 'test-responder' } });
  assert.equal(result.status, 200);
  return result.response.headers.get('Set-Cookie').split(';')[0];
}

async function overview(mf, cookie) {
  const result = await request(mf, '/api/overview', { cookie: cookie || await login(mf) });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

async function getCase(mf, id) {
  const result = await command(mf, { action: 'case.get', id });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.caseRecord;
}

async function addResponder(mf, cookie) {
  const registered = await request(mf, '/api/responders', { cookie, body: {
    name: 'Fictional repeat-call responder', organization: 'Fictional test desk',
    serviceAreas: ['zone-river'], capabilities: ['general'], capacity: 2,
  } });
  assert.equal(registered.status, 201);
  const responder = registered.data.responder;
  const approved = await request(mf, `/api/responders/${responder.id}/approval`, {
    cookie: await login(mf, true), body: { approved: true },
  });
  assert.equal(approved.status, 200);
  return responder;
}

test('a confirmed repeat report preserves the owner and human decision until new danger escalates it', async (t) => {
  const mf = runtime(t);
  const cookie = await login(mf);
  const id = await report(mf, 'repeat-first');
  const before = await getCase(mf, id);
  const responder = await addResponder(mf, cookie);
  assert.equal((await request(mf, `/api/cases/${id}/claim`, { cookie, body: { responderId: responder.id } })).status, 200);
  assert.equal((await request(mf, `/api/cases/${id}/priority`, { cookie, body: { priority: 'follow-up', reason: 'Human confirmed a nonurgent supply delivery.' } })).status, 200);
  await begin(mf, 'repeat-second');
  assert.equal((await turn(mf, 'repeat-second', repeatSafe)).caseId, id);
  const unchanged = await getCase(mf, id);
  assert.equal(unchanged.assignedTo, responder.id);
  assert.equal(unchanged.priority, 'follow-up');
  assert.equal(unchanged.latestPriority, 'urgent');
  assert.equal(unchanged.priorityOverride.supersededAt, undefined);
  assert.equal(unchanged.createdAt, before.createdAt);
  assert.equal(unchanged.callId, 'repeat-second');
  assert.equal(unchanged.peopleCount, null, 'Missing facts in a fresh report must not silently inherit a past count');
  assert.equal(unchanged.linkedCallCount, 2);
  assert.ok(unchanged.history.some(entry => entry.kind === 'responder-review'));
  await turn(mf, 'repeat-second', 'Now water is rising inside our house and we cannot get out.', 1);
  const escalated = await getCase(mf, id);
  assert.equal(escalated.immediateDanger, 'yes');
  assert.equal(escalated.priority, 'immediate');
  assert.equal(escalated.latestPriority, 'immediate');
  assert.equal(escalated.reassessmentRequired, true);
  assert.ok(escalated.priorityOverride.supersededAt);
  assert.equal(escalated.assignedTo, responder.id);
  assert.equal(escalated.status, 'claimed');
  assert.ok(!escalated.transcript.includes('There are four of us.'), 'A case snapshot must not concatenate an earlier call transcript');
  assert.ok((await overview(mf, cookie)).calls.find(item => item.id === 'repeat-first').transcript.includes('There are four of us.'));
  assert.equal((await ingest(mf, 'call.ended', 'repeat-second')).status, 200);
  assert.equal(await report(mf, 'repeat-third', { text: repeatDanger }), id, 'Multiple prior calls to one case must not make matching ambiguous');
  assert.equal((await getCase(mf, id)).linkedCallCount, 3);
});

test('phone lookup keys and raw numbers never appear in responder, call, or warning output', async (t) => {
  const mf = runtime(t);
  const started = await begin(mf, 'repeat-private');
  await turn(mf, 'repeat-private', initial);
  const data = await overview(mf);
  const call = await command(mf, { action: 'call.get', id: 'repeat-private' });
  const warning = await request(mf, '/api/guard/status', { token: new URL(started.warningUrl).hash.slice(1) });
  for (const output of [started, data, call.data, warning.data]) {
    const encoded = JSON.stringify(output);
    assert.ok(!encoded.includes(number));
    assert.ok(!encoded.includes('callerRef'));
    assert.ok(!encoded.includes('callerNumber'));
  }
  assert.equal((await request(mf, '/api/overview')).status, 401);
});

test('shared phones, missing identity, browser callers, and broad zones do not merge requests', async (t) => {
  const scenarios = [
    ['different-number', { callerNumber: '+15550002222', text: repeatDanger }],
    ['missing-number', { callerNumber: '', text: repeatDanger }],
    ['invalid-number', { callerNumber: '555-000-1111', text: repeatDanger }],
    ['browser-asserted', { transport: 'webrtc', text: repeatDanger }],
    ['different-location', { text: 'I am calling back about the same request near the Northbank water tower, Zone 2. We need shelter.' }],
    ['zone-only', { text: 'I am calling back about the same request in Zone 3. We need shelter.' }],
    ['no-repeat-intent', { text: `We need rescue ${location}. Now water is rising inside.` }],
  ];
  for (const [name, options] of scenarios) {
    await t.test(name, async (t) => {
      const mf = runtime(t);
      const oldId = await report(mf, `old-${name}`);
      const newId = await report(mf, `new-${name}`, options);
      assert.ok(newId);
      assert.notEqual(newId, oldId);
      assert.equal((await getCase(mf, oldId)).callId, `old-${name}`);
    });
  }
});

test('guard calls and unconsented or withdrawn reports cannot supply distress history', async (t) => {
  for (const prior of ['guard', 'declined', 'revoked']) {
    await t.test(prior, async (t) => {
      const mf = runtime(t);
      let oldId;
      if (prior === 'guard') oldId = await report(mf, 'excluded-old', { purpose: 'guard' });
      else if (prior === 'declined') await begin(mf, 'excluded-old', { consent: false });
      else {
        oldId = await report(mf, 'excluded-old');
        assert.equal((await ingest(mf, 'consent.revoked', 'excluded-old')).status, 200);
      }
      const newId = await report(mf, 'excluded-new', { text: repeatDanger });
      assert.ok(newId);
      assert.notEqual(newId, oldId);
      assert.equal((await getCase(mf, newId)).linkedCallCount, 1);
    });
  }
});

test('an explicitly declined callback cannot read or mutate an earlier case', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'consented-old');
  const before = await getCase(mf, id);
  await begin(mf, 'declined-callback', { consent: false });
  const rejected = await ingest(mf, 'turn', 'declined-callback', { role: 'caller', text: repeatDanger, sequence: 0 });
  assert.equal(rejected.status, 403);
  assert.deepEqual(await getCase(mf, id), before);
});

test('resolved cases stay closed when a later report arrives from the same phone and location', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'resolved-old');
  const cookie = await login(mf);
  assert.equal((await request(mf, `/api/cases/${id}/status`, { cookie, body: { status: 'resolved' } })).status, 200);
  const fresh = await report(mf, 'resolved-new', { text: repeatDanger });
  assert.notEqual(fresh, id);
  assert.equal((await getCase(mf, id)).status, 'resolved');
  assert.equal((await getCase(mf, fresh)).priority, 'immediate');
});

test('a split callback merges its untouched provisional case after location is supplied', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'split-old');
  await begin(mf, 'split-new');
  const provisional = (await turn(mf, 'split-new', 'I am calling back about the same request. We need rescue.')).caseId;
  assert.ok(provisional);
  assert.notEqual(provisional, id);
  const confirmed = await turn(mf, 'split-new', `We are ${location}. Now water is rising inside.`, 1);
  assert.equal(confirmed.caseId, id);
  const data = await overview(mf);
  assert.equal(data.cases.filter(item => !item.synthetic).length, 1);
  assert.ok(!data.cases.some(item => item.id === provisional));
  assert.equal(data.calls.find(item => item.id === 'split-new').caseId, id);
});

test('human work on a provisional report prevents deletion during later matching', async (t) => {
  for (const action of ['resolve', 'priority', 'followup-owner']) {
    await t.test(action, async (t) => {
      const mf = runtime(t);
      const oldId = await report(mf, `worked-old-${action}`);
      await begin(mf, `worked-new-${action}`);
      const provisional = (await turn(mf, `worked-new-${action}`, 'I am calling back about the same request. We need rescue.')).caseId;
      const cookie = await login(mf);
      if (action === 'resolve') assert.equal((await request(mf, `/api/cases/${provisional}/status`, { cookie, body: { status: 'resolved' } })).status, 200);
      if (action === 'priority') assert.equal((await request(mf, `/api/cases/${provisional}/priority`, { cookie, body: { priority: 'urgent', reason: 'Human confirmed this is a separate household.' } })).status, 200);
      if (action === 'followup-owner') {
        const responder = await addResponder(mf, cookie);
        assert.equal((await request(mf, `/api/cases/${provisional}/followup-owner`, { cookie, body: { responderId: responder.id } })).status, 200);
      }
      const next = await turn(mf, `worked-new-${action}`, `We are ${location}. Now water is rising inside.`, 1);
      assert.equal(next.caseId, provisional);
      assert.notEqual(next.caseId, oldId);
      assert.equal((await overview(mf, cookie)).cases.filter(item => !item.synthetic).length, 2);
    });
  }
});

test('an active report cannot be overwritten by a parallel callback from the same phone', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'parallel-old');
  await Promise.all([begin(mf, 'parallel-one'), begin(mf, 'parallel-two')]);
  const updates = await Promise.all([
    turn(mf, 'parallel-one', repeatDanger),
    turn(mf, 'parallel-two', repeatDanger),
  ]);
  assert.equal(updates.filter(item => item.caseId === id).length, 1);
  assert.equal(new Set(updates.map(item => item.caseId)).size, 2);
  const data = await overview(mf);
  assert.equal(data.cases.filter(item => !item.synthetic).length, 2);
  assert.equal(data.calls.filter(item => /^parallel-(?:one|two)$/.test(item.id) && item.caseId === id).length, 1);
});

test('revoking an older linked call removes its history without destroying the newest report', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'revoke-old');
  assert.equal(await report(mf, 'revoke-new', { text: repeatDanger }), id);
  const before = await getCase(mf, id);
  assert.equal((await ingest(mf, 'consent.revoked', 'revoke-old')).status, 200);
  assert.equal((await ingest(mf, 'consent.revoked', 'revoke-old')).data.duplicate, true);
  assert.equal((await ingest(mf, 'call.ended', 'revoke-old')).data.duplicate, true);
  const after = await getCase(mf, id);
  assert.equal(after.callId, 'revoke-new');
  assert.equal(after.transcript, before.transcript);
  assert.deepEqual(after.turns, before.turns);
  assert.equal(after.priority, 'immediate');
  assert.ok(after.history.every(entry => entry.callId !== 'revoke-old'));
  assert.equal(after.linkedCallCount, 1);
  const old = (await command(mf, { action: 'call.get', id: 'revoke-old' })).data.call;
  assert.deepEqual(old.turns, []);
  assert.match(old.transcript, /removed/i);
});

test('expiry of an older source cannot erase a newer snapshot on the same case', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'expire-old');
  assert.equal(await report(mf, 'expire-new', { text: repeatDanger }), id);
  const data = await overview(mf);
  const old = data.calls.find(item => item.id === 'expire-old');
  const current = data.calls.find(item => item.id === 'expire-new');
  assert.ok(Date.parse(old.startedAt) < Date.parse(current.startedAt), 'Fixture calls need distinct start times');
  const before = await getCase(mf, id);
  assert.equal((await command(mf, { action: 'transcripts.prune', cutoff: Date.parse(current.startedAt) })).status, 200);
  const after = await getCase(mf, id);
  assert.equal(after.createdAt, before.createdAt);
  assert.equal(after.transcript, before.transcript);
  assert.deepEqual(after.turns, before.turns);
  assert.ok(after.history.every(entry => entry.callId !== 'expire-old'));
  assert.equal(after.linkedCallCount, 1);
  const expired = (await command(mf, { action: 'call.get', id: 'expire-old' })).data.call;
  assert.ok(expired.transcriptExpiredAt);
  assert.deepEqual(expired.turns, []);
});

test('new life-safety evidence reopens a case resolved during that still-active call', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'active-resolved', { end: false });
  const cookie = await login(mf);
  assert.equal((await request(mf, `/api/cases/${id}/status`, { cookie, body: { status: 'resolved' } })).status, 200);
  await turn(mf, 'active-resolved', 'Now water is rising inside our house and we cannot get out.', 1);
  const after = await getCase(mf, id);
  assert.equal(after.status, 'follow-up');
  assert.equal(after.priority, 'immediate');
  assert.equal(after.reassessmentRequired, true);
});

test('multiple different open cases on a shared phone and location remain ambiguous', async (t) => {
  const mf = runtime(t);
  const first = await report(mf, 'ambiguous-first');
  const second = await report(mf, 'ambiguous-second');
  assert.notEqual(second, first);
  const third = await report(mf, 'ambiguous-third', { text: repeatDanger });
  assert.notEqual(third, first);
  assert.notEqual(third, second);
  assert.equal((await overview(mf)).cases.filter(item => !item.synthetic).length, 3);
});

test('expired lookup history cannot be reused by a new call', async (t) => {
  const mf = runtime(t);
  const old = await report(mf, 'lookup-expired-old');
  assert.equal((await command(mf, { action: 'transcripts.prune', cutoff: Date.now() + 1 })).status, 200);
  const fresh = await report(mf, 'lookup-expired-new', { text: repeatDanger });
  assert.notEqual(fresh, old);
  assert.equal((await getCase(mf, fresh)).linkedCallCount, 1);
});

test('a protected scam call cannot consume an existing distress case', async (t) => {
  const mf = runtime(t);
  const old = await report(mf, 'guard-isolation-old');
  const before = await getCase(mf, old);
  assert.equal(await report(mf, 'guard-isolation-new', { purpose: 'guard', text: repeatDanger }), null);
  assert.deepEqual(await getCase(mf, old), before);
});

test('revoking the newest report removes its evidence without reviving an older snapshot', async (t) => {
  const mf = runtime(t);
  const id = await report(mf, 'newest-revoke-old');
  assert.equal(await report(mf, 'newest-revoke-new', { text: repeatDanger }), id);
  assert.equal((await ingest(mf, 'consent.revoked', 'newest-revoke-new')).status, 200);
  const record = await getCase(mf, id);
  assert.equal(record.callId, 'newest-revoke-new');
  assert.deepEqual(record.turns, []);
  assert.match(record.transcript, /removed/i);
  assert.ok(!record.transcript.includes('There are four of us.'));
  assert.ok(record.history.every(entry => entry.callId !== 'newest-revoke-new'));
  assert.equal(record.followUp, true);
});
