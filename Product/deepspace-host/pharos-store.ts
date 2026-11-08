import { DurableObject } from 'cloudflare:workers'
import { analyzeCall, analyzeScamText, eligibleRespondersFor, makeSeedData, rankFor, transcriptText, type CallSession, type Incident, type PharosCase, type Priority, type Responder, type ResidentAlert, type ScamReview, type TranscriptTurn, type Zone } from './pharos-domain'

type StoreCommand = {
  action: string
  [key: string]: unknown
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

function decode<T>(value: unknown): T {
  return JSON.parse(String(value)) as T
}

function publicCall(call: CallSession): Omit<CallSession, 'callerRef'> {
  const { callerRef: _privateLookup, ...visible } = call
  return visible
}

function locationKey(location: string): string | null {
  const key = location.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  // A zone alone is much too broad for a shared-phone incident match.
  return key.length >= 10 && /\b(?:near|at|by|beside|outside|street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|highway|hwy)\b/.test(key) ? key : null
}

export class PharosStore extends DurableObject {
  private readonly sql: SqlStorage
  private readonly retentionMs: number

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    const hours = Number((env as { PHAROS_TRANSCRIPT_RETENTION_HOURS?: string })?.PHAROS_TRANSCRIPT_RETENTION_HOURS || 24)
    this.retentionMs = (Number.isFinite(hours) ? Math.max(1, Math.min(24, hours)) : 24) * 3_600_000
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS zones (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS responders (
        id TEXT PRIMARY KEY,
        synthetic INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        synthetic INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS transcript_turns (
        call_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (call_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        zone_id TEXT,
        priority_rank INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synthetic INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cases_zone_priority ON cases(zone_id, priority_rank, created_at);
      CREATE TABLE IF NOT EXISTS scam_reviews (
        id TEXT PRIMARY KEY,
        source_id TEXT,
        level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synthetic INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resident_alerts (
        id TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        synthetic INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS warning_access (
        token_hash TEXT PRIMARY KEY,
        call_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
    `)
  }

  private rows<T>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.sql.exec(query, ...bindings).toArray() as T[]
  }

  private getCase(id: string): PharosCase | null {
    const row = this.rows<{ payload: string }>('SELECT payload FROM cases WHERE id = ?', id)[0]
    return row ? decode<PharosCase>(row.payload) : null
  }

  private getResponder(id: string): Responder | null {
    const row = this.rows<{ payload: string }>('SELECT payload FROM responders WHERE id = ?', id)[0]
    return row ? decode<Responder>(row.payload) : null
  }

  private getCall(id: string): CallSession | null {
    const row = this.rows<{ payload: string }>('SELECT payload FROM calls WHERE id = ?', id)[0]
    return row ? decode<CallSession>(row.payload) : null
  }

  private putCall(call: CallSession): void {
    this.sql.exec('INSERT INTO calls (id, status, started_at, synthetic, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload', call.id, call.status, call.startedAt, Number(call.synthetic), JSON.stringify(call))
  }

  private repeatCase(call: CallSession, current: PharosCase | null, candidate: PharosCase, callerText: string): PharosCase | null {
    if (!call.callerRef || call.transport !== 'sip' || call.purpose === 'guard' || call.consent !== 'yes') return null
    if (!/\b(?:calling (?:back|again)|same (?:situation|request|incident)|(?:an? |another )?update (?:on|about|to) (?:my|our|the) (?:situation|request|case)|called (?:you )?(?:earlier|before))\b/i.test(callerText)) return null
    const key = locationKey(candidate.locationText)
    if (!key) return null
    // A provisional record can merge only while no responder work can be lost.
    if (current && (current.status === 'resolved' || current.assignedTo || current.followUpOwner || current.priorityOverride || (current.linkedCallCount || 1) > 1)) return null
    const recentCalls = this.rows<{ payload: string }>('SELECT payload FROM calls WHERE synthetic = 0 AND started_at > ?', new Date(Date.now() - this.retentionMs).toISOString())
      .map(row => decode<CallSession>(row.payload))
    const matches = new Map<string, PharosCase>()
    for (const prior of recentCalls) {
      if (prior.id === call.id || prior.callerRef !== call.callerRef || prior.consent !== 'yes' || prior.transcriptExpiredAt || !prior.endedAt || prior.purpose === 'guard' || !prior.caseId || prior.caseId === current?.id) continue
      const item = this.getCase(prior.caseId)
      if (!item || item.synthetic || item.status === 'resolved' || item.incidentId !== candidate.incidentId || locationKey(item.locationText) !== key) continue
      // Never let parallel callbacks replace an ongoing report.
      if (recentCalls.some(other => other.id !== call.id && other.caseId === item.id && !other.endedAt && other.consent !== 'no')) continue
      matches.set(item.id, item)
    }
    return matches.size === 1 ? [...matches.values()][0] : null
  }

  private refreshCall(call: CallSession): { caseRecord: PharosCase | null; warning: ResidentAlert | null } {
    const zones = this.rows<{ payload: string }>('SELECT payload FROM zones').map(row => decode<Zone>(row.payload))
    const responders = this.rows<{ payload: string }>('SELECT payload FROM responders').map(row => decode<Responder>(row.payload))
    const callerText = call.turns.filter(turn => turn.role === 'caller').map(turn => turn.text).join(' ')
    const pressure = analyzeScamText(callerText)
    let caseRecord: PharosCase | null = null
    if (call.purpose !== 'guard') {
      let previous = call.caseId ? this.getCase(call.caseId) : null
      const analysis = analyzeCall({ callId: call.id, turns: call.turns, zones, responders, incidentId: zones[0]?.incidentId || 'incident-trinity', synthetic: call.synthetic, createdAt: call.startedAt })
      caseRecord = analysis.caseRecord
      if (caseRecord) {
        // An old source call may be finalized/retried after a newer snapshot.
        if (previous && previous.callId !== call.id) return { caseRecord: null, warning: null }
        const repeat = this.repeatCase(call, previous, caseRecord, callerText)
        if (repeat) {
          if (previous) this.sql.exec('DELETE FROM cases WHERE id = ?', previous.id)
          previous = repeat
          call.caseId = repeat.id
          this.audit('case.repeat-linked', { caseId: repeat.id, callId: call.id, identityVerified: false })
        }
        caseRecord.id = call.caseId || `PH-${call.id}`
        caseRecord.latestPriority = caseRecord.priority
        if (call.transport === 'webrtc') {
          caseRecord.source = 'web'
          caseRecord.sourceLabel = 'LiveKit browser audio test · not a Photon phone call'
        }
        if (previous) {
          caseRecord.createdAt = previous.createdAt
          caseRecord.status = previous.status
          caseRecord.assignedTo = previous.assignedTo
          caseRecord.followUpOwner = previous.followUpOwner
          caseRecord.priorityOverride = previous.priorityOverride
          caseRecord.reassessmentRequired = previous.reassessmentRequired
          const newlyWorse = rankFor[caseRecord.latestPriority] < rankFor[previous.latestPriority || previous.priority]
            || caseRecord.immediateDanger === 'yes' && previous.immediateDanger !== 'yes'
          if (newlyWorse) caseRecord.reassessmentRequired = true
          if (previous.status === 'resolved' && previous.callId === call.id && newlyWorse && caseRecord.immediateDanger === 'yes') {
            caseRecord.status = 'follow-up'
            this.audit('case.active-danger-reopened', { caseId: caseRecord.id, callId: call.id })
          }
          if (newlyWorse && rankFor[caseRecord.latestPriority] < previous.priorityRank) {
            caseRecord.reassessmentRequired = true
            if (previous.priorityOverride) caseRecord.priorityOverride = { ...previous.priorityOverride, supersededAt: caseRecord.updatedAt }
            this.audit('case.urgency-increased', { caseId: caseRecord.id, callId: call.id, from: previous.priority, to: caseRecord.priority })
          } else if (previous.priorityOverride && !previous.priorityOverride.supersededAt || previous.priorityRank < caseRecord.priorityRank) {
            caseRecord.priority = previous.priority
            caseRecord.priorityRank = previous.priorityRank
            caseRecord.priorityReason = previous.priorityOverride && !previous.priorityOverride.supersededAt ? previous.priorityReason : 'Earlier higher urgency retained pending human review. Latest report: ' + caseRecord.priorityReason
            if (previous.latestPriority && previous.latestPriority !== caseRecord.latestPriority) caseRecord.reassessmentRequired = true
          }
          if (previous.assignedTo) {
            const owner = responders.find(item => item.id === previous.assignedTo)
            const coverageMatches = owner && caseRecord.zoneId && owner.serviceAreas.includes(caseRecord.zoneId)
              && (!caseRecord.needs.length || owner.capabilities.includes('general') || caseRecord.needs.some(need => owner.capabilities.includes(need)))
            if (!coverageMatches) {
              caseRecord.assignmentNeedsReview = true
              caseRecord.followUp = true
              caseRecord.priorityReason += ' Location or need changed after assignment; review responder coverage and ownership.'
              if (!previous.assignmentNeedsReview) this.audit('case.assignment-review', { caseId: caseRecord.id, responderId: previous.assignedTo, previousZone: previous.zoneId, zoneId: caseRecord.zoneId })
            }
          }
        }
        if (call.deliveryFailed) {
          caseRecord.followUp = true
          caseRecord.priorityReason += ' Transcript delivery was incomplete; confirm missing details.'
        }
        const at = call.turns.filter(turn => turn.role === 'caller').at(-1)?.at || call.startedAt
        const fields = ['immediateDanger', 'locationText', 'peopleCount', 'needs', 'priority'] as const
        const changedFields = previous ? fields.filter(field => JSON.stringify(previous![field]) !== JSON.stringify(caseRecord![field])) : [...fields]
        const priorHistory = previous?.history || (previous && previous.callId !== call.id ? [{ id: previous.callId || previous.id, callId: previous.callId || '', at: previous.updatedAt, kind: 'initial' as const, summary: 'Earlier help report', priority: previous.priority, reason: previous.priorityReason }] : [])
        const existingEntry = priorHistory.find(entry => entry.callId === call.id && entry.kind !== 'responder-review')
        const entry = {
          id: call.id, callId: call.id, at, kind: (priorHistory.some(item => item.callId !== call.id) ? 'caller-update' : 'initial') as 'caller-update' | 'initial',
          summary: `Danger ${caseRecord.immediateDanger === 'yes' ? 'reported' : caseRecord.immediateDanger === 'no' ? 'denied in this report' : 'not confirmed'}; people ${caseRecord.peopleCount ?? 'not confirmed'}; needs: ${caseRecord.needs.join(', ') || 'not confirmed'}.`,
          previousPriority: existingEntry?.previousPriority || previous?.priority, priority: caseRecord.priority, reason: caseRecord.priorityReason,
          changedFields: [...new Set([...(existingEntry?.changedFields || []), ...changedFields])],
        }
        caseRecord.history = [...priorHistory.filter(item => item.callId !== call.id || item.kind === 'responder-review'), entry].slice(-100)
        caseRecord.linkedCallCount = new Set(caseRecord.history.filter(item => item.kind !== 'responder-review').map(item => item.callId)).size
        this.putCase(caseRecord)
        call.caseId = caseRecord.id
      }
    }
    if (pressure.shouldWarn) {
      const review: ScamReview = { id: `SC-${call.id}`, source: 'call', sourceId: call.id, text: callerText, level: pressure.level, headline: pressure.headline, signals: pressure.signals, nextStep: pressure.nextStep, createdAt: call.startedAt, synthetic: call.synthetic }
      this.putScam(review)
      call.scamReviewId = review.id
    }
    let warning: ResidentAlert | null = null
    if (pressure.shouldWarn) {
      const previous = this.rows<{ payload: string }>('SELECT payload FROM resident_alerts WHERE call_id = ?', call.id).map(row => decode<ResidentAlert>(row.payload))
      const rank = { low: 0, medium: 1, high: 2 }
      if (!previous.some(item => rank[item.level] >= rank[pressure.level])) {
        warning = { id: `AL-${call.id}-${pressure.level}`, callId: call.id, headline: pressure.headline, level: pressure.level, signals: pressure.signals, nextStep: pressure.nextStep, evidenceQuality: pressure.evidenceQuality, confidence: pressure.confidence, createdAt: new Date().toISOString(), synthetic: call.synthetic, deliveryStatus: 'available' }
        this.sql.exec('INSERT OR IGNORE INTO resident_alerts (id, call_id, created_at, synthetic, payload) VALUES (?, ?, ?, ?, ?)', warning.id, call.id, warning.createdAt, Number(call.synthetic), JSON.stringify(warning))
        this.audit('call.warning', { callId: call.id, warningId: warning.id, level: warning.level })
      }
    }
    return { caseRecord, warning }
  }

  private voiceEvent(command: StoreCommand): Record<string, unknown> {
    const id = String(command.callId)
    const event = String(command.event)
    let call = this.getCall(id)
    if (event === 'call.started') {
      if (!call) {
        call = { id, provider: command.transport === 'webrtc' ? 'LiveKit WebRTC audio test' : 'Photon SIP → LiveKit', transport: command.transport === 'webrtc' ? 'webrtc' : 'sip', purpose: command.purpose === 'guard' ? 'guard' : 'intake', status: 'ringing', consent: 'pending', transcript: '', turns: [], caseId: null, scamReviewId: null, startedAt: new Date().toISOString(), endedAt: null, transcriptionSource: 'LiveKit Inference STT', synthetic: false, ...(typeof command.callerRef === 'string' ? { callerRef: command.callerRef } : {}) }
        this.putCall(call)
      }
      if (call.synthetic) throw new Error('Call ID belongs to a synthetic session')
      if (command.warningTokenHash && !call.transcriptExpiredAt) this.sql.exec('INSERT OR IGNORE INTO warning_access (token_hash, call_id, expires_at) VALUES (?, ?, ?)', String(command.warningTokenHash), id, Date.parse(call.startedAt) + this.retentionMs)
      return { accepted: true, callId: id, status: call.status, purpose: call.purpose, duplicate: call.consent !== 'pending' || call.turns.length > 0 }
    }
    if (!call) throw new Error('Start the call session before sending updates')
    if (call.synthetic) throw new Error('Live events cannot update a synthetic call')
    if (event === 'call.ended' && call.endedAt) return { accepted: true, callId: id, caseId: call.caseId, duplicate: true, warning: null }
    if (event === 'consent.revoked' && call.consent === 'no' && call.transcriptExpiredAt) return { accepted: true, consent: 'no', revoked: true, duplicate: true }
    if (call.transcriptExpiredAt || Date.parse(call.startedAt) + this.retentionMs <= Date.now()) throw new Error('Call transcript retention has expired')
    if (event === 'consent.revoked') {
      call.consent = 'no'
      call.status = 'declined'
      call.endedAt = new Date().toISOString()
      call.transcript = '[Transcript removed after consent was withdrawn]'
      call.turns = []
      call.transcriptExpiredAt = new Date().toISOString()
      delete call.callerRef
      this.sql.exec('DELETE FROM transcript_turns WHERE call_id = ?', id)
      this.sql.exec('DELETE FROM scam_reviews WHERE source_id = ?', id)
      this.sql.exec('DELETE FROM resident_alerts WHERE call_id = ?', id)
      this.sql.exec('DELETE FROM warning_access WHERE call_id = ?', id)
      this.sql.exec('DELETE FROM push_subscriptions WHERE scope = ?', id)
      if (call.caseId) {
        const item = this.getCase(call.caseId)
        if (item) {
          if (item.callId === call.id) {
            item.transcript = call.transcript
            item.turns = []
            item.scamSignals = []
            item.scamLevel = null
          }
          item.history = item.history?.filter(entry => entry.callId !== call.id)
          item.linkedCallCount = new Set(item.history?.filter(entry => entry.kind !== 'responder-review').map(entry => entry.callId)).size
          item.followUp = true
          if (item.status !== 'resolved' && !item.assignedTo) item.status = 'follow-up'
          this.putCase(item)
        }
      }
      this.putCall(call)
      this.audit('call.consent-withdrawn', { callId: id })
      return { accepted: true, consent: 'no', revoked: true }
    }
    if (event === 'consent') {
      const consent = command.consent === true ? 'yes' : 'no'
      if (call.consent === consent) return { accepted: true, consent, duplicate: true }
      if (call.consent !== 'pending' || call.endedAt) throw new Error('Consent has already been decided for this session')
      call.consent = consent
      call.status = consent === 'yes' ? 'in-progress' : 'declined'
      if (consent === 'no') {
        call.endedAt = new Date().toISOString()
        delete call.callerRef
      }
      this.putCall(call)
      return { accepted: true, consent }
    }
    if (event === 'turn') {
      if (call.consent !== 'yes') throw new Error('Transcript storage requires caller consent')
      const sequence = Number(command.sequence)
      const role = command.role
      const text = String(command.text || '').trim()
      if (!Number.isSafeInteger(sequence) || sequence < 0 || !['caller', 'agent'].includes(String(role)) || !text || text.length > 1800) throw new Error('Valid role, transcript text, and sequence are required')
      const existing = this.rows<{ payload: string }>('SELECT payload FROM transcript_turns WHERE call_id = ? AND sequence = ?', id, sequence)[0]
      if (existing) {
        const stored = decode<TranscriptTurn>(existing.payload)
        if (stored.role !== role || stored.text !== text) throw new Error('Transcript sequence conflicts with an earlier event')
        return { accepted: true, callId: id, status: call.status, duplicate: true, caseId: call.caseId, warning: null }
      }
      if (call.endedAt) throw new Error('Call is already closed')
      if (sequence !== call.turns.length) throw new Error('Transcript events must arrive in sequence')
      if (call.turns.length >= 300 || call.transcript.length + text.length > 100_000) throw new Error('Call transcript limit reached')
      const turn: TranscriptTurn = { role: role as 'caller' | 'agent', text, at: new Date().toISOString() }
      this.sql.exec('INSERT INTO transcript_turns (call_id, sequence, role, created_at, payload) VALUES (?, ?, ?, ?, ?)', id, sequence, turn.role, turn.at, JSON.stringify(turn))
      call.turns.push(turn)
      call.transcript = transcriptText(call.turns)
      const analysis = role === 'caller' ? this.refreshCall(call) : { caseRecord: null, warning: null }
      this.putCall(call)
      return { accepted: true, callId: id, status: call.status, purpose: call.purpose, caseId: call.caseId, caseCreated: Boolean(analysis.caseRecord), warning: analysis.warning }
    }
    if (event === 'call.ended') {
      if (call.endedAt) return { accepted: true, callId: id, caseId: call.caseId, duplicate: true, warning: null }
      call.status = call.consent === 'no' ? 'declined' : command.deliveryFailed === true ? 'failed' : 'completed'
      call.deliveryFailed = command.deliveryFailed === true
      call.endedAt = new Date().toISOString()
      const analysis = call.consent === 'yes' ? this.refreshCall(call) : { caseRecord: null, warning: null }
      this.putCall(call)
      return { accepted: true, callId: id, status: call.status, caseId: call.caseId, warning: analysis.warning }
    }
    throw new Error('Unsupported voice event')
  }

  private async scheduleExpiry(): Promise<void> {
    const row = this.rows<{ next: string | null }>("SELECT MIN(started_at) AS next FROM calls WHERE synthetic = 0 AND json_extract(payload, '$.transcriptExpiredAt') IS NULL")[0]
    const review = this.rows<{ next: string | null }>("SELECT MIN(created_at) AS next FROM scam_reviews WHERE synthetic = 0 AND source_id IS NULL AND json_extract(payload, '$.text') NOT LIKE '[Text expired%'")[0]
    const times = [row?.next, review?.next].filter(Boolean).map(value => Date.parse(value!) + this.retentionMs)
    for (const table of ['warning_access', 'push_subscriptions']) {
      const next = this.rows<{ next: number | null }>(`SELECT MIN(expires_at) AS next FROM ${table}`)[0]?.next
      if (next) times.push(next)
    }
    if (times.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...times)))
    else await this.ctx.storage.deleteAlarm()
  }

  async alarm(): Promise<void> {
    await this.fetch(new Request('https://pharos-store.local/command', { method: 'POST', body: JSON.stringify({ action: 'transcripts.prune', cutoff: Date.now() - this.retentionMs + 1 }) }))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'POST required' }, 405)
    let command: StoreCommand
    try {
      command = await request.json() as StoreCommand
    } catch {
      return json({ error: 'Invalid JSON command' }, 400)
    }

    try {
      switch (command.action) {
        case 'voice.event': {
          const result = this.ctx.storage.transactionSync(() => this.voiceEvent(command))
          await this.scheduleExpiry()
          return json(result)
        }
        case 'warning.lookup': {
          const access = this.rows<{ call_id: string; expires_at: number }>('SELECT call_id, expires_at FROM warning_access WHERE token_hash = ?', String(command.tokenHash))[0]
          if (!access || access.expires_at <= Date.now()) return json({ error: 'Warning link is unavailable or expired' }, 404)
          const recipientScope = access.call_id === 'demo-resident'
          const call = recipientScope ? this.rows<{ payload: string }>("SELECT payload FROM calls WHERE synthetic = 0 AND json_extract(payload, '$.purpose') = 'guard' ORDER BY started_at DESC LIMIT 1").map(row => decode<CallSession>(row.payload))[0] : this.getCall(access.call_id)
          if (call?.transcriptExpiredAt && !recipientScope) return json({ error: 'Warning link is unavailable or expired' }, 404)
          const alerts = (recipientScope
            ? this.rows<{ payload: string }>("SELECT a.payload FROM resident_alerts a JOIN calls c ON a.call_id = c.id WHERE a.synthetic = 0 AND json_extract(c.payload, '$.purpose') = 'guard' AND json_extract(c.payload, '$.transcriptExpiredAt') IS NULL ORDER BY a.created_at DESC LIMIT 20")
            : this.rows<{ payload: string }>('SELECT payload FROM resident_alerts WHERE call_id = ? ORDER BY created_at DESC', access.call_id)).map(row => decode<ResidentAlert>(row.payload))
          return json({ status: call?.status || 'completed', alerts, expiresAt: new Date(access.expires_at).toISOString() })
        }
        case 'warning.enroll': {
          const expiresAt = Date.now() + this.retentionMs
          this.sql.exec('INSERT INTO warning_access (token_hash, call_id, expires_at) VALUES (?, ?, ?)', String(command.tokenHash), 'demo-resident', expiresAt)
          await this.scheduleExpiry()
          return json({ expiresAt: new Date(expiresAt).toISOString() })
        }
        case 'push.subscribe': {
          const access = this.rows<{ call_id: string; expires_at: number }>('SELECT call_id, expires_at FROM warning_access WHERE token_hash = ?', String(command.tokenHash))[0]
          if (!access || access.expires_at <= Date.now()) return json({ error: 'Warning link is unavailable or expired' }, 404)
          const existing = this.rows<{ id: string }>('SELECT id FROM push_subscriptions WHERE id = ?', String(command.id))[0]
          const count = this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM push_subscriptions WHERE scope = ?', access.call_id)[0]?.count || 0
          if (!existing && count >= 5) return json({ error: 'This test recipient already has five notification devices' }, 409)
          this.sql.exec('INSERT INTO push_subscriptions (id, scope, expires_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET scope = excluded.scope, expires_at = excluded.expires_at, payload = excluded.payload', String(command.id), access.call_id, access.expires_at, JSON.stringify(command.subscription))
          await this.scheduleExpiry()
          return json({ subscribed: true, expiresAt: new Date(access.expires_at).toISOString() })
        }
        case 'push.list': {
          const call = this.getCall(String(command.callId))
          if (!call || call.consent !== 'yes' || call.transcriptExpiredAt) return json({ subscriptions: [] })
          const rows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM push_subscriptions WHERE expires_at > ? AND (scope = ? OR scope = ?)', Date.now(), String(command.callId), call?.purpose === 'guard' ? 'demo-resident' : String(command.callId))
          return json({ subscriptions: rows.map(row => ({ id: row.id, subscription: decode(row.payload) })) })
        }
        case 'push.remove': {
          this.sql.exec('DELETE FROM push_subscriptions WHERE id = ?', String(command.id))
          return json({ removed: true })
        }
        case 'push.unsubscribe': {
          const access = this.rows<{ call_id: string }>('SELECT call_id FROM warning_access WHERE token_hash = ?', String(command.tokenHash))[0]
          if (!access) return json({ error: 'Warning link is unavailable or expired' }, 404)
          this.sql.exec('DELETE FROM push_subscriptions WHERE id = ? AND scope = ?', String(command.id), access.call_id)
          return json({ removed: true })
        }
        case 'warning.delivery': {
          const row = this.rows<{ payload: string }>('SELECT payload FROM resident_alerts WHERE id = ?', String(command.id))[0]
          if (!row) return json({ error: 'Warning was not found' }, 404)
          const alert = decode<ResidentAlert>(row.payload)
          if (!['available', 'pending', 'accepted', 'failed', 'not-configured'].includes(String(command.status))) return json({ error: 'Invalid delivery status' }, 400)
          alert.deliveryStatus = command.status as ResidentAlert['deliveryStatus']
          this.sql.exec('UPDATE resident_alerts SET payload = ? WHERE id = ?', JSON.stringify(alert), alert.id)
          return json({ alert })
        }
        case 'warning.exists': {
          const row = this.rows<{ call_id: string }>('SELECT call_id FROM resident_alerts WHERE id = ?', String(command.id))[0]
          const call = row ? this.getCall(row.call_id) : null
          return json({ active: Boolean(call && call.consent === 'yes' && !call.transcriptExpiredAt) })
        }
        case 'warning.received': {
          const row = this.rows<{ payload: string }>('SELECT payload FROM resident_alerts WHERE id = ?', String(command.id))[0]
          if (!row) return json({ error: 'Warning was not found' }, 404)
          const alert = decode<ResidentAlert>(row.payload)
          if (Date.parse(alert.createdAt) + this.retentionMs <= Date.now()) return json({ error: 'Warning receipt expired' }, 410)
          alert.displayedAt = alert.displayedAt || new Date().toISOString()
          this.sql.exec('UPDATE resident_alerts SET payload = ? WHERE id = ?', JSON.stringify(alert), alert.id)
          return json({ acknowledged: true })
        }
        case 'seed': {
          const existing = this.rows<{ count: number }>('SELECT COUNT(*) AS count FROM cases WHERE synthetic = 1')[0]?.count ?? 0
          if (existing > 0) return json({ seeded: false })
          const data = makeSeedData()
          this.sql.exec('INSERT OR IGNORE INTO incidents (id, status, payload) VALUES (?, ?, ?)', data.incident.id, data.incident.status, JSON.stringify(data.incident))
          for (const zone of data.zones) this.sql.exec('INSERT OR IGNORE INTO zones (id, incident_id, payload) VALUES (?, ?, ?)', zone.id, zone.incidentId, JSON.stringify(zone))
          for (const responder of data.responders) this.sql.exec('INSERT OR IGNORE INTO responders (id, synthetic, payload) VALUES (?, ?, ?)', responder.id, Number(responder.synthetic), JSON.stringify(responder))
          for (const call of data.calls) this.sql.exec('INSERT OR IGNORE INTO calls (id, status, started_at, synthetic, payload) VALUES (?, ?, ?, ?, ?)', call.id, call.status, call.startedAt, 1, JSON.stringify(call))
          for (const caseRecord of data.cases) this.putCase(caseRecord)
          for (const scam of data.scamReviews) this.putScam(scam)
          for (const call of data.calls) {
            for (const [sequence, turn] of call.turns.entries()) {
              this.sql.exec('INSERT OR IGNORE INTO transcript_turns (call_id, sequence, role, created_at, payload) VALUES (?, ?, ?, ?, ?)', call.id, sequence, turn.role, turn.at, JSON.stringify(turn))
            }
          }
          return json({ seeded: true })
        }
        case 'overview': {
          const incidents = this.rows<{ payload: string }>('SELECT payload FROM incidents ORDER BY status, id').map((row) => decode<Incident>(row.payload))
          const zones = this.rows<{ payload: string }>('SELECT payload FROM zones ORDER BY id').map((row) => decode<Zone>(row.payload))
          const responders = this.rows<{ payload: string }>('SELECT payload FROM responders ORDER BY id').map((row) => decode<Responder>(row.payload))
          const cases = this.rows<{ payload: string }>('SELECT payload FROM cases ORDER BY priority_rank, created_at').map((row) => decode<PharosCase>(row.payload)).map(item => ({ ...item, eligibleResponders: eligibleRespondersFor(item, responders) }))
          const calls = this.rows<{ payload: string }>('SELECT payload FROM calls ORDER BY started_at DESC LIMIT 100').map((row) => publicCall(decode<CallSession>(row.payload)))
          const scamReviews = this.rows<{ payload: string }>('SELECT payload FROM scam_reviews ORDER BY created_at DESC LIMIT 100').map((row) => decode<ScamReview>(row.payload))
          const alerts = this.rows<{ payload: string }>('SELECT payload FROM resident_alerts ORDER BY created_at DESC LIMIT 100').map(row => decode<ResidentAlert>(row.payload))
          return json({ incidents, zones, responders, cases, calls, scamReviews, alerts })
        }
        case 'call.put': {
          const call = command.call as CallSession
          this.sql.exec('INSERT INTO calls (id, status, started_at, synthetic, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload', call.id, call.status, call.startedAt, Number(call.synthetic), JSON.stringify(call))
          if (!call.synthetic) await this.scheduleExpiry()
          return json({ call })
        }
        case 'call.get': {
          const row = this.rows<{ payload: string }>('SELECT payload FROM calls WHERE id = ?', String(command.id))[0]
          return row ? json({ call: publicCall(decode<CallSession>(row.payload)) }) : json({ error: 'Call session was not found' }, 404)
        }
        case 'call.turn': {
          const callId = String(command.callId)
          const sequence = Number(command.sequence)
          const turn = command.turn as CallSession['turns'][number]
          this.sql.exec('INSERT OR IGNORE INTO transcript_turns (call_id, sequence, role, created_at, payload) VALUES (?, ?, ?, ?, ?)', callId, sequence, turn.role, turn.at, JSON.stringify(turn))
          const callRow = this.rows<{ payload: string }>('SELECT payload FROM calls WHERE id = ?', callId)[0]
          if (!callRow) return json({ error: 'Call session was not found' }, 404)
          const call = decode<CallSession>(callRow.payload)
          const turnRows = this.rows<{ payload: string }>('SELECT payload FROM transcript_turns WHERE call_id = ? ORDER BY sequence', callId)
          call.turns = turnRows.map((row) => decode<CallSession['turns'][number]>(row.payload))
          call.transcript = call.turns.map((item) => `${item.role === 'agent' ? 'Pharos' : 'Caller'}: ${item.text}`).join('\n')
          call.status = 'in-progress'
          this.sql.exec('UPDATE calls SET status = ?, payload = ? WHERE id = ?', call.status, JSON.stringify(call), callId)
          return json({ call })
        }
        case 'case.put': {
          const caseRecord = command.caseRecord as PharosCase
          this.putCase(caseRecord)
          return json({ caseRecord })
        }
        case 'case.get': {
          const caseRecord = this.getCase(String(command.id))
          return caseRecord ? json({ caseRecord }) : json({ error: 'Case was not found' }, 404)
        }
        case 'case.claim': {
          const id = String(command.id)
          const responderId = String(command.responderId)
          const caseRecord = this.getCase(id)
          const responder = this.getResponder(responderId)
          if (!caseRecord || !responder) return json({ error: 'Case or responder was not found' }, 404)
          if (command.syntheticOnly && (!caseRecord.synthetic || !responder.synthetic)) return json({ error: 'Case or responder was not found' }, 404)
          if (caseRecord.status === 'resolved') return json({ error: 'Reopen the resolved case before claiming it' }, 409)
          if (caseRecord.assignedTo === responderId) return json({ caseRecord, responder, alreadyClaimed: true })
          if (caseRecord.assignedTo) return json({ error: 'Another responder has already claimed this case' }, 409)
          if (!responder.approved || !responder.available || responder.assignedCount - (caseRecord.followUpOwner === responderId ? 1 : 0) >= responder.capacity) return json({ error: 'Responder is not currently eligible' }, 409)
          if (caseRecord.synthetic !== responder.synthetic) return json({ error: 'Synthetic and live case records must stay in their matching workspaces' }, 403)
          const needMatch = !caseRecord.needs.length || caseRecord.needs.some((need) => responder.capabilities.includes(need) || responder.capabilities.includes('general'))
          if (!caseRecord.zoneId || !responder.serviceAreas.includes(caseRecord.zoneId) || !needMatch) return json({ error: 'This responder is not eligible for the case area or need' }, 403)
          if (caseRecord.assignedTo && caseRecord.assignedTo !== responderId) return json({ error: 'Another responder has already claimed this case' }, 409)
          if (caseRecord.assignedTo === responderId) return json({ caseRecord, responder, alreadyClaimed: true })
          caseRecord.assignedTo = responder.id
          if (caseRecord.followUpOwner) {
            const previousOwner = this.getResponder(caseRecord.followUpOwner)
            if (previousOwner) {
              previousOwner.assignedCount = Math.max(0, previousOwner.assignedCount - 1)
              this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(previousOwner), previousOwner.id)
              if (previousOwner.id === responder.id) responder.assignedCount = previousOwner.assignedCount
            }
            caseRecord.followUpOwner = null
          }
          caseRecord.status = 'claimed'
          caseRecord.updatedAt = new Date().toISOString()
          responder.assignedCount += 1
          this.putCase(caseRecord)
          this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(responder), responder.id)
          this.audit('case.claimed', { caseId: id, responderId })
          return json({ caseRecord, responder })
        }
        case 'case.followup-owner': {
          const caseRecord = this.getCase(String(command.id))
          const responder = this.getResponder(String(command.responderId))
          if (!caseRecord || !responder || (command.syntheticOnly && (!caseRecord.synthetic || !responder.synthetic))) return json({ error: 'Case or responder was not found' }, 404)
          if (caseRecord.status === 'resolved' || caseRecord.assignedTo) return json({ error: 'Follow-up ownership is only for open requests awaiting dispatch assignment' }, 409)
          if (caseRecord.followUpOwner === responder.id) return json({ caseRecord, responder, alreadyOwned: true })
          if (caseRecord.synthetic !== responder.synthetic || !responder.approved || !responder.available || responder.assignedCount >= responder.capacity || !responder.capabilities.some(value => ['general', 'information'].includes(value))) return json({ error: 'Choose an eligible general or information responder for follow-up' }, 409)
          if (caseRecord.followUpOwner) {
            const previous = this.getResponder(caseRecord.followUpOwner)
            if (previous) {
              previous.assignedCount = Math.max(0, previous.assignedCount - 1)
              this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(previous), previous.id)
            }
          }
          responder.assignedCount += 1
          this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(responder), responder.id)
          caseRecord.followUpOwner = responder.id
          caseRecord.followUp = true
          caseRecord.status = 'follow-up'
          caseRecord.updatedAt = new Date().toISOString()
          this.putCase(caseRecord)
          this.audit('case.followup-owned', { caseId: caseRecord.id, responderId: responder.id })
          return json({ caseRecord, responder })
        }
        case 'case.status': {
          const id = String(command.id)
          const status = String(command.status)
          if (!['new', 'claimed', 'follow-up', 'resolved'].includes(status)) return json({ error: 'Unsupported case status' }, 400)
          const caseRecord = this.getCase(id)
          if (!caseRecord) return json({ error: 'Case was not found' }, 404)
          if (command.syntheticOnly && !caseRecord.synthetic) return json({ error: 'Case was not found' }, 404)
          if (status === 'claimed' && !caseRecord.assignedTo) return json({ error: 'Claim the case through an eligible responder first' }, 409)
          if ((status === 'resolved' || status === 'new') && caseRecord.assignedTo) {
            const assignedResponder = this.getResponder(caseRecord.assignedTo)
            if (assignedResponder) {
              assignedResponder.assignedCount = Math.max(0, assignedResponder.assignedCount - 1)
              this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(assignedResponder), assignedResponder.id)
            }
            caseRecord.assignedTo = null
            caseRecord.assignmentNeedsReview = false
          }
          if ((status === 'resolved' || status === 'new') && caseRecord.followUpOwner) {
            const owner = this.getResponder(caseRecord.followUpOwner)
            if (owner) {
              owner.assignedCount = Math.max(0, owner.assignedCount - 1)
              this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(owner), owner.id)
            }
            caseRecord.followUpOwner = null
          }
          caseRecord.status = status as PharosCase['status']
          caseRecord.followUp = status === 'follow-up' || caseRecord.followUp
          caseRecord.updatedAt = new Date().toISOString()
          this.putCase(caseRecord)
          this.audit(`case.${status}`, { caseId: id })
          return json({ caseRecord })
        }
        case 'case.priority': {
          const caseRecord = this.getCase(String(command.id))
          if (!caseRecord) return json({ error: 'Case was not found' }, 404)
          if (command.syntheticOnly && !caseRecord.synthetic) return json({ error: 'Case was not found' }, 404)
          const priority = String(command.priority) as Priority
          const reason = String(command.reason || '').trim()
          if (!Object.hasOwn(rankFor, priority) || reason.length < 8 || reason.length > 1000) return json({ error: 'Choose a valid priority and provide a reason of 8–1000 characters' }, 400)
          caseRecord.priorityOverride = { previousPriority: caseRecord.priority, reason, at: new Date().toISOString() }
          caseRecord.priority = priority
          caseRecord.priorityRank = rankFor[priority]
          caseRecord.priorityReason = `Human review: ${reason}`
          caseRecord.updatedAt = caseRecord.priorityOverride.at
          caseRecord.reassessmentRequired = false
          caseRecord.history = [...(caseRecord.history || []), { id: crypto.randomUUID(), callId: caseRecord.callId || '', at: caseRecord.updatedAt, kind: 'responder-review' as const, summary: 'Responder reviewed priority', previousPriority: caseRecord.priorityOverride.previousPriority, priority, reason }].slice(-100)
          this.putCase(caseRecord)
          this.audit('case.priority-reviewed', { caseId: caseRecord.id, priority, reason, role: command.role })
          return json({ caseRecord })
        }
        case 'scam.put': {
          const scam = command.scamReview as ScamReview
          this.putScam(scam)
          if (!scam.synthetic) await this.scheduleExpiry()
          return json({ scamReview: scam })
        }
        case 'responder.put': {
          const responder = command.responder as Responder
          if (command.syntheticOnly && !responder.synthetic) return json({ error: 'Responder was not found' }, 404)
          this.sql.exec('INSERT INTO responders (id, synthetic, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET synthetic = excluded.synthetic, payload = excluded.payload', responder.id, Number(responder.synthetic), JSON.stringify(responder))
          this.audit('responder.updated', { responderId: responder.id })
          return json({ responder })
        }
        case 'demo.reset': {
          const syntheticCalls = this.rows<{ id: string }>('SELECT id FROM calls WHERE synthetic = 1').map((row) => row.id)
          for (const callId of syntheticCalls) this.sql.exec('DELETE FROM transcript_turns WHERE call_id = ?', callId)
          this.sql.exec('DELETE FROM resident_alerts WHERE synthetic = 1')
          this.sql.exec('DELETE FROM incidents WHERE id LIKE \'incident-demo-%\'')
          this.sql.exec('DELETE FROM zones WHERE id LIKE \'demo-zone-%\'')
          this.sql.exec('DELETE FROM responders WHERE synthetic = 1')
          this.sql.exec('DELETE FROM calls WHERE synthetic = 1')
          this.sql.exec('DELETE FROM cases WHERE synthetic = 1')
          this.sql.exec('DELETE FROM scam_reviews WHERE synthetic = 1')
          return json({ reset: true })
        }
        case 'transcripts.prune': {
          const cutoff = Number(command.cutoff)
          const cutoffIso = new Date(cutoff).toISOString()
          const rows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM calls WHERE synthetic = 0 AND started_at < ?', cutoffIso)
          for (const row of rows) {
            const call = decode<CallSession>(row.payload)
            call.transcript = '[Transcript expired under the configured retention policy]'
            call.turns = []
            call.transcriptExpiredAt = new Date().toISOString()
            delete call.callerRef
            this.sql.exec('UPDATE calls SET payload = ? WHERE id = ?', JSON.stringify(call), row.id)
            this.sql.exec('DELETE FROM transcript_turns WHERE call_id = ?', row.id)
            const scamRows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM scam_reviews WHERE source_id = ? AND synthetic = 0', row.id)
            for (const scamRow of scamRows) {
              const review = decode<ScamReview>(scamRow.payload)
              review.text = '[Transcript expired under the configured retention policy]'
              review.signals = review.signals.map((signal) => ({ ...signal, evidence: '[expired]' }))
              this.sql.exec('UPDATE scam_reviews SET payload = ? WHERE id = ?', JSON.stringify(review), scamRow.id)
            }
          }
          // A case may outlive its original call. Expire evidence by its current
          // source call, never by the incident's original creation timestamp.
          const caseRows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM cases WHERE synthetic = 0')
          for (const row of caseRows) {
            const caseRecord = decode<PharosCase>(row.payload)
            const source = caseRecord.callId ? this.getCall(caseRecord.callId) : null
            if (source ? Date.parse(source.startedAt) < cutoff : Date.parse(caseRecord.createdAt) < cutoff) {
              caseRecord.transcript = '[Transcript expired under the configured retention policy]'
              caseRecord.turns = []
              caseRecord.scamSignals = caseRecord.scamSignals.map((signal) => ({ ...signal, evidence: '[expired]' }))
            }
            caseRecord.history = caseRecord.history?.filter(entry => Date.parse(entry.at) >= cutoff)
            caseRecord.linkedCallCount = new Set(caseRecord.history?.filter(entry => entry.kind !== 'responder-review').map(entry => entry.callId)).size
            this.sql.exec('UPDATE cases SET payload = ? WHERE id = ?', JSON.stringify(caseRecord), row.id)
          }
          const standaloneScamRows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM scam_reviews WHERE synthetic = 0 AND source_id IS NULL AND created_at < ?', cutoffIso)
          for (const row of standaloneScamRows) {
            const review = decode<ScamReview>(row.payload)
            review.text = '[Text expired under the configured retention policy]'
            review.signals = review.signals.map((signal) => ({ ...signal, evidence: '[expired]' }))
            this.sql.exec('UPDATE scam_reviews SET payload = ? WHERE id = ?', JSON.stringify(review), row.id)
          }
          const alertRows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM resident_alerts WHERE synthetic = 0 AND (created_at < ? OR call_id IN (SELECT id FROM calls WHERE synthetic = 0 AND started_at < ?))', cutoffIso, cutoffIso)
          for (const row of alertRows) {
            const alert = decode<ResidentAlert>(row.payload)
            alert.signals = alert.signals.map(signal => ({ ...signal, evidence: '[expired]' }))
            this.sql.exec('UPDATE resident_alerts SET payload = ? WHERE id = ?', JSON.stringify(alert), row.id)
          }
          this.sql.exec('DELETE FROM warning_access WHERE expires_at <= ?', Date.now())
          this.sql.exec('DELETE FROM push_subscriptions WHERE expires_at <= ?', Date.now())
          await this.scheduleExpiry()
          return json({ prunedCalls: rows.length, cutoff: cutoffIso })
        }
        default:
          return json({ error: `Unknown store action: ${command.action}` }, 404)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Store request failed'
      const status = /requires caller consent/.test(message) ? 403 : /expired/.test(message) ? 410 : /before sending|sequence|already|closed/.test(message) ? 409 : 400
      return json({ error: message }, status)
    }
  }

  private putCase(caseRecord: PharosCase): void {
    this.sql.exec(
      'INSERT INTO cases (id, zone_id, priority_rank, status, created_at, synthetic, payload) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET zone_id = excluded.zone_id, priority_rank = excluded.priority_rank, status = excluded.status, synthetic = excluded.synthetic, payload = excluded.payload',
      caseRecord.id, caseRecord.zoneId, caseRecord.priorityRank, caseRecord.status, caseRecord.createdAt, Number(caseRecord.synthetic), JSON.stringify(caseRecord),
    )
  }

  private putScam(scam: ScamReview): void {
    this.sql.exec(
      'INSERT INTO scam_reviews (id, source_id, level, created_at, synthetic, payload) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET level = excluded.level, payload = excluded.payload',
      scam.id, scam.sourceId, scam.level, scam.createdAt, Number(scam.synthetic), JSON.stringify(scam),
    )
  }

  private audit(eventType: string, payload: Record<string, unknown>): void {
    this.sql.exec('INSERT INTO audit_events (id, event_type, created_at, payload) VALUES (?, ?, ?, ?)', crypto.randomUUID(), eventType, new Date().toISOString(), JSON.stringify(payload))
  }
}
