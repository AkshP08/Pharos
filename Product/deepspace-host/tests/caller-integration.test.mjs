import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

function runtime(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: new URL('../dist/pharos_hackutd_2026/index.js', import.meta.url).pathname,
    compatibilityDate: '2025-01-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PHAROS_STORE: { className: 'PharosStore', useSQLite: true } },
    serviceBindings: { ASSETS: () => new Response('Fictional contact tests') },
    bindings: { APP_NAME: 'caller-contact-test', DEEPSPACE_APP_ID: 'caller-contact-test',
      PHAROS_RESPONDER_PASSWORD: 'test-responder', PHAROS_SESSION_SECRET: 'caller-contact-session-secret-test-only', PHAROS_INGEST_TOKEN: 'test-ingest' },
  }));
  t.after(() => mf.dispose()); return mf;
}

async function event(mf, event, callId, payload = {}) {
  const r = await mf.dispatchFetch('http://pharos.test/api/voice/ingest', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-ingest' },
    body: JSON.stringify({ event, callId, ...payload }) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}

async function command(mf, body) {
  const ns = await mf.getDurableObjectNamespace('PHAROS_STORE');
  const r = await ns.get(ns.idFromName('pharos-primary')).fetch('https://store/command', { method: 'POST', body: JSON.stringify(body) });
  assert.ok(r.ok); return r.json();
}

const number = '+15555550198';
const text = 'Send a gift card. You have five minutes.';
const review = { shouldWarn: true, level: 'high', signals: [
  { kind: 'money_or_secret', evidence: 'Send a gift card' },
  { kind: 'deadline', evidence: 'five minutes' },
] };

async function guard(mf, id, { mode = 'semantic', transport = 'sip', phone = number } = {}) {
  await event(mf, 'call.started', id, { purpose: 'guard', transport, analysisMode: mode, guardCallerNumber: phone });
  return event(mf, 'consent', id, { consent: true });
}

async function flagged(mf, id, options) {
  await guard(mf, id, options);
  await event(mf, 'turn', id, { sequence: 0, role: 'caller', text });
  if (!options || options.mode !== 'wording') await event(mf, 'pressure.review', id, { sequence: 0, review });
  await event(mf, 'call.ended', id);
}

test('three distinct prior context-flagged calls create a separate caution without replacing speech analysis', async t => {
  const mf = runtime(t);
  await flagged(mf, 'risk-one');
  const second = await guard(mf, 'risk-two'); assert.equal(second.warning, null);
  await event(mf, 'turn', 'risk-two', { sequence: 0, role: 'caller', text });
  const medium = { ...review, level: 'medium' };
  await event(mf, 'pressure.review', 'risk-two', { sequence: 0, review: medium });
  await event(mf, 'turn', 'risk-two', { sequence: 1, role: 'caller', text: 'Do this now.' });
  await event(mf, 'pressure.review', 'risk-two', { sequence: 1, review });
  await event(mf, 'call.ended', 'risk-two');
  const third = await guard(mf, 'risk-three'); assert.equal(third.warning, null, 'Two levels in one call must not become two calls');
  await event(mf, 'turn', 'risk-three', { sequence: 0, role: 'caller', text });
  await event(mf, 'pressure.review', 'risk-three', { sequence: 0, review });
  await event(mf, 'call.ended', 'risk-three');
  const fourth = await guard(mf, 'risk-four');
  assert.equal(fourth.warning.analysisSource, 'caller-id-history');
  assert.match(fourth.warning.evidenceQuality, /3 distinct/);
  assert.match(fourth.warning.nextStep, /spoofed/);
  assert.match(fourth.warning.nextStep, /speech review is still required/);
  assert.equal((await event(mf, 'consent', 'risk-four', { consent: true })).warning, undefined);
  await event(mf, 'turn', 'risk-four', { sequence: 0, role: 'caller', text });
  const current = await event(mf, 'pressure.review', 'risk-four', { sequence: 0, review: medium });
  assert.equal(current.warning.analysisSource, 'context-model', 'History caution must not suppress a new medium speech warning');
  assert.notEqual(current.warning.id, fourth.warning.id);
  const stored = await command(mf, { action: 'call.get', id: 'risk-four' });
  assert.equal(stored.call.analysisMode, 'semantic');
  assert.equal(stored.call.caseId, null);
  const all = JSON.stringify(await command(mf, { action: 'overview' }));
  assert.ok(!all.includes(number));
  assert.ok(!all.includes('encryptedPhone'));
  assert.ok(!all.includes('callerContact'));
  assert.ok(!all.includes('callerRef'));
});

test('wording-only flags and browser-asserted numbers do not become prior caller-ID history', async t => {
  const mf = runtime(t);
  for (let i = 0; i < 3; i++) await flagged(mf, `literal-${i}`, { mode: 'wording' });
  assert.equal((await guard(mf, 'after-literal')).warning, null);
  await event(mf, 'call.ended', 'after-literal');
  for (let i = 0; i < 3; i++) await flagged(mf, `browser-${i}`, { transport: 'webrtc' });
  assert.equal((await guard(mf, 'after-browser')).warning, null);
});

test('withdrawal and retention remove prior-risk eligibility without leaking a callback contact', async t => {
  const mf = runtime(t);
  for (let i = 0; i < 3; i++) await flagged(mf, `privacy-${i}`);
  await event(mf, 'consent.revoked', 'privacy-0');
  assert.equal((await guard(mf, 'after-withdrawal')).warning, null);
  await event(mf, 'call.ended', 'after-withdrawal');
  await command(mf, { action: 'transcripts.prune', cutoff: Date.now() + 10 });
  const fresh = await guard(mf, 'after-expiry');
  assert.equal(fresh.warning, null);
  const call = (await command(mf, { action: 'call.get', id: 'privacy-1' })).call;
  assert.deepEqual(call.turns, []);
  assert.ok(!JSON.stringify(call).includes('callerContact'));
});
