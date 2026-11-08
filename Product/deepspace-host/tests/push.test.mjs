import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, verify } from 'node:crypto';
import { encryptPushPayload, generateVapidKeys, preparePushRequest, sendPush, validatePushEndpoint, validatePushSubscription } from '../pharos-push.ts';

const b64 = bytes => Buffer.from(bytes).toString('base64url');
const rawPublic = jwk => Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
function receiver(endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/test-only') {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.privateKey.export({ format: 'jwk' });
  return {
    pair,
    subscription: { endpoint, keys: { p256dh: b64(rawPublic(jwk)), auth: b64(randomBytes(16)) } },
  };
}
async function vapid() { return { ...await generateVapidKeys(), subject: 'mailto:push@example.invalid' }; }

// Independent OpenSSL/Node implementation of the subscriber side. It uses no
// production encryption helpers and is checked against the RFC 8291 vector.
function decryptRecord(body, receiverPrivateJwk, auth) {
  body = Buffer.from(body);
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const keyLength = body[20];
  assert.equal(keyLength, 65);
  const senderPublic = body.subarray(21, 21 + keyLength);
  const senderKey = createPublicKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', x: b64(senderPublic.subarray(1, 33)), y: b64(senderPublic.subarray(33)),
  } });
  const receiverKey = createPrivateKey({ format: 'jwk', key: receiverPrivateJwk });
  const shared = diffieHellman({ privateKey: receiverKey, publicKey: senderKey });
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), rawPublic(receiverPrivateJwk), senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(auth, 'base64url'), info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const ciphertext = body.subarray(21 + keyLength);
  assert.ok(ciphertext.length < recordSize);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(plaintext.at(-1), 2, 'final-record padding delimiter');
  return plaintext.subarray(0, -1);
}

