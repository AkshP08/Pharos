import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../../app.js', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const initialTime = Date.parse('2026-11-08T08:00:00Z');
const clone = value => structuredClone(value);
const settle = () => new Promise(resolve => setImmediate(resolve));
const encoded = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function caseRecord(id, overrides = {}) {
  return {
    id, title: `Request ${id}`, transcript: `Fictional report for ${id}.`, turns: [], needs: ['transport'], synthetic: true,
    zoneId: 'west', zoneName: 'West', locationText: 'West pickup point', locationStatus: 'matched',
    status: 'new', priority: 'urgent', priorityRank: 2, priorityReason: 'Caller reported needing transport.',
    createdAt: '2026-11-08T07:00:00Z', updatedAt: '2026-11-08T07:00:00Z',
    assignedTo: null, followUpOwner: null, eligibleResponders: ['responder-one'], history: [],
    integrityReview: { status: 'clear', version: 1, sourceCallId: `call-${id}`, sourceSequence: 1, analysisStatus: 'complete', basis: 'content', reason: 'No supported integrity concern.', signals: [], updatedAt: '2026-11-08T07:00:00Z' }, ...overrides,
  };
}
function responder(id = 'responder-one', overrides = {}) {
  return { id, name: 'Test Responder', organization: 'Test Team', synthetic: true, approved: true, available: true, capacity: 4, assignedCount: 0, capabilities: ['general', 'transport'], serviceAreas: ['west'], ...overrides };
}
function integrityReview(status, overrides = {}) {
  return { status, version: 7, sourceCallId: 'reviewed-call', sourceSequence: 4, analysisStatus: 'complete', basis: 'content', reason: 'Repeated threats and a request for a payment code require verification.', signals: [{ label: 'Risky request', evidence: 'Give me the payment code', explanation: 'A code can transfer value before independent verification.' }], updatedAt: '2026-11-08T07:50:00Z', ...overrides };
}
const audioMetadata = { available: true, callId: 'recorded-call', durationSeconds: 20, expiresAt: '2026-11-09T08:00:00Z' };
function snapshot(cases = [caseRecord('case-one')], overrides = {}) {
  return { mode: 'secured', role: 'coordinator', incidents: [], zones: [{ id: 'west', name: 'West' }, { id: 'east', name: 'East' }], responders: [responder()], cases, calls: [], scamReviews: [], alerts: [], ...overrides };
}

// Exercise the shipped script and its event handlers. The DOM is a deliberately
// small test double; every fetch is handled here and cannot reach a service.
async function beacon(data = snapshot()) {
  const nodes = new Map();
  const requests = [];
  const intervals = [];
  const selectedAreas = new Set();
  const selectedCapabilities = new Set();
  const actions = new Map();
  const audioUrls = [];
  const revokedAudioUrls = [];
  let now = initialTime;
  let checkedWrites = 0;
  const backend = { data: clone(data), authenticated: true, overview: null };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function element(selector) {
    let markup = '';
    let text = '';
    const attributes = new Map();
    const classes = new Set();
    return {
      value: '', hidden: false, disabled: false, required: false, checked: false, open: false, className: '', dataset: {}, children: [], listeners: new Map(),
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value), toggle(value, force) { const present = force === undefined ? !classes.has(value) : Boolean(force); if (present) classes.add(value); else classes.delete(value); return present; } },
      setAttribute: (key, value) => attributes.set(key, String(value)),
      getAttribute: key => attributes.get(key) ?? null,
      removeAttribute: key => attributes.delete(key),
      get href() { return attributes.get('href') || ''; },
      set href(value) { attributes.set('href', String(value)); },
      addEventListener(event, callback) { const listeners = this.listeners.get(event) || []; listeners.push(callback); this.listeners.set(event, listeners); },
      append(child) { this.children.push(child); },
      focus() {}, scrollIntoView() {}, reset() {}, pauseCount: 0, loadCount: 0,
      pause() { ++this.pauseCount; }, load() { ++this.loadCount; },
      get src() { return attributes.get('src') || ''; },
      set src(value) { attributes.set('src', String(value)); },
      get innerHTML() { return markup; },
      set innerHTML(value) { markup = String(value); text = markup.replace(/<[^>]*>/g, ''); this.children = []; if (selector === '#responderAreaOptions') ++checkedWrites; },
      get textContent() { return text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { text = String(value ?? ''); markup = encoded(text); this.children = []; },
    };
  }
  function node(selector) {
    if (selector.startsWith('#')) assert.ok(ids.includes(selector.slice(1)), `app references absent HTML element ${selector}`);
    if (!nodes.has(selector)) nodes.set(selector, element(selector));
    return nodes.get(selector);
  }
  const tabs = ['all', 'immediate', 'followup', 'resolved'].map(filter => {
    const tab = element(`tab-${filter}`); tab.dataset.filter = filter; return tab;
  });
  const document = {
    querySelector: node,
    querySelectorAll(selector) {
      if (selector === '.queue-tab') return tabs;
      if (selector === 'input[name="responderArea"]:checked') return [...selectedAreas].map(value => ({ value }));
      if (selector === 'input[name="responderCapability"]:checked') return [...selectedCapabilities].map(value => ({ value }));
      if (selector === 'input, textarea, select') return [...nodes.values()];
      return [];
    },
    addEventListener() {},
    createElement: tag => element(tag),
  };
  const sandbox = {
    document, Headers, Date: Clock, console,
    URL: class extends URL {
      static createObjectURL(blob) { assert.ok(blob instanceof Blob); const url = `blob:https://beacon.example.invalid/audio-${audioUrls.length + 1}`; audioUrls.push(url); return url; }
      static revokeObjectURL(url) { revokedAudioUrls.push(url); }
    },
    window: { location: { href: 'https://beacon.example.invalid/', origin: 'https://beacon.example.invalid' }, clearTimeout() {}, setTimeout() { return 1; }, setInterval(callback) { intervals.push(callback); return intervals.length; } },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (path, init = {}) => {
      const request = { path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, credentials: init.credentials, cache: init.cache };
      requests.push(request);
      let result;
      if (request.method === 'GET' && path === '/api/auth/status') result = { required: true, authenticated: backend.authenticated, role: 'coordinator' };
      else if (request.method === 'GET' && path === '/api/overview') result = backend.overview ? await backend.overview() : clone(backend.data);
      else if (request.method === 'GET' && path === '/api/health') result = { voiceRoute: 'ready', persistentStorage: 'sqlite-durable-object', transcriptRetentionHours: 24 };
      else if (request.method === 'POST' && path === '/api/auth/logout') { backend.authenticated = false; result = {}; }
      else {
        const action = actions.get(`${request.method} ${path}`);
        assert.ok(action, `Unexpected request: ${request.method} ${path}`);
        result = await action(request);
      }
      const status = result?.httpStatus || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => clone(result?.httpStatus ? result.body : result), blob: async () => result.audioBlob || new Blob(['fictional-WAV'], { type: 'audio/wav' }) };
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: 'app.js' });
  await settle();
  async function dispatch(target, type, extra = {}) {
    const event = { preventDefault() {}, currentTarget: target, target, ...extra };
    for (const listener of target.listeners.get(type) || []) await listener(event);
  }
  return {
    node, nodes, requests, backend, actions, selectedAreas, audioUrls, revokedAudioUrls,
    get checkedWrites() { return checkedWrites; },
    get now() { return now; },
    advance(minutes) { now += minutes * 60_000; },
    run: expression => vm.runInContext(expression, context),
    poll: () => intervals[0](),
    click: selector => dispatch(node(selector), 'click'),
    submit: selector => dispatch(node(selector), 'submit'),
    change: selector => dispatch(node(selector), 'change'),
    input: selector => dispatch(node(selector), 'input'),
    tab: filter => dispatch(tabs.find(tab => tab.dataset.filter === filter), 'click'),
    allDom: () => [...nodes.values()].map(element => [element.innerHTML, element.textContent, element.value].join('\n')).join('\n'),
  };
}

