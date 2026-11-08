import { analyzeCall, analyzeScamText, orderedCases, parseTranscriptTurns, transcriptText, type CallSession, type PharosCase, type Responder, type ScamReview, type TranscriptTurn } from './pharos-domain'
import { PharosStore } from './pharos-store'
export { PharosStore } from './pharos-store'

export const __DO_MANIFEST__ = [
  { binding: 'PHAROS_STORE', className: 'PharosStore', sqlite: true },
] as const

interface Env {
  ASSETS: Fetcher
  PHAROS_STORE: DurableObjectNamespace<PharosStore>
  DEEPSPACE_APP_ID: string
  APP_NAME: string
  PHAROS_INGEST_TOKEN?: string
  PHAROS_RESPONDER_PASSWORD?: string
  PHAROS_COORDINATOR_PASSWORD?: string
  PHAROS_SESSION_SECRET?: string
  PHAROS_VOICE_ROUTE_READY?: string
  PHOTON_VOICE_LINE_ID?: string
  LIVEKIT_URL?: string
}

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const maxBodyBytes = 96 * 1024
const transcriptMaxChars = 10_000

function responseJson(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } })
}

function configuredResponderAuth(env: Env): boolean {
  return Boolean(env.PHAROS_RESPONDER_PASSWORD && env.PHAROS_SESSION_SECRET)
}

function voiceReady(env: Env): boolean {
  return configuredResponderAuth(env) && Boolean(env.PHAROS_INGEST_TOKEN && env.PHOTON_VOICE_LINE_ID && env.LIVEKIT_URL && env.PHAROS_VOICE_ROUTE_READY === 'true')
}

function transcriptRetentionHours(env: Env): number {
  const value = Number((env as Env & { PHAROS_TRANSCRIPT_RETENTION_HOURS?: string }).PHAROS_TRANSCRIPT_RETENTION_HOURS || 24)
  return Number.isFinite(value) ? Math.max(1, Math.min(24, value)) : 24
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}

async function getSessionRole(request: Request, env: Env): Promise<'responder' | 'coordinator' | null> {
  if (!configuredResponderAuth(env)) return null
  const cookie = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith('pharos_session='))?.slice('pharos_session='.length)
  if (!cookie) return null
  const [payloadPart, signature] = cookie.split('.')
  if (!payloadPart || !signature) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart))) as { exp: number; role: string }
    if (!['responder', 'coordinator'].includes(payload.role) || payload.exp <= Date.now()) return null
    const expected = await hmac(env.PHAROS_SESSION_SECRET!, payloadPart)
    const supplied = fromBase64Url(signature)
    if (expected.length !== supplied.length) return null
    let diff = 0
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ supplied[i]
    return diff === 0 ? payload.role as 'responder' | 'coordinator' : null
  } catch {
    return null
  }
}

async function validSession(request: Request, env: Env): Promise<boolean> {
  return (await getSessionRole(request, env)) !== null
}

async function verifySecret(supplied: string, expected: string | undefined): Promise<boolean> {
  if (!expected) return false
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
  ])
  const a = new Uint8Array(left)
  const b = new Uint8Array(right)
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('Content-Length') || 0)
  if (declaredLength > maxBodyBytes) throw new Error('Request is too large')
  const body = await request.text()
  if (new TextEncoder().encode(body).length > maxBodyBytes) throw new Error('Request is too large')
  const parsed: unknown = JSON.parse(body || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON object required')
  return parsed as Record<string, unknown>
}

