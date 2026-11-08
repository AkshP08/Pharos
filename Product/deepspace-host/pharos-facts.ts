/**
 * Conservative factual extraction from caller speech for the Pharos prototype.
 * Prompts provide context; only caller words support facts. This is a transparent
 * rule set, not a medical assessment, geocoder, or validated triage model.
 */
export interface FactsTurn {
  role: 'caller' | 'agent'
  text: string
  at: string
}

export interface CallFacts {
  locationText: string
  immediateDanger: 'yes' | 'no' | 'unknown'
  peopleCount: number | null
  needs: string[]
  immediateEvidence: string | null
}

type Safety = CallFacts['immediateDanger']
type Need = 'evacuation' | 'medical' | 'shelter' | 'supplies' | 'information'
type Prompt = 'safety' | 'safe' | 'location' | 'people' | 'needs' | null

const correctionPattern = /\b(?:actually|correction|i meant|we meant|sorry|to correct (?:that|myself)|let me correct|rather than)\b/gi
const uncertainPattern = /\b(?:not sure|unsure|uncertain|not certain|do not know|don't know|dont know|cannot tell|can't tell|could not tell|maybe|possibly|might be)\b/i
const numberWords: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
}
const numberToken = '(?:\\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)'

function normalize(text: string): string {
  return text.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
}

function originalEvidence(rawText: string, evidence: string | null): string | null {
  if (!evidence) return null
  const escaped = evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’‘]").replace(/\s+/g, '\\s+').replace(/-/g, '[-–—]')
  return rawText.match(new RegExp(escaped, 'i'))?.[0] || evidence
}

function correctionTail(text: string): { text: string; corrected: boolean } {
  const matches = [...text.matchAll(correctionPattern)]
  const last = matches.at(-1)
  return last ? { text: text.slice((last.index ?? 0) + last[0].length).replace(/^[\s,:;-]+/, ''), corrected: true } : { text, corrected: false }
}

function promptFor(text: string): Prompt {
  if (/\b(?:how many|number of)\b.{0,40}\b(?:people|persons|of you|need help|household|adults|children)\b/i.test(text)) return 'people'
  if (/\b(?:where (?:are|can|should)|location|nearby (?:address|landmark)|what (?:address|landmark|zone)|which (?:area|zone|district))\b/i.test(text)) return 'location'
  if (/\b(?:immediate danger|anyone in danger|in danger (?:right )?now)\b/i.test(text)) return 'safety'
  if (/\b(?:safe right now|currently safe|safe at (?:the )?moment)\b/i.test(text)) return 'safe'
  if (/\b(?:what (?:help|assistance)|help do you need|need most|time-sensitive need)\b/i.test(text)) return 'needs'
  return null
}

function negatedAt(text: string, index: number): boolean {
  const prefix = text.slice(0, index).split(/[.!?;,]|\bbut\b|\bhowever\b|\band (?:i|we|they|he|she|my|our)\b/i).at(-1) || ''
  const nearby = prefix.split(/\s+/).slice(-7).join(' ')
  return /\b(?:no|not|never|without|neither|nobody|no one|no longer|don't|do not|doesn't|does not|isn't|is not|aren't|are not|wasn't|was not|weren't|were not)\b/i.test(nearby)
}

function callerHazard(text: string): string | null {
  // Reported scam quotations are reviewed separately, rather than promoted to
  // facts about the resident's own physical circumstances.
  if (/\b(?:someone called me|scammer (?:said|told)|they (?:said|told me)|the (?:message|text|caller) says)\b/i.test(text)
    && !/\b(?:but (?:i|we|my|our)|i (?:am|can't|cannot)|we (?:are|can't|cannot)|my (?:home|house|father|mother|child))\b/i.test(text)) return null
  const patterns = [
    /\btrapped\b/gi,
    /\b(?:cannot|can't|unable to) (?:get out|leave|escape|breathe)\b/gi,
    /\bno safe (?:way out|exit)\b/gi,
    /\b(?:water|floodwater) (?:is |has been )?(?:now )?(?:rising (?:inside|in (?:my|our|the) (?:house|home|room))|coming (?:in|into (?:my|our|the) (?:house|home|room))|inside(?: (?:my|our|the) (?:house|home|room))?|coming up(?: (?:the )?stairs|stairs))\b/gi,
    /\b(?:fire|smoke) (?:is )?(?:inside|in (?:my|our|the) (?:house|home|room)|near (?:my|our) (?:home|house))\b/gi,
    /\b(?:unconscious|seriously injured|serious injury|bleeding heavily|life[- ]threatening)\b/gi,
    /\b(?:i am|i'm|we are|we're|someone is) in (?:immediate )?danger\b/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (negatedAt(text, match.index ?? 0)) continue
      if (uncertainPattern.test(text.slice(Math.max(0, (match.index ?? 0) - 45), (match.index ?? 0) + match[0].length))) continue
      return match[0]
    }
  }
  return null
}

