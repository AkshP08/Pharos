import type { PressureAnalysis, PressureSignal } from './pharos-pressure'

// Model output is untrusted. Only exact caller quotations and known labels
// become UI evidence; the server supplies all explanations and UTF-16 spans.
const descriptions: Record<string, [string, string, string]> = {
  authority: ['Claimed authority', 'Authority cue', 'An official or trusted role can encourage compliance. The transcript cannot verify that role.'],
  deadline: ['Pressure to decide quickly', 'Time pressure', 'A deadline can reduce the chance to check a request. Real safety instructions can also be urgent.'],
  scarcity: ['Limited availability used as pressure', 'Scarcity cue', 'Limited availability can make checking feel costly. Availability is not verified here.'],
  money_or_secret: ['Payment or private information requested', 'Risky requested action', 'A request for money, login secrets, or private information deserves an independent check.'],
  isolation: ['Independent checking discouraged', 'Isolation from a second opinion', 'Preventing a separate check can remove a useful safeguard. Maintaining an emergency connection alone is not this tactic.'],
  threat: ['Punishment or loss used as pressure', 'Loss or punishment framing', 'A threatened loss can press someone into complying. This does not establish whether the consequence is real.'],
  link: ['Supplied link or download requested', 'Moving to a supplied channel', 'A supplied channel may bypass a contact already trusted. Links alone do not establish fraud.'],
  remote_access: ['Device access requested', 'Control or access request', 'Remote access or screen sharing can expose information and control. Verify the contact before granting access.'],
  social_proof: ['Others invoked to encourage compliance', 'Social proof cue', 'Claims that others complied can make a request seem normal. Those claims are unverified.'],
  reciprocity: ['A favor used to seek compliance', 'Reciprocity cue', 'A claimed favor can create obligation. The new requested action deserves its own check.'],
  commitment: ['Earlier agreement used as pressure', 'Commitment pressure', 'An earlier agreement does not require accepting a new payment, disclosure, or access request.'],
  guilt: ['Guilt used to obtain compliance', 'Guilt or obligation framing', 'Blame or obligation can pressure a decision. Judge the requested action independently.'],
  financial_control: ['Control of funds requested', 'Financial control request', 'Moving or handing over control of funds can cause loss. Check through a trusted independent contact first.'],
  reputation_threat: ['Exposure or reputation used as leverage', 'Threat of social loss', 'Threatened exposure can discourage seeking help. The transcript cannot verify the claim.'],
  withholding_aid: ['Help made conditional on compliance', 'Conditional assistance pressure', 'Withholding promised assistance can pressure a resident into an unrelated risky action. Verify that condition independently.'],
}

export function semanticAnalysis(value: unknown, callerText: string): { analysis: PressureAnalysis; identity: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A valid context review is required')
  const review = value as Record<string, unknown>
  if (Object.keys(review).some(key => !['shouldWarn', 'level', 'signals'].includes(key))
    || typeof review.shouldWarn !== 'boolean' || !['low', 'medium', 'high'].includes(String(review.level))
    || review.shouldWarn !== (review.level !== 'low') || !Array.isArray(review.signals) || review.signals.length > 8) throw new Error('Invalid context review shape')
  const used = new Set<string>()
  const signals: PressureSignal[] = review.signals.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid context evidence')
    const signal = value as Record<string, unknown>
    if (Object.keys(signal).some(key => !['kind', 'evidence'].includes(key)) || typeof signal.kind !== 'string'
      || !Object.hasOwn(descriptions, signal.kind) || used.has(signal.kind) || typeof signal.evidence !== 'string'
      || !signal.evidence.trim() || signal.evidence.length > 300) throw new Error('Invalid context evidence')
    const start = callerText.indexOf(signal.evidence)
    if (start < 0) throw new Error('Context evidence must exactly quote caller speech')
    used.add(signal.kind)
    const [label, psychology, explanation] = descriptions[signal.kind]
    return { kind: signal.kind, evidence: signal.evidence, start, end: start + signal.evidence.length, label, psychology, explanation }
  })
  const actions = new Set(['money_or_secret', 'remote_access', 'financial_control', 'link'])
  const actionPresent = signals.some(signal => actions.has(signal.kind))
  const pressurePresent = signals.some(signal => !['money_or_secret', 'remote_access', 'link'].includes(signal.kind))
  if (!review.shouldWarn && signals.length || review.shouldWarn && (signals.length < 2 || !actionPresent || !pressurePresent)) throw new Error('Context warning needs consistent supporting evidence')
  const level = review.level as PressureAnalysis['level']
  const analysis: PressureAnalysis = {
    level, shouldWarn: review.shouldWarn, signals,
    headline: level === 'high' ? 'Possible scam: pressured request detected' : level === 'medium' ? 'This request deserves an independent check' : 'No strong manipulation combination identified in this review',
    summary: 'Contextual transcript review identifies wording and requested actions. It does not establish identity, intent, or safety.',
    nextStep: review.shouldWarn ? 'Pause payment, code sharing, or device access and verify through a trusted contact you find independently. Continue immediate physical safety instructions; this warning does not assess evacuation guidance.' : 'This review cannot verify the caller or establish safety. Check unexpected requests through a trusted independent contact.',
    evidenceQuality: signals.length >= 2 ? 'combined' : signals.length ? 'limited' : 'insufficient',
    confidence: 'Contextual wording evidence; not a fraud probability',
    limitations: ['Prototype model interpretation can be wrong.', 'Exact quotes establish attribution, not the correctness of an interpretation.', 'No inference is made from phone number, accent, identity, or mental state.'],
  }
  const identity = JSON.stringify({ shouldWarn: review.shouldWarn, level, signals: signals.map(({ kind, evidence }) => ({ kind, evidence })).sort((a, b) => a.kind.localeCompare(b.kind)) })
  return { analysis, identity }
}