test('independent subscriber decoder matches the RFC 8291 Appendix A vector', () => {
  const senderPublic = Buffer.from('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'base64url');
  const receiverPublic = Buffer.from('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'base64url');
  const receiverJwk = { kty: 'EC', crv: 'P-256', d: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94', x: b64(receiverPublic.subarray(1, 33)), y: b64(receiverPublic.subarray(33)) };
  const header = Buffer.alloc(21); Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url').copy(header); header.writeUInt32BE(4096, 16); header[20] = 65;
  const ciphertext = Buffer.from('8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ', 'base64url');
  const decoded = decryptRecord(Buffer.concat([header, senderPublic, ciphertext]), receiverJwk, 'BTBZMqHH6r4Tts7J_aSIgg');
  assert.equal(decoded.toString(), 'When I grow up, I want to be a watermelon');
});

test('generated payload decrypts independently and VAPID signature binds the push origin', async () => {
  const { pair, subscription } = receiver();
  const keys = await vapid();
  const payload = { title: 'Pharos warning', body: 'Pause before sharing codes. 📞', url: '/guard.html#test' };
  const request = await preparePushRequest(subscription, payload, keys);
  const decoded = decryptRecord(request.body, pair.privateKey.export({ format: 'jwk' }), subscription.keys.auth);
  assert.deepEqual(JSON.parse(decoded.toString()), payload);
  assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(request.headers.TTL, '120');
  assert.equal(request.headers.Urgency, 'high');
  const match = request.headers.Authorization.match(/^vapid t=([^,]+), k=(\S+)$/);
  assert.ok(match);
  const [header, claims, signature] = match[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const jwt = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(jwt.aud, new URL(subscription.endpoint).origin);
  assert.equal(jwt.sub, keys.subject);
  assert.ok(jwt.exp > Date.now() / 1000 && jwt.exp <= Date.now() / 1000 + 12 * 3600);
  assert.equal(match[2], keys.publicKey);
  const publicRaw = Buffer.from(keys.publicKey, 'base64url');
  const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64(publicRaw.subarray(1, 33)), y: b64(publicRaw.subarray(33)) } });
  assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  assert.ok(!verify('sha256', Buffer.from(`${header}.${claims}tampered`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  const tampered = Buffer.from(request.body); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptRecord(tampered, pair.privateKey.export({ format: 'jwk' }), subscription.keys.auth));
});

test('each encryption uses a different salt and ephemeral ECDH public key', async () => {
  const { subscription } = receiver();
  const payload = new TextEncoder().encode('same warning');
  const first = await encryptPushPayload(subscription, payload);
  const second = await encryptPushPayload(subscription, payload);
  assert.notDeepEqual(first.slice(0, 16), second.slice(0, 16));
  assert.notDeepEqual(first.slice(21, 86), second.slice(21, 86));
});

test('push endpoint validation allows documented providers and rejects SSRF/redirect tricks', () => {
  for (const endpoint of [
    'https://web.push.apple.com/test-only',
    'https://fcm.googleapis.com/fcm/send/test-only',
    'https://updates.push.services.mozilla.com/wpush/v2/test-only',
    'https://push.services.mozilla.com/wpush/v2/test-only',
    'https://wns2-bl2p.notify.windows.com/w/?token=test-only',
  ]) assert.equal(validatePushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.invalid/x',
    'https://evilpush.apple.com/x', 'https://push.apple.com.evil.invalid/x',
    'https://fcm.googleapis.com@127.0.0.1/x', 'https://user:secret@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', 'https://127.0.0.1/x', 'https://[::1]/x',
    'https://169.254.169.254/latest/meta-data/', 'https://example.invalid/x',
    'https://fcm.googleapis.com/x#fragment', 'https://fcm.googleapis.com/',
    'https://fcm.googleapis.com./x', 'https://fcm.googleapis.com\\@evil.invalid/x',
    ' https://fcm.googleapis.com/x', '', null,
  ]) assert.equal(validatePushEndpoint(endpoint), false, String(endpoint));
});

test('malformed/invalid-curve keys and mismatched VAPID pairs fail before network', async () => {
  const { subscription } = receiver();
  const keys = await vapid();
  assert.equal(await validatePushSubscription(subscription), true);
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 201 }); };
  const badSubscriptions = [
    { ...subscription, endpoint: 'https://example.invalid/push' },
    { ...subscription, keys: { ...subscription.keys, auth: b64(new Uint8Array(15)) } },
    { ...subscription, keys: { ...subscription.keys, p256dh: b64(new Uint8Array(65)) } },
    { ...subscription, keys: { ...subscription.keys, p256dh: b64(Uint8Array.from([4, ...new Uint8Array(64)])) } },
    { ...subscription, keys: { ...subscription.keys, p256dh: 'not+base64url/' } },
    { ...subscription, keys: null },
  ];
  for (const invalid of badSubscriptions) {
    assert.equal(await validatePushSubscription(invalid), false);
    assert.deepEqual(await sendPush(invalid, { title: 'test' }, keys, fetcher), { status: 'failed' });
  }
  const otherKeys = await vapid();
  for (const invalid of [
    { ...keys, privateKey: b64(new Uint8Array(31)) },
    { ...keys, privateKey: otherKeys.privateKey },
    { ...keys, subject: 'http://example.invalid' },
    { ...keys, subject: 'mailto:not-an-address' },
    { ...keys, subject: 'mailto:push@example.invalid\nsecret' },
  ]) assert.deepEqual(await sendPush(subscription, { title: 'test' }, invalid, fetcher), { status: 'failed' });
  assert.equal(calls, 0);
});

test('payload byte limits are enforced and errors never expose input secrets', async () => {
  const { subscription } = receiver(); const keys = await vapid();
  const circular = {}; circular.self = circular;
  for (const payload of [{ body: 'x'.repeat(4000) }, { body: '📞'.repeat(1100) }, circular]) {
    await assert.rejects(preparePushRequest(subscription, payload, keys), error => error.message === 'Invalid Web Push request');
  }
  const maximum = await encryptPushPayload(subscription, new Uint8Array(3993));
  assert.equal(maximum.length, 4096);
  await assert.rejects(encryptPushPayload(subscription, new Uint8Array(3994)), /Invalid Web Push request/);
});

test('provider responses distinguish accepted, expired, and failed without following redirects', async () => {
  const { subscription } = receiver(); const keys = await vapid();
  for (const [code, expected] of [[201, 'accepted'], [202, 'accepted'], [404, 'expired'], [410, 'expired'], [301, 'failed'], [403, 'failed'], [429, 'failed'], [500, 'failed']]) {
    const result = await sendPush(subscription, { title: 'test' }, keys, async (url, init) => {
      assert.equal(url, subscription.endpoint);
      assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST');
      assert.ok(init.signal instanceof AbortSignal);
      assert.ok(init.body instanceof Uint8Array);
      return new Response(null, { status: code });
    });
    assert.deepEqual(result, { status: expected });
  }
  assert.deepEqual(await sendPush(subscription, {}, keys, async () => { throw new Error('do not expose endpoint tokens'); }), { status: 'failed' });
});
