/**
 * Evidence-first wording review for Pharos. These are prototype rules, not a
 * validated fraud classifier. The psychological labels explain an observable
 * persuasion tactic; they do not infer the speaker's identity or mental state.
 *
 * Consumer-protection grounding:
 * https://consumer.ftc.gov/articles/how-avoid-scam
 * https://consumer.ftc.gov/consumer-alerts/2025/07/spot-avoid-fema-impersonators
 */
export type PressureLevel = 'high' | 'medium' | 'low'

export interface PressureSignal {
  kind: string
  label: string
  evidence: string
  /** Zero-based UTF-16 offsets into the original input, end exclusive. */
  start: number
  end: number
  psychology: string
  explanation: string
}

export interface PressureAnalysis {
  level: PressureLevel
  headline: string
  signals: PressureSignal[]
  nextStep: string
  shouldWarn: boolean
  summary: string
  evidenceQuality: 'insufficient' | 'limited' | 'combined'
  /** A description of the evidence, deliberately not a numeric probability. */
  confidence: string
  limitations: string[]
}

type Rule = {
  kind: string
  label: string
  psychology: string
  explanation: string
  patterns: RegExp[]
  needsRequest?: boolean
}

const rules: Rule[] = [
  {
    kind: 'authority',
    label: 'Claimed authority to verify',
    psychology: 'Authority cue',
    explanation: 'An official-sounding name can encourage trust. This phrase alone does not establish who is calling.',
    patterns: [/\b(?:FEMA|county|rescue office|relief office|disaster agency|government|sheriff|police|utility company|your bank|fraud department|official representative)\b/gi],
  },
  {
    kind: 'deadline',
    label: 'Pressure to act before checking',
    psychology: 'Time pressure',
    explanation: 'A short deadline can reduce the opportunity to compare information or ask someone else. Genuine emergency instructions can also be urgent.',
    patterns: [
      /\b(?:act now|right now|immediately|urgent|before (?:it is|it['’]s) too late|today only|only today)\b/gi,
      /\b(?:within|in|you have|expires? in)\s+(?:\d+|one|two|three|four|five|ten|fifteen|thirty)\s+(?:minutes?|hours?|seconds?)\b/gi,
    ],
  },
  {
    kind: 'scarcity',
    label: 'Limited availability used as pressure',
    psychology: 'Scarcity cue',
    explanation: 'A claim that very few places remain can push a decision before verification. Availability claims cannot be checked from the transcript.',
    patterns: [/\b(?:(?:the\s+)?last\s+(?:available\s+)?(?:seat|spot|place|chance)|only\s+(?:one|two|three|\d+)\s+(?:seats?|spots?|places?)\s+(?:left|remain(?:ing)?))\b/gi],
  },
  {
    kind: 'money_or_secret',
    label: 'Payment or sensitive information request',
    psychology: 'Risky requested action',
    explanation: 'This wording involves a payment method or sensitive account information. Pause that action and verify the request through an independently found contact.',
    needsRequest: true,
    patterns: [
      /\bgift[\s-]*cards?\b/gi,
      /\b(?:wire transfer|crypto(?:currency)?|bitcoin|payment app|cash app|zelle|venmo)\b/gi,
      /\b(?:passwords?|passcodes?|PIN|OTP|(?:verification|security|login|six[- ]digit|two[- ]factor)\s+codes?|one[- ]time\s+(?:codes?|passwords?)|bank (?:accounts?|login)|social security (?:numbers?|details)|credit card (?:numbers?|details)|card (?:PIN|numbers?))\b/gi,
      /\b(?:pay|send|transfer|wire)\s+(?:(?:me|us|a|the|this|your)\s+){0,2}(?:(?:processing|rescue|application|reservation|inspection)\s+)?(?:fee|charge|deposit|money|cash|\$\s*\d[\d,.]*)\b/gi,
      /\b(?:fee|payment|deposit)\s+(?:to|before you can)\s+(?:reserve|access|get|receive|release|qualify|claim)\b/gi,
    ],
  },
  {
    kind: 'isolation',
    label: 'Discourages independent verification',
    psychology: 'Isolation from a second opinion',
    explanation: 'Keeping the contact secret or preventing a separate call removes a useful chance to check the story with someone trusted.',
    patterns: [
      /\b(?:do not|don['’]t)\s+(?:call|contact|tell|talk to|check with)\b/gi,
      /\b(?:keep (?:this|it|our conversation) (?:a )?secret|only (?:contact|speak to|deal with) me|stay on the line|do not hang up|don['’]t hang up|no need to verify)\b/gi,
    ],
  },
  {
    kind: 'threat',
    label: 'Threat of losing help or punishment',
    psychology: 'Loss or punishment framing',
    explanation: 'A threatened loss can pressure someone to comply. The transcript cannot establish whether the stated consequence is real.',
    patterns: [
      /\b(?:you (?:will|['’]ll) (?:lose|be arrested|be fined|be deported)|(?:your\s+)?(?:request|seat|rescue|benefits|assistance)\s+will be\s+(?:cancelled|canceled|denied|removed)|lose your (?:place|seat|benefits)|no rescue (?:unless|until)|or (?:we (?:will|['’]ll) |you (?:will|['’]ll) )?(?:cancel|arrest|deny))\b/gi,
    ],
  },
  {
    kind: 'link',
    label: 'Requested link or download action',
    psychology: 'Moving the interaction to a supplied channel',
    explanation: 'A supplied link or app can move the interaction away from a contact you already trust. A link by itself is not evidence of fraud.',
    needsRequest: true,
    patterns: [
      /\b(?:click|open|tap|follow)\s+(?:on\s+)?(?:(?:the|this|my|our)\s+)?(?:link|https?:\/\/[^\s<>"']+)/gi,
      /\bdownload\s+(?:(?:the|this|our|an?)\s+)?app\b/gi,
    ],
  },
  {
    kind: 'remote_access',
    label: 'Requests control of a device',
    psychology: 'Control or access request',
    explanation: 'Sharing a screen or allowing remote control can expose information or let another person act on the device. Verify the support contact before granting access.',
    needsRequest: true,
    patterns: [
      /\b(?:install|download)\s+(?:AnyDesk|TeamViewer|remote (?:access|support) (?:software|app))\b/gi,
      /\b(?:give|grant|allow)\s+(?:(?:me|us)\s+)?remote\s+(?:access|control)\b/gi,
      /\b(?:share your screen|screen[- ]share with me)\b/gi,
    ],
  },
  {
    kind: 'social_proof',
    label: 'Other people invoked to encourage compliance',
    psychology: 'Social proof cue',
    explanation: 'Claims that everyone else complied can make a request feel normal. Those claims are unverified, and are not suspicious on their own.',
    patterns: [/\b(?:everyone (?:else |in your (?:neighborhood|area) )?(?:has already|already) (?:paid|agreed|done (?:this|it)|sent)|all your neighbors (?:have |already )?(?:paid|agreed)|other families have already (?:paid|agreed))\b/gi],
  },
  {
    kind: 'reciprocity',
    label: 'A claimed favor used to ask for compliance',
    psychology: 'Reciprocity cue',
    explanation: 'A claimed favor can create a sense of obligation. Judge the requested action independently of the favor.',
    patterns: [/\b(?:(?:we|I) (?:have |already )?(?:saved|reserved) (?:you |your )?(?:a |the )?(?:seat|spot)|(?:after|because of) (?:all |everything )?(?:we|I)['’]?(?:ve| have)? done for you|you owe (?:me|us) (?:this|a favor))\b/gi],
  },
  {
    kind: 'commitment',
    label: 'Earlier agreement used to press for another action',
    psychology: 'Commitment pressure',
    explanation: 'An earlier agreement does not require accepting a new payment, disclosure, or access request. The new action deserves its own check.',
    patterns: [/\b(?:you (?:already |have already )?(?:agreed|promised)|you said yes|finish what you started|you can['’]t back out now)\b/gi],
  },
]

/** Context is used only to avoid treating protective instructions as demands. */
function clauseAround(text: string, start: number, end: number): { prefix: string; suffix: string; clause: string } {
  const boundary = /[.!?;\n]/
  let left = start
  let right = end
  while (left > 0 && !boundary.test(text[left - 1]) && start - left < 150) left -= 1
  while (right < text.length && !boundary.test(text[right]) && right - end < 150) right += 1
  return { prefix: text.slice(left, start), suffix: text.slice(end, right), clause: text.slice(left, right) }
}

function isProtectiveInstruction(kind: string, prefix: string, clause: string): boolean {
  if (kind === 'isolation') {
    // Safety/traffic guidance is not the anti-verification tactic we mean.
    return /\b(?:do not|don['’]t)\s+(?:call|contact)\s+(?:911|9-1-1|emergency services)\s+(?:unless|except|for (?:road|traffic|weather|general))/i.test(clause)
      || /\b(?:do not|don['’]t)\s+(?:call|contact)\s+(?:the\s+)?(?:number|contact)\s+(?:in|on|from)\s+(?:the|this|a)\s+(?:suspicious\s+)?(?:message|text|email)/i.test(clause)
  }
  if (!['money_or_secret', 'link', 'remote_access'].includes(kind)) return false
  // A comma/conjunction starts a new instruction. Otherwise "don't pay a fee,
  // send gift cards instead" would suppress the positive demand as well.
  const localPrefix = prefix.split(/,|\bbut\b|\binstead\b/i).at(-1) || ''
  return /\bno\s+$/i.test(localPrefix)
    || /\b(?:never|do not|don['’]t|must not|should not|shouldn['’]t|will not|won['’]t|cannot|can['’]t|not to|no need to|without)\b(?:\s+[\w'’$-]+){0,14}\s*$/i.test(localPrefix)
    || /\b(?:not (?:asking|requesting|demanding)(?: you)? (?:to|for)|no (?:payment|fee|code|password) (?:is )?(?:needed|required))\b(?:\s+[\w'’$-]+){0,10}\s*$/i.test(localPrefix)
}

function hasRequestContext(evidence: string, prefix: string, suffix: string, clause: string): boolean {
  // Certain patterns already contain an explicit action verb.
  if (/^(?:pay|send|transfer|wire|click|open|tap|follow|download|install|give|grant|allow|share your|screen.share)/i.test(evidence)) return true
  if (/\b(?:fee|payment|deposit)\s+(?:to|before you can)\b/i.test(evidence)) return true
  const before = prefix.slice(-120)
  const after = suffix.slice(0, 90)
  const request = /\b(?:pay|send|buy|purchase|use|read|give|tell|share|provide|transfer|wire|needs?|requires?|must|asked|asking|asks|told|demand(?:s|ed)?|request(?:s|ed)?|give me|for a|by|via)\b/i
  if (request.test(before)) return true
  if (/^\s*(?:is|are|will be)?\s*(?:required|needed|only|to pay|for payment)/i.test(after)) return true
  // "The fee is payable by gift card" and reported requests keep their evidence.
  return /\b(?:payable|payment|fee|charge|demanded|asked (?:me|us|her|him|them) for)\b/i.test(clause)
}

function signalForRule(text: string, rule: Rule): PressureSignal | null {
  const candidates = rule.patterns.flatMap(pattern => [...text.matchAll(pattern)]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  for (const match of candidates) {
    const start = match.index ?? 0
    const end = start + match[0].length
    const context = clauseAround(text, start, end)
    if (isProtectiveInstruction(rule.kind, context.prefix, context.clause)) continue
    if (rule.needsRequest && !hasRequestContext(match[0], context.prefix, context.suffix, context.clause)) continue
    return { kind: rule.kind, label: rule.label, evidence: match[0], start, end, psychology: rule.psychology, explanation: rule.explanation }
  }
  return null
}

export function analyzePressureText(input: string): PressureAnalysis {
  // Preserve original characters and offsets for direct evidence highlighting.
  const text = String(input || '')
  const signals = rules.flatMap(rule => {
    const signal = signalForRule(text, rule)
    return signal ? [signal] : []
  })
  const kinds = new Set(signals.map(signal => signal.kind))
  const riskyAction = kinds.has('money_or_secret') || kinds.has('remote_access')
  const coercion = ['deadline', 'scarcity', 'isolation', 'threat'].filter(kind => kinds.has(kind))
  const persuasiveContext = kinds.has('authority') || coercion.length > 0 || kinds.has('social_proof') || kinds.has('reciprocity') || kinds.has('commitment')
  const combinedRisk = riskyAction && persuasiveContext
  const coerciveWithoutPayment = (kinds.has('isolation') || kinds.has('threat')) && (coercion.length >= 2 || kinds.has('authority'))
  const pressuredLink = kinds.has('link') && (coercion.length > 0 || kinds.has('authority'))
  const level: PressureLevel = combinedRisk ? 'high' : riskyAction || coerciveWithoutPayment || pressuredLink ? 'medium' : 'low'
  const shouldWarn = level !== 'low'
  const evidenceQuality = level === 'high' ? 'combined' : shouldWarn ? 'limited' : 'insufficient'
  const headline = level === 'high' ? 'Risky request combined with pressure: pause and verify'
    : level === 'medium' ? 'This request deserves an independent check'
    : 'No strong manipulation combination detected'
  const summary = level === 'high'
    ? 'The transcript combines a risky action with persuasion or pressure. This supports a warning, not a conclusion about the caller’s identity.'
    : level === 'medium'
      ? 'The wording includes a risky request or a coercive combination. Context is incomplete; verify before acting.'
      : 'Urgency, authority, and links can appear in genuine messages. Few signals here do not establish that the contact is safe.'
  const nextStep = riskyAction
    ? 'Pause any payment, code sharing, or device access. Verify using an official contact you find independently. You can end the call if you choose.'
    : shouldWarn
      ? 'Pause before following the request or supplied link. Verify with an official contact you find independently; you can end the call if you choose.'
      : 'This check cannot verify the caller. If unsure, check through an official contact you find independently.'
  return {
    level, headline, signals, nextStep, shouldWarn, summary, evidenceQuality,
    confidence: level === 'high' ? 'Combined wording evidence; not a fraud probability'
      : level === 'medium' ? 'Limited wording evidence; not a fraud probability'
      : 'Insufficient evidence to assess safety',
    limitations: [
      'Prototype wording rules, not a validated fraud model or identity check.',
      'Speech-recognition errors, quotations, missing context, and unfamiliar phrasing can change the result.',
      'No judgement is made from tone, accent, emotion, identity, or persistence.',
    ],
  }
}
