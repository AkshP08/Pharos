import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Exercise the compiled Worker with real local SQLite-backed Durable Objects.
// These fixtures never load .dev.vars or contact Photon, LiveKit, or DeepSpace.
const instances = [];
function runtime(secured = false) {
  const options = {
    modules: true,
    scriptPath: new URL('../dist/signalbridge_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Pharos login shell') },
    bindings: {
      DEEPSPACE_APP_ID: 'test-only', APP_NAME: 'pharos-test',
      ...(secured ? {
        PHAROS_RESPONDER_PASSWORD: 'test-responder',
        PHAROS_COORDINATOR_PASSWORD: 'test-coordinator',
        PHAROS_SESSION_SECRET: 'test-session-secret-never-used-outside-tests',
        PHAROS_INGEST_TOKEN: 'test-ingest',
      } : {}),
    },
  };
  // The installed Miniflare 5 beta provides an adapter for this binding format.
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  instances.push(mf);
  return mf;
}

async function request(mf, path, { body, headers = {}, method } = {}) {
  const response = await mf.dispatchFetch(`http://pharos.test${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.text();
  return { response, data };
}

async function login(mf, password) {
  const { response } = await request(mf, '/api/auth/login', { body: { password } });
  assert.equal(response.status, 200);
  return response.headers.get('Set-Cookie').split(';')[0];
}

const helpTranscript = [
  '[Pharos] Are you in immediate danger right now?',
  '[Caller] Yes. Water is rising inside and we cannot get out.',
  '[Pharos] Where are you or what nearby landmark should responders use?',
  '[Caller] Near the Riverbend footbridge, Zone 3.',
  '[Pharos] What help do you need most?',
  '[Caller] We need rescue and transport.',
].join('\n');

test('secured workspace serves the login shell and assets while protecting records', async () => {
  const mf = runtime(true);
  for (const path of ['/', '/index.html', '/app.js', '/styles.css']) {
    const { response, data } = await request(mf, path);
    assert.equal(response.status, 200, path);
    assert.equal(data, 'Pharos login shell');
  }
  const anonymous = await request(mf, '/api/overview');
  assert.equal(anonymous.response.status, 401);
  const hostingHealth = await request(mf, '/api/auth/ok');
  assert.equal(hostingHealth.response.status, 200);
  assert.equal(hostingHealth.data, 'ok');
  const cookie = await login(mf, 'test-responder');
  assert.equal((await request(mf, '/api/overview', { headers: { Cookie: cookie } })).response.status, 200);
  assert.equal((await request(mf, '/api/overview', { headers: { Cookie: `${cookie}tampered` } })).response.status, 401);
});

test('synthetic call creates a persistent ranked case with area and eligible responders', async () => {
  const mf = runtime();
  const { response, data } = await request(mf, '/api/demo/calls', { body: { transcript: helpTranscript } });
  assert.equal(response.status, 201);
  assert.equal(data.caseRecord.priority, 'immediate');
  assert.equal(data.caseRecord.zoneId, 'zone-river');
  assert.equal(data.call.turns[0].role, 'agent');
  assert.equal(data.caseRecord.locationText, 'Near the Riverbend footbridge, Zone 3.');
  assert.ok(data.caseRecord.eligibleResponders.length > 0);
  const overview = (await request(mf, '/api/overview')).data;
  assert.ok(overview.cases.some(item => item.id === data.caseRecord.id));
  assert.ok(overview.calls.some(item => item.id === data.call.id && item.caseId === data.caseRecord.id));
});

test('scam-only call gets evidence and next steps without creating a help case', async () => {
  const mf = runtime();
  const { response, data } = await request(mf, '/api/demo/calls', { body: {
    transcript: 'Caller: Is this a scam? Someone called me claiming to be the county relief office and asked for gift cards within 5 minutes. Do not call anyone else, they said.',
  } });
  assert.equal(response.status, 201);
  assert.equal(data.caseRecord, null);
  assert.equal(data.callKind, 'scam-check');
  assert.equal(data.scamReview.level, 'high');
  assert.ok(data.scamReview.signals.some(signal => signal.evidence === 'gift cards'));
});

test('live transcript requires consent, excludes sample responders, and survives a demo reset', async () => {
  const mf = runtime(true);
  const ingest = body => request(mf, '/api/voice/ingest', { body, headers: { Authorization: 'Bearer test-ingest' } });
  const callId = 'test-consented-call';
  assert.equal((await ingest({ event: 'call.started', callId })).response.status, 202);
  assert.equal((await ingest({ event: 'turn', callId, role: 'caller', text: 'Need help', sequence: 0 })).response.status, 403);
  assert.equal((await ingest({ event: 'consent', callId, consent: true })).response.status, 200);
  assert.equal((await ingest({ event: 'turn', callId, role: 'caller', text: 'We need rescue. Water is rising inside near Riverbend, Zone 3. Someone asked for gift cards within 5 minutes.', sequence: 0 })).response.status, 202);
  const end = await ingest({ event: 'call.ended', callId });
  assert.equal(end.response.status, 200);
  assert.ok(end.data.caseId);
  const cookie = await login(mf, 'test-responder');
  const overview = (await request(mf, '/api/overview', { headers: { Cookie: cookie } })).data;
  const liveCase = overview.cases.find(item => item.id === end.data.caseId);
  assert.equal(liveCase.synthetic, false);
  assert.deepEqual(liveCase.eligibleResponders, []);
  const reset = await request(mf, '/api/demo/reset', { body: {}, headers: { Cookie: cookie } });
  assert.equal(reset.response.status, 200);
  const afterReset = (await request(mf, '/api/overview', { headers: { Cookie: cookie } })).data;
  assert.ok(afterReset.cases.some(item => item.id === end.data.caseId));
  const namespace = await mf.getDurableObjectNamespace('PHAROS_STORE');
  const store = namespace.get(namespace.idFromName('pharos-primary'));
  const expiry = await store.fetch('https://pharos-store.local/command', {
    method: 'POST', body: JSON.stringify({ action: 'transcripts.prune', cutoff: Date.now() + 1000 }),
  });
  assert.equal(expiry.status, 200);
  const pruned = (await request(mf, '/api/overview', { headers: { Cookie: cookie } })).data;
  const expiredCase = pruned.cases.find(item => item.id === end.data.caseId);
  assert.deepEqual(expiredCase.turns, []);
  assert.ok(expiredCase.scamSignals.length > 0);
  assert.ok(expiredCase.scamSignals.every(signal => signal.evidence === '[expired]'));
  assert.ok(pruned.scamReviews.filter(item => item.sourceId === callId).every(item => item.signals.every(signal => signal.evidence === '[expired]')));
});

after(async () => { await Promise.all(instances.map(mf => mf.dispose())); });
