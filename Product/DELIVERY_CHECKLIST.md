# Pharos delivery acceptance

Evidence checkpoint: November 8, 2026. Submission is noon CST. “Verified” below means the stated artifact/test was checked; implementation and local tests are not substituted for physical phone evidence. The main developer owns deployment, Git, and [PROJECT_LOG.md](PROJECT_LOG.md). Judge recommendations and dispositions are in [JUDGE_FEEDBACK.md](JUDGE_FEEDBACK.md); operation and recording are in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

## Current acceptance matrix

| Priority | Acceptance | Verified evidence | Remaining gate | Owner |
| --- | --- | --- | --- | --- |
| P0 | Real Photon help intake reaches Beacon | One consenting fictional call completed with 16 turns, a three-person case, and no transcript delivery failure. Deployed API still returns the retained case and pending response progress with no confirmed ETA. | Audio-check the current short opening and current voice version. The earlier post-call AttributeError remains unexplained unless a later test establishes its cause. | Main developer / voice owner |
| P0 | Reliable persistent voice | Hosted `V52ieDp6sHXp` from `c32c79e` reports Running; old local worker stopped. A 40.235-second WebRTC simulation produced first audio at 8.051 seconds, 2 caller/2 agent turns, consent yes, an urgent three-person shelter case, completed/no delivery failure, and successful disconnect/room deletion. | **Overall audio acceptance OPEN:** a later generic library remark replaced precise Northbank location, losing area. Fix/rerun pending. Do not call this a new Photon test or full pass. | Main developer / voice owner |
| P0 | Two-party protected relay | Photon outbound enabled, credential saved privately, SHA-256/TLS verified, scoped LiveKit outbound trunk created, runtime configuration copied. | Relay stays disabled until deliberately enabled. Confirm the fixed consenting Phone B, loop guards, guard dispatch, and an actual connected Phone A→Phone B call. | Main developer / phone owner |
| P0 | Phone B warning during the call | Pre-enrollment/PWA/push/evidence/review-state implementation and local client/crypto tests pass. | Install/pair Phone B, grant permission on that phone, observe a real warning before hangup, and record timing. Provider acceptance is not display proof. | Main developer / notification QA |
| P0 | Evolving caller history and encrypted contacts | Caller helper 12/12 and compiled integration 3/3 pass. Purpose-separated encrypted contacts, legacy help lookup compatibility, distinct risk calls, consent/revocation/expiry, and public field stripping are integrated. | Real same-situation callback updates one case; demonstrate safe separate handling for ambiguous/shared/different-location reports when needed. | Main developer / database owner / backend QA |
| P0 | Urgency and area together | Settled facts 29/29, backend integration, and 35 UI contracts passed; immediate unknown-location requests stay ranked. The new hosted WebRTC test exposed loss of precise area after a generic library remark. | Add the location-retention regression/fix and rerun audio, then deployed visual acceptance and a real worsening callback. Earlier green checks do not close this new bug. | Main developer / triage / UI QA |
| P0 | Honest responder ETA | Twelve compiled progress scenarios pass, including versions/races, history, fresh danger, unrelated updates, expiry, assignment/approval changes, and privacy. Voice polling/deferral/server-message contracts pass offline. | Hear the desk-entered estimate during an actual active call. No claimed case or elapsed time may become an invented dispatch/arrival. | Main developer / frontend / voice / backend QA |
| P0 | Reproducible current publish | Integrated backend deployed; health 200, unauthorized overview 401, recipient assets 200 checked. Canonical source is pushed to [AkshP08/Pharos](https://github.com/AkshP08/Pharos). Build-stamp generation is committed. | After final publish, verify served `/build.json` matches intended committed source and `dirty:false`. DeepSpace's GitHub-source metadata does not record commit lineage even from a clean tree; do not promise otherwise. | Main developer |
| P1 | Honest contextual model evaluation | Frozen fresh six-case actual-SDK check: three benign/no-warning and three risky/validated warnings, no unavailable results. Labels/hashes were fixed before inference. | Preserve the small-synthetic-sample limitation and the two earlier risky outputs withheld for invalid evidence. No population accuracy claim. | Context owner / independent QA / judge owner |
| P1 | Prior caller-ID risk caution | Three distinct prior context-model-warned guard calls trigger a separate history caution; the current call is excluded. Same-call escalation counts once. Identity stays unverified and current analysis remains required. | Physical guard validation, including clear distinction between older warning history and a new alert. Never permanently label/block a person from this threshold. | Main developer / database / QA |
| P1 | Continuous offline QA | Root-owned watcher is running; the last completed green checkpoint was: **152 backend, 76 voice, 35 UI**. Permanent Beacon/Guard contracts exist. Scheduling/filter/env self-tests and independent voice/UI reviews passed. | Keep fingerprints current after edits. Pause/wait for backend idle before manual build/deploy; a stopped/stale watcher is not ongoing monitoring. No provider/model/phone calls are in these lanes. | Main developer / QA owners |
| P1 | Feedback becomes verified work | Dedicated judge ledger has 17 owned recommendations; ETA/contact/area local gates and narrow fresh-six evaluation now have evidence. | Reopen review after hosted/audio, native ETA/callback, guard/banner/latency, and final served-source-stamp gates. | Judge-feedback owner |
| P1 | Submission and recording | Initial Devpost entry exists; four-call runbook and three-minute recording plan prepared. | Complete actual video/manual acceptance and final submission before noon; disclose remaining limitations and avoid unintegrated sponsor claims. | Main developer / team |

## Product vision that must remain intact

- Residents call for help without a name or web form. Beacon is the responder workspace; the optional PWA is only for protected-call warning setup/display.
- Partial reports and later callbacks can update urgency, location, history, assignment review, and response estimates. Absence of a report is not evidence of safety; Pharos is not continuously measuring floods.
- The contextual reviewer analyzes caller words and requested actions. It does not judge accent, tone, identity, or mental state. Urgency/official language alone must not become a scam conclusion.
- Encrypted phone history supports conservative retrieval and a separately labeled prior-risk caution. Caller ID can be spoofed; history never blocks help or replaces current analysis.
- Humans own response decisions. “On the way” and an ETA require an explicit desk report; arrival is self-reported, never inferred from time passing. Changed situations invalidate stale promises.

The one Photon number serves operator-selected intake and guard modes sequentially. Label the selected mode and do not claim concurrent service or arbitrary personal-call screening. Do not add a second paid number or new routing feature merely to make the story cleaner before the core physical demo passes.

## Critical path from this checkpoint

1. Close the precise-location retention regression and rerun hosted audio. Speech/persistence/cleanup boundaries worked in simulation, but overall acceptance failed on area. The old local worker is stopped; keep WebRTC simulation distinct from Photon proof.
2. Verify Phone B pairing/notifications and guard readiness with the consenting teammates available. The automated audio check placed no new PSTN call.
3. Run the four manual calls: short help+desk ETA, worsening callback, risky two-party guard/banner, and benign urgent guard control. Compare current alert/call timestamps when older warning history remains.
4. Verify the served source stamp after final publish, keep Git/log current, capture the actual demonstration, and update judge dispositions from evidence rather than implementation claims.

## Evaluation and spending boundaries

The original frozen 28-example literal-rule challenge remains **TP 0, FP 2, TN 12, FN 14**. Later known regressions must not overwrite it. The earlier contextual smoke validated three of five risky examples and withheld two; those failures remain open. The later fresh six results are a separate small synthetic check, not field accuracy, prompt-injection proof, or end-to-device latency.

Latest context-review evaluation record: 15 known responses across 24 attempts, including nine earlier DNS failures; estimated cumulative tariff approximately **$0.0043104**. This is not a finalized invoice or all-in voice cost. The cap remains **$0.25 existing LiveKit inference credit, no cash**.

Photon authorization remains **one number, at most $5 existing credit, no cash, no paid-plan or SMS campaign upgrade**. The number used $2; actual rounded answered-minute charges consume the test-call allowance. Each guard PSTN leg is separate. Build's fixed free allowances are not a promise of instant pickup; cold starts and current hosted health remain operational considerations.

Keep private phone numbers, credentials, enrollment links, raw call content, and provider metadata out of Git/public captures/watcher output. Scheduled retention/withdrawal covers relevant transcripts, evidence, contacts/risk records, access, and subscriptions; external provider/device copies have separate limits.

## Coordination rule

There are four active slots including the main developer. Delivery/judge checkpoints and development/QA reviews rotate; the root-owned offline watcher continues on relevant file changes independently of those agent turns. Do not claim seven simultaneous agents. Reuse owners and create another agent only for an uncovered critical task. Leads update this matrix or the judge ledger on meaningful new evidence, then yield idle coordination slots to implementation and QA.
