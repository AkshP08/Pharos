# Pharos system plan

Updated November 8, 2026. This describes the local implementation; the latest revision still awaits production deployment and real phone testing.

## Product and deadline

Pharos combines **Flare**, a resident phone hotline, with **Beacon**, a responder website. Residents speak their request rather than complete a web form. Beacon organizes reported needs by service area and explainable urgency; humans own review, assignment, and any real-world action. The animated Pharaoh Guide answers from the loaded desk state locally.

The final HackUTD submission is due **November 8 at noon CST**; the initial Devpost entry exists. The two required demonstrations are:

1. A real consenting teammate help call → short intake/STT → changing, location-aware case → accountable responder.
2. A routed scam-call scenario → ongoing manipulation-wording analysis → timely warning on the consenting recipient's phone.

State Farm, T-Mobile Safe Signal, Photon, and General/Beginner are the intended targets. The supplied T-Mobile slide explicitly permits team-created synthetic scenarios. MongoDB Atlas and Tiger Data remain possible future integrations, not components of this build or claimed prize eligibility. Extra integrations must improve the product without displacing the phone demonstration.

## Implementation and remaining gates

| Component | Implemented locally | Still to verify |
| --- | --- | --- |
| DeepSpace Worker and SQLite Durable Object | Persistent incidents, zones, responders, consented calls, cases, reviews, warnings, audit events, and scheduled evidence expiry. Protected responder/coordinator sessions; demo mode exposes only synthetic records. | Publish this revision with server secrets and verify the hosted flows. |
| LiveKit runtime | Short intake and protected-call guard modes, deterministic consent/withdrawal, ordered retrying text delivery, caller allowlist, duration limits, and SIP-leg cleanup. Browser audio tests are explicitly labeled separately. | Photon SIP authentication save, consenting caller allowlist, agent operation, actual audio/STT, and end-to-end phone calls. |
| Changing cases | Partial cases update during consented calls. Conservative return-call linkage, latest report snapshots, timestamped history, and reassessment flags pass the local regression suite. | Verify the published browser flow and demonstrate worsening conditions over real calls without losing ownership. |
| Beacon | Area/urgency queues; eligibility by approval, availability, capability, and remaining capacity; claim, resolve/reopen, reasoned human priority changes, unknown-location follow-up ownership, and coverage-change review. | Deployed browser acceptance; real responder identity and operational incident maps are outside the prototype. |
| Pressure Trace and resident warnings | Exact wording spans, psychological explanations, benign/negated/quoted-content handling, warning escalation/deduplication, private pre-enrollment, PWA Web Push, and an optional disabled SMS adapter. | Actual phone banner during a routed call. Provider acceptance and device display are tracked separately; human reading is not inferred. |
| Photon account | The owner provisioned one US number; $2 existing credit spent, $98 wallet remains. Default SIP profile, one LiveKit inbound trunk, and dispatch rule exist. | The owner must enter the generated SIP authentication and save the prepared Photon TLS destination. SMS activation/10DLC is pending and SMS remains disabled. |

Most recent completed local verification: **93 Worker/client/domain/notification tests and 22 voice-runtime tests passed**, including repeat-case regressions. These results use fictional data and local/mocked services; they do not establish real audio, Photon routing, a delivered phone banner, or production readiness.

## Help-call flow

```text
consenting teammate calls provisioned Photon number
  → Photon SIP → LiveKit intake/STT
  → clear consent acknowledgment before transcript storage
  → ordered finalized turns to the protected Worker
  → partial case and updated urgency as caller reports arrive
  → persistent latest report, history, and separate wording review
  → Beacon area queue and accountable human owner
```

The agent asks short questions about immediate danger, current location/landmark, people, and requested help. Server rules derive facts from caller words; agent suggestions are not evidence. Corrections, uncertainty, negation, and reported scam quotations have explicit handling. Unknown location remains visible for follow-up. Location is spoken information matched to fictional configured zones, not GPS obtained from a phone call.

## Returning callers and changing conditions

Only provider-observed **SIP intake** caller numbers can support automatic linkage. The Worker derives an internal keyed lookup; raw numbers are not persisted in application records or exposed to Beacon. The lookup expires with the short transcript-retention window and is removed on withdrawal. It is a matching hint, not authenticated identity.

A callback can update an existing case only when the caller explicitly indicates the same situation, supplies a substantial exact current-location match, and there is one eligible recent open case from an ended call. Guard calls, browser calls, unknown/shared or ambiguous locations, multiple candidate cases, active overlapping reports, and resolved cases take the separate-case path. No name, case number, or special phrase is required to receive help.