test('Beacon markup has unique IDs and supplies the selectors used by the shipped client', () => {
  assert.equal(ids.length, new Set(ids).size);
  const references = [...source.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(references)].filter(id => !ids.includes(id)), []);
});

test('unknown-location immediate cases remain visible in the ranked action queue', async () => {
  const page = await beacon(snapshot([
    caseRecord('urgent-old', { createdAt: '2026-11-08T06:00:00Z' }),
    caseRecord('immediate-unknown', { priority: 'immediate', priorityRank: 0, zoneId: null, zoneName: null, locationText: 'Unmatched place', locationStatus: 'unknown', followUp: true, eligibleResponders: [], createdAt: '2026-11-08T07:30:00Z' }),
    caseRecord('immediate-old', { priority: 'immediate', priorityRank: 0, createdAt: '2026-11-08T07:00:00Z' }),
  ]));
  const queue = page.node('#queueList').innerHTML;
  assert.ok(queue.indexOf('data-case-id="immediate-old"') < queue.indexOf('data-case-id="immediate-unknown"'));
  assert.ok(queue.indexOf('data-case-id="immediate-unknown"') < queue.indexOf('data-case-id="urgent-old"'));
  assert.match(queue, /Location follow-up unassigned/);
  assert.equal(page.node('#immediateTabCount').textContent, '2');
  page.node('#zoneFilter').value = 'unassigned';
  await page.change('#zoneFilter');
  assert.equal(page.run('selectedCaseId'), 'immediate-unknown');
  assert.equal(page.node('#priorityLabel').textContent, 'Immediate life-safety');
  assert.equal(page.node('#assignButton').textContent, 'Assign follow-up owner');
  assert.equal(page.node('#responseProgressEta').hidden, true);
});

test('area and resolved filters update counts and replace out-of-area selections', async () => {
  const page = await beacon(snapshot([
    caseRecord('west-immediate', { priority: 'immediate', priorityRank: 0 }),
    caseRecord('east-open', { zoneId: 'east', zoneName: 'East' }),
    caseRecord('east-followup', { zoneId: 'east', zoneName: 'East', priority: 'follow-up', priorityRank: 3, followUp: true }),
    caseRecord('east-resolved', { zoneId: 'east', zoneName: 'East', status: 'resolved' }),
  ]));
  assert.equal(page.run('selectedCaseId'), 'west-immediate');
  page.node('#zoneFilter').value = 'east';
  await page.change('#zoneFilter');
  assert.equal(page.run('selectedCaseId'), 'east-open');
  assert.equal(page.node('#allTabCount').textContent, '2');
  assert.equal(page.node('#immediateTabCount').textContent, '0');
  assert.equal(page.node('#followupTabCount').textContent, '1');
  assert.equal(page.node('#resolvedTabCount').textContent, '1');
  assert.equal(page.node('#activeCount').textContent, '03', 'workspace total remains distinct from area counts');
  assert.equal(page.node('#queueBadge').textContent, '2');
  assert.doesNotMatch(page.node('#queueList').innerHTML, /west-immediate/);
  await page.tab('resolved');
  assert.equal(page.run('selectedCaseId'), 'east-resolved');
  assert.equal(page.node('#resolveButton').textContent, 'Reopen for review');
  assert.equal(page.node('#followupList').hidden, true);
  assert.equal(page.node('#queueBadge').textContent, '1');
  page.node('#zoneFilter').value = 'unassigned';
  await page.change('#zoneFilter');
  assert.equal(page.run('selectedCaseId'), null);
  assert.equal(page.node('#caseTitle').textContent, 'No case selected');
  assert.equal(page.node('#assignButton').disabled, true);
});