async function callStore(env: Env, action: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const id = env.PHAROS_STORE.idFromName('pharos-primary')
  const stub = env.PHAROS_STORE.get(id)
  const response = await stub.fetch('https://pharos-store.local/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  })
  const result = await response.json() as Record<string, unknown>
  if (!response.ok) throw new Error(String(result.error || 'Storage request failed'))
  return result
}

function apiError(error: unknown, status = 400): Response {
  return responseJson({ error: error instanceof Error ? error.message : 'Request failed' }, status)
}

function isPublicDemoRoute(pathname: string, method: string): boolean {
  return (pathname === '/api/auth/status' && method === 'GET')
    || (pathname === '/api/auth/login' && method === 'POST')
    || (pathname === '/api/auth/logout' && method === 'POST')
    || (pathname === '/api/health' && method === 'GET')
}

function maskedOverview(overview: Record<string, unknown>): Record<string, unknown> {
  const filtered = { ...overview }
  for (const key of ['cases', 'calls', 'scamReviews']) {
    const items = Array.isArray(filtered[key]) ? filtered[key] as Array<Record<string, unknown>> : []
    filtered[key] = items.filter((item) => item.synthetic === true)
  }
  if (Array.isArray(filtered.responders)) filtered.responders = (filtered.responders as Responder[]).filter((item) => item.synthetic)
  if (Array.isArray(filtered.incidents)) filtered.incidents = (filtered.incidents as Array<{ synthetic?: boolean }>).filter((item) => item.synthetic)
  if (Array.isArray(filtered.zones)) filtered.zones = (filtered.zones as Array<{ synthetic?: boolean }>).filter((item) => item.synthetic)
  return filtered
}

async function buildAndPersistCall(env: Env, call: CallSession, previousCaseId?: string): Promise<{ caseRecord: PharosCase | null; callKind: string; scamReview: ScamReview | null }> {
  const overview = await callStore(env, 'overview')
  const zones = overview.zones as Parameters<typeof analyzeCall>[0]['zones']
  const responders = overview.responders as Responder[]
  const incidentId = (overview.incidents as Array<{ id: string; status: string }>).find((item) => item.status === 'active')?.id ?? 'incident-trinity'
  const analysis = analyzeCall({ callId: call.id, turns: call.turns, zones, responders, incidentId, synthetic: call.synthetic, createdAt: call.startedAt })
  if (analysis.caseRecord) {
    const existing = previousCaseId ? (await callStore(env, 'case.get', { id: previousCaseId })).caseRecord as PharosCase | undefined : undefined
    if (existing) {
      analysis.caseRecord.id = existing.id
      analysis.caseRecord.createdAt = existing.createdAt
      analysis.caseRecord.status = existing.status
      analysis.caseRecord.assignedTo = existing.assignedTo
    }
    call.caseId = analysis.caseRecord.id
    await callStore(env, 'case.put', { caseRecord: analysis.caseRecord })
  }
  if (analysis.scamReview) {
    call.scamReviewId = analysis.scamReview.id
    await callStore(env, 'scam.put', { scamReview: analysis.scamReview })
  }
  await callStore(env, 'call.put', { call })
  return { caseRecord: analysis.caseRecord, callKind: analysis.callKind, scamReview: analysis.scamReview }
}

async function pruneExpired(env: Env): Promise<void> {
  await callStore(env, 'transcripts.prune', { cutoff: Date.now() - transcriptRetentionHours(env) * 60 * 60 * 1000 })
}

function expiredNotice(): string {
  return 'This voice call is transcribed for a short-lived responder review. Do not share passwords, payment details, or one-time codes.'
}

async function handleVoiceIngest(request: Request, env: Env): Promise<Response> {
  if (!configuredResponderAuth(env)) return responseJson({ error: 'Live intake is disabled until responder access is secured.' }, 503)
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || ''
  if (!(await verifySecret(token, env.PHAROS_INGEST_TOKEN))) return responseJson({ error: 'Unauthorized voice event' }, 401)
  const body = await readBody(request)
  const event = String(body.event || '')
  const callId = String(body.callId || '').slice(0, 180)
  if (!callId || !/^[a-zA-Z0-9._:-]+$/.test(callId)) return responseJson({ error: 'A safe callId is required' }, 400)

  if (event === 'call.started') {
    await callStore(env, 'seed')
    const startedAt = new Date().toISOString()
    const call: CallSession = {
      id: callId, provider: 'Photon SIP → LiveKit', status: 'ringing', consent: 'pending', transcript: '', turns: [], caseId: null, scamReviewId: null,
      startedAt, endedAt: null, transcriptionSource: 'LiveKit Inference STT', synthetic: false,
    }
    await callStore(env, 'call.put', { call })
    await pruneExpired(env)
    return responseJson({ accepted: true, callId, disclosure: expiredNotice() }, 202)
  }

  let existingCall: CallSession
  try {
    existingCall = (await callStore(env, 'call.get', { id: callId })).call as CallSession
  } catch {
    return responseJson({ error: 'Start the call session before sending updates' }, 409)
  }

  if (event === 'consent') {
    const consent = body.consent === true ? 'yes' : 'no'
    existingCall.consent = consent
    existingCall.status = consent === 'yes' ? 'in-progress' : 'declined'
    if (consent === 'no') existingCall.endedAt = new Date().toISOString()
    await callStore(env, 'call.put', { call: existingCall })
    return responseJson({ accepted: true, consent })
  }

  if (event === 'turn') {
    if (existingCall.consent !== 'yes') return responseJson({ error: 'Transcript storage requires caller consent' }, 403)
    const role = body.role === 'agent' ? 'agent' : body.role === 'caller' ? 'caller' : null
    const text = String(body.text || '').trim().slice(0, 1800)
    const sequence = Number(body.sequence)
    if (!role || !text || !Number.isSafeInteger(sequence) || sequence < 0) return responseJson({ error: 'A role, transcript text, and sequence are required' }, 400)
    const turn: TranscriptTurn = { role, text, at: new Date().toISOString() }
    const turnResult = await callStore(env, 'call.turn', { callId, sequence, turn })
    return responseJson({ accepted: true, callId, status: (turnResult.call as CallSession | undefined)?.status ?? 'in-progress', caseCreated: false }, 202)
  }

  if (event === 'call.ended') {
    existingCall.status = 'completed'
    existingCall.endedAt = new Date().toISOString()
    const result = await buildAndPersistCall(env, existingCall, existingCall.caseId ?? undefined)
    return responseJson({ accepted: true, callId, caseId: result.caseRecord?.id ?? existingCall.caseId })
  }
  return responseJson({ error: 'Unsupported voice event' }, 400)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname
    const method = request.method.toUpperCase()
    if (method === 'OPTIONS' && pathname.startsWith('/api/')) return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Cache-Control': 'no-store' } })
    if (pathname === '/api/auth/ok' && method === 'GET') return new Response('ok', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

    if (pathname === '/api/auth/status' && method === 'GET') {
      const required = configuredResponderAuth(env)
      const role = required ? await getSessionRole(request, env) : 'demo'
      return responseJson({ required, authenticated: !required || role !== null, role, mode: required ? 'secured' : 'demo-only' })
    }
    if (pathname === '/api/health' && method === 'GET') return responseJson({ ok: true, mode: configuredResponderAuth(env) ? 'secured' : 'demo-only', persistentStorage: 'sqlite-durable-object', voiceAgentCode: true, voiceRoute: voiceReady(env) ? 'ready' : 'not-configured', transcriptRetentionHours: transcriptRetentionHours(env) })
    if (pathname === '/api/auth/login' && method === 'POST') {
      if (!configuredResponderAuth(env)) return responseJson({ error: 'Responder sign-in is not configured in demo-only mode.' }, 409)
      try {
        const body = await readBody(request)
        const password = String(body.password || '')
        const responderMatch = await verifySecret(password, env.PHAROS_RESPONDER_PASSWORD)
        const coordinatorMatch = !responderMatch && await verifySecret(password, env.PHAROS_COORDINATOR_PASSWORD)
        if (!responderMatch && !coordinatorMatch) return responseJson({ error: 'Sign-in failed.' }, 401)
        const role = coordinatorMatch ? 'coordinator' : 'responder'
        const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ role, exp: Date.now() + 8 * 60 * 60 * 1000 })))
        const signature = toBase64Url(await hmac(env.PHAROS_SESSION_SECRET!, payload))
        const secure = url.protocol === 'https:' ? '; Secure' : ''
        return responseJson({ authenticated: true, role }, 200, { 'Set-Cookie': `pharos_session=${payload}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}` })
      } catch (error) { return apiError(error) }
    }
    if (pathname === '/api/auth/logout' && method === 'POST') return responseJson({ authenticated: false }, 200, { 'Set-Cookie': 'pharos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })

    if (pathname === '/api/voice/ingest' && method === 'POST') {
      try { return await handleVoiceIngest(request, env) } catch (error) { return apiError(error) }
    }

    const publicDemo = isPublicDemoRoute(pathname, method)
    if (pathname.startsWith('/api/') && configuredResponderAuth(env) && !publicDemo && !(await validSession(request, env))) return responseJson({ error: 'Responder sign-in required', authRequired: true }, 401)

    try {
      if (pathname === '/api/overview' && method === 'GET') {
        await callStore(env, 'seed')
        if (configuredResponderAuth(env)) await pruneExpired(env)
        const overview = await callStore(env, 'overview')
        if (!configuredResponderAuth(env)) return responseJson({ ...maskedOverview(overview), mode: 'demo-only' })
        return responseJson({ ...overview, mode: 'secured' })
      }

      if (pathname === '/api/cases' && method === 'GET') {
        await callStore(env, 'seed')
        if (configuredResponderAuth(env)) await pruneExpired(env)
        const overview = await callStore(env, 'overview')
        const data = configuredResponderAuth(env) ? overview : maskedOverview(overview)
        const cases = orderedCases(data.cases as PharosCase[], url.searchParams.get('zone') || 'all')
        return responseJson({ cases })
      }

      if (pathname === '/api/demo/reset' && method === 'POST') {
        await callStore(env, 'demo.reset')
        await callStore(env, 'seed')
        return responseJson({ reset: true })
      }

      if (pathname === '/api/demo/calls' && method === 'POST') {
        const body = await readBody(request)
        const transcript = String(body.transcript || '').trim().slice(0, transcriptMaxChars)
        if (transcript.length < 8) return responseJson({ error: 'Add a longer synthetic call transcript to process.' }, 400)
        await callStore(env, 'seed')
        const overview = await callStore(env, 'overview')
        const callId = `demo-${crypto.randomUUID()}`
        const startedAt = new Date().toISOString()
        const turns = parseTranscriptTurns(transcript, startedAt)
        const call: CallSession = { id: callId, provider: 'Pharos call processor · synthetic transcript', status: 'completed', consent: 'yes', transcript: transcriptText(turns), turns, caseId: null, scamReviewId: null, startedAt, endedAt: new Date().toISOString(), transcriptionSource: 'Provided synthetic transcript · no audio used', synthetic: true }
        await callStore(env, 'call.put', { call })
        for (const [sequence, turn] of turns.entries()) await callStore(env, 'call.turn', { callId, sequence, turn })
        const result = await buildAndPersistCall(env, call)
        const output = await callStore(env, 'overview')
        const caseRecord = result.caseRecord ? (output.cases as PharosCase[]).find((item) => item.id === result.caseRecord?.id) ?? result.caseRecord : null
        return responseJson({ call: (output.calls as CallSession[]).find((item) => item.id === callId), caseRecord, callKind: result.callKind, scamReview: result.scamReview, zones: overview.zones }, 201)
      }

      if (pathname === '/api/scam/analyze' && method === 'POST') {
        const body = await readBody(request)
        const text = String(body.text || '').trim().slice(0, transcriptMaxChars)
        if (text.length < 4) return responseJson({ error: 'Enter a synthetic message or transcript to analyze.' }, 400)
        const result = analyzeScamText(text)
        const scamReview = { id: `SC-${crypto.randomUUID()}`, source: 'message', sourceId: null, text, ...result, signals: result.signals, createdAt: new Date().toISOString(), synthetic: !configuredResponderAuth(env) || body.synthetic === true }
        await callStore(env, 'scam.put', { scamReview })
        return responseJson({ scamReview }, 201)
      }

      const claimMatch = pathname.match(/^\/api\/cases\/([a-zA-Z0-9._:-]+)\/claim$/)
      if (claimMatch && method === 'POST') {
        const body = await readBody(request)
        return responseJson(await callStore(env, 'case.claim', { id: claimMatch[1], responderId: String(body.responderId || '') }))
      }
      const statusMatch = pathname.match(/^\/api\/cases\/([a-zA-Z0-9._:-]+)\/status$/)
      if (statusMatch && method === 'POST') {
        const body = await readBody(request)
        return responseJson(await callStore(env, 'case.status', { id: statusMatch[1], status: String(body.status || '') }))
      }
      if (pathname === '/api/responders' && method === 'POST') {
        const body = await readBody(request)
        await callStore(env, 'seed')
        const responder: Responder = {
          id: `resp-${crypto.randomUUID()}`,
          name: String(body.name || '').trim().slice(0, 100),
          organization: String(body.organization || '').trim().slice(0, 140),
          serviceAreas: Array.isArray(body.serviceAreas) ? [...new Set(body.serviceAreas.map(String))].slice(0, 20) : [],
          capabilities: Array.isArray(body.capabilities) ? [...new Set(body.capabilities.map(String))].slice(0, 20) : [],
          available: body.available !== false,
          capacity: Math.max(0, Math.min(100, Math.floor(Number(body.capacity || 0)))),
          assignedCount: 0,
          approved: false,
          synthetic: !configuredResponderAuth(env),
        }
        const currentOverview = await callStore(env, 'overview')
        const knownZones = new Set((currentOverview.zones as Array<{ id: string }>).map((zone) => zone.id))
        const allowedCapabilities = new Set(['evacuation', 'medical', 'shelter', 'supplies', 'information', 'general'])
        if (!responder.name || !responder.organization || !responder.serviceAreas.length) return responseJson({ error: 'Name, organization, and at least one service area are required.' }, 400)
        if (responder.serviceAreas.some((zoneId) => !knownZones.has(zoneId))) return responseJson({ error: 'Choose only configured response areas.' }, 400)
        if (responder.capabilities.some((capability) => !allowedCapabilities.has(capability))) return responseJson({ error: 'One or more responder capabilities are unsupported.' }, 400)
        if (!Number.isFinite(responder.capacity)) return responseJson({ error: 'Capacity must be a number between 0 and 100.' }, 400)
        await callStore(env, 'responder.put', { responder })
        return responseJson({ responder, note: 'A coordinator must approve this profile before it receives cases.' }, 201)
      }
      const responderApproval = pathname.match(/^\/api\/responders\/([a-zA-Z0-9._:-]+)\/approval$/)
      if (responderApproval && method === 'POST') {
        if (configuredResponderAuth(env) && await getSessionRole(request, env) !== 'coordinator') return responseJson({ error: 'Coordinator sign-in is required to approve responder profiles.' }, 403)
        const body = await readBody(request)
        const overview = await callStore(env, 'overview')
        const responder = (overview.responders as Responder[]).find((item) => item.id === responderApproval[1])
        if (!responder) return responseJson({ error: 'Responder profile was not found.' }, 404)
        responder.approved = body.approved === true
        await callStore(env, 'responder.put', { responder })
        return responseJson({ responder })
      }

      if (pathname.startsWith('/api/')) return responseJson({ error: 'API route not found' }, 404)
      return env.ASSETS.fetch(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed'
      const status = /not found/i.test(message) ? 404 : /already claimed|not eligible/i.test(message) ? 409 : 400
      return apiError(error, status)
    }
  },
}
