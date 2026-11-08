import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../../guard.js', import.meta.url), 'utf8');
const enrollment = 'a'.repeat(43);
const storageKey = 'pharos-warning-enrollment';
const endpoint = 'https://web.push.apple.com/test-only';
const warning = { id: 'warning-one', callId: 'call-one', createdAt: 1_800_000_000_000, headline: 'Pause and verify', confidence: 'A wording pattern, not a probability.', nextStep: 'Call a trusted number.', signals: [{ psychology: 'Urgency', evidence: 'Act now.', explanation: 'Pressure can rush a decision.' }] };
const status = alerts => ({ currentCallId: 'call-one', status: 'in-progress', expiresAt: 1_900_000_000_000, pushPublicKey: 'test-key', alerts });
const response = (data, httpStatus = 200) => ({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, json: async () => data });
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function client(options = {}) {
  const elements = new Map();
  const storage = new Map();
  const calls = [];
  const order = [];
  const timers = new Map();
  let nextTimer = 0;
  let reloads = 0;
  let vibrations = 0;
  const state = {
    onStatus: options.onStatus || (() => response(status([warning]))),
    onRemove: options.onRemove || (() => response({ removed: true })),
    subscription: options.subscription === undefined ? { endpoint, unsubscribe: async () => true } : options.subscription,
    lookupError: options.lookupError,
  };
  function element() {
    const classes = new Set();
    return {
      textContent: '', hidden: false, disabled: false, value: '', dataset: {}, children: [], listeners: {},
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      replaceChildren(...children) { this.children = children; },
      append(child) { this.children.push(child); },
      addEventListener(event, callback) { this.listeners[event] = callback; },
    };
  }
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  const browserRegistration = { pushManager: { getSubscription: async () => {
    if (state.lookupError) throw state.lookupError;
    return state.subscription;
  } } };
  const sandbox = {
    document: { querySelector: get, createElement: element },
    location: { hash: `#${enrollment}`, reload() { ++reloads; } },
    history: { replaceState() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: { serviceWorker: { getRegistration: async () => browserRegistration }, vibrate() { ++vibrations; } },
    window: {},
    setInterval(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearInterval: id => timers.delete(id),
    fetch: async (path, init) => {
      calls.push({ path, ...init });
      if (path === '/api/guard/status') return state.onStatus();
      if (path === '/api/guard/unsubscribe') { order.push('server'); return state.onRemove(); }
      throw new Error(`Unexpected request: ${path}`);
    },
    atob, Uint8Array,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'guard.js' });
  await settle();
  return {
    get, state, storage, calls, order, timers,
    get reloads() { return reloads; },
    get vibrations() { return vibrations; },
    value: expression => vm.runInContext(expression, context),
    refresh: () => vm.runInContext('refresh()', context),
    click: selector => get(selector).listeners.click(),
  };
}

function assertWarningCleared(page) {
  assert.equal(page.get('#warningCard').hidden, true);
  assert.equal(page.get('#warningCard').classList.contains('warn'), false);
  assert.equal(page.get('#waitingCard').hidden, false);
  assert.equal(page.get('#evidence').children.length, 0);
  for (const field of ['#warningTitle', '#warningConfidence', '#warningTime', '#nextStep']) assert.equal(page.get(field).textContent, '', field);
  assert.equal(page.value('lastAlert'), '');
}

test('an empty alert response removes the warning, quoted evidence, and cached alert ID', async () => {
  const page = await client();
  assert.equal(page.get('#warningCard').hidden, false);
  assert.equal(page.get('#evidence').children.length, 1);
  page.state.onStatus = () => response(status([]));
  await page.refresh();
  assertWarningCleared(page);
  assert.equal(page.storage.get(storageKey), enrollment, 'consent withdrawal clears evidence without discarding valid recipient access');
});

test('expired enrollment removes quoted evidence and local access', async () => {
  const page = await client();
  page.state.onStatus = () => response({ error: 'Enrollment expired' }, 404);
  await page.refresh();
  assertWarningCleared(page);
  assert.equal(page.storage.has(storageKey), false);
  assert.equal(page.value('token'), '');
  assert.equal(page.get('#disconnectPhone').hidden, true);
  assert.equal(page.timers.size, 0);
});

test('disconnect removes the server subscription before the browser subscription', async () => {
  const page = await client();
  page.state.subscription.unsubscribe = async () => { page.order.push('browser'); return true; };
  await page.click('#disconnectPhone');
  assert.deepEqual(page.order, ['server', 'browser']);
  const request = page.calls.find(call => call.path === '/api/guard/unsubscribe');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.Authorization, `Bearer ${enrollment}`);
  assert.deepEqual(JSON.parse(request.body), { endpoint });
  assert.equal(request.path.includes(enrollment), false);
  assert.equal(page.storage.has(storageKey), false);
  assert.equal(page.reloads, 1);
  assertWarningCleared(page);
});

