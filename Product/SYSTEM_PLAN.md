# Pharos system plan

Updated November 8, 2026 after the user's responder-only pivot. Final submission is noon CST. [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) defines the current three-call acceptance, and [PROJECT_LOG.md](PROJECT_LOG.md) preserves the previous architecture and failures.

## Product contract

Residents call the automated **Pharos hotline**; **Beacon** is entirely responder-facing. A name or resident web form is not required. The same urgency/area queue contains every request, including suspicious or incomplete reports. Reported danger is independent of verification state.

```text
Caller → Photon SIP → LiveKit intake/STT
  → consented ordered transcript → protected Worker/SQLite
  ├─ current facts → urgency + area + responder eligibility
  └─ caller-text review → clear / pending / needs human review
  → Beacon: evidence + optional consented caller audio + reasoned human decision
  → eligible assignment → explicit desk progress/ETA → server-authored voice update
```

`integrityReview` is a separate axis from priority. Pending, uncertain, failed, unavailable, flagged, and dismissed cases cannot receive normal assignment or an ETA until a human explicitly accepts the current evidence. They retain their reported urgency, area, and danger facts. A verification/follow-up owner can still clarify the report. “Clear” means no supported concern in reviewed words; it never verifies identity or physical truth.

Human acceptance/dismissal requires a meaningful reason and exact review version, source call, and source sequence. Server-side gates enforce this even if the client is bypassed. Decisions are audited; dismissal retains the case and history. Later supported concerns can reopen review and invalidate travel reassurance while preserving accountable ownership. Stale or late model results cannot override a same-version human decision; a benign result cannot automatically erase an established concern.

## Evolving cases, urgency, and area

Consented partial reports create/update cases before hangup. Each report supplies current facts instead of concatenating old transcripts into a timeless situation. New danger can increase urgency above an earlier human downgrade; corrections, location changes, and coverage changes remain auditable. Pharos re-triages when new reports arrive, not through continuous flood measurement.

| Suggested tier | Reported evidence |
| --- | --- |
| Immediate | Explicit life-safety danger, trapped/no safe exit, or dangerous indoor/upstairs flooding. |
| Time-sensitive | Essential powered-equipment, medical, or medication support without stronger explicit danger. |
| Urgent | Shelter, evacuation, transport, or supplies without stated immediate danger. |
| Follow-up | Missing or uncertain facts; keep visible and clarify. |

These are transparent prototype suggestions, not validated clinical triage. Unknown location never means low danger. Spoken landmarks/addresses/zones match configured demonstration areas; this is not GPS or live flood sensing. Approved coverage, capability, availability, and capacity determine normal assignment eligibility.

Encrypted phone contacts and keyed lookup support conservative repeat retrieval. Linking requires fresh consent, explicit same-situation intent, an independently supplied substantial location match, one eligible recent open case, and an ended prior report. Shared/ambiguous/different locations, active parallel calls, closed or dismissed cases, and expired/revoked history do not silently merge. Caller ID can be spoofed and never proves identity. A later generic reference such as “at the library” preserves the earlier named library/zone; explicit relocation and correction remain separate.

## Contextual verification and psychology

The model receives consented caller text, never phone number, raw audio, voice tone, accent, or inferred mental state. Exact caller-only quotations are checked against the supplied text; the server supplies known explanations. One request is in flight, latest snapshots coalesce, each call has a finite request limit, serialized input is at most 15 KB, output at most 800 tokens, timeout 8 seconds, and there are no model tools or retries. Withdrawal/end cancel outstanding work; unreviewed final speech becomes unavailable/human review rather than silently clear.

Two distinct supported bases can require human verification:

1. **Pressure toward a concrete unsafe action.** Examples: transferring relief funds, sharing secrets/device control, or explicitly bypassing independent safety/verification checks under coercion. Urgency, authority, scarcity, reciprocity, prior commitment, guilt, social proof, or threats matter only in context of that request. At least two distinct supported kinds and exact evidence are required.
2. **Explicit false-report admission plus resource diversion.** The caller explicitly states the current report was fabricated and asks resources to serve that stated non-emergency purpose. This is a separate verification concern, not automatically a psychological-pressure tactic or proof of real-world facts.

Ordinary rescue urgency, fear, anger, confusion, missing names, changed counts/locations, corrections, or unlikely circumstances cannot establish fabrication. Quoted threats, victim reports, training examples, negations, and rejected demands must not be attributed as active requests. Uncertain interpretation remains human review; it is not a fraud accusation.

Research grounding, with bounded interpretations:

