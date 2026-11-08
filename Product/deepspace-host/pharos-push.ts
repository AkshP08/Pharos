/**
 * Standards-based Web Push, with no Node APIs or external dependencies.
 * RFC 8291 encryption (RFC 8188 aes128gcm) + RFC 8292 VAPID authentication.
 *
 * This sends only to browser-issued subscriptions on known push services.
 * Provider acceptance is not evidence that the phone displayed a notification.
 * The service worker must show the notification; iOS requires a Home Screen
 * web app and user-granted permission. OS focus/network settings can delay it.
 */

export interface PushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface VapidKeys {
  /** Base64url uncompressed P-256 public point, including leading 0x04. */
  publicKey: string
  /** Base64url 32-byte P-256 private scalar. Server-side secret. */
  privateKey: string
  /** Operator contact URI: mailto: or https:. */
  subject: string
}

export interface PreparedPushRequest {
  endpoint: string
  headers: Record<string, string>
  body: Uint8Array
}

export type PushResult = { status: 'accepted' | 'expired' | 'failed' }
type Fetcher = (input: string, init: RequestInit) => Promise<Response>

const encoder = new TextEncoder()
const maxPayloadBytes = 3993 // RFC 8291: 4096 body - 86 header - 16 tag - 1 delimiter.

function failure(): never {
  // Never include endpoint tokens, subscription keys, payloads or credentials.
  throw new Error('Invalid Web Push request')
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}

function encodeBase64Url(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64Url(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) failure()
  const unpadded = value.replace(/=+$/, '')
  if (unpadded.length % 4 === 1) failure()
  const binary = atob(unpadded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - unpadded.length % 4) % 4))
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (bytes.length !== length || encodeBase64Url(bytes) !== unpadded) failure()
  return bytes
}

/** Known service domains only, with suffix-boundary checks and no redirects. */
export function validatePushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(endpoint)) return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname === '/') return false
    const host = url.hostname.toLowerCase()
    return host === 'fcm.googleapis.com'
      || host === 'push.services.mozilla.com'
      || host.endsWith('.push.services.mozilla.com')
      || host.endsWith('.push.apple.com')
      || host === 'notify.windows.com'
      || host.endsWith('.notify.windows.com')
  } catch { return false }
}

function subscriptionKeys(subscription: PushSubscription): { publicKey: Uint8Array; auth: Uint8Array } {
  if (!subscription || !validatePushEndpoint(subscription.endpoint)) failure()
  const publicKey = decodeBase64Url(subscription.keys?.p256dh, 65)
  if (publicKey[0] !== 4) failure()
  return { publicKey, auth: decodeBase64Url(subscription.keys?.auth, 16) }
}

/** Also checks that p256dh is an actual point on the P-256 curve. */
export async function validatePushSubscription(subscription: unknown): Promise<boolean> {
  try {
    const { publicKey } = subscriptionKeys(subscription as PushSubscription)
    await crypto.subtle.importKey('raw', publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    return true
  } catch { return false }
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8)
  return new Uint8Array(bits)
}

/** Encrypts exactly one record, with fresh ephemeral ECDH key and salt. */
export async function encryptPushPayload(subscription: PushSubscription, payload: Uint8Array): Promise<Uint8Array> {
  try {
    if (!(payload instanceof Uint8Array) || payload.length > maxPayloadBytes) failure()
    const { publicKey: uaPublic, auth } = subscriptionKeys(subscription)
    const receiverKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']) as CryptoKeyPair
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey) as ArrayBuffer)
    // The installed Workers declaration calls this property "$public"; the
    // runtime follows WebCrypto's standard "public" property.
    const agreement = { name: 'ECDH', public: receiverKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
    const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(agreement, sender.privateKey, 256))
    const ikm = await hkdf(sharedSecret, auth, concatenate(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const [cek, nonce] = await Promise.all([
      hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16),
      hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12),
    ])
    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
    const plaintext = concatenate(payload, new Uint8Array([2])) // Final-record delimiter; no padding.
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext))
    const header = new Uint8Array(21)
    header.set(salt)
    new DataView(header.buffer).setUint32(16, 4096, false)
    header[20] = asPublic.length
    return concatenate(header, asPublic, ciphertext)
  } catch { return failure() }
}

function validSubject(subject: unknown): subject is string {
  if (typeof subject !== 'string' || subject.length > 1024 || /[\u0000-\u0020\u007f]/.test(subject)) return false
  try {
    const url = new URL(subject)
    if (url.hash || url.username || url.password) return false
    return url.protocol === 'https:' && Boolean(url.hostname)
      || url.protocol === 'mailto:' && /^[^@?]+@[^@?]+$/.test(url.pathname) && !url.search
  } catch { return false }
}

async function vapidAuthorization(endpoint: string, vapid: VapidKeys): Promise<string> {
  if (!vapid || !validSubject(vapid.subject)) failure()
  const publicKey = decodeBase64Url(vapid.publicKey, 65)
  const privateKey = decodeBase64Url(vapid.privateKey, 32)
  if (publicKey[0] !== 4) failure()
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256',
    x: encodeBase64Url(publicKey.slice(1, 33)), y: encodeBase64Url(publicKey.slice(33)),
    d: encodeBase64Url(privateKey), ext: false,
  }
  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const verifyingKey = await crypto.subtle.importKey('raw', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const header = encodeBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = encodeBase64Url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })))
  const signedInput = encoder.encode(`${header}.${claims}`)
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, signedInput))
  // Catch a mismatched configured public/private pair before any network call.
  if (signature.length !== 64 || !await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyingKey, signature, signedInput)) failure()
  return `vapid t=${header}.${claims}.${encodeBase64Url(signature)}, k=${encodeBase64Url(publicKey)}`
}

/** Generates keys for server-side setup; never publish or log privateKey. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const [publicKey, jwk] = await Promise.all([
    crypto.subtle.exportKey('raw', pair.publicKey),
    crypto.subtle.exportKey('jwk', pair.privateKey),
  ])
  return { publicKey: encodeBase64Url(new Uint8Array(publicKey as ArrayBuffer)), privateKey: (jwk as JsonWebKey).d! }
}

/** No request is sent here. Useful for independent crypto/interoperability QA. */
export async function preparePushRequest(subscription: PushSubscription, payload: object, vapid: VapidKeys): Promise<PreparedPushRequest> {
  try {
    if (!payload || typeof payload !== 'object' || !validatePushEndpoint(subscription?.endpoint)) failure()
    const plaintext = encoder.encode(JSON.stringify(payload))
    if (plaintext.length > maxPayloadBytes) failure()
    const [body, authorization] = await Promise.all([
      encryptPushPayload(subscription, plaintext),
      vapidAuthorization(subscription.endpoint, vapid),
    ])
    return {
      endpoint: subscription.endpoint,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '120', // Avoid delivering an old in-call warning hours later.
        Urgency: 'high',
      },
      body,
    }
  } catch { return failure() }
}

export async function sendPush(subscription: PushSubscription, payload: object, vapid: VapidKeys, fetcher: Fetcher = fetch): Promise<PushResult> {
  try {
    const request = await preparePushRequest(subscription, payload, vapid)
    const response = await fetcher(request.endpoint, {
      method: 'POST', redirect: 'error', headers: request.headers, body: request.body,
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 404 || response.status === 410) return { status: 'expired' }
    if (response.status >= 200 && response.status < 300) return { status: 'accepted' }
    return { status: 'failed' }
  } catch { return { status: 'failed' } }
}
