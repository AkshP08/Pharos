export type Priority = 'immediate' | 'time-sensitive' | 'urgent' | 'follow-up'
export type RiskLevel = 'high' | 'medium' | 'low'

export interface Zone {
  id: string
  name: string
  aliases: string[]
  bounds: { south: number; west: number; north: number; east: number }
  incidentId: string
  synthetic: boolean
}

export interface Responder {
  id: string
  name: string
  organization: string
  serviceAreas: string[]
  capabilities: string[]
  available: boolean
  capacity: number
  assignedCount: number
  approved: boolean
  synthetic: boolean
}

export interface TranscriptTurn {
  role: 'caller' | 'agent'
  text: string
  at: string
}

export interface ScamSignal {
  kind: string
  label: string
  evidence: string
}

export interface PharosCase {
  id: string
  incidentId: string
  title: string
  source: 'phone' | 'web' | 'sms'
  sourceLabel: string
  callId: string | null
  transcript: string
  turns: TranscriptTurn[]
  locationText: string
  zoneId: string | null
  zoneName: string
  locationStatus: 'matched' | 'unknown'
  latitude: number | null
  longitude: number | null
  immediateDanger: 'yes' | 'no' | 'unknown'
  peopleCount: number | null
  needs: string[]
  priority: Priority
  priorityRank: number
  priorityReason: string
  followUp: boolean
  scamLevel: RiskLevel | null
  scamSignals: ScamSignal[]
  status: 'new' | 'claimed' | 'follow-up' | 'resolved'
  eligibleResponders: string[]
  assignedTo: string | null
  createdAt: string
  updatedAt: string
  synthetic: boolean
}

export interface CallSession {
  id: string
  provider: string
  status: 'ringing' | 'in-progress' | 'completed' | 'declined' | 'failed'
  consent: 'pending' | 'yes' | 'no'
  transcript: string
  turns: TranscriptTurn[]
  caseId: string | null
  scamReviewId: string | null
  startedAt: string
  endedAt: string | null
  transcriptionSource: string
  synthetic: boolean
}

export interface ScamReview {
  id: string
  source: 'call' | 'message'
  sourceId: string | null
  text: string
  level: RiskLevel
  headline: string
  signals: ScamSignal[]
  nextStep: string
  createdAt: string
  synthetic: boolean
}

export interface Incident {
  id: string
  name: string
  status: 'active' | 'closed'
  description: string
  createdAt: string
  synthetic: boolean
}

const rankFor: Record<Priority, number> = {
  immediate: 0,
  'time-sensitive': 1,
  urgent: 2,
  'follow-up': 3,
}

const nowIso = () => new Date().toISOString()

function normalized(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9., -]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function parseTranscriptTurns(input: string, at = nowIso()): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  for (const raw of input.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = line.match(/^(?:\[(caller|resident|agent|pharos|assistant)\]\s*[:>-]?\s*|(caller|resident|agent|pharos|assistant)\s*[:>-]\s*)(.+)$/i)
    if (match) {
      turns.push({ role: /^(agent|pharos|assistant)$/i.test(match[1] || match[2]) ? 'agent' : 'caller', text: match[3].trim(), at })
    } else {
      turns.push({ role: 'caller', text: line, at })
    }
  }
  return turns
}

export function transcriptText(turns: TranscriptTurn[]): string {
  return turns.map((turn) => `${turn.role === 'agent' ? 'Pharos' : 'Caller'}: ${turn.text}`).join('\n')
}

function findZone(location: string, zones: Zone[]): { zone: Zone | null; latitude: number | null; longitude: number | null } {
  const text = normalized(location)
  const coordinateMatch = text.match(/\b(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\b/)
  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1])
    const longitude = Number(coordinateMatch[2])
    const zone = zones.find((candidate) => latitude >= candidate.bounds.south && latitude <= candidate.bounds.north && longitude >= candidate.bounds.west && longitude <= candidate.bounds.east) ?? null
    return { zone, latitude, longitude }
  }

  for (const zone of zones) {
    for (const alias of zone.aliases) {
      const needle = normalized(alias)
      if (!needle) continue
      const safe = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
      if (new RegExp(`(^|\\b)${safe}(\\b|$)`, 'i').test(text)) return { zone, latitude: null, longitude: null }
    }
  }
  return { zone: null, latitude: null, longitude: null }
}