- [FTC: How To Avoid a Scam](https://consumer.ftc.gov/articles/how-avoid-scam) describes impersonated authority, immediate-action pressure, threats, and risky payment requests. It grounds examples and independent-verification advice, not classifier accuracy.
- [FTC: FEMA impersonators](https://consumer.ftc.gov/consumer-alerts/2025/07/spot-avoid-fema-impersonators) supports the narrow fact that FEMA does not charge for its disaster assistance/inspections; it does not imply every disaster-related fee is fraud.
- [Vrij, Hartwig and Granhag: Reading Lies](https://doi.org/10.1146/annurev-psych-010418-103135) reviews weak/unreliable behavioral deception cues. Human playback supplies context; Pharos does not derive a lie score from tone or pacing.
- [Khadka, Ullah and Marroquin: Unmasking persuasion in phishing](https://doi.org/10.1108/ICS-12-2024-0321) qualitatively examines persuasion in selected phishing emails. Its categories inspire explanations; email findings do not validate disaster-call detection or probabilities.
- [FBI: False emergency calls have consequences](https://www.fbi.gov/news/stories/the-crime-of-swatting-fake-9-1-1-calls-have-real-consequences1) establishes that deliberately false reports can divert responders and cause harm. It does not establish that transcript interpretation can detect arbitrary fabricated emergencies.

## Human review audio, consent, and retention

The brief opening discloses transcript and caller-audio sharing and offers **transcript only**. Audio capture starts only after recording consent is acknowledged; no pre-consent raw recording is retained. If consent and facts are spoken in one utterance, the audio of that utterance may be absent. For a recorded demo, consent separately before giving facts.

Caller-only 16 kHz mono PCM16 is bounded to 180 seconds/5,760,000 bytes. The agent uses memory, not a microphone, local recording file, Egress service, or new provider account. Up to 88 ordered 64 KiB chunks are encrypted with AES-GCM and purpose/call/sequence binding in existing SQLite storage. Retries are immutable and cannot extend retention. The complete recording is served as WAV only to authenticated responders, without URL credentials, preloading, or autoplay. The UI clears playback and revokes blob URLs on case change/logout and rejects late responses.

Active/pending audio remains private until a final decision. Completed clear-call audio is discarded. Retained concern/review evidence expires no later than 24 hours from the source call and is removed on consent withdrawal. Missing or failed audio does not imply dishonesty or declined consent. Provider processing and recipient browser memory have separate limits; there is no claim of deleting external provider copies.

## Response progress

A claimed case is not dispatched help. An eligible accepted case's desk explicitly reports On the way, Delayed, Arrived, or Unable. Travel/delay requires an entered 1–180 minute estimate and the current case version. Fresh danger, location, coverage, or integrity concerns can invalidate progress. Time passing never implies arrival. During an active intake, private polling speaks only server-authored current messages and defers while someone is speaking.

## Validation, release, and scope

One prior real Photon intake reached Beacon. The later hosted synthetic audio rerun passed speech, consent, case facts, corrected area retention, completion, and cleanup; it was WebRTC simulation, not a new phone call. The responder-review/audio changes require their own compiled/backend, offline voice, browser, and current-build phone acceptance. Use `node Product/qa-watch.mjs --status` for current fingerprints; old green counts do not prove changed code.

The original literal detector's frozen 28-case result remains TP 0, FP 2, TN 12, FN 14. Earlier guard-context failures and small six-case results remain separate. The new frozen responder six-case check returned six matching warning decisions, with one expected category mismatch (`financial_control` instead of `money_or_secret`). Preserve that mismatch; neither set establishes field accuracy or real-world truth verification.

Current context-model tariff estimate is about $0.0062796 after 21 known responses, not a finalized invoice or total voice cost. Approved limits remain $0.25 existing LiveKit model-check credit and one Photon number/up to $5 existing credit/no cash/no upgrade. Shared passwords, fixture responders/areas, and human status reports are prototype limitations. MongoDB Atlas, Tiger Data, Gemini API, Solana, and Vultr are not integrated.

Source is pushed to [AkshP08/Pharos](https://github.com/AkshP08/Pharos). Final publication must serve `/build.json` matching the clean tested commit. DeepSpace calls Vite directly, so maintained asset sync/source-stamp generation also runs from Vite configuration. Its GitHub-source metadata omits native commit lineage; do not claim otherwise.

**Future work, explicitly outside the core demo:** resident scam-warning PWA/push/SMS and protected two-party relay. Older experimental files remain for future work, but relay and SMS are disabled and resident enrollment is removed from Beacon. Current targets are State Farm, T-Mobile Safe Signal, Photon, and General/Beginner, with team-created scenarios as permitted by the supplied challenge.