test('claim waits for the server, refreshes persisted ownership, and never invents travel', async () => {
  const page = await beacon();
  const gate = deferred();
  page.actions.set('POST /api/cases/case-one/claim', async request => {
    assert.deepEqual(request.body, { responderId: 'responder-one' });
    await gate.promise;
    Object.assign(page.backend.data.cases[0], { assignedTo: 'responder-one', status: 'claimed' });
    return { caseRecord: page.backend.data.cases[0], responder: page.backend.data.responders[0] };
  });
  page.node('#responderSelect').value = 'responder-one';
  const pending = page.click('#assignButton');
  assert.equal(page.node('#assignButton').disabled, true);
  assert.equal(page.run('appData.cases[0].assignedTo'), null);
  gate.resolve();
  await pending;
  assert.match(page.node('#caseOwner').textContent, /Response owner: Test Responder/);
  assert.equal(page.node('#assignButton').textContent, 'Case claimed');
  assert.match(page.node('#responseProgressTitle').textContent, /arrival not confirmed/);
  assert.equal(page.node('#responseProgressEta').hidden, true);
  assert.match(page.node('#toast').textContent, /No external dispatch was sent/);
  const reloaded = await beacon(page.backend.data);
  assert.match(reloaded.node('#caseOwner').textContent, /Response owner: Test Responder/);
  assert.ok(page.requests.filter(request => request.path === '/api/overview').length >= 2);
  assert.ok(page.requests.every(request => request.credentials === 'same-origin' && request.cache === 'no-store'));
});

test('unknown locations use eligible follow-up ownership rather than a dispatch claim', async () => {
  const page = await beacon(snapshot([caseRecord('unknown', { zoneId: null, zoneName: null, eligibleResponders: [], followUp: true })], {
    responders: [responder('eligible', { capabilities: ['information'] }), responder('wrong-workspace', { synthetic: false }), responder('full', { assignedCount: 4 }), responder('unapproved', { approved: false }), responder('wrong-skill', { capabilities: ['medical'] })],
  }));
  const choices = page.node('#responderSelect').innerHTML;
  assert.match(choices, /value="eligible"/);
  for (const id of ['wrong-workspace', 'full', 'unapproved', 'wrong-skill']) assert.ok(!choices.includes(`value="${id}"`), id);
  page.actions.set('POST /api/cases/unknown/followup-owner', request => {
    assert.deepEqual(request.body, { responderId: 'eligible' });
    page.backend.data.cases[0].followUpOwner = 'eligible';
    return { caseRecord: page.backend.data.cases[0] };
  });
  page.node('#responderSelect').value = 'eligible';
  await page.click('#assignButton');
  assert.match(page.node('#caseOwner').textContent, /Location follow-up owner/);
  assert.match(page.node('#caseOwner').textContent, /not a dispatch assignment/);
  assert.equal(page.run('appData.cases[0].assignedTo'), null);
  assert.ok(!page.requests.some(request => request.path.endsWith('/claim')));
  assert.equal(page.node('#responseProgressForm').hidden, true);
});

test('fresh caller history exposes escalation and a reviewed priority is saved through the server', async () => {
  const record = caseRecord('evolving', { assignedTo: 'responder-one', status: 'claimed', latestPriority: 'immediate', reassessmentRequired: true, linkedCallCount: 2, callId: 'update-call', history: [
    { kind: 'initial', callId: 'first-call', at: '2026-11-08T06:00:00Z', priority: 'urgent', summary: 'Transport requested.' },
    { kind: 'caller-update', callId: 'update-call', at: '2026-11-08T07:30:00Z', previousPriority: 'urgent', priority: 'immediate', summary: 'Water is inside the home.', reason: 'New indoor flooding reported.', changedFields: ['immediateDanger', 'priority'] },
  ] });
  const page = await beacon(snapshot([record]));
  assert.equal(page.node('#caseLinkedCalls').textContent, '2 linked calls');
  assert.equal(page.node('#caseReassessment').hidden, false);
  assert.match(page.node('#caseReassessmentTitle').textContent, /higher urgency: Immediate life-safety/);
  const history = page.node('#caseHistoryList').innerHTML;
  assert.match(history, /Urgent assistance → Immediate life-safety/);
  assert.match(history, /urgency increased/);
  assert.ok(history.indexOf('update-call') < history.indexOf('first-call'));
  assert.match(page.node('#caseLinkageNote').textContent, /not verified/);
  await page.click('#reviewNewFactsButton');
  assert.equal(page.node('#priorityReview').open, true);
  assert.equal(page.node('#priorityOverrideSelect').value, 'immediate');
  page.actions.set('POST /api/cases/evolving/priority', request => {
    assert.deepEqual(request.body, { priority: 'immediate', reason: 'Confirmed the newest indoor flood report.' });
    Object.assign(page.backend.data.cases[0], { priority: 'immediate', priorityRank: 0, reassessmentRequired: false, priorityOverride: { previousPriority: 'urgent', reason: request.body.reason, at: '2026-11-08T08:00:00Z' } });
    return { caseRecord: page.backend.data.cases[0] };
  });
  page.node('#priorityOverrideReason').value = 'Confirmed the newest indoor flood report.';
  await page.submit('#priorityOverrideForm');
  assert.equal(page.node('#priorityOrigin').textContent, 'HUMAN-REVIEWED QUEUE');
  assert.equal(page.node('#priorityLabel').textContent, 'Immediate life-safety');
  assert.match(page.node('#priorityOverrideAudit').textContent, /Confirmed the newest indoor flood report/);
  assert.match(page.node('#caseOwner').textContent, /Response owner: Test Responder/);
  assert.equal(page.node('#priorityOverrideReason').value, '');
});