function safetyReport(text: string, prompt: Prompt): { value: Safety; evidence: string | null; reported: boolean; corrected: boolean } {
  const correction = correctionTail(text)
  const value = correction.text
  const safetyContext = prompt === 'safety' || prompt === 'safe'
  const changingSituation = /\b(?:now (?:safe|out of danger)|safe now|no longer (?:trapped|in danger)|not (?:trapped|in danger) anymore|rescued|have (?:now )?got(?:ten)? out)\b/i.test(value)
  const danger = callerHazard(value)
  const uncertain = uncertainPattern.test(value)
  const explicitSafe = /\b(?:we (?:are|'re)|i (?:am|'m)|everyone is|all (?:of us|people) are) (?:currently |now )?safe\b|\b(?:currently safe|safe (?:inside|now|right now)|out of (?:immediate )?danger|no (?:immediate )?danger|not in (?:immediate )?danger)\b/i.test(value)
  const firstYes = /^(?:yes|yeah|yep|correct|that's right)\b/i.test(value)
  const firstNo = /^(?:no|nope|not right now)\b/i.test(value)
  const directYes = safetyContext && (prompt === 'safe' ? firstNo : firstYes)
  const directNo = explicitSafe || (safetyContext && (prompt === 'safe' ? firstYes : firstNo))
  if ((danger || directYes) && directNo) return { value: 'unknown', evidence: null, reported: true, corrected: correction.corrected || changingSituation }
  if (uncertain && (safetyContext || danger || /\b(?:danger|safe|trapped|breathe|(?:water|floodwater)\b.{0,45}\b(?:inside|rising|coming up))\b/i.test(value))) return { value: 'unknown', evidence: null, reported: true, corrected: correction.corrected || changingSituation }
  if (danger || directYes) return { value: 'yes', evidence: danger || value, reported: true, corrected: correction.corrected || changingSituation }
  if (directNo) return { value: 'no', evidence: null, reported: true, corrected: correction.corrected || changingSituation }
  return { value: 'unknown', evidence: null, reported: false, corrected: false }
}

function locationCandidate(text: string, prompted: boolean): { value: string; reported: boolean; corrected: boolean } {
  const tail = correctionTail(text)
  const value = tail.text.replace(/\bnot (?:in |at |near )?(?:zone|district)\s+(?:\d+|one|two|three|four|five)\b[^,.;]*(?:[,;]\s*)?/gi, '').trim()
  if (prompted && /^(?:i |we )?(?:do not|don't|dont) know(?: where (?:i am|we are)| (?:my|our|the) (?:address|location|area))?[.! ]*$/i.test(value)) return { value: '', reported: true, corrected: tail.corrected }
  const coordinate = value.match(/(?:^|[^\d])(-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,})(?!\d)/)?.[1]
  const address = value.match(/\b\d{1,6}\s+[\w .'-]{2,45}\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|lane|ln\.?|boulevard|blvd\.?|highway|hwy\.?)\b/i)?.[0]
  const zone = value.match(/\b(?:zone|district)\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)?.[0]
  const zip = value.match(/\b(?:zip(?: code)? (?:is )?)?(\d{5}(?:-\d{4})?)\b/i)?.[1]
  const landmark = value.match(/\b(?:near|at|by|beside|outside)\s+(?:the\s+)?([^.!?;]{3,90})/i)?.[0]
  const unknown = /\b(?:don't know|do not know|not sure|unsure|unknown)\b/i.test(value)
  const plausible = coordinate || address || landmark || zone || zip
  if (unknown && !plausible) return { value: '', reported: prompted || /\b(?:location|where|address|zone|area)\b/i.test(value), corrected: tail.corrected }
  if (!prompted && !plausible) return { value: '', reported: false, corrected: false }
  const irrelevantAnswer = /^(?:yes|no|we need|i need|we (?:are|'re) (?:safe|trapped)|i (?:am|'m) (?:safe|trapped)|there are (?:\d+|one|two|three|four|five))\b/i.test(value) && !plausible
  const chosen = prompted && !unknown && !irrelevantAnswer ? value : plausible || ''
  return {
    value: chosen.replace(/\s+(?:and |but )?(?:we|i) (?:need|require|have|are trapped|am trapped)\b.*$/i, '').trim(),
    reported: Boolean(chosen), corrected: tail.corrected,
  }
}

function locationIdentity(value: string): string | null {
  const match = normalize(value).toLowerCase().match(/\b(zone|district)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/)
  return match ? `${match[1]} ${numberWords[match[2]] ?? match[2]}` : null
}

function countValue(token: string): number {
  return numberWords[token.toLowerCase()] ?? Number(token)
}

function peopleReport(text: string, prompted: boolean): { value: number | null; reported: boolean; corrected: boolean } {
  const tail = correctionTail(text)
  const value = tail.text
  const countContext = prompted || /\b(?:of us|people|persons|residents|household|family of|adults?|children|kids?)\b/i.test(value)
  if (!countContext) return { value: null, reported: false, corrected: false }
  if (/\b(?:not sure|don't know|do not know)\b/i.test(value)
    || new RegExp(`\\b(?:about|around|at least|maybe|roughly)\\s+(?:there are\\s+)?${numberToken}\\b`, 'i').test(value)
    || new RegExp(`\\b${numberToken} (?:or|to) ${numberToken}\\b`, 'i').test(value)) return { value: null, reported: true, corrected: tail.corrected }
  const total = value.match(new RegExp(`\\b(${numberToken}) (?:of us|people|persons|residents)\\b`, 'i'))
    || value.match(new RegExp(`\\b(?:family|household|party) of (${numberToken})\\b`, 'i'))
    || (prompted ? value.match(new RegExp(`^(${numberToken})(?:[.! ,]|$)`, 'i')) : null)
  if (total && !negatedAt(value, total.index ?? 0)) return { value: countValue(total[1]), reported: true, corrected: tail.corrected }
  const groups = [...value.matchAll(new RegExp(`\\b(${numberToken}) (adults?|children|kids?)\\b`, 'gi'))].filter((match) => !negatedAt(value, match.index ?? 0))
  if (groups.length >= 2) return { value: groups.reduce((sum, match) => sum + countValue(match[1]), 0), reported: true, corrected: tail.corrected }
  return { value: null, reported: false, corrected: false }
}

function needUpdates(text: string, prompted: boolean): Array<{ need: Need; wanted: boolean; corrected: boolean }> {
  const tail = correctionTail(text)
  const clauses = tail.text.split(/[.!?;]|\bbut\b|\bhowever\b/i).map((part) => part.trim()).filter(Boolean)
  const result: Array<{ need: Need; wanted: boolean; corrected: boolean }> = []
  const patterns: Array<[Need, RegExp]> = [
    ['evacuation', /\b(?:evacuation|evacuate|ride|transport|rescue|safe way out|leave safely|get out)\b/gi],
    ['medical', /\b(?:oxygen|medical device|powered (?:medical )?(?:device|equipment)|medication|medicine|medical supplies|dialysis|insulin)\b/gi],
    ['shelter', /\b(?:shelter|place to stay|temporary housing)\b/gi],
    ['supplies', /\b(?:drinking water|bottled water|clean water|potable water|food|basic supplies|blankets?|clean clothes)\b/gi],
    ['information', /\b(?:information|updates?|where can i|what should i do)\b/gi],
  ]
  for (const clause of clauses) {
    const demandContext = prompted || /\b(?:need|needs|require|requires|request|requesting|help|uses?|depends? on|running (?:out|low)|battery is low|power is out|out of|without|no (?:clean|drinking|bottled) water)\b/i.test(clause)
    for (const [need, pattern] of patterns) {
      for (const match of clause.matchAll(pattern)) {
        const prefix = clause.slice(0, match.index)
        const noSafeExit = need === 'evacuation' && match[0].toLowerCase() === 'safe way out' && /\bno\s*$/i.test(prefix)
        const negative = negatedAt(clause, match.index ?? 0) && !noSafeExit
        // Lack of essential supplies or support is a positive need, not a denial.
        const lacking = /\b(?:out of|without|no (?:clean|drinking|bottled|potable))\s+(?:[\w'-]+\s+){0,2}$/i.test(clause.slice(0, match.index))
        if (negative && !lacking) result.push({ need, wanted: false, corrected: tail.corrected })
        else if (demandContext || (need === 'evacuation' && callerHazard(clause))) result.push({ need, wanted: true, corrected: tail.corrected })
      }
    }
    // Plain 'water' counts only in an explicit supply request, never a flood report.
    const requestedWater = clause.match(/\b(?:need|require|request|out of|without) (?:some |more |any |a supply of )?water\b/i)
    if (requestedWater && !negatedAt(clause, requestedWater.index ?? 0)) result.push({ need: 'supplies', wanted: true, corrected: tail.corrected })
  }
  return result
}

export function deriveCallFacts(turns: readonly FactsTurn[]): CallFacts {
  let prompt: Prompt = null
  let immediateDanger: Safety = 'unknown'
  let immediateEvidence: string | null = null
  let safetyReported = false
  let locationText = ''
  let locationAmbiguous = false
  let peopleCount: number | null = null
  let countReported = false
  const needs = new Set<Need>()

  for (const turn of turns) {
    const text = normalize(turn.text)
    if (!text) continue
    if (turn.role === 'agent') {
      prompt = promptFor(text)
      continue
    }
    const fragments = text.split(/(?=\b(?:actually|correction|i meant|we meant|sorry|to correct (?:that|myself)|let me correct)\b)/i).filter(Boolean)
    for (const fragment of fragments) {
      const safety = safetyReport(fragment, prompt)
      if (safety.reported) {
        const rechecked = prompt === 'safety' || prompt === 'safe'
        // A later explicit worsening report is new evidence, not a static
        // contradiction. Plain conflicting answers still need clarification.
        const worsening = safety.value === 'yes' && /\b(?:now|getting worse|rising|has risen|coming up|since (?:my|our|the) last call)\b/i.test(fragment)
        if (!safetyReported || safety.corrected || rechecked || worsening) {
          immediateDanger = safety.value
          immediateEvidence = originalEvidence(turn.text, safety.evidence)
        } else if (safety.value !== immediateDanger) {
          immediateDanger = 'unknown'
          immediateEvidence = null
        } else if (safety.evidence) immediateEvidence = originalEvidence(turn.text, safety.evidence)
        safetyReported = true
      }
  
      const location = locationCandidate(fragment, prompt === 'location')
      if (location.reported) {
        const previousZone = locationIdentity(locationText)
        const nextZone = locationIdentity(location.value)
        const conflict = previousZone && nextZone && previousZone !== nextZone
        if (location.corrected || prompt === 'location' || !locationText && !locationAmbiguous) {
          locationText = location.value
          locationAmbiguous = false
        } else if (conflict) {
          locationText = ''
          locationAmbiguous = true
        } else if (!locationAmbiguous && location.value) locationText = location.value
      }
  
      const people = peopleReport(fragment, prompt === 'people')
      if (people.reported) {
        if (!countReported || people.corrected || prompt === 'people') peopleCount = people.value
        else if (people.value !== peopleCount) peopleCount = null
        countReported = true
      }
      for (const update of needUpdates(fragment, prompt === 'needs')) {
        if (update.wanted) needs.add(update.need)
        else needs.delete(update.need)
      }
    }
    // An answer is associated with its immediately preceding prompt only; a
    // later unprompted yes is never silently interpreted as a safety answer.
    prompt = null
  }
  return { locationText, immediateDanger, peopleCount, needs: [...needs], immediateEvidence: immediateDanger === 'yes' ? immediateEvidence : null }
}
