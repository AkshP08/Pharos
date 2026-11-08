import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDecipheriv, hkdfSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CallerStore, callerLookup, createCallerContact, decryptCallerPhone, normalizeProviderPhone } from '../pharos-callers.ts';

// Fictional NANP numbers only; no env files, providers, or network access.
const phone = '+12025550123';
const anotherPhone = '+12025550124';
const secret = 'fictional-caller-secret-for-offline-tests-only';
const start = Date.UTC(2026, 10, 8, 6);
const hour = 3_600_000;

function fixture(t, retention = 24 * hour) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const bindingsSeen = [];
  const sql = { exec(query, ...bindings) {
    bindingsSeen.push(...bindings);
    if (!bindings.length && /CREATE TABLE/.test(query)) { db.exec(query); return { toArray: () => [] }; }
    const statement = db.prepare(query);
    const result = statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => result };
  } };
  let now = start;
  const store = new CallerStore(sql, retention, () => now);
  return { db, store, bindingsSeen, setNow(value) { now = value; } };
}

function call(contact, callId, purpose = 'risk', startedAt = start) {
  return { callId, purpose, contact, startedAt, consent: true, transport: 'sip', synthetic: false };
}

test('provider number normalization is syntax-only and never guesses a country', () => {
  assert.equal(normalizeProviderPhone(phone), phone);
  assert.equal(normalizeProviderPhone(' +1 (202) 555-0123 '), phone);
  assert.equal(normalizeProviderPhone('+44 20 7946 0958'), '+442079460958');
  for (const input of ['2025550123', 'sip:+12025550123@example.invalid', '+02025550123', '+1\n2025550123', '+１２３４５６７８', '+123', '+1234567890123456', '++12025550123', null, {}, 12025550123]) {
    assert.equal(normalizeProviderPhone(input), null);
  }
});

test('keyed lookups are stable but separated by purpose and server secret', async () => {
  const help = await callerLookup(secret, phone, 'help');
  assert.match(help, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(help, await callerLookup(secret, '+1 (202) 555-0123', 'help'));
  assert.notEqual(help, await callerLookup(secret, phone, 'risk'));
  assert.notEqual(help, await callerLookup(secret + 'rotated', phone, 'help'));
  assert.notEqual(help, await callerLookup(secret, anotherPhone, 'help'));
  assert.ok(!help.includes(phone));
});

test('encrypted contacts use fresh nonces and independently decrypt with authenticated purpose and lookup', async () => {
  const first = await createCallerContact(secret, phone, 'help');
  const second = await createCallerContact(secret, phone, 'help');
  assert.equal(first.lookup, second.lookup);
  assert.notEqual(first.encryptedPhone, second.encryptedPhone);
  assert.equal(await decryptCallerPhone(secret, first, 'help'), phone);
  assert.ok(!JSON.stringify(first).includes(phone));
  const [version, purpose, nonce, cipher] = first.encryptedPhone.split('.');
  assert.equal(version, 'v1'); assert.equal(purpose, 'help');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('pharos.caller-contact.v1'), Buffer.from('pharos.caller.help.encryption.v1'), 32));
  const ciphertext = Buffer.from(cipher, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(`pharos.caller-contact.v1:help:${first.lookup}`));
  decipher.setAuthTag(ciphertext.subarray(-16));
  assert.equal(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString(), phone);
});

test('wrong purpose, secret, lookup and tampered ciphertext fail without echoing input', async () => {
  const contact = await createCallerContact(secret, phone, 'risk');
  const other = await createCallerContact(secret, anotherPhone, 'risk');
  const parts = contact.encryptedPhone.split('.');
  const bytes = Buffer.from(parts[3], 'base64url'); bytes[0] ^= 1;
  const corrupted = { ...contact, encryptedPhone: [...parts.slice(0, 3), bytes.toString('base64url')].join('.') };
  for (const [key, value, purpose] of [
    [secret + 'wrong', contact, 'risk'], [secret, contact, 'help'],
    [secret, { ...contact, lookup: other.lookup }, 'risk'], [secret, corrupted, 'risk'],
    [secret, { ...contact, encryptedPhone: phone }, 'risk'], [secret, null, 'risk'],
  ]) await assert.rejects(decryptCallerPhone(key, value, purpose), error => error.message === 'Invalid caller contact' && !error.message.includes(phone));
  for (const [key, number, purpose] of [['tiny', phone, 'help'], [secret, 'not-a-number', 'risk'], [secret, phone, 'unknown']]) {
    await assert.rejects(createCallerContact(key, number, purpose), { message: 'Invalid caller contact' });
  }
});