test('confirmed server removal permits disconnect when browser unsubscribe fails', async () => {
  const page = await client();
  page.state.subscription.unsubscribe = async () => { throw new Error('Browser unavailable'); };
  await page.click('#disconnectPhone');
  assert.equal(page.reloads, 1);
  assert.equal(page.value('token'), '');
  assertWarningCleared(page);
});

test('confirmed browser unsubscribe permits disconnect when the server cannot be reached', async () => {
  const page = await client({ onRemove: () => { throw new Error('Offline'); } });
  await page.click('#disconnectPhone');
  assert.equal(page.reloads, 1);
  assert.equal(page.storage.has(storageKey), false);
});

for (const browserResult of ['throw', false]) {
  test(`dual disconnect failure retains access and offers a working retry (browser ${browserResult})`, async () => {
    const page = await client({ onRemove: () => response({ error: 'Unavailable' }, 503) });
    page.state.subscription.unsubscribe = async () => {
      if (browserResult === 'throw') throw new Error('Offline');
      return false;
    };
    await page.click('#disconnectPhone');
    assert.equal(page.reloads, 0);
    assert.equal(page.storage.get(storageKey), enrollment);
    assert.equal(page.value('token'), enrollment);
    assert.equal(page.get('#disconnectPhone').disabled, false);
    assert.match(page.get('#notificationStatus').textContent, /Could not confirm disconnection/);
    assert.equal(page.timers.size, 1, 'status polling resumes after a failed attempt');
    page.state.onRemove = () => response({ removed: true });
    await page.click('#disconnectPhone');
    assert.equal(page.reloads, 1);
    assert.equal(page.storage.has(storageKey), false);
  });
}

test('an HTTP success without confirmed server removal does not erase the retry token', async () => {
  const page = await client({ onRemove: () => response({ removed: false }) });
  page.state.subscription.unsubscribe = async () => false;
  await page.click('#disconnectPhone');
  assert.equal(page.reloads, 0);
  assert.equal(page.storage.get(storageKey), enrollment);
});

test('a browser with no subscription can disconnect after enrollment expires', async () => {
  const page = await client({ subscription: null, onRemove: () => response({ error: 'Expired' }, 404) });
  await page.click('#disconnectPhone');
  assert.equal(page.calls.some(call => call.path === '/api/guard/unsubscribe'), false);
  assert.equal(page.reloads, 1);
  assert.equal(page.storage.has(storageKey), false);
});

test('a failed subscription lookup does not falsely confirm disconnection', async () => {
  const page = await client({ lookupError: new Error('Browser unavailable') });
  await page.click('#disconnectPhone');
  assert.equal(page.reloads, 0);
  assert.equal(page.storage.get(storageKey), enrollment);
  assert.equal(page.get('#disconnectPhone').disabled, false);
});

test('an in-flight status response cannot restore evidence after disconnect', async () => {
  const page = await client();
  const delayed = deferred();
  page.state.onStatus = () => delayed.promise;
  const pending = page.refresh();
  await page.click('#disconnectPhone');
  delayed.resolve(response(status([warning])));
  await pending;
  assertWarningCleared(page);
  assert.equal(page.storage.has(storageKey), false);
});

test('re-pairing clears prior evidence and ignores an old enrollment response', async () => {
  const page = await client();
  const delayed = deferred();
  page.state.onStatus = () => delayed.promise;
  const pending = page.refresh();
  page.state.onStatus = () => response(status([]));
  const nextEnrollment = 'b'.repeat(43);
  page.get('#pairingInput').value = `https://example.invalid/guard.html#${nextEnrollment}`;
  await page.click('#pairButton');
  delayed.resolve(response({ error: 'Expired old enrollment' }, 404));
  await pending;
  assertWarningCleared(page);
  assert.equal(page.storage.get(storageKey), nextEnrollment);
  assert.equal(page.value('token'), nextEnrollment);
});

test('semantic pending shows a neutral review state without an early warning', async () => {
  const page = await client({ onStatus: () => response({ ...status([]), analysisMode: 'semantic', reviewStatus: 'pending' }) });
  assert.equal(page.get('#reviewCard').hidden, false);
  assert.equal(page.get('#reviewStatus').textContent, 'Reviewing the latest call wording…');
  assert.equal(page.get('#reviewCard').classList.contains('active'), false);
  assertWarningCleared(page);
  page.state.onStatus = () => response(status([]));
  await page.refresh();
  assert.equal(page.get('#reviewCard').hidden, true, 'calls without semantic review keep the existing flow');
  assert.equal(page.get('#reviewStatus').textContent, '');
});