test('resolve and reopen are persisted actions and release active ownership', async () => {
  const page = await beacon(snapshot([caseRecord('case-one', { status: 'claimed', assignedTo: 'responder-one' })]));
  page.actions.set('POST /api/cases/case-one/status', request => {
    Object.assign(page.backend.data.cases[0], { status: request.body.status, assignedTo: null, responseProgress: null });
    return { caseRecord: page.backend.data.cases[0] };
  });
  await page.click('#resolveButton');
  assert.equal(page.node('#allTabCount').textContent, '0');
  assert.equal(page.node('#resolvedTabCount').textContent, '1');
  await page.tab('resolved');
  assert.equal(page.node('#resolveButton').textContent, 'Reopen for review');
  assert.match(page.node('#responseProgressTitle').textContent, /no active arrival estimate/);
  await page.click('#resolveButton');
  await page.tab('all');
  assert.equal(page.node('#caseStatus').textContent, 'Awaiting review');
  assert.match(page.node('#caseOwner').textContent, /Unclaimed/);
  assert.match(page.node('#responseProgressTitle').textContent, /arrival not confirmed/);
  assert.deepEqual(page.requests.filter(request => request.path.endsWith('/status') && request.method === 'POST').map(request => request.body), [{ status: 'resolved' }, { status: 'new' }]);
});

test('ETA belongs to the current owner, expires without inventing arrival, and yields to review', async () => {
  const page = await beacon(snapshot([caseRecord('eta', { assignedTo: 'responder-one', status: 'claimed', responseProgress: { state: 'en-route', responderId: 'responder-one', etaAt: '2026-11-08T08:15:00Z', updatedAt: '2026-11-08T07:59:00Z' } })]));
  assert.equal(page.node('#responseProgressTitle').textContent, 'Response desk reported: On the way');
  assert.match(page.node('#responseProgressEta').textContent, /about 15 minutes/);
  assert.equal(page.node('#responseEtaMinutes').value, '', 'an old ETA is never guessed into a fresh update');
  page.advance(16);
  await page.poll();
  assert.equal(page.node('#responseProgressTitle').textContent, 'Updated ETA needed');
  assert.equal(page.node('#responseProgressEta').hidden, true);
  assert.match(page.node('#responseProgressDetail').textContent, /arrival has not been inferred/);
  page.backend.data.cases[0].assignedTo = 'replacement-owner';
  await page.poll();
  assert.match(page.node('#responseProgressTitle').textContent, /arrival not confirmed/);
  assert.equal(page.node('#responseProgressReported').hidden, true);
  Object.assign(page.backend.data.cases[0], { assignedTo: 'responder-one', assignmentNeedsReview: true });
  await page.poll();
  assert.equal(page.node('#responseProgressTitle').textContent, 'Response status needs reconfirmation');
  assert.equal(page.node('#responseProgressForm').hidden, true);
  assert.equal(page.node('#responseProgressEta').hidden, true);
  assert.equal(page.node('#assignmentReviewNote').hidden, false);
  assert.equal(page.node('#releaseAssignmentButton').hidden, false);
  Object.assign(page.backend.data.cases[0], { assignmentNeedsReview: false, responseProgress: { state: 'arrived', responderId: 'responder-one', updatedAt: '2026-11-08T08:16:00Z' } });
  await page.poll();
  assert.equal(page.node('#responseProgressTitle').textContent, 'Response desk reported: Arrived');
  assert.match(page.node('#responseProgressDetail').textContent, /does not mean the assistance is complete/);
});

test('a response update requires explicit fresh ETA and sends the server version', async () => {
  const page = await beacon(snapshot([caseRecord('eta', { assignedTo: 'responder-one', status: 'claimed' })]));
  page.node('#responseProgressState').value = 'en-route';
  await page.change('#responseProgressState');
  await page.submit('#responseProgressForm');
  assert.match(page.node('#responseProgressResult').textContent, /between 1 and 180/);
  assert.ok(!page.requests.some(request => request.path.endsWith('/progress')));
  page.actions.set('POST /api/cases/eta/progress', request => {
    assert.deepEqual(request.body, { state: 'en-route', expectedUpdatedAt: '2026-11-08T07:00:00Z', etaMinutes: 12 });
    page.backend.data.cases[0].responseProgress = { state: request.body.state, responderId: 'responder-one', etaAt: '2026-11-08T08:12:00Z', updatedAt: '2026-11-08T08:00:00Z' };
    return { caseRecord: page.backend.data.cases[0] };
  });
  page.node('#responseEtaMinutes').value = '12';
  await page.input('#responseEtaMinutes');
  await page.submit('#responseProgressForm');
  assert.equal(page.node('#responseProgressTitle').textContent, 'Response desk reported: On the way');
  assert.match(page.node('#responseProgressEta').textContent, /about 12 minutes/);
  assert.match(page.node('#responseProgressResult').textContent, /estimate remains an estimate/);
});

