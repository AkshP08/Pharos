import { DurableObject } from 'cloudflare:workers'
import { analyzeCall, analyzeScamText, eligibleRespondersFor, integrityAllowsDispatch, makeSeedData, rankFor, transcriptText, type CallSession, type Incident, type IntegrityReview, type PharosCase, type Priority, type Responder, type ResidentAlert, type ScamReview, type TranscriptTurn, type Zone } from './pharos-domain'
import { semanticAnalysis } from './pharos-semantic'
import { CallerStore } from './pharos-callers'
import { CallerAudioStore, type SealedAudioChunk } from './pharos-audio'

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

function publicCall(call: CallSession): Omit<CallSession, 'callerRef' | 'reviewIdentity' | 'callerContact'> {
  const { callerRef: _privateLookup, reviewIdentity: _privateEvidence, callerContact: _privateContact, ...visible } = call
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
  private readonly callers: CallerStore
  private readonly audio: CallerAudioStore

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    const hours = Number((env as { PHAROS_TRANSCRIPT_RETENTION_HOURS?: string })?.PHAROS_TRANSCRIPT_RETENTION_HOURS || 24)
    this.retentionMs = (Number.isFinite(hours) ? Math.max(1, Math.min(24, hours)) : 24) * 3_600_000
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS responder_accounts (email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL, created_at TEXT NOT NULL);
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
    this.callers = new CallerStore(this.sql, this.retentionMs)
    this.audio = new CallerAudioStore(this.sql, this.retentionMs)
  }

  private rows<T>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.sql.exec(query, ...bindings).toArray() as T[]
  }

  private getCase(id: string): PharosCase | null {
    const row = this.rows<{ payload: string }>('SELECT payload FROM cases WHERE id = ?', id)[0]
    return row ? this.decorateCase(decode<PharosCase>(row.payload)) : null
  }

  private latestCallerSequence(call: CallSession): number {
    let sequence = call.turns.length - 1
    while (sequence >= 0 && call.turns[sequence].role !== 'caller') sequence -= 1
    return sequence
  }

  private initialIntegrity(item: PharosCase, call?: CallSession | null): IntegrityReview {
    const at = item.updatedAt || item.createdAt || new Date().toISOString()
    const syntheticConcern = item.synthetic && Boolean(item.scamLevel && item.scamLevel !== 'low' && item.scamSignals.length)
    const syntheticClear = item.synthetic && !syntheticConcern
    return {
      status: syntheticClear ? 'clear' : 'review-required', version: 1,
      sourceCallId: call?.id || item.callId || `case:${item.id}`, sourceSequence: call ? this.latestCallerSequence(call) : -1,
      analysisStatus: syntheticClear || syntheticConcern ? 'completed' : 'unavailable',
      basis: syntheticClear ? 'model-clear' : syntheticConcern ? 'content-signals' : 'analysis-unavailable',
      reason: syntheticClear ? 'Known fictional fixture: no supported current request concern.' : syntheticConcern ? 'Fictional wording contains a request concern. Human verification is required.' : 'A completed contextual assessment is not available. Human verification is required.',
      signals: syntheticConcern ? item.scamSignals : [], updatedAt: at,
      ...(syntheticConcern ? { evidenceCallId: call?.id || item.callId || undefined, evidenceSequence: call ? this.latestCallerSequence(call) : -1 } : {}),
    }
  }

  private decorateCase(item: PharosCase): PharosCase {
    const call = item.callId ? this.getCall(item.callId) : null
    item.integrityReview ||= this.initialIntegrity(item, call)
    const selectedId = item.integrityReview.evidenceCallId || item.callId || ''
    const audioCall = this.retainedAudioSource(item)
    item.audio = { callId: selectedId, ...(audioCall ? this.audio.metadata(audioCall.id) : { available: false, durationSeconds: 0, expiresAt: null }) }
    return item
  }

  private retainedAudioSource(item: PharosCase): CallSession | null {
    if (item.integrityReview?.status === 'clear') return null
    const selectedId = item.integrityReview?.evidenceCallId || item.callId
    const call = selectedId ? this.getCall(selectedId) : null
    return call && call.caseId === item.id && call.purpose !== 'guard' && call.consent === 'yes' && call.audioConsent === true
      && !call.transcriptExpiredAt && Date.parse(call.startedAt) + this.retentionMs > Date.now() ? call : null
  }

  private invalidateTravel(item: PharosCase, at: string): void {
    if (item.responseProgress && item.responseProgress.state !== 'review-needed') item.responseProgress = { ...item.responseProgress, state: 'review-needed', etaAt: null, updatedAt: at }
  }

  private pendingIntegrity(item: PharosCase, call: CallSession, previous?: IntegrityReview): IntegrityReview {
    const sequence = this.latestCallerSequence(call)
    if (previous?.sourceCallId === call.id && previous.sourceSequence === sequence) return previous
    const sameCall = previous?.sourceCallId === call.id
    const sticky = previous && ['review-required', 'dismissed'].includes(previous.status)
    const reopenedDismissal = previous?.status === 'dismissed'
    const accepted = sameCall && previous?.status === 'accepted'
    const semantic = call.analysisMode === 'semantic'
    return {
      status: reopenedDismissal ? 'review-required' : sticky ? previous!.status : accepted ? 'accepted' : semantic ? 'pending' : 'review-required',
      version: (previous?.version || 0) + 1, sourceCallId: call.id, sourceSequence: sequence,
      analysisStatus: semantic ? 'pending' : 'unavailable',
      basis: sticky || accepted ? previous!.basis : semantic ? 'analysis-pending' : 'analysis-unavailable',
      reason: reopenedDismissal ? 'New caller information arrived after the prior dismissal. Human verification is required; reported danger remains visible.' : sticky || accepted ? previous!.reason : semantic ? 'Context review is pending. Reported danger remains visible for immediate human review.' : 'Context review is unavailable. Human verification is required; urgency remains based on the reported facts.',
      signals: sticky || accepted ? previous!.signals : [], updatedAt: new Date().toISOString(),
      ...(previous?.decision ? { decision: previous.decision } : {}),
      ...(previous?.evidenceCallId ? { evidenceCallId: previous.evidenceCallId, evidenceSequence: previous.evidenceSequence } : {}),
    }
  }

  private applyIntegrityAssessment(call: CallSession, input: { analysisStatus: 'completed' | 'unavailable'; concerning: boolean; uncertain?: boolean; signals?: PharosCase['scamSignals']; level?: ScamReview['level'] }): void {
    if (call.purpose === 'guard' || !call.caseId) return
    const item = this.getCase(call.caseId)
    if (!item || item.callId !== call.id) return
    const sequence = this.latestCallerSequence(call)
    const current = item.integrityReview || this.initialIntegrity(item, call)
    const acceptedScope = current.status === 'accepted' && current.decision?.action === 'accept'
      && current.decision.sourceCallId === call.id && current.decision.sourceSequence >= sequence
    const sticky = ['review-required', 'dismissed'].includes(current.status)
    const requiresReview = input.concerning || input.uncertain || input.analysisStatus === 'unavailable'
    const next: IntegrityReview = {
      ...current, sourceCallId: call.id, sourceSequence: sequence, analysisStatus: input.analysisStatus,
      status: acceptedScope ? 'accepted' : requiresReview ? 'review-required' : sticky ? current.status : current.status === 'accepted' ? 'accepted' : 'clear',
      basis: acceptedScope ? 'human-decision' : requiresReview ? input.analysisStatus === 'unavailable' ? 'analysis-unavailable' : 'content-signals' : sticky || current.status === 'accepted' ? current.basis : 'model-clear',
      reason: acceptedScope ? current.reason : requiresReview ? input.analysisStatus === 'unavailable' ? 'Context review was unavailable. A human must verify this request; reported danger remains highlighted.' : input.uncertain ? 'The contextual assessment is uncertain about a potential concerning request. Human verification is required; this is not proof of fabrication.' : 'Caller wording contains a supported request concern. Verify it before assignment; urgency and danger facts are unchanged.' : sticky || current.status === 'accepted' ? current.reason : 'No supported current request concern was identified. This is not proof that the caller or report is genuine.',
      signals: input.concerning ? input.signals || [] : sticky || acceptedScope ? current.signals : [],
      ...(input.concerning ? { evidenceCallId: call.id, evidenceSequence: sequence } : {}),
    }
    if (!input.concerning && !sticky && !acceptedScope && current.status !== 'accepted') {
      delete next.evidenceCallId
      delete next.evidenceSequence
    }
    const equal = JSON.stringify({ ...next, version: 0, updatedAt: '' }) === JSON.stringify({ ...current, version: 0, updatedAt: '' })
    if (equal) return
    next.version = current.version + 1
    next.updatedAt = new Date().toISOString()
    item.integrityReview = next
    item.updatedAt = next.updatedAt
    if (next.status === 'review-required') this.invalidateTravel(item, next.updatedAt)
    if (input.concerning) {
      item.scamSignals = input.signals || []
      item.scamLevel = input.level || 'medium'
    } else if (!sticky && !acceptedScope && !input.uncertain) {
      item.scamSignals = []
      item.scamLevel = null
    }
    this.putCase(item)
    this.audit('case.integrity-assessed', { caseId: item.id, callId: call.id, sequence, status: next.status, analysisStatus: next.analysisStatus, version: next.version })
    if (call.endedAt && next.status === 'clear') this.audio.revoke(call.id)
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

  private validAssignedResponder(item: PharosCase): boolean {
    const owner = item.assignedTo ? this.getResponder(item.assignedTo) : null
    return Boolean(owner?.approved && owner.synthetic === item.synthetic && item.zoneId && owner.serviceAreas.includes(item.zoneId)
      && (!item.needs.length || owner.capabilities.includes('general') || item.needs.some(need => owner.capabilities.includes(need))))
  }

  private callProgress(call: CallSession): Record<string, unknown> {
    if (call.purpose === 'guard') throw new Error('Response progress requires an intake call')
    if (call.transcriptExpiredAt || Date.parse(call.startedAt) + this.retentionMs <= Date.now()) throw new Error('Call retention has expired')
    if (call.consent !== 'yes') throw new Error('Response progress requires caller consent')
    const item = call.caseId ? this.getCase(call.caseId) : null
    const base = { accepted: true, revision: `pending:${item?.id || call.id}`, state: 'pending', message: item ? 'Your request reached the response desk. An arrival time is not confirmed yet.' : 'Request details are still being collected. An arrival time is not confirmed.', announce: false }
    if (!item) return base
    if (!integrityAllowsDispatch(item)) return { ...base, revision: `review:${item.id}:${item.integrityReview?.version || 0}`, state: 'review-needed', message: 'Your request reached the response desk for human verification. An arrival time is not confirmed yet.', announce: false }
    if (item.status === 'resolved') return { ...base, revision: `resolved:${item.updatedAt}`, state: 'resolved', message: 'The response desk marked this request resolved. Tell us if you still need help.', announce: true }
    const progress = item.responseProgress
    if (!progress) return base
    const revision = `${progress.state}:${progress.updatedAt}`
    if (progress.state === 'review-needed' || item.assignmentNeedsReview || progress.responderId !== item.assignedTo || !this.validAssignedResponder(item)) {
      return { ...base, revision: `review:${item.updatedAt}`, state: 'review-needed', message: 'Your updated situation needs responder review. An arrival time is not confirmed.', announce: true }
    }
    if (progress.state === 'unable') return { ...base, revision, state: 'unable', message: 'The response desk reports that the assigned responder cannot attend. Your request needs reassignment; an arrival time is not confirmed.', announce: true }
    if (progress.state === 'arrived') return { ...base, revision, state: 'arrived', message: 'The response desk reports that the responder has arrived. Tell us if you still need help.', announce: true }
    const eta = Date.parse(progress.etaAt || '')
    if (!Number.isFinite(eta) || eta <= Date.now()) return { ...base, revision: `expired:${revision}:${progress.etaAt}`, state: 'delayed', message: 'The last arrival estimate has passed. An updated time is not confirmed yet.', announce: true }
    const minutes = Math.ceil((eta - Date.now()) / 60_000)
    return { ...base, revision, state: progress.state, message: progress.state === 'delayed' ? `The response desk reports a delay. Updated estimated arrival: about ${minutes} minutes. Conditions can change.` : `The response desk reports a responder is on the way. Estimated arrival: about ${minutes} minutes. Conditions can change.`, announce: true }
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
      if (!item || item.synthetic || item.status === 'resolved' || item.integrityReview?.status === 'dismissed' || item.incidentId !== candidate.incidentId || locationKey(item.locationText) !== key) continue
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
      const analysis = analyzeCall({ callId: call.id, turns: call.turns, zones, responders, incidentId: zones[0]?.incidentId || 'incident-trinity', synthetic: call.synthetic, createdAt: call.startedAt, preserveIntake: true })
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
        caseRecord.integrityReview = this.pendingIntegrity(caseRecord, call, previous?.integrityReview)
        if (call.analysisMode === 'semantic') {
          caseRecord.scamSignals = previous?.scamSignals || []
          caseRecord.scamLevel = previous?.scamLevel || null
        }
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
          caseRecord.responseProgress = previous.responseProgress
          caseRecord.reassessmentRequired = previous.reassessmentRequired
          const newlyWorse = rankFor[caseRecord.latestPriority] < rankFor[previous.latestPriority || previous.priority]
            || caseRecord.immediateDanger === 'yes' && previous.immediateDanger !== 'yes'
          if (newlyWorse) caseRecord.reassessmentRequired = true
          const latestCaller = call.turns.filter(turn => turn.role === 'caller').at(-1)
          const changedLocation = previous.zoneId !== caseRecord.zoneId || locationKey(previous.locationText) !== locationKey(caseRecord.locationText)
          const newWorseningReport = Boolean(latestCaller && previous.responseProgress && Date.parse(latestCaller.at) > Date.parse(previous.responseProgress.updatedAt)
            && caseRecord.immediateDanger === 'yes' && /\b(?:(?:water|floodwater)\b.{0,60}\b(?:rising|risen|higher|coming|upstairs|deep)|getting worse|(?:cannot|can't) breathe|trapped|no safe (?:way out|exit))\b/i.test(latestCaller.text))
          if (previous.responseProgress && (newlyWorse || changedLocation || newWorseningReport || previous.immediateDanger !== caseRecord.immediateDanger)) {
            caseRecord.responseProgress = { ...previous.responseProgress, state: 'review-needed', etaAt: null, updatedAt: caseRecord.updatedAt }
          }
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
        const fields = ['immediateDanger', 'locationText', 'peopleCount', 'needs', 'priority', 'responseProgress'] as const
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
    const warning = call.analysisMode !== 'semantic' && pressure.shouldWarn ? this.recordPressure(call, pressure, callerText, 'wording-rules') : null
    return { caseRecord, warning }
  }

  private recordPressure(call: CallSession, pressure: ReturnType<typeof analyzeScamText>, callerText: string, analysisSource: 'wording-rules' | 'context-model'): ResidentAlert | null {
    if (pressure.shouldWarn) {
      if (call.purpose === 'guard' && analysisSource === 'context-model') this.callers.recordRisk({ callId: call.id, level: pressure.level, analysisSource })
      const review: ScamReview = { id: `SC-${call.id}`, source: 'call', sourceId: call.id, text: callerText, level: pressure.level, headline: pressure.headline, signals: pressure.signals, nextStep: pressure.nextStep, createdAt: call.startedAt, synthetic: call.synthetic, analysisSource }
      this.putScam(review)
      call.scamReviewId = review.id
    }
    // Current product is responder-facing. Intake concerns are a case badge,
    // never a resident warning, phone-reputation verdict, or auto-dismissal.
    if (call.purpose !== 'guard') return null
    let warning: ResidentAlert | null = null
    if (pressure.shouldWarn) {
      const previous = this.rows<{ payload: string }>('SELECT payload FROM resident_alerts WHERE call_id = ?', call.id).map(row => decode<ResidentAlert>(row.payload)).filter(alert => alert.analysisSource !== 'caller-id-history')
      const rank = { low: 0, medium: 1, high: 2 }
      if (!previous.some(item => rank[item.level] >= rank[pressure.level])) {
        warning = { id: `AL-${call.id}-${pressure.level}`, callId: call.id, headline: pressure.headline, level: pressure.level, signals: pressure.signals, nextStep: pressure.nextStep, evidenceQuality: pressure.evidenceQuality, confidence: pressure.confidence, createdAt: new Date().toISOString(), synthetic: call.synthetic, deliveryStatus: 'available', analysisSource }
        this.sql.exec('INSERT OR IGNORE INTO resident_alerts (id, call_id, created_at, synthetic, payload) VALUES (?, ?, ?, ?, ?)', warning.id, call.id, warning.createdAt, Number(call.synthetic), JSON.stringify(warning))
        this.audit('call.warning', { callId: call.id, warningId: warning.id, level: warning.level })
      }
    }
    return warning
  }

  private voiceEvent(command: StoreCommand): Record<string, unknown> {
    const id = String(command.callId)
    const event = String(command.event)
    let call = this.getCall(id)
    if (event === 'call.started') {
      if (!call) {
        call = { id, provider: command.transport === 'webrtc' ? 'LiveKit WebRTC audio test' : 'Photon SIP → LiveKit', transport: command.transport === 'webrtc' ? 'webrtc' : 'sip', purpose: command.purpose === 'guard' ? 'guard' : 'intake', status: 'ringing', consent: 'pending', audioConsent: false, transcript: '', turns: [], caseId: null, scamReviewId: null, startedAt: new Date().toISOString(), endedAt: null, transcriptionSource: 'LiveKit Inference STT', synthetic: false, ...(typeof command.callerRef === 'string' ? { callerRef: command.callerRef } : {}) }
        call.analysisMode = command.analysisMode === 'semantic' ? 'semantic' : 'wording'
        if (command.callerContact && typeof command.callerContact === 'object') call.callerContact = command.callerContact as CallSession['callerContact']
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
      call.audioConsent = false
      call.status = 'declined'
      call.endedAt = new Date().toISOString()
      call.transcript = '[Transcript removed after consent was withdrawn]'
      call.turns = []
      call.transcriptExpiredAt = new Date().toISOString()
      delete call.callerRef
      delete call.callerContact
      delete call.reviewIdentity
      delete call.reviewStatus
      this.sql.exec('DELETE FROM transcript_turns WHERE call_id = ?', id)
      this.sql.exec('DELETE FROM scam_reviews WHERE source_id = ?', id)
      this.sql.exec('DELETE FROM resident_alerts WHERE call_id = ?', id)
      this.sql.exec('DELETE FROM warning_access WHERE call_id = ?', id)
      this.sql.exec('DELETE FROM push_subscriptions WHERE scope = ?', id)
      this.callers.revokeCall(id)
      this.audio.revoke(id)
      if (call.caseId) {
        const item = this.getCase(call.caseId)
        if (item) {
          if (item.integrityReview?.evidenceCallId === call.id) {
            item.integrityReview = { ...item.integrityReview, signals: [], reason: 'Earlier content evidence was removed after consent withdrawal. Any existing human-verification requirement remains in force.', version: item.integrityReview.version + 1, updatedAt: new Date().toISOString() }
            delete item.integrityReview.evidenceCallId
            delete item.integrityReview.evidenceSequence
            item.scamSignals = []
            item.scamLevel = null
          }
          if (item.callId === call.id) {
            item.transcript = call.transcript
            item.turns = []
            item.scamSignals = []
            item.scamLevel = null
            if (item.integrityReview) {
              item.integrityReview = { ...item.integrityReview, status: 'review-required', analysisStatus: 'unavailable', basis: 'analysis-unavailable', reason: 'Transcript consent was withdrawn. Verify retained basic request facts through an appropriate human process.', signals: [], version: item.integrityReview.version + 1, updatedAt: new Date().toISOString() }
            }
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
      call.audioConsent = consent === 'yes' && command.audioConsent === true
      call.status = consent === 'yes' ? 'in-progress' : 'declined'
      let warning: ResidentAlert | null = null
      if (consent === 'yes' && call.callerContact) {
        this.callers.registerCall({ callId: call.id, purpose: call.purpose === 'guard' ? 'risk' : 'help', contact: call.callerContact, startedAt: Date.parse(call.startedAt), consent: true, transport: call.transport || 'sip', synthetic: call.synthetic })
        if (call.purpose === 'guard') {
          const prior = this.callers.priorRisk(call.callerContact.lookup, { excludeCallId: id })
          if (prior.shouldCaution) {
            warning = { id: `AL-${id}-history`, callId: id, headline: 'Caller ID has prior risk reports', level: 'medium', signals: [], nextStep: 'Calls using this caller ID were previously flagged. Caller ID can be spoofed; verify independently. Current speech review is still required.', createdAt: new Date().toISOString(), synthetic: false, deliveryStatus: 'available', analysisSource: 'caller-id-history', evidenceQuality: `${prior.priorWarnedCalls} distinct prior flagged calls; not current speech`, confidence: 'Historical caller-ID observations; identity unverified' }
            this.sql.exec('INSERT OR IGNORE INTO resident_alerts (id, call_id, created_at, synthetic, payload) VALUES (?, ?, ?, ?, ?)', warning.id, id, warning.createdAt, 0, JSON.stringify(warning))
            this.audit('call.prior-risk-caution', { callId: id, priorWarnedCalls: prior.priorWarnedCalls, identityVerified: false })
          }
        }
      }
      if (consent === 'no') {
        call.endedAt = new Date().toISOString()
        delete call.callerRef
        delete call.callerContact
      }
      this.putCall(call)
      return { accepted: true, consent, warning }
    }
    if (event === 'pressure.review' || event === 'pressure.unavailable') {
      if (call.analysisMode !== 'semantic' || call.consent !== 'yes' || call.endedAt) throw new Error('Context review requires an open consented semantic call')
      let latest = call.turns.length - 1
      while (latest >= 0 && call.turns[latest].role !== 'caller') latest -= 1
      if (!Number.isSafeInteger(command.sequence) || latest < 0 || command.sequence !== latest) throw new Error('Context review sequence is stale or invalid')
      if (event === 'pressure.unavailable') {
        if (call.reviewStatus !== 'completed' || call.reviewSequence !== latest) {
          call.reviewStatus = 'unavailable'
          this.applyIntegrityAssessment(call, { analysisStatus: 'unavailable', concerning: false })
        }
        this.putCall(call)
        return { accepted: true, callId: id, reviewStatus: call.reviewStatus, warning: null }
      }
      const callerText = call.turns.filter(turn => turn.role === 'caller').map(turn => turn.text).join(' ')
      const { analysis, identity, uncertain } = semanticAnalysis(command.review, callerText, call.purpose === 'guard' ? 'guard' : 'responder')
      if (call.reviewSequence === latest && call.reviewIdentity) {
        if (identity !== call.reviewIdentity) throw new Error('Context review sequence conflicts with its earlier result')
        return { accepted: true, callId: id, duplicate: true, reviewStatus: call.reviewStatus, warning: null }
      }
      const warning = analysis.shouldWarn ? this.recordPressure(call, analysis, callerText, 'context-model') : null
      call.reviewSequence = latest
      call.reviewIdentity = identity
      call.reviewStatus = 'completed'
      this.applyIntegrityAssessment(call, { analysisStatus: 'completed', concerning: analysis.shouldWarn, uncertain, signals: analysis.signals, level: analysis.level })
      this.putCall(call)
      return { accepted: true, callId: id, reviewStatus: call.reviewStatus, warning }
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
      if (role === 'caller' && call.analysisMode === 'semantic') call.reviewStatus = 'pending'
      const analysis = role === 'caller' ? this.refreshCall(call) : { caseRecord: null, warning: null }
      this.putCall(call)
      return { accepted: true, callId: id, status: call.status, purpose: call.purpose, caseId: call.caseId, caseCreated: Boolean(analysis.caseRecord), warning: analysis.warning }
    }
    if (event === 'call.ended') {
      if (call.endedAt) return { accepted: true, callId: id, caseId: call.caseId, duplicate: true, warning: null }
      call.status = call.consent === 'no' ? 'declined' : command.deliveryFailed === true ? 'failed' : 'completed'
      call.deliveryFailed = command.deliveryFailed === true
      call.endedAt = new Date().toISOString()
      if (call.analysisMode === 'semantic' && call.reviewStatus === 'pending') call.reviewStatus = 'unavailable'
      const analysis = call.consent === 'yes' ? this.refreshCall(call) : { caseRecord: null, warning: null }
      if (call.purpose !== 'guard' && call.consent === 'yes' && (call.reviewStatus === 'unavailable' || call.analysisMode !== 'semantic')) this.applyIntegrityAssessment(call, { analysisStatus: 'unavailable', concerning: false })
      const finalCase = call.caseId ? this.getCase(call.caseId) : null
      if (finalCase?.integrityReview?.status === 'clear') this.audio.revoke(call.id)
      this.putCall(call)
      return { accepted: true, callId: id, status: call.status, caseId: call.caseId, warning: analysis.warning }
    }
    throw new Error('Unsupported voice event')
  }

  private async scheduleExpiry(): Promise<void> {
    const row = this.rows<{ next: string | null }>("SELECT MIN(started_at) AS next FROM calls WHERE synthetic = 0 AND json_extract(payload, '$.transcriptExpiredAt') IS NULL")[0]
    const review = this.rows<{ next: string | null }>("SELECT MIN(created_at) AS next FROM scam_reviews WHERE synthetic = 0 AND source_id IS NULL AND json_extract(payload, '$.text') NOT LIKE '[Text expired%'")[0]
    const times = [row?.next, review?.next].filter(Boolean).map(value => Date.parse(value!) + this.retentionMs)
    const callerExpiry = this.callers.nextExpiry()
    if (callerExpiry) times.push(callerExpiry)
    const audioExpiry = this.audio.nextExpiry()
    if (audioExpiry) times.push(audioExpiry)
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
        case 'account.create': {
          const email = String(command.email)
          if (this.rows('SELECT email FROM responder_accounts WHERE email = ?', email).length) return json({error:'An account with this email already exists.'},409)
          this.sql.exec('INSERT INTO responder_accounts VALUES (?, ?, ?, ?)',email,String(command.salt),String(command.hash),new Date().toISOString())
          return json({created:true})
        }
        case 'account.get': {
          const account = this.rows('SELECT salt, hash FROM responder_accounts WHERE email = ?',String(command.email))[0] || null
          return json({account})
        }
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
          return json({ currentCallId: call?.id || null, status: call?.status || 'completed', analysisMode: call?.analysisMode, reviewStatus: call?.transcriptExpiredAt ? undefined : call?.reviewStatus, alerts, expiresAt: new Date(access.expires_at).toISOString() })
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
          const cases = this.rows<{ payload: string }>('SELECT payload FROM cases ORDER BY priority_rank, created_at').map((row) => this.decorateCase(decode<PharosCase>(row.payload))).map(item => ({ ...item, eligibleResponders: eligibleRespondersFor(item, responders) }))
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
        case 'call.progress': {
          const call = this.getCall(String(command.id))
          return call ? json(this.callProgress(call)) : json({ error: 'Call was not found' }, 404)
        }
        case 'audio.chunk':
        case 'audio.complete': {
          return this.ctx.storage.transactionSync(() => {
            const call = this.getCall(String(command.callId))
            if (!call) return json({ error: 'Call was not found' }, 404)
            if (call.purpose === 'guard') return json({ error: 'Caller evidence recording is for intake requests only' }, 403)
            if (call.consent !== 'yes' || call.audioConsent !== true) return json({ error: 'Caller audio requires explicit recording consent' }, 403)
            if (call.transcriptExpiredAt || Date.parse(call.startedAt) + this.retentionMs <= Date.now()) return json({ error: 'Call retention has expired' }, 410)
            const item = call.caseId ? this.getCase(call.caseId) : null
            if (call.endedAt && item?.integrityReview?.status === 'clear') {
              this.audio.revoke(call.id)
              return json({ accepted: true, discarded: true, durationSeconds: 0 })
            }
            const result = command.action === 'audio.chunk'
              ? this.audio.put({ callId: call.id, startedAt: Date.parse(call.startedAt), consent: true, audioConsent: true, chunk: command.chunk as SealedAudioChunk })
              : this.audio.complete(call.id, command.lastSequence as number)
            return json(result)
          })
        }
        case 'audio.read': {
          const item = this.getCase(String(command.caseId))
          if (!item || command.syntheticOnly && !item.synthetic) return json({ error: 'Case was not found' }, 404)
          const call = this.retainedAudioSource(item)
          if (!call) return json({ audio: null })
          return json({ audio: this.audio.read(call.id) })
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
          if (!integrityAllowsDispatch(caseRecord)) return json({ error: 'Human acceptance of the current request review is required before assignment' }, 409)
          if (caseRecord.assignedTo === responderId) return json({ caseRecord, responder, alreadyClaimed: true })
          if (caseRecord.assignedTo) return json({ error: 'Another responder has already claimed this case' }, 409)
          if (!responder.approved || !responder.available || responder.assignedCount - (caseRecord.followUpOwner === responderId ? 1 : 0) >= responder.capacity) return json({ error: 'Responder is not currently eligible' }, 409)
          if (caseRecord.synthetic !== responder.synthetic) return json({ error: 'Synthetic and live case records must stay in their matching workspaces' }, 403)
          const needMatch = !caseRecord.needs.length || caseRecord.needs.some((need) => responder.capabilities.includes(need) || responder.capabilities.includes('general'))
          if (!caseRecord.zoneId || !responder.serviceAreas.includes(caseRecord.zoneId) || !needMatch) return json({ error: 'This responder is not eligible for the case area or need' }, 403)
          if (caseRecord.assignedTo && caseRecord.assignedTo !== responderId) return json({ error: 'Another responder has already claimed this case' }, 409)
          if (caseRecord.assignedTo === responderId) return json({ caseRecord, responder, alreadyClaimed: true })
          caseRecord.assignedTo = responder.id
          delete caseRecord.responseProgress
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
          if (status === 'claimed' && !integrityAllowsDispatch(caseRecord)) return json({ error: 'Human acceptance of the current request review is required before assignment' }, 409)
          if (status === 'resolved' && ['pending', 'review-required'].includes(caseRecord.integrityReview!.status)) return json({ error: 'Accept or dismiss this request with a recorded reason before closing it' }, 409)
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
          if (status === 'new' || status === 'resolved') delete caseRecord.responseProgress
          caseRecord.followUp = status === 'follow-up' || caseRecord.followUp
          caseRecord.updatedAt = new Date().toISOString()
          this.putCase(caseRecord)
          this.audit(`case.${status}`, { caseId: id })
          return json({ caseRecord })
        }
        case 'case.progress': {
          const item = this.getCase(String(command.id))
          if (!item || command.syntheticOnly && !item.synthetic) return json({ error: 'Case was not found' }, 404)
          if (!integrityAllowsDispatch(item)) return json({ error: 'Human acceptance of the current request review is required before reporting an arrival time' }, 409)
          if (typeof command.expectedUpdatedAt !== 'string' || command.expectedUpdatedAt !== item.updatedAt) return json({ error: 'This case changed. Refresh and review the latest report before updating response status.' }, 409)
          if (!item.assignedTo || item.status === 'resolved' || item.assignmentNeedsReview || !this.validAssignedResponder(item)) return json({ error: 'A currently eligible assigned responder and reviewed coverage are required.' }, 409)
          const state = String(command.state)
          if (!['en-route', 'arrived', 'delayed', 'unable'].includes(state)) return json({ error: 'Choose an explicit response status.' }, 400)
          const needsEta = state === 'en-route' || state === 'delayed'
          if (needsEta ? typeof command.etaMinutes !== 'number' || !Number.isInteger(command.etaMinutes) || command.etaMinutes < 1 || command.etaMinutes > 180 : command.etaMinutes !== undefined && command.etaMinutes !== null) return json({ error: 'On the way or delayed requires an integer ETA of 1–180 minutes; other statuses have no ETA.' }, 400)
          const at = new Date().toISOString()
          item.responseProgress = { state: state as 'en-route' | 'arrived' | 'delayed' | 'unable', responderId: item.assignedTo, etaAt: needsEta ? new Date(Date.now() + Number(command.etaMinutes) * 60_000).toISOString() : null, updatedAt: at }
          if (state === 'unable') { item.followUp = true; item.status = 'follow-up' }
          item.updatedAt = at
          item.history = [...(item.history || []), { id: crypto.randomUUID(), callId: item.callId || '', at, kind: 'responder-review' as const, summary: `Response progress reported: ${state}.`, priority: item.priority, reason: needsEta ? `The response desk supplied an estimated arrival of ${command.etaMinutes} minutes; this is not a guarantee.` : `The response desk explicitly reported ${state}.` }].slice(-100)
          this.putCase(item)
          this.audit('case.response-reported', { caseId: item.id, responderId: item.assignedTo, state, etaAt: item.responseProgress.etaAt })
          return json({ caseRecord: item })
        }
        case 'case.integrity-review': {
          return this.ctx.storage.transactionSync(() => {
            const item = this.getCase(String(command.id))
            if (!item || command.syntheticOnly && !item.synthetic) return json({ error: 'Case was not found' }, 404)
            const current = item.integrityReview!
            if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion !== current.version
              || command.expectedSourceCallId !== current.sourceCallId || command.expectedSequence !== current.sourceSequence) return json({ error: 'This request changed. Refresh the transcript and review the latest source before deciding.' }, 409)
            const decision = String(command.decision)
            const reason = typeof command.reason === 'string' ? command.reason.trim() : ''
            if (!['accept', 'dismiss'].includes(decision) || reason.length < 8 || reason.length > 1000) return json({ error: 'Choose accept or dismiss and record a reason of 8–1000 characters' }, 400)
            if (!['responder', 'coordinator', 'demo'].includes(String(command.role))) return json({ error: 'A responder review session is required' }, 403)
            const at = new Date().toISOString()
            item.integrityReview = { ...current, status: decision === 'accept' ? 'accepted' : 'dismissed', version: current.version + 1, basis: 'human-decision', reason: `Human ${decision === 'accept' ? 'acceptance' : 'dismissal'}: ${reason}`, updatedAt: at,
              decision: { action: decision as 'accept' | 'dismiss', reason, at, role: String(command.role), sourceCallId: current.sourceCallId, sourceSequence: current.sourceSequence } }
            if (decision === 'dismiss') this.invalidateTravel(item, at)
            item.updatedAt = at
            item.history = [...(item.history || []), { id: crypto.randomUUID(), callId: current.sourceCallId, at, kind: 'responder-review' as const, summary: `Request review ${decision === 'accept' ? 'accepted' : 'dismissed'} by the response desk.`, priority: item.priority, reason }].slice(-100)
            this.putCase(item)
            this.audit('case.integrity-decided', { caseId: item.id, sourceCallId: current.sourceCallId, sourceSequence: current.sourceSequence, version: item.integrityReview.version, decision, reason, role: command.role })
            return json({ caseRecord: this.decorateCase(item) })
          })
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
            this.callers.revokeCall(row.id)
            this.audio.revoke(row.id)
            call.transcript = '[Transcript expired under the configured retention policy]'
            call.turns = []
            call.transcriptExpiredAt = new Date().toISOString()
            call.audioConsent = false
            delete call.callerRef
            delete call.callerContact
            delete call.reviewIdentity
            delete call.reviewStatus
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
            const integritySource = caseRecord.integrityReview?.evidenceCallId ? this.getCall(caseRecord.integrityReview.evidenceCallId) : null
            const evidenceExpired = Boolean(integritySource && (integritySource.transcriptExpiredAt || integritySource.consent !== 'yes' || Date.parse(integritySource.startedAt) < cutoff))
            const currentSourceExpired = source ? Date.parse(source.startedAt) < cutoff : Date.parse(caseRecord.createdAt) < cutoff
            const currentTextRemoved = currentSourceExpired && caseRecord.transcript !== '[Transcript expired under the configured retention policy]'
            if (evidenceExpired) {
              caseRecord.integrityReview!.signals = []
              delete caseRecord.integrityReview!.evidenceCallId
              delete caseRecord.integrityReview!.evidenceSequence
              caseRecord.scamSignals = []
              caseRecord.scamLevel = null
            }
            if (currentSourceExpired) {
              caseRecord.transcript = '[Transcript expired under the configured retention policy]'
              caseRecord.turns = []
              caseRecord.scamSignals = caseRecord.scamSignals.map((signal) => ({ ...signal, evidence: '[expired]' }))
              if (caseRecord.integrityReview) caseRecord.integrityReview.signals = []
            }
            if (caseRecord.integrityReview && (evidenceExpired || currentTextRemoved)) {
              const review = caseRecord.integrityReview
              const at = new Date(Math.max(Date.now(), Date.parse(review.updatedAt) || 0, Date.parse(caseRecord.updatedAt) || 0) + 1).toISOString()
              caseRecord.integrityReview = { ...review, version: review.version + 1, updatedAt: at, analysisStatus: 'unavailable',
                status: review.status === 'accepted' || review.status === 'dismissed' ? review.status : 'review-required',
                basis: review.status === 'accepted' || review.status === 'dismissed' ? 'human-decision' : 'analysis-unavailable',
                reason: review.status === 'accepted' ? 'Earlier recorded evidence expired. The recorded human acceptance remains attached to its reviewed source.' : review.status === 'dismissed' ? 'Earlier recorded evidence expired. The recorded human dismissal remains attached to its reviewed source.' : 'Earlier recorded evidence expired. Human verification remains required; this does not establish wrongdoing.' }
              caseRecord.updatedAt = at
              if (caseRecord.integrityReview.status === 'review-required') this.invalidateTravel(caseRecord, at)
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
          this.callers.prune()
          this.audio.prune()
          await this.scheduleExpiry()
          return json({ prunedCalls: rows.length, cutoff: cutoffIso })
        }
        default:
          return json({ error: `Unknown store action: ${command.action}` }, 404)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Store request failed'
      const status = /requires caller consent|requires an intake call/.test(message) ? 403 : /expired/.test(message) ? 410 : /before sending|sequence|already|closed|open consented/.test(message) ? 409 : 400
      return json({ error: message }, status)
    }
  }

  private putCase(caseRecord: PharosCase): void {
    caseRecord.integrityReview ||= this.initialIntegrity(caseRecord, caseRecord.callId ? this.getCall(caseRecord.callId) : null)
    const previous = this.getCase(caseRecord.id)
    if (previous && Date.parse(caseRecord.updatedAt) <= Date.parse(previous.updatedAt)) caseRecord.updatedAt = new Date(Date.parse(previous.updatedAt) + 1).toISOString()
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