function captureLocation(turns: TranscriptTurn[]): string {
  const callerText = turns.filter((turn) => turn.role === 'caller').map((turn) => turn.text).join(' ')
  const spokenAddress = callerText.match(/\b(?:near|at|by|beside|outside|on)\s+(?:the\s+)?([^.!?;]{3,70})/i)?.[1]
  const postalCode = callerText.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]
  const address = callerText.match(/\b\d{1,6}\s+[\w .'-]{2,45}\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|highway|hwy\.?)\b/i)?.[0]
  return (address || postalCode || spokenAddress || '').trim().replace(/[,.]+$/, '')
}

function answerAfterPrompt(turns: TranscriptTurn[], prompt: RegExp): string | null {
  for (let i = 0; i < turns.length; i += 1) {
    if (turns[i].role === 'agent' && prompt.test(turns[i].text)) {
      const answer = turns.slice(i + 1).find((turn) => turn.role === 'caller')
      if (answer) return answer.text
    }
  }
  return null
}

export function analyzeScamText(input: string): { level: RiskLevel; headline: string; signals: ScamSignal[]; nextStep: string } {
  const text = input.replace(/\s+/g, ' ').trim()
  const patterns: Array<{ kind: string; label: string; pattern: RegExp }> = [
    { kind: 'authority', label: 'Authority claim to verify', pattern: /\b(?:county|rescue office|fema|official|government|sheriff|police|utility|relief office|disaster agency)\b/i },
    { kind: 'deadline', label: 'Deadline or pressure to act', pattern: /\b(?:within \d+|expires? in|act now|right now|immediately|urgent|before (?:it is|it's) too late|\d+\s*(?:minutes?|hours?))\b/i },
    { kind: 'money_or_secret', label: 'Payment or sensitive information request', pattern: /\b(?:gift cards?|wire transfer|crypto(?:currency)?|payment app|pay (?:a |the )?(?:fee|charge)|fee to (?:reserve|access|get)|password|verification code|one[- ]time code|security code|social security|bank account)\b/i },
    { kind: 'isolation', label: 'Discourages independent verification', pattern: /\b(?:do not call|don't call|do not tell|don't tell|keep (?:this|it) secret|only contact me|do not contact|don't contact)\b/i },
    { kind: 'link', label: 'Link or download request', pattern: /(?:https?:\/\/|\bclick (?:the )?link|\bdownload (?:the )?app|\bopen this link)/i },
    { kind: 'threat', label: 'Threat or consequence used as pressure', pattern: /\b(?:you will lose|will be cancelled|will be arrested|your request will be denied|no rescue|lose your place|seat will be cancelled)\b/i },
  ]
  const signals = patterns.flatMap(({ kind, label, pattern }) => {
    const match = text.match(pattern)
    return match ? [{ kind, label, evidence: match[0] }] : []
  })
  const hasRiskyAsk = signals.some((signal) => signal.kind === 'money_or_secret')
  const hasPressure = signals.some((signal) => ['deadline', 'isolation', 'threat', 'authority'].includes(signal.kind))
  const pressureWithoutAuthority = signals.filter((signal) => signal.kind !== 'authority').length
  const level: RiskLevel = hasRiskyAsk && hasPressure ? 'high' : hasRiskyAsk || pressureWithoutAuthority >= 2 ? 'medium' : 'low'
  const headline = level === 'high' ? 'Several strong pressure signals found' : level === 'medium' ? 'Some wording deserves verification' : 'Few pressure signals found'
  const nextStep = hasRiskyAsk
    ? 'Do not send money or share codes. End the contact and verify through an official number you find independently.'
    : 'The wording cannot verify the sender. Check through an official contact you find independently.'
  return { level, headline, signals, nextStep }
}

function inferNeedTypes(text: string): string[] {
  const value = normalized(text)
  const needs: string[] = []
  const patterns: Array<[string, RegExp]> = [
    ['evacuation', /\b(?:evacuat|leave safely|safe way out|trapped|rescue|get out|ride|transport)\w*\b/],
    ['medical', /\b(?:oxygen|medical device|powered equipment|medication|medicine|medical supplies|dialysis)\b/],
    ['shelter', /\b(?:shelter|place to stay|temporary housing)\b/],
    ['supplies', /\b(?:water|food|basic supplies|blanket|clean clothes)\b/],
    ['information', /\b(?:information|update|where can i|what should i do)\b/],
  ]
  for (const [need, pattern] of patterns) if (pattern.test(value)) needs.push(need)
  return needs
}

function parsePeopleCount(text: string): number | null {
  const match = text.match(/\b(?:there are|we are|it's|it is|for)\s+(\d{1,2})\s+(?:of us|people|persons|residents|adults|children)\b/i)
  if (match) return Number(match[1])
  return null
}

export function analyzeCall(input: {
  callId: string
  turns: TranscriptTurn[]
  zones: Zone[]
  responders: Responder[]
  incidentId: string
  synthetic: boolean
  createdAt?: string
}): { caseRecord: PharosCase | null; scamReview: ScamReview | null; callKind: 'help' | 'scam-check' | 'unclear' } {
  const { callId, turns, zones, responders, incidentId, synthetic } = input
  const createdAt = input.createdAt ?? nowIso()
  const callerTurns = turns.filter((turn) => turn.role === 'caller')
  const callerText = callerTurns.map((turn) => turn.text).join(' ').trim()
  const allText = transcriptText(turns)
  const scam = analyzeScamText(callerText)
  const hasScamIntent = /\b(?:is this (?:a )?scam|check (?:if|whether)|suspicious (?:call|text|message)|someone called me|they asked me for|they told me to (?:pay|send|share))\b/i.test(callerText)
  const explicitHelpRequest = /\b(?:need help|please help|help me|need (?:a )?(?:ride|transport|evacuation|shelter|water|food|supplies|rescue|oxygen|medicine|medication)|need to (?:leave|get out|evacuate)|requesting (?:help|a ride|shelter|supplies))\b/i.test(callerText)
  const explicitHazard = /\b(?:trapped|floodwater|water (?:is )?(?:rising|coming in|inside)|fire (?:is )?(?:inside|near)|injured|cannot breathe|can't breathe|unconscious|life.?threatening|in danger)\b/i.test(callerText)
  const hasHelpNeed = explicitHelpRequest || explicitHazard || (!hasScamIntent && inferNeedTypes(callerText).length > 0)
  const callKind = hasHelpNeed ? 'help' : hasScamIntent || scam.signals.length > 0 ? 'scam-check' : 'unclear'
  const scamReview = scam.signals.length ? {
    id: `SC-${callId}`,
    source: 'call' as const,
    sourceId: callId,
    text: callerText,
    level: scam.level,
    headline: scam.headline,
    signals: scam.signals,
    nextStep: scam.nextStep,
    createdAt,
    synthetic,
  } : null

  if (!hasHelpNeed && callKind === 'scam-check') return { caseRecord: null, scamReview, callKind }
  if (!callerText) return { caseRecord: null, scamReview, callKind }

  const locationPromptAnswer = answerAfterPrompt(turns, /where (?:are you|can|should)|location|nearby (?:address|landmark)/i)
  const locationText = (locationPromptAnswer || captureLocation(turns)).trim()
  const location = findZone(locationText || callerText, zones)
  const zone = location.zone
  const safetyAnswer = answerAfterPrompt(turns, /immediate danger|anyone in danger|safe right now/i)
  const dangerText = normalized(`${safetyAnswer || ''} ${callerText}`)
  const immediatePattern = /\b(?:trapped|cannot get out|can't get out|cannot leave|can't leave|water (?:is )?(?:rising|coming in|inside)|floodwater inside|fire (?:is )?(?:inside|in the house|near (?:my|our) home)|smoke inside|serious(?:ly)? injured|cannot breathe|can't breathe|unconscious|life.?threatening)\b/i
  const explicitYes = safetyAnswer ? /\b(?:yes|yeah|yep|correct)\b/i.test(safetyAnswer) : false
  const explicitNo = safetyAnswer ? /\b(?:no|not right now|currently safe)\b/i.test(safetyAnswer) : false
  const explicitUnknown = safetyAnswer ? /\b(?:not sure|unsure|don't know|do not know)\b/i.test(safetyAnswer) : false
  const immediateDanger: PharosCase['immediateDanger'] = immediatePattern.test(dangerText) || explicitYes ? 'yes' : explicitNo ? 'no' : explicitUnknown ? 'unknown' : 'unknown'
  const needs = inferNeedTypes(callerText)
  const peopleCount = parsePeopleCount(callerText)
  const requestText = callerText || 'Caller requested assistance.'
  const title = immediateDanger === 'yes' ? 'Immediate safety concern' : needs.includes('medical') ? 'Time-sensitive essential support' : needs.includes('evacuation') ? 'Evacuation or transport request' : needs.includes('shelter') ? 'Shelter request' : needs.length ? 'Disaster assistance request' : 'Call needs follow-up'
  let priority: Priority
  let priorityReason: string
  if (immediateDanger === 'yes') {
    priority = 'immediate'
    priorityReason = 'Caller-reported immediate danger or a direct life-safety phrase was detected. A human responder must confirm urgency and act under local procedures.'
  } else if (needs.includes('medical')) {
    priority = 'time-sensitive'
    priorityReason = 'Caller mentioned a time-sensitive medical, powered-device, or medication need. A responder should clarify the deadline and resources; this is not a medical assessment.'
  } else if (needs.includes('evacuation') || needs.includes('shelter') || needs.includes('supplies')) {
    priority = 'urgent'
    priorityReason = 'Caller requested evacuation, shelter, or essential supplies and did not state an immediate life-safety threat. Human responders confirm the work order.'
  } else {
    priority = 'follow-up'
    priorityReason = 'The transcript does not contain enough structured information to suggest a safe priority. Keep the call visible for responder follow-up.'
  }
  const locationStatus = zone ? 'matched' : 'unknown'
  const followUp = !zone || priority === 'follow-up' || immediateDanger === 'unknown'
  if (!zone) priorityReason += ' Location did not match a configured response area; the request stays in the unassigned location queue.'
  const eligibleResponders = zone ? responders
    .filter((responder) => responder.synthetic === synthetic)
    .filter((responder) => responder.approved && responder.available && responder.serviceAreas.includes(zone.id) && (responder.assignedCount < responder.capacity))
    .filter((responder) => !needs.length || needs.some((need) => responder.capabilities.includes(need) || responder.capabilities.includes('general')))
    .map((responder) => responder.id) : []
  const id = `PH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
  const caseRecord: PharosCase = {
    id,
    incidentId,
    title,
    source: 'phone',
    sourceLabel: synthetic ? 'Synthetic voice transcript' : 'Photon voice call',
    callId,
    transcript: allText,
    turns,
    locationText: locationText || 'Not confirmed',
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? 'Unassigned · location follow-up',
    locationStatus,
    latitude: location.latitude,
    longitude: location.longitude,
    immediateDanger,
    peopleCount,
    needs,
    priority,
    priorityRank: rankFor[priority],
    priorityReason,
    followUp,
    scamLevel: scam.signals.length ? scam.level : null,
    scamSignals: scam.signals,
    status: 'new',
    eligibleResponders,
    assignedTo: null,
    createdAt,
    updatedAt: nowIso(),
    synthetic,
  }
  return { caseRecord, scamReview, callKind }
}

export function orderedCases(cases: PharosCase[], zoneId = 'all'): PharosCase[] {
  return cases.filter((item) => zoneId === 'all' || item.zoneId === zoneId).sort((a, b) => a.priorityRank - b.priorityRank || a.createdAt.localeCompare(b.createdAt))
}

export function makeSeedData(): { incident: Incident; zones: Zone[]; responders: Responder[]; calls: CallSession[]; cases: PharosCase[]; scamReviews: ScamReview[] } {
  const createdAt = Date.now()
  const minutesAgo = (minutes: number) => new Date(createdAt - minutes * 60_000).toISOString()
  const incident: Incident = { id: 'incident-trinity', name: 'Trinity River flooding', status: 'active', description: 'Synthetic flood response scenario. Not a live incident.', createdAt: new Date(createdAt - 3_600_000).toISOString(), synthetic: true }
  const zones: Zone[] = [
    { id: 'zone-west', name: 'West Reach · Zone 1', aliases: ['west reach', 'westbank', 'zone 1', 'zone one', 'district 1', 'district one', '76010', '76011'], bounds: { south: 32.65, west: -97.5, north: 33.15, east: -97.2 }, incidentId: incident.id, synthetic: true },
    { id: 'zone-north', name: 'Northbank · Zone 2', aliases: ['northbank', 'north bank', 'zone 2', 'zone two', 'district 2', 'district two', '75080', '75081'], bounds: { south: 32.65, west: -97.2, north: 33.15, east: -96.9 }, incidentId: incident.id, synthetic: true },
    { id: 'zone-river', name: 'Riverbend · Zone 3', aliases: ['riverbend', 'river bend', 'riverbend footbridge', 'zone 3', 'zone three', 'district 3', 'district three', '76013', '76014'], bounds: { south: 32.4, west: -97.5, north: 32.65, east: -96.9 }, incidentId: incident.id, synthetic: true },
  ]
  const responders: Responder[] = [
    { id: 'resp-river', name: 'Maya Reed', organization: 'River Ops', serviceAreas: ['zone-river'], capabilities: ['evacuation', 'medical', 'shelter', 'supplies', 'information', 'general'], available: true, capacity: 5, assignedCount: 1, approved: true, synthetic: true },
    { id: 'resp-north', name: 'Jordan Lee', organization: 'Northbank Aid', serviceAreas: ['zone-north'], capabilities: ['evacuation', 'medical', 'shelter', 'supplies', 'information', 'general'], available: true, capacity: 4, assignedCount: 0, approved: true, synthetic: true },
    { id: 'resp-county', name: 'Sam Patel', organization: 'County Response Desk', serviceAreas: ['zone-west', 'zone-north', 'zone-river'], capabilities: ['evacuation', 'medical', 'shelter', 'supplies', 'information', 'general'], available: true, capacity: 8, assignedCount: 2, approved: true, synthetic: true },
  ]
  const transcripts = [
    '[Pharos] Are you in immediate danger right now?\n[Caller] Yes. Water is coming up the stairs and we cannot get out.\n[Pharos] Where are you or what nearby landmark should responders use?\n[Caller] Near the Riverbend footbridge, Zone 3.\n[Pharos] What help do you need most?\n[Caller] A safe way out. There are four of us, and one person needs powered oxygen.\n[Pharos] I heard rising water, the Riverbend footbridge, four people, and a powered medical need. Is that right?\n[Caller] Yes, that is right.',
    '[Pharos] Are you in immediate danger right now?\n[Caller] No, we are safe inside for now.\n[Pharos] Where are you or what nearby landmark should responders use?\n[Caller] Northbank, Zone 2.\n[Pharos] What help do you need most?\n[Caller] The power is out and my dad’s oxygen concentrator battery is low. We need a safe ride.',
    '[Pharos] Are you in immediate danger right now?\n[Caller] I am not sure.\n[Pharos] Where are you or what nearby landmark should responders use?\n[Caller] I need a ride to a shelter, next to a blue water tower. I do not know the area name.',
  ]
  const calls: CallSession[] = transcripts.map((transcript, index) => ({
    id: `demo-call-${index + 1}`,
    provider: 'Photon SIP · synthetic scenario',
    status: 'completed',
    consent: 'yes',
    transcript,
    turns: parseTranscriptTurns(transcript, minutesAgo([2, 7, 11][index])),
    caseId: ['PH-DEMO-024', 'PH-DEMO-019', 'PH-DEMO-021'][index],
    scamReviewId: index === 0 ? 'SC-DEMO-01' : null,
    startedAt: minutesAgo([2, 7, 11][index]),
    endedAt: minutesAgo([1, 6, 10][index]),
    transcriptionSource: 'LiveKit STT · synthetic transcript fixture',
    synthetic: true,
  }))
  const cases: PharosCase[] = [
    {
      id: 'PH-DEMO-024', incidentId: incident.id, title: 'Immediate safety concern', source: 'phone', sourceLabel: 'Synthetic voice transcript', callId: calls[0].id, transcript: transcripts[0], turns: calls[0].turns,
      locationText: 'Riverbend footbridge · Zone 3', zoneId: 'zone-river', zoneName: zones[2].name, locationStatus: 'matched', latitude: null, longitude: null, immediateDanger: 'yes', peopleCount: 4,
      needs: ['evacuation', 'medical'], priority: 'immediate', priorityRank: 0, priorityReason: 'Caller reported rising water and no safe exit. A human responder must confirm the situation and follow local procedures.', followUp: false,
      scamLevel: 'low', scamSignals: [], status: 'new', eligibleResponders: ['resp-river', 'resp-county'], assignedTo: null, createdAt: minutesAgo(2), updatedAt: minutesAgo(2), synthetic: true,
    },
    {
      id: 'PH-DEMO-019', incidentId: incident.id, title: 'Time-sensitive essential support', source: 'phone', sourceLabel: 'Synthetic voice transcript', callId: calls[1].id, transcript: transcripts[1], turns: calls[1].turns,
      locationText: 'Northbank · Zone 2', zoneId: 'zone-north', zoneName: zones[1].name, locationStatus: 'matched', latitude: null, longitude: null, immediateDanger: 'no', peopleCount: null,
      needs: ['medical', 'evacuation'], priority: 'time-sensitive', priorityRank: 1, priorityReason: 'Caller mentioned an oxygen concentrator and low battery. A responder should clarify the remaining power and transport options.', followUp: false,
      scamLevel: null, scamSignals: [], status: 'new', eligibleResponders: ['resp-north', 'resp-county'], assignedTo: null, createdAt: minutesAgo(7), updatedAt: minutesAgo(7), synthetic: true,
    },
    {
      id: 'PH-DEMO-021', incidentId: incident.id, title: 'Call needs location follow-up', source: 'phone', sourceLabel: 'Synthetic voice transcript', callId: calls[2].id, transcript: transcripts[2], turns: calls[2].turns,
      locationText: 'Blue water tower (not matched to a configured area)', zoneId: null, zoneName: 'Unassigned · location follow-up', locationStatus: 'unknown', latitude: null, longitude: null, immediateDanger: 'unknown', peopleCount: null,
      needs: ['evacuation', 'shelter'], priority: 'follow-up', priorityRank: 3, priorityReason: 'The caller is unsure about immediate danger and the landmark did not match a configured area. Keep visible and clarify location; missing data is not low priority.', followUp: true,
      scamLevel: null, scamSignals: [], status: 'follow-up', eligibleResponders: [], assignedTo: null, createdAt: minutesAgo(11), updatedAt: minutesAgo(11), synthetic: true,
    },
  ]
  const scamText = 'The caller quoted a message: “County Rescue says your seat expires in 5 minutes. Pay a $40 gift card fee and do not call the county.”'
  const scam = analyzeScamText(scamText)
  const scamReviews: ScamReview[] = [{ id: 'SC-DEMO-01', source: 'call', sourceId: calls[0].id, text: scamText, level: scam.level, headline: scam.headline, signals: scam.signals, nextStep: scam.nextStep, createdAt: minutesAgo(2), synthetic: true }]
  return { incident, zones, responders, calls, cases, scamReviews }
}