test('polling preserves typed review/response/registration drafts until the response context changes', async () => {
  const page = await beacon(snapshot([caseRecord('draft', { assignedTo: 'responder-one', status: 'claimed' })]));
  page.node('#priorityOverrideReason').value = 'Pending confirmation with the caller.';
  page.node('#priorityOverrideSelect').value = 'time-sensitive';
  page.node('#responseProgressState').value = 'delayed';
  await page.change('#responseProgressState');
  page.node('#responseEtaMinutes').value = '45';
  await page.input('#responseEtaMinutes');
  page.selectedAreas.add('east');
  const beforeWrites = page.checkedWrites;
  await page.poll();
  assert.equal(page.node('#priorityOverrideReason').value, 'Pending confirmation with the caller.');
  assert.equal(page.node('#priorityOverrideSelect').value, 'time-sensitive');
  assert.equal(page.node('#responseProgressState').value, 'delayed');
  assert.equal(page.node('#responseEtaMinutes').value, '45');
  assert.equal(page.checkedWrites, beforeWrites, 'unchanged areas do not rebuild registration checkboxes');
  page.backend.data.zones.push({ id: 'north', name: 'North' });
  await page.poll();
  assert.match(page.node('#responderAreaOptions').innerHTML, /value="east" checked/);
  page.backend.data.cases[0].responseProgress = { state: 'review-needed', responderId: 'responder-one', updatedAt: '2026-11-08T08:01:00Z' };
  await page.poll();
  assert.equal(page.node('#responseProgressState').value, '');
  assert.equal(page.node('#responseEtaMinutes').value, '', 'obsolete travel drafts are cleared after new facts require review');
});

test('failed claim and stale-version progress cannot create local success state', async () => {
  const page = await beacon();
  page.actions.set('POST /api/cases/case-one/claim', () => ({ httpStatus: 409, body: { error: 'Responder capacity changed' } }));
  page.node('#responderSelect').value = 'responder-one';
  await page.click('#assignButton');
  assert.equal(page.run('appData.cases[0].assignedTo'), null);
  assert.match(page.node('#toast').textContent, /capacity changed/);
  assert.equal(page.node('#assignButton').disabled, false);
  Object.assign(page.backend.data.cases[0], { assignedTo: 'responder-one', status: 'claimed' });
  await page.poll();
  page.actions.set('POST /api/cases/case-one/progress', () => ({ httpStatus: 409, body: { error: 'Case changed; refresh before confirming ETA' } }));
  page.node('#responseProgressState').value = 'en-route';
  await page.change('#responseProgressState');
  page.node('#responseEtaMinutes').value = '20';
  await page.input('#responseEtaMinutes');
  await page.submit('#responseProgressForm');
  assert.match(page.node('#responseProgressResult').textContent, /Case changed/);
  assert.equal(page.node('#responseEtaMinutes').value, '20');
  assert.match(page.node('#responseProgressTitle').textContent, /arrival not confirmed/);
});

test('an unsubmitted responder choice survives polling but case-specific drafts reset on selection change', async () => {
  const page = await beacon(snapshot([
    caseRecord('west-case', { eligibleResponders: ['responder-one', 'responder-two'] }),
    caseRecord('east-case', { zoneId: 'east', zoneName: 'East' }),
  ], { responders: [responder(), responder('responder-two', { name: 'Second Responder' })] }));
  page.node('#responderSelect').value = 'responder-two';
  page.node('#priorityOverrideReason').value = 'Private draft belongs to the west case.';
  page.node('#priorityOverrideSelect').value = 'time-sensitive';
  await page.poll();
  assert.equal(page.node('#responderSelect').value, 'responder-two');
  assert.equal(page.node('#priorityOverrideSelect').value, 'time-sensitive');
  page.node('#zoneFilter').value = 'east';
  await page.change('#zoneFilter');
  assert.equal(page.run('selectedCaseId'), 'east-case');
  assert.equal(page.node('#priorityOverrideReason').value, '');
  assert.equal(page.node('#responderSelect').value, '');
});

test('a late polling response cannot replace a newer server snapshot', async () => {
  const page = await beacon();
  const delayed = deferred();
  page.backend.overview = () => delayed.promise;
  const oldPoll = page.poll();
  await settle();
  page.backend.overview = null;
  page.backend.data.cases[0].title = 'Latest confirmed server record';
  await page.poll();
  delayed.resolve(snapshot([caseRecord('old', { title: 'Obsolete delayed record' })]));
  await oldPoll;
  assert.equal(page.node('#caseTitle').textContent, 'Latest confirmed server record');
  assert.doesNotMatch(page.node('#queueList').innerHTML, /Obsolete delayed record/);
});

test('untrusted case/history/call/pressure/responder values are escaped in rendered markup', async () => {
  const attack = '"><img src=x onerror=alert(1)><script>bad()</script>&';
  const record = caseRecord('unsafe', { title: attack, transcript: attack, zoneName: attack, needs: [attack], history: [{ kind: 'caller-update', callId: attack, at: '2026-11-08T07:30:00Z', summary: attack, reason: attack, changedFields: [attack] }] });
  const page = await beacon(snapshot([record], {
    responders: [responder('responder-one', { name: attack, organization: attack })],
    calls: [{ id: attack, provider: attack, startedAt: '2026-11-08T07:00:00Z', transcript: attack, caseId: attack, status: attack, consent: attack, transcriptionSource: attack }],
    alerts: [{ id: attack, callId: attack, headline: attack, level: 'high', deliveryStatus: 'accepted', createdAt: '2026-11-08T07:30:00Z', signals: [{ label: attack, evidence: attack, explanation: attack }], nextStep: attack }],
  }));
  for (const selector of ['#queueList', '#caseHistoryList', '#callList', '#liveWarningList', '#traceSignalList', '#responderProfiles', '#responderSelect', '.reported-chip-row']) {
    const markup = page.node(selector).innerHTML;
    assert.doesNotMatch(markup, /<script|<img/i, selector);
    assert.match(markup, /&lt;(?:img|script)/, selector);
  }
  assert.equal(page.node('#caseMessage').textContent, attack, 'plain text details keep the text without interpreting markup');
  assert.match(page.node('#liveWarningList').innerHTML, /Provider accepted; phone display unconfirmed/);
});