test('only consented live SIP metadata registers, and SQLite contains no plaintext number', async (t) => {
  const { store, db, bindingsSeen } = fixture(t);
  const contact = await createCallerContact(secret, phone, 'help');
  for (const override of [{ consent: false }, { transport: 'webrtc' }, { synthetic: true }]) {
    assert.throws(() => store.registerCall({ ...call(contact, 'unconsented', 'help'), ...override }), /consented live SIP/);
  }
  assert.throws(() => store.registerCall(call(contact, 'wrong-purpose', 'risk')), /Invalid caller contact/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM caller_contacts').get().count, 0);
  assert.deepEqual(store.registerCall(call(contact, 'help-one', 'help')), { registered: true, duplicate: false, expiresAt: start + 24 * hour });
  assert.equal(store.contact(contact.lookup, 'help').encryptedPhone, contact.encryptedPhone);
  assert.equal(store.contact(contact.lookup, 'risk'), null);
  const dump = ['caller_contacts', 'caller_contact_calls', 'caller_risk_events'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
  assert.ok(!JSON.stringify(dump).includes(phone));
  assert.ok(!JSON.stringify(bindingsSeen).includes(phone));
});

test('retries cannot renew TTL, change call identity, or overwrite a newer contact snapshot', async (t) => {
  const f = fixture(t);
  const old = await createCallerContact(secret, phone, 'help');
  const newer = await createCallerContact(secret, phone, 'help');
  f.store.registerCall(call(old, 'first-help', 'help'));
  f.setNow(start + hour);
  assert.deepEqual(f.store.registerCall(call(newer, 'first-help', 'help')), { registered: true, duplicate: true, expiresAt: start + 24 * hour });
  assert.throws(() => f.store.registerCall(call(old, 'first-help', 'help', start + hour)), /conflicts/);
  const foreign = await createCallerContact(secret, anotherPhone, 'help');
  assert.throws(() => f.store.registerCall(call(foreign, 'first-help', 'help')), /conflicts/);
  f.store.registerCall(call(newer, 'second-help', 'help', start + hour));
  const lateOlder = await createCallerContact(secret, phone, 'help');
  f.store.registerCall(call(lateOlder, 'late-old-report', 'help', start + 10));
  const retained = f.store.contact(old.lookup, 'help');
  assert.equal(retained.encryptedPhone, newer.encryptedPhone);
  assert.equal(retained.lastSeenAt, start + hour);
  assert.equal(retained.expiresAt, start + 25 * hour);
  assert.equal(f.store.nextExpiry(), start + 24 * hour);
});

test('three warnings within one call count once; wording-only/help/unknown calls never contribute', async (t) => {
  const f = fixture(t);
  const contact = await createCallerContact(secret, phone, 'risk');
  f.store.registerCall(call(contact, 'risk-one'));
  for (const level of ['medium', 'high', 'high']) f.store.recordRisk({ callId: 'risk-one', level, analysisSource: 'context-model' });
  f.store.recordRisk({ callId: 'risk-one', level: 'high', analysisSource: 'wording-rules' });
  assert.deepEqual(f.store.priorRisk(contact.lookup), { priorWarnedCalls: 1, shouldCaution: false, identityVerified: false, analysisRequired: true, lastWarnedAt: new Date(start).toISOString() });
  assert.equal(f.store.priorRisk(contact.lookup, { excludeCallId: 'risk-one' }).priorWarnedCalls, 0);
  assert.equal(f.db.prepare('SELECT level FROM caller_risk_events WHERE call_id = ?').get('risk-one').level, 'high');
  const help = await createCallerContact(secret, phone, 'help');
  f.store.registerCall(call(help, 'help-risk-wording', 'help'));
  assert.equal(f.store.recordRisk({ callId: 'help-risk-wording', level: 'high', analysisSource: 'context-model' }).recorded, false);
  assert.equal(f.store.recordRisk({ callId: 'unknown', level: 'high', analysisSource: 'context-model' }).recorded, false);
  assert.equal(f.store.recordRisk({ callId: 'risk-one', level: 'low', analysisSource: 'context-model' }).recorded, false);
  assert.equal(f.store.recordRisk({ callId: 'risk-one', level: 'high', analysisSource: 'history-caution' }).recorded, false);
  assert.equal(f.store.priorRisk(help.lookup).priorWarnedCalls, 0);
});

test('early caution needs three separate prior warned calls and continues current analysis', async (t) => {
  const f = fixture(t);
  const contact = await createCallerContact(secret, phone, 'risk');
  for (let index = 1; index <= 3; index++) {
    f.setNow(start + index * 1000);
    const id = `risk-${index}`;
    f.store.registerCall(call(contact, id, 'risk', start + index * 1000));
    f.store.recordRisk({ callId: id, level: 'high', analysisSource: 'context-model' });
    assert.equal(f.store.priorRisk(contact.lookup, { excludeCallId: id }).shouldCaution, false);
  }
  const summary = f.store.priorRisk(contact.lookup, { excludeCallId: 'new-current-call' });
  assert.equal(summary.priorWarnedCalls, 3);
  assert.equal(summary.shouldCaution, true);
  assert.equal(summary.identityVerified, false);
  assert.equal(summary.analysisRequired, true);
  assert.ok(!JSON.stringify(summary).includes(contact.lookup));
  assert.ok(!JSON.stringify(summary).includes(phone));
  const other = await createCallerContact(secret, anotherPhone, 'risk');
  assert.equal(f.store.priorRisk(other.lookup).shouldCaution, false);
});

test('a new consented call refreshes the contact but cannot refresh old risk evidence', async (t) => {
  const f = fixture(t, hour);
  const contact = await createCallerContact(secret, phone, 'risk');
  f.store.registerCall(call(contact, 'old-risk'));
  f.store.recordRisk({ callId: 'old-risk', level: 'high', analysisSource: 'context-model' });
  f.setNow(start + hour - 1);
  f.store.registerCall(call(contact, 'recent-guard', 'risk', start + hour - 1));
  f.setNow(start + hour);
  assert.equal(f.store.priorRisk(contact.lookup).priorWarnedCalls, 0);
  assert.ok(f.store.contact(contact.lookup, 'risk'));
  assert.equal(f.store.recordRisk({ callId: 'old-risk', level: 'high', analysisSource: 'context-model' }).recorded, false);
  assert.throws(() => f.store.registerCall(call(contact, 'old-risk')), /expired/);
});

test('withdrawal removes that call’s risk and deletes contact only after the last retained call', async (t) => {
  const f = fixture(t);
  const contact = await createCallerContact(secret, phone, 'risk');
  f.store.registerCall(call(contact, 'retained-one'));
  f.store.recordRisk({ callId: 'retained-one', level: 'high', analysisSource: 'context-model' });
  f.setNow(start + hour);
  f.store.registerCall(call(contact, 'withdraw-newest', 'risk', start + hour));
  f.store.recordRisk({ callId: 'withdraw-newest', level: 'high', analysisSource: 'context-model' });
  assert.deepEqual(f.store.revokeCall('withdraw-newest'), { removedRisk: 1, removedContact: false });
  assert.equal(f.store.contact(contact.lookup, 'risk').expiresAt, start + 24 * hour);
  assert.equal(f.store.priorRisk(contact.lookup).priorWarnedCalls, 1);
  assert.deepEqual(f.store.revokeCall('retained-one'), { removedRisk: 1, removedContact: true });
  assert.equal(f.store.contact(contact.lookup, 'risk'), null);
  assert.equal(f.store.priorRisk(contact.lookup).priorWarnedCalls, 0);
  assert.deepEqual(f.store.revokeCall('retained-one'), { removedRisk: 0, removedContact: false });
  assert.equal(f.store.recordRisk({ callId: 'retained-one', level: 'high', analysisSource: 'context-model' }).recorded, false);
});

test('pruning enforces a hard maximum 24-hour horizon and removes all private references', async (t) => {
  const f = fixture(t, 100 * hour);
  const risk = await createCallerContact(secret, phone, 'risk');
  const help = await createCallerContact(secret, phone, 'help');
  f.store.registerCall(call(risk, 'expiring-risk'));
  f.store.recordRisk({ callId: 'expiring-risk', level: 'high', analysisSource: 'context-model' });
  f.store.registerCall(call(help, 'expiring-help', 'help'));
  assert.equal(f.store.nextExpiry(), start + 24 * hour);
  f.setNow(start + 24 * hour);
  assert.equal(f.store.contact(risk.lookup, 'risk'), null);
  assert.equal(f.store.priorRisk(risk.lookup).priorWarnedCalls, 0);
  assert.deepEqual(f.store.prune(), { removedRisk: 1, removedCalls: 2, removedContacts: 2 });
  assert.equal(f.store.nextExpiry(), null);
  assert.deepEqual(f.store.prune(), { removedRisk: 0, removedCalls: 0, removedContacts: 0 });
  for (const table of ['caller_contacts', 'caller_contact_calls', 'caller_risk_events']) {
    assert.equal(f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
});

test('invalid timestamps, storage shapes, scopes, and retention fail before any private write', async (t) => {
  const f = fixture(t);
  const contact = await createCallerContact(secret, phone, 'help');
  for (const startedAt of [0, -1, NaN, Infinity, start + 1, start - 24 * hour, 1.5]) {
    assert.throws(() => f.store.registerCall(call(contact, 'bad-clock', 'help', startedAt)), /Invalid caller call time|expired/);
  }
  assert.throws(() => f.store.registerCall(call({ lookup: contact.lookup, encryptedPhone: phone }, 'plain', 'help')), /Invalid caller contact/);
  assert.throws(() => f.store.registerCall(call(contact, 'bad\ncall', 'help')), /Invalid caller contact/);
  assert.throws(() => f.store.priorRisk(phone), /Invalid caller contact/);
  assert.throws(() => f.store.priorRisk(contact.lookup, { excludeCallId: 'bad\ncall' }), /Invalid caller contact/);
  for (const retention of [0, -1, NaN, Infinity]) assert.throws(() => new CallerStore({ exec() { throw new Error('must not write'); } }, retention), /Invalid caller retention/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM caller_contacts').get().count, 0);
});