The latest report supplies current facts; older transcripts are not concatenated into a timeless report. History records what changed and when. Ownership and the original case age remain visible. Fresh danger triggers reassessment; an earlier human priority decision stays auditable without silently hiding a worsening report. Absence of a new report is not evidence that a resident is safe. Pharos **re-triages when reports arrive**; it does not continuously observe water levels or independently monitor a resident.

## Urgency and coordination

| Suggested tier | Caller-reported evidence |
| --- | --- |
| Immediate | Immediate danger, trapped/no safe exit, water coming inside/upstairs, breathing difficulty, unconsciousness, or serious injury. |
| Time-sensitive | Essential medical support, powered equipment, medication, or related support need. |
| Urgent | Evacuation, transport, shelter, or essential supplies without a stated immediate life-safety threat. |
| Follow-up | Insufficient or uncertain facts; keep the request visible and clarify. |

These are transparent prototype rules, not a validated medical or dispatch standard. Human priority changes require a reason. Cases retain an accountable dispatch or follow-up owner; new area/need information flags assignments whose coverage no longer matches. Capacity is released on resolution or reassignment and is not double-counted when follow-up becomes dispatch ownership. The area selector filters the shared demo desk; it is not per-user area authorization.

## Protected-call warnings

Guard mode connects a consented incoming caller to one fixed, pre-consenting test recipient through a second SIP leg. Only incoming caller speech is transcribed. Guard calls never create help cases. Content rules explain authority, time pressure/scarcity, threats of loss, isolation, risky payments/codes, and other manipulation patterns using exact evidence. They do not infer fraud from accent, tone, distress, or urgency alone, and they never block help intake.

A signed-in responder can pre-enroll the test recipient before the call and provide a private 24-hour link to `guard.html`. That optional companion screen provides warnings, not resident help intake. Web Push requires browser/OS support, installation where required, and explicit notification permission. A normal PSTN phone cannot display LiveKit room-data messages. SMS is implemented as an optional server adapter but stays disabled until sender eligibility, credentials, and costs are approved. The current fixed demo-recipient scope is not a multi-resident account system.

Warnings distinguish app availability, provider acceptance, failure, and device-reported display. None proves the recipient read the warning or that a caller is a scammer. Advice is to pause and independently verify through an official contact.

## Consent, retention, and access

LiveKit must process audio to recognize the consent answer. Pharos stores no raw audio and accepts transcript turns only after clear consent. The agent explicitly disables its recording feature. Withdrawal stops collection, removes stored transcript/evidence/access and caller linkage, and can leave minimal previously consented help facts for human follow-up. This does not promise deletion from provider buffers or a recipient's device.

Live transcript text, quoted evidence, warning access, and caller linkage expire within the configured retention window, at most 24 hours; scheduled storage alarms perform pruning. Structured case summaries may remain. Provider-specific processing and retention still require account review. Shared responder/coordinator passwords and fictional profiles are demo safeguards, not production identity verification.

## Complete the phone demonstration

1. The owner must enter the generated SIP authentication and save the prepared Photon TLS destination. One number, default SIP profile, LiveKit inbound trunk, and dispatch rule already exist; the consenting caller allowlist is still required.
2. Keep within the authorized **$5 of existing credit and $0 out of pocket**: $2 is spent and $3 remains in the test budget. No paid-plan or SMS campaign upgrade is approved. Enable any outbound guard relay only after checking both call legs and consenting test numbers.
3. Eleven selected server secrets have been uploaded with merge semantics and apply at deployment. Publish this revision to the existing DeepSpace app; verify authentication and synthetic flows first.
4. Run fictional help and worsening-callback scripts, then a protected scam script plus benign urgent control. Capture case continuity, warning latency, and actual notification behavior.
5. Set `PHAROS_VOICE_ROUTE_READY=true` only after the real phone path passes. Keep any browser-audio fallback visibly labeled.

See [Photon setup](PHOTON_SETUP.md), [voice runtime](voice-agent/README.md), [host setup](deepspace-host/README.md), and [project log](PROJECT_LOG.md) for configuration and evidence. Official references: [Photon LiveKit cookbook](https://photon.codes/docs/beta/cookbooks/voice/livekit), [LiveKit inbound workflow](https://docs.livekit.io/telephony/accepting-calls/workflow-setup/), and [HackUTD challenges](https://zeroday.hackutd.co/).
