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
  safeguard_bypass: ['Safeguards explicitly bypassed', 'Pressure toward removing a safeguard', 'An explicit instruction to skip an independent or safety check needs verification. Ordinary rescue urgency does not establish this.'],
  resource_diversion: ['Resources requested for a stated nonemergency purpose', 'Explicit resource-use concern', 'The quoted request describes a false or nonemergency purpose. Verify its context; unusual rescue details alone do not establish diversion.'],
  false_report_admission: ['Explicit false-report admission quoted', 'Admission requiring contextual verification', 'This is a quoted explicit admission, not a psychological diagnosis or proof the report is false. Negated, quoted, or third-party reports are not current admissions.'],
}

export type SemanticBasis = 'pressure-pattern' | 'explicit-false-report' | 'uncertain-request' | 'no-supported-concern'

export function semanticAnalysis(value: unknown, callerText: string, context: 'guard' | 'responder' = 'guard'): { analysis: PressureAnalysis; identity: string; uncertain: boolean; basis: SemanticBasis } {
  if (!['guard', 'responder'].includes(context)) throw new Error('Unknown context review target')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A valid context review is required')
  const review = value as Record<string, unknown>
  const allowedFields = context === 'responder' ? ['shouldWarn', 'level', 'signals', 'uncertain'] : ['shouldWarn', 'level', 'signals']
  if (Object.keys(review).some(key => !allowedFields.includes(key))
    || typeof review.shouldWarn !== 'boolean' || typeof review.level !== 'string' || !['low', 'medium', 'high'].includes(review.level)
    || context === 'responder' && typeof review.uncertain !== 'boolean'
    || review.shouldWarn !== (review.level !== 'low') || !Array.isArray(review.signals) || review.signals.length > 8) throw new Error('Invalid context review shape')
  const uncertain = context === 'responder' && review.uncertain === true
  const responderOnly = new Set(['safeguard_bypass', 'resource_diversion', 'false_report_admission'])
  const used = new Set<string>()
  const signals: PressureSignal[] = review.signals.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid context evidence')
    const signal = value as Record<string, unknown>
    if (Object.keys(signal).some(key => !['kind', 'evidence'].includes(key)) || typeof signal.kind !== 'string'
      || !Object.hasOwn(descriptions, signal.kind) || used.has(signal.kind) || typeof signal.evidence !== 'string'
      || context === 'guard' && responderOnly.has(signal.kind)
      || !signal.evidence.trim() || signal.evidence.length > 300) throw new Error('Invalid context evidence')
    const start = callerText.indexOf(signal.evidence)
    if (start < 0) throw new Error('Context evidence must exactly quote caller speech')
    used.add(signal.kind)
    const [label, psychology, explanation] = descriptions[signal.kind]
    return { kind: signal.kind, evidence: signal.evidence, start, end: start + signal.evidence.length, label, psychology, explanation }
  })
  const actions = new Set(['money_or_secret', 'remote_access', 'financial_control', 'link',
    ...(context === 'responder' ? ['safeguard_bypass', 'resource_diversion'] : [])])
  const actionPresent = signals.some(signal => actions.has(signal.kind))
  const pressurePresent = signals.some(signal => !['money_or_secret', 'remote_access', 'link', ...responderOnly].includes(signal.kind))
  const explicitFalseReport = context === 'responder' && used.has('resource_diversion') && used.has('false_report_admission')
  if (!review.shouldWarn && signals.length || review.shouldWarn && (signals.length < 2 || !(actionPresent && pressurePresent || explicitFalseReport))
    || uncertain && (review.shouldWarn || review.level !== 'low' || signals.length)) throw new Error('Context warning needs consistent supporting evidence')
  const basis: SemanticBasis = uncertain ? 'uncertain-request' : explicitFalseReport ? 'explicit-false-report' : review.shouldWarn ? 'pressure-pattern' : 'no-supported-concern'
  const level = review.level as PressureAnalysis['level']
  const analysis: PressureAnalysis = {
    level, shouldWarn: review.shouldWarn, signals,
    headline: context === 'responder'
      ? uncertain ? 'Request interpretation needs human review' : explicitFalseReport ? 'Explicit false-report wording needs verification' : review.shouldWarn ? 'Request wording needs human verification' : 'No supported integrity concern identified in this review'
      : level === 'high' ? 'Possible scam: pressured request detected' : level === 'medium' ? 'This request deserves an independent check' : 'No strong manipulation combination identified in this review',
    summary: context === 'responder' && explicitFalseReport
      ? 'The quoted words pair an explicit admission with a resource request. This supports contextual verification, not proof of a false report.'
      : context === 'responder' && uncertain ? 'The current potentially concerning request could not be interpreted reliably. This is uncertainty about wording, not proof that an emergency is fabricated.'
      : 'Contextual transcript review identifies wording and requested actions. It does not establish identity, intent, truth, or safety.',
    nextStep: context === 'responder'
      ? review.shouldWarn || uncertain ? 'A human must verify the relevant request before assignment or an arrival estimate. Preserve reported urgency and immediate danger facts; this review does not prove wrongdoing.' : 'Continue normal factual triage. No supported concern is not verified truth, and any existing human review decision remains separate.'
      : review.shouldWarn ? 'Pause payment, code sharing, or device access and verify through a trusted contact you find independently. Continue immediate physical safety instructions; this warning does not assess evacuation guidance.' : 'This review cannot verify the caller or establish safety. Check unexpected requests through a trusted independent contact.',
    evidenceQuality: signals.length >= 2 ? 'combined' : signals.length ? 'limited' : 'insufficient',
    confidence: 'Contextual wording evidence; not a fraud probability',
    limitations: ['Prototype model interpretation can be wrong.', 'Exact quotes establish attribution, not the correctness of an interpretation.', 'No inference is made from phone number, accent, identity, or mental state.',
      ...(context === 'responder' ? ['Urgency, emotion, inconsistent memories, corrections, or missing location do not establish a false report.'] : [])],
  }
  const identity = JSON.stringify({ shouldWarn: review.shouldWarn, level, ...(context === 'responder' ? { uncertain } : {}), signals: signals.map(({ kind, evidence }) => ({ kind, evidence })).sort((a, b) => a.kind.localeCompare(b.kind)) })
  return { analysis, identity, uncertain, basis }
}