test('logout erases cached records, displayed PII, evidence, and typed private drafts', async () => {
  const marker = 'PRIVATE-FICTIONAL-RESIDENT-MARKER';
  const page = await beacon(snapshot([caseRecord('private', { transcript: marker, title: marker, history: [{ kind: 'initial', summary: marker, at: '2026-11-08T07:00:00Z' }] })], {
    calls: [{ id: 'private-call', transcript: marker, startedAt: '2026-11-08T07:00:00Z', status: 'completed', consent: 'yes' }],
    alerts: [{ id: 'private-alert', callId: 'private-call', text: marker, headline: marker, level: 'high', createdAt: '2026-11-08T07:00:00Z', signals: [{ label: 'Pressure', evidence: marker }], nextStep: marker }],
  }));
  for (const selector of ['#transcriptInput', '#messageInput', '#guideInput', '#priorityOverrideReason', '#integrityDecisionReason']) page.node(selector).value = marker;
  page.actions.set('POST /api/scam/analyze', request => {
    assert.deepEqual(request.body, { text: marker, synthetic: true });
    const review = { id: 'private-message-review', text: marker, headline: marker, level: 'high', signals: [{ label: 'Pressure', evidence: marker }], nextStep: marker };
    page.backend.data.scamReviews = [review];
    return { scamReview: review };
  });
  await page.click('#analyzeButton');
  page.run(`askGuide('Explain the selected case priority')`);
  assert.ok(page.allDom().includes(marker));
  await page.click('#signOutButton');
  assert.equal(page.run('appData.cases.length + appData.calls.length + appData.alerts.length'), 0);
  assert.equal(page.run('selectedCaseId'), null);
  assert.equal(page.node('#beaconView').hidden, true);
  assert.equal(page.node('#guidePanel').hidden, true);
  const retained = [...page.nodes].filter(([, element]) => [element.innerHTML, element.textContent, element.value].some(value => value.includes(marker))).map(([selector]) => selector);
  assert.deepEqual(retained, [], 'locking must erase sensitive DOM and drafts, not just hide the workspace');
});

test('logout invalidates an in-flight overview before its private records can return', async () => {
  const page = await beacon();
  const marker = 'FICTIONAL-LATE-OVERVIEW-PRIVATE';
  const delayed = deferred();
  page.backend.overview = () => delayed.promise;
  const pending = page.poll();
  await settle();
  await page.click('#signOutButton');
  delayed.resolve(snapshot([caseRecord('late-private', { title: marker, transcript: marker })]));
  await pending;
  assert.equal(page.run('appData.cases.length'), 0);
  assert.equal(page.node('#beaconView').hidden, true);
  assert.equal(page.node('#responderLogin').hidden, false);
  assert.ok(!page.allDom().includes(marker));
});

test('Beacon no longer offers resident Guard enrollment or a notification setup flow', () => {
  assert.doesNotMatch(html, /guardEnrollment|Enroll a test phone|add it to the Home Screen/i);
  assert.doesNotMatch(source, /\/api\/guard\/enrollment/);
});

