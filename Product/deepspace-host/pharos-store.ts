import { DurableObject } from 'cloudflare:workers'
import { makeSeedData, type CallSession, type Incident, type PharosCase, type Responder, type ScamReview, type Zone } from './pharos-domain'

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

export class PharosStore extends DurableObject {
  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    this.sql = ctx.storage.sql
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
          const cases = this.rows<{ payload: string }>('SELECT payload FROM cases ORDER BY priority_rank, created_at').map((row) => decode<PharosCase>(row.payload))
          const calls = this.rows<{ payload: string }>('SELECT payload FROM calls ORDER BY started_at DESC LIMIT 100').map((row) => decode<CallSession>(row.payload))
          const scamReviews = this.rows<{ payload: string }>('SELECT payload FROM scam_reviews ORDER BY created_at DESC LIMIT 100').map((row) => decode<ScamReview>(row.payload))
          return json({ incidents, zones, responders, cases, calls, scamReviews })
        }
        case 'call.put': {
          const call = command.call as CallSession
          this.sql.exec('INSERT INTO calls (id, status, started_at, synthetic, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload', call.id, call.status, call.startedAt, Number(call.synthetic), JSON.stringify(call))
          return json({ call })
        }
        case 'call.get': {
          const row = this.rows<{ payload: string }>('SELECT payload FROM calls WHERE id = ?', String(command.id))[0]
          return row ? json({ call: decode<CallSession>(row.payload) }) : json({ error: 'Call session was not found' }, 404)
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
          if (!responder.approved || !responder.available || responder.assignedCount >= responder.capacity) return json({ error: 'Responder is not currently eligible' }, 409)
          if (caseRecord.synthetic !== responder.synthetic) return json({ error: 'Synthetic and live case records must stay in their matching workspaces' }, 403)
          const needMatch = !caseRecord.needs.length || caseRecord.needs.some((need) => responder.capabilities.includes(need) || responder.capabilities.includes('general'))
          if (!caseRecord.zoneId || !responder.serviceAreas.includes(caseRecord.zoneId) || !needMatch) return json({ error: 'This responder is not eligible for the case area or need' }, 403)
          if (caseRecord.assignedTo && caseRecord.assignedTo !== responderId) return json({ error: 'Another responder has already claimed this case' }, 409)
          if (caseRecord.assignedTo === responderId) return json({ caseRecord, responder, alreadyClaimed: true })
          caseRecord.assignedTo = responder.id
          caseRecord.status = 'claimed'
          caseRecord.updatedAt = new Date().toISOString()
          responder.assignedCount += 1
          this.putCase(caseRecord)
          this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(responder), responder.id)
          this.audit('case.claimed', { caseId: id, responderId })
          return json({ caseRecord, responder })
        }
        case 'case.status': {
          const id = String(command.id)
          const status = String(command.status)
          if (!['new', 'claimed', 'follow-up', 'resolved'].includes(status)) return json({ error: 'Unsupported case status' }, 400)
          const caseRecord = this.getCase(id)
          if (!caseRecord) return json({ error: 'Case was not found' }, 404)
          if (status === 'resolved' && caseRecord.assignedTo) {
            const assignedResponder = this.getResponder(caseRecord.assignedTo)
            if (assignedResponder) {
              assignedResponder.assignedCount = Math.max(0, assignedResponder.assignedCount - 1)
              this.sql.exec('UPDATE responders SET payload = ? WHERE id = ?', JSON.stringify(assignedResponder), assignedResponder.id)
            }
            caseRecord.assignedTo = null
          }
          caseRecord.status = status as PharosCase['status']
          caseRecord.followUp = status === 'follow-up' || caseRecord.followUp
          caseRecord.updatedAt = new Date().toISOString()
          this.putCase(caseRecord)
          this.audit(`case.${status}`, { caseId: id })
          return json({ caseRecord })
        }
        case 'scam.put': {
          const scam = command.scamReview as ScamReview
          this.putScam(scam)
          return json({ scamReview: scam })
        }
        case 'responder.put': {
          const responder = command.responder as Responder
          this.sql.exec('INSERT INTO responders (id, synthetic, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET synthetic = excluded.synthetic, payload = excluded.payload', responder.id, Number(responder.synthetic), JSON.stringify(responder))
          this.audit('responder.updated', { responderId: responder.id })
          return json({ responder })
        }
        case 'demo.reset': {
          const syntheticCalls = this.rows<{ id: string }>('SELECT id FROM calls WHERE synthetic = 1').map((row) => row.id)
          for (const callId of syntheticCalls) this.sql.exec('DELETE FROM transcript_turns WHERE call_id = ?', callId)
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
          const caseRows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM cases WHERE synthetic = 0 AND created_at < ?', cutoffIso)
          for (const row of caseRows) {
            const caseRecord = decode<PharosCase>(row.payload)
            caseRecord.transcript = '[Transcript expired under the configured retention policy]'
            caseRecord.turns = []
            caseRecord.scamSignals = caseRecord.scamSignals.map((signal) => ({ ...signal, evidence: '[expired]' }))
            this.sql.exec('UPDATE cases SET payload = ? WHERE id = ?', JSON.stringify(caseRecord), row.id)
          }
          const standaloneScamRows = this.rows<{ id: string; payload: string }>('SELECT id, payload FROM scam_reviews WHERE synthetic = 0 AND source_id IS NULL AND created_at < ?', cutoffIso)
          for (const row of standaloneScamRows) {
            const review = decode<ScamReview>(row.payload)
            review.text = '[Text expired under the configured retention policy]'
            review.signals = review.signals.map((signal) => ({ ...signal, evidence: '[expired]' }))
            this.sql.exec('UPDATE scam_reviews SET payload = ? WHERE id = ?', JSON.stringify(review), row.id)
          }
          return json({ prunedCalls: rows.length, cutoff: cutoffIso })
        }
        default:
          return json({ error: `Unknown store action: ${command.action}` }, 404)
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Store request failed' }, 500)
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