test('semantic unavailable is unverified and retains an earlier returned context warning', async () => {
  const contextWarning = { ...warning, analysisSource: 'context-model' };
  const page = await client({ onStatus: () => response({ ...status([contextWarning]), analysisMode: 'semantic', reviewStatus: 'unavailable' }) });
  assert.equal(page.get('#reviewCard').hidden, false);
  assert.equal(page.get('#reviewStatus').textContent, 'Context review unavailable. This does not verify the caller. Check unexpected money, code, or access requests independently; continue immediate physical safety instructions.');
  assert.equal(page.get('#warningCard').hidden, false);
  assert.equal(page.get('#evidence').children.length, 1);
  assert.match(page.get('#warningTime').textContent, /^Contextual transcript review · /);
  assert.equal(page.get('#reviewCard').classList.contains('active'), false);
});

test('semantic completed never verifies safety and does not erase returned earlier alerts', async () => {
  const page = await client({ onStatus: () => response({ ...status([]), analysisMode: 'semantic', reviewStatus: 'completed' }) });
  assert.equal(page.get('#reviewStatus').textContent, 'No warning identified in this review. Caller identity and safety are not verified.');
  assertWarningCleared(page);
  page.state.onStatus = () => response({ ...status([{ ...warning, analysisSource: 'context-model' }]), analysisMode: 'semantic', reviewStatus: 'completed' });
  await page.refresh();
  assert.equal(page.get('#warningCard').hidden, false);
  assert.equal(page.get('#evidence').children.length, 1);
  assert.equal(page.get('#reviewStatus').textContent, 'Contextual transcript review completed. Review the warning below; caller identity and safety are not verified.');
  assert.equal(page.get('#reviewCard').classList.contains('active'), false);
});

test('an earlier risky-call warning is historical when the newest call review has no warning', async () => {
  const earlier = { ...warning, analysisSource: 'context-model' };
  const page = await client({ onStatus: () => response({ ...status([earlier]), currentCallId: 'newer-call', analysisMode: 'semantic', reviewStatus: 'completed' }) });
  assert.equal(page.get('#warningCard').hidden, false, 'Retain the previous warning and evidence');
  assert.equal(page.get('#evidence').children.length, 1);
  assert.equal(page.get('#warningTitle').textContent, 'Earlier call warning: Pause and verify');
  assert.match(page.get('#warningTime').textContent, /^Earlier call · Contextual transcript review · /);
  assert.ok(page.get('#warningTime').textContent.includes(String(new Date(earlier.createdAt).getFullYear())), 'Historical warnings show a date, not only a clock time');
  assert.equal(page.get('#reviewStatus').textContent, 'No warning identified in the latest call review. An earlier call warning is retained below. Caller identity and safety are not verified.');
});

test('a pending or unavailable newest review does not present the previous call warning as new', async () => {
  const page = await client();
  for (const reviewStatus of ['pending', 'unavailable']) {
    page.state.onStatus = () => response({ ...status([{ ...warning, id: `earlier-${reviewStatus}`, analysisSource: 'context-model' }]), currentCallId: 'newest-call', analysisMode: 'semantic', reviewStatus });
    await page.refresh();
    assert.match(page.get('#warningTitle').textContent, /^Earlier call warning:/);
    assert.match(page.get('#reviewStatus').textContent, /An earlier call warning is retained below/);
    assert.equal(page.vibrations, 0, 'Historical evidence does not trigger a new-warning vibration');
  }
});

test('a current-call warning is preferred while earlier-call alerts remain in the response', async () => {
  const earlier = { ...warning, id: 'old-warning', callId: 'old-call' };
  const current = { ...warning, id: 'current-warning', callId: 'current-call', headline: 'Current call needs verification' };
  const alerts = [earlier, current];
  const page = await client({ onStatus: () => response({ ...status(alerts), currentCallId: 'current-call', analysisMode: 'semantic', reviewStatus: 'completed' }) });
  assert.equal(page.get('#warningTitle').textContent, 'Current call needs verification');
  assert.ok(!page.get('#warningTime').textContent.includes('Earlier call'));
  assert.equal(page.get('#reviewStatus').textContent, 'Contextual transcript review completed. Review the warning below; caller identity and safety are not verified.');
  assert.deepEqual(alerts.map(alert => alert.id), ['old-warning', 'current-warning'], 'Display selection does not erase retained alert history');
});