test('integrity badges keep every case in urgency order with danger and area intact', async () => {
  const page = await beacon(snapshot([
    caseRecord('dismissed-immediate', { priority: 'immediate', priorityRank: 0, immediateDanger: 'yes', integrityReview: integrityReview('dismissed'), createdAt: '2026-11-08T06:00:00Z' }),
    caseRecord('clear-urgent'),
    caseRecord('flagged-immediate', { priority: 'immediate', priorityRank: 0, immediateDanger: 'yes', integrityReview: integrityReview('review-required'), createdAt: '2026-11-08T07:00:00Z' }),
    caseRecord('pending-followup', { priority: 'follow-up', priorityRank: 3, integrityReview: integrityReview('pending') }),
  ]));
  const queue = page.node('#queueList').innerHTML;
  const idsInOrder = [...queue.matchAll(/data-case-id="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(idsInOrder, ['dismissed-immediate', 'flagged-immediate', 'clear-urgent', 'pending-followup']);
  for (const label of ['Human dismissed · retained', 'Human review required', 'No supported concern', 'Review pending']) assert.ok(queue.includes(label), label);
  assert.equal(page.node('#priorityLabel').textContent, 'Immediate life-safety');
  assert.match(page.node('.reported-chip-row').textContent, /Caller reported immediate danger/);
  assert.match(page.node('#caseLocation').textContent, /West/);
  assert.equal(page.node('#scamCount').textContent, '03');
  assert.equal(page.node('#allTabCount').textContent, '4');
  assert.equal(page.node('#followupList').hidden, true, 'follow-up urgency stays in the same ranked list');
  assert.match(page.node('#integritySummary').textContent, /case, reported urgency, history/);
  assert.match(page.node('#liveWarningList').innerHTML, /Responder intake review/);
  assert.match(page.node('#traceSignalList').innerHTML, /Give me the payment code/, 'case integrity evidence reaches Pressure Trace without a resident notification alert');
  assert.doesNotMatch(page.allDom(), /proven scammer/i);
});

test('held and unavailable reports allow verification ownership but block response claim and ETA', async () => {
  for (const status of ['pending', 'review-required', 'dismissed']) {
    const record = caseRecord(`held-${status}`, { assignedTo: 'responder-one', status: 'claimed', integrityReview: integrityReview(status, { analysisStatus: 'unavailable', basis: 'unavailable' }), responseProgress: { state: 'en-route', responderId: 'responder-one', etaAt: '2026-11-08T08:15:00Z', updatedAt: '2026-11-08T07:59:00Z' } });
    const page = await beacon(snapshot([record]));
    assert.equal(page.node('#assignButton').textContent, 'Assign verification owner');
    assert.equal(page.node('#responseProgressForm').hidden, true);
    assert.equal(page.node('#responseProgressEta').hidden, true);
    assert.match(page.node('#responseProgressTitle').textContent, /Human acceptance required/);
    assert.match(page.node('#integrityMeta').textContent, /unavailable/);
    page.node('#responseProgressState').value = 'en-route';
    page.node('#responseEtaMinutes').value = '10';
    await page.submit('#responseProgressForm');
    assert.ok(!page.requests.some(request => request.path.endsWith('/progress')));
    page.actions.set(`POST /api/cases/${record.id}/followup-owner`, request => {
      assert.deepEqual(request.body, { responderId: 'responder-one' });
      page.backend.data.cases[0].followUpOwner = 'responder-one';
      return { caseRecord: page.backend.data.cases[0] };
    });
    page.node('#responderSelect').value = 'responder-one';
    await page.click('#assignButton');
    assert.ok(!page.requests.some(request => request.path.endsWith('/claim')));
    assert.match(page.node('#caseOwner').textContent, /Verification owner/);
    assert.match(page.node('#caseOwner').textContent, /Response owner/, 'late concerns do not silently cancel existing response ownership');
  }
});

test('human decisions require reasons and submit the exact call/sequence/version evidence scope', async () => {
  const page = await beacon(snapshot([caseRecord('review', { priority: 'immediate', priorityRank: 0, integrityReview: integrityReview('review-required') })]));
  const reviewPath = 'POST /api/cases/review/integrity-review';
  page.node('#integrityDecisionReason').value = 'short';
  await page.click('#integrityAcceptButton');
  assert.match(page.node('#integrityReviewResult').textContent, /between 8 and 1,000/);
  page.node('#integrityDecisionReason').value = 'x'.repeat(1001);
  await page.click('#integrityDismissButton');
  assert.equal(page.requests.filter(request => request.path.endsWith('/integrity-review')).length, 0);
  const gate = deferred();
  const reason = 'Verified the help request with the duty coordinator.';
  page.actions.set(reviewPath, async request => {
    assert.deepEqual(request.body, { decision: 'accept', reason, expectedVersion: 7, expectedSourceCallId: 'reviewed-call', expectedSequence: 4 });
    await gate.promise;
    page.backend.data.cases[0].integrityReview = integrityReview('accepted', { version: 8, decision: { action: 'accept', reason, at: '2026-11-08T08:00:00Z' } });
    return { caseRecord: page.backend.data.cases[0] };
  });
  page.node('#integrityDecisionReason').value = reason;
  const pending = page.click('#integrityAcceptButton');
  assert.equal(page.node('#integrityAcceptButton').disabled, true);
  assert.equal(page.node('#assignButton').textContent, 'Assign verification owner', 'no optimistic acceptance');
  gate.resolve();
  await pending;
  assert.equal(page.node('#integrityBadge').textContent, 'Human accepted');
  assert.equal(page.node('#assignButton').textContent, 'Claim for responder →');
  assert.equal(page.node('#priorityLabel').textContent, 'Immediate life-safety');
  assert.match(page.node('#integrityDecisionAudit').textContent, new RegExp(reason));
  page.actions.set(reviewPath, request => {
    assert.deepEqual(request.body, { decision: 'dismiss', reason: 'Could not verify the reported pickup request.', expectedVersion: 8, expectedSourceCallId: 'reviewed-call', expectedSequence: 4 });
    page.backend.data.cases[0].integrityReview = integrityReview('dismissed', { version: 9 });
    return { caseRecord: page.backend.data.cases[0] };
  });
  page.node('#integrityDecisionReason').value = 'Could not verify the reported pickup request.';
  await page.click('#integrityDismissButton');
  assert.equal(page.node('#allTabCount').textContent, '1');
  assert.match(page.node('#queueList').innerHTML, /Human dismissed · retained/);
  assert.equal(page.node('#priorityLabel').textContent, 'Immediate life-safety');
  assert.equal(page.node('#assignButton').textContent, 'Assign verification owner');
});

test('review polling preserves drafts only for the same evidence scope and failed decisions never clear a hold', async () => {
  const page = await beacon(snapshot([caseRecord('scope', { integrityReview: integrityReview('review-required', { evidenceCallId: 'older-call', evidenceSequence: 2 }) })]));
  assert.match(page.node('#integrityMeta').textContent, /retained concern from earlier call older-call, sequence 2/);
  page.node('#integrityDecisionReason').value = 'Checking this exact evidence scope.';
  await page.poll();
  assert.equal(page.node('#integrityDecisionReason').value, 'Checking this exact evidence scope.');
  page.backend.data.cases[0].integrityReview.sourceSequence = 5;
  await page.poll();
  assert.equal(page.node('#integrityDecisionReason').value, '');
  assert.match(page.node('#integrityReviewResult').textContent, /snapshot changed/);
  page.actions.set('POST /api/cases/scope/integrity-review', () => ({ httpStatus: 409, body: { error: 'A newer caller update needs review.' } }));
  page.node('#integrityDecisionReason').value = 'A meaningful reason for the current report.';
  await page.submit('#integrityReviewForm');
  assert.match(page.node('#integrityReviewResult').textContent, /newest evidence/);
  assert.equal(page.node('#integrityBadge').textContent, 'Human review required');
  assert.equal(page.node('#assignButton').textContent, 'Assign verification owner');
  assert.match(page.run("groundedGuideAnswer('Explain this integrity hold')"), /A human must accept/);
});

test('private caller audio is manual, uses authenticated bytes, and revokes on case change and logout', async () => {
  assert.match(html, /<audio[^>]+controls preload="none"[^>]*>/);
  assert.doesNotMatch(html, /<audio[^>]+autoplay/);
  const page = await beacon(snapshot([
    caseRecord('audio-one', { audio: audioMetadata, integrityReview: integrityReview('review-required') }),
    caseRecord('audio-two', { zoneId: 'east', zoneName: 'East', audio: { ...audioMetadata, callId: 'second-recording' } }),
  ]));
  await page.poll();
  assert.ok(!page.requests.some(request => request.path.endsWith('/audio')), 'selecting and polling never loads bytes');
  page.actions.set('GET /api/cases/audio-one/audio', () => ({ audioBlob: new Blob(['first fictional WAV'], { type: 'audio/wav' }) }));
  await page.click('#caseAudioLoadButton');
  assert.equal(page.audioUrls.length, 1);
  assert.equal(page.node('#caseAudioPlayer').src, page.audioUrls[0]);
  assert.equal(page.node('#caseAudioPlayer').hidden, false);
  assert.match(page.node('#caseAudioStatus').textContent, /Press Play/);
  assert.match(page.node('#caseAudioMeta').textContent, /recorded-call/);
  page.node('#zoneFilter').value = 'east';
  await page.change('#zoneFilter');
  assert.deepEqual(page.revokedAudioUrls, [page.audioUrls[0]]);
  assert.equal(page.node('#caseAudioPlayer').src, '');
  assert.equal(page.node('#caseAudioPlayer').hidden, true);
  page.actions.set('GET /api/cases/audio-two/audio', () => ({}));
  await page.click('#caseAudioLoadButton');
  await page.click('#signOutButton');
  assert.deepEqual(page.revokedAudioUrls, page.audioUrls);
  assert.equal(page.node('#caseAudioPlayer').src, '');
  assert.equal(page.node('#caseAudioPanel').hidden, true);
  const audioRequests = page.requests.filter(request => request.path.endsWith('/audio'));
  assert.ok(audioRequests.every(request => request.credentials === 'same-origin' && request.cache === 'no-store'));
  assert.ok(page.node('#caseAudioPlayer').pauseCount >= 2);
});

test('late caller audio fetch/blob resolution cannot restore bytes after logout or a case change', async () => {
  for (const stage of ['response-logout', 'blob-logout', 'response-case-change']) {
    const page = await beacon(snapshot([
      caseRecord('private-audio', { audio: audioMetadata }),
      caseRecord('different-case', { zoneId: 'east', zoneName: 'East' }),
    ]));
    const gate = deferred();
    page.actions.set('GET /api/cases/private-audio/audio', () => stage === 'blob-logout' ? { audioBlob: gate.promise } : gate.promise);
    const pending = page.click('#caseAudioLoadButton');
    await settle();
    if (stage.endsWith('case-change')) { page.node('#zoneFilter').value = 'east'; await page.change('#zoneFilter'); }
    else await page.click('#signOutButton');
    gate.resolve(stage === 'blob-logout' ? new Blob(['late fictional WAV'], { type: 'audio/wav' }) : {});
    await pending;
    assert.equal(page.audioUrls.length, 0, stage);
    assert.equal(page.node('#caseAudioPlayer').src, '', stage);
    assert.equal(page.node('#caseAudioPlayer').hidden, true, stage);
    assert.equal(page.run('audioObjectUrl'), '', stage);
  }
});

test('missing and unavailable audio are neutral and an expired recording never loads', async () => {
  const page = await beacon(snapshot([caseRecord('no-audio', { audio: { available: false }, integrityReview: integrityReview('pending', { analysisStatus: 'unavailable' }) })]));
  assert.match(page.node('#caseAudioMeta').textContent, /missing audio is not a negative signal/);
  assert.equal(page.node('#caseAudioLoadButton').hidden, true);
  Object.assign(page.backend.data.cases[0], { audio: audioMetadata });
  await page.poll();
  page.actions.set('GET /api/cases/no-audio/audio', () => ({ httpStatus: 404, body: {} }));
  await page.click('#caseAudioLoadButton');
  assert.match(page.node('#caseAudioStatus').textContent, /missing audio does not count against/);
  assert.equal(page.run('appData.cases[0].priority'), 'urgent');
  page.backend.data.cases[0].audio.expiresAt = '2026-11-08T07:00:00Z';
  await page.poll();
  assert.equal(page.node('#caseAudioLoadButton').hidden, true);
  const requestsBefore = page.requests.length;
  await page.click('#caseAudioLoadButton');
  assert.equal(page.requests.length, requestsBefore);
});

test('expired or withdrawn metadata cannot resurrect an in-flight caller recording', async () => {
  for (const change of ['expired-during-load', 'withdrawn', 'new-call']) {
    const page = await beacon(snapshot([caseRecord('audio', { audio: { ...audioMetadata, expiresAt: '2026-11-08T08:01:00Z' } })]));
    const gate = deferred();
    page.actions.set('GET /api/cases/audio/audio', () => ({ audioBlob: gate.promise }));
    const pending = page.click('#caseAudioLoadButton');
    await settle();
    if (change === 'expired-during-load') page.advance(2);
    else {
      if (change === 'withdrawn') page.backend.data.cases[0].audio.available = false;
      else page.backend.data.cases[0].audio.callId = 'newer-call';
      await page.poll();
    }
    gate.resolve(new Blob(['stale fictional recording'], { type: 'audio/wav' }));
    await pending;
    assert.equal(page.audioUrls.length, 0, change);
    assert.equal(page.node('#caseAudioPlayer').src, '', change);
  }
});
