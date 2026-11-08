# Pharos delivery acceptance

Evidence checkpoint: November 8, 2026. Final submission is noon CST. This checklist distinguishes completed implementation from demonstrated behavior. The main developer owns integration, production changes, the canonical project log, and Git commits. The delivery lead coordinates existing owners; the judge-feedback owner maintains [JUDGE_FEEDBACK.md](JUDGE_FEEDBACK.md).

## Product that must be demonstrated

- Residents call the Pharos hotline; Beacon is the responder website. A name or resident web form is not required.
- A short, interruptible intake sends consented partial reports to a persistent case. New reports can change urgency, location, ownership review, and response estimates.
- A consenting protected-call scenario routes through Photon and LiveKit to a second test phone. Caller words are transcribed and reviewed for psychological pressure toward risky actions; the resident receives a warning during the call.
- Responders see urgency and area queues, eligible capacity, accountable ownership, and explicit status updates. Help is announced as on the way only after the response desk reports it. Arrival estimates are estimates supplied by the desk, never invented by the bot.
- Caller ID supports retrieval and prior-risk caution. It does not establish identity, prove fraud, block help, or replace analysis of current speech.

## Acceptance matrix

| Priority | Acceptance check | Current evidence | Remaining proof | Owner |
| --- | --- | --- | --- | --- |
| P0 | Real Photon help call reaches Beacon | One consenting fictional phone call completed; production overview recorded a three-person case, 16 turns, consent yes, and no transcript delivery failure. | Recheck the current shorter intake after deployment/restart; save a private capture suitable for the demo. | Main developer + `voice_runtime` |
| P0 | Phone service stays available | Root-owned worker registered after the first setup worker disappeared. | Resolve or characterize the logged end-of-call AttributeError; choose a persistent local or hosted lifecycle and verify an independent call. Do not confuse registration with continued availability. | Main developer + `voice_runtime` |
| P0 | Two-party protected call connects | Photon outbound is enabled; the user saved the one-time credential privately. TLS/SHA-256 connection metadata is verified. The outbound setup helper has six passing tests, and the scoped LiveKit outbound trunk was created without dialing. | Copy the trunk ID to the private runtime configuration, verify the fixed consenting recipient and loop guards, then connect Phone A through Photon to Phone B. Relay remains disabled until deliberately enabled. | Main developer + `outbound_setup` / `voice_runtime` |
| P0 | Warning reaches Phone B during the call | Pre-enrollment, PWA, push cryptography, evidence validation, delivery statuses, and client state tests exist. | Install/pair Phone B, grant notifications on that device, deliver a real warning before hangup, and record relevant timestamps. Provider acceptance alone is insufficient. | Main developer + notification QA |
| P0 | Evolving reports update one case safely | Existing repeat-call integration checks passed; latest snapshots and history preserve ownership, corrections, and reassessment. | Run a real callback with the same independently supplied location and fresh danger; demonstrate one stable case and a separate case for a shared-phone different-location control. | Main developer + caller/triage owners |
| P0 | Caller database is connected | `pharos-callers.ts` has 12 passing SQLite/WebCrypto tests: encrypted contacts, separate help/risk lookups, distinct-call risk counting, revocation, and expiry. | Integrate Worker encryption and transactional store mutations; retain the legacy `callerRef` for existing calls; strip all private contact fields from public output; include new expiry deadlines in alarms. | Main developer + `caller_database` + backend QA |
| P0 | Urgency and area are correct together | Current facts module has 29 passing checks after conservative flood, quotation, address/zone, and relocation improvements. Area/capacity/history integration has earlier passing coverage. | Run the complete compiled suite on the integrated revision and browser-check immediate unknown-location cases, area changes, filter selection, and assignment review. Unknown location must not imply low priority. | `triage_developer` + main developer + UI/backend QA |
| P0 | ETA is confirmed, current, and honest | UI and voice polling are implemented. ETA integration tests identified remaining contract/history/validation cases. | Close those failures; test version races, new danger, unrelated updates, expired estimates, lost approval, release/reassignment, and exact spoken server wording. No automatic arrival from time passing. | Main developer + `beacon_workflows` + `voice_runtime` + backend QA |
| P0 | Published app can be reproduced | Application chunks are committed with the configured human identity. The existing DeepSpace app was deployed and health verified. | Commit all finished chunks, run final checks, redeploy a clean tree with recoverable source lineage, verify deployed auth/assets/flows, and back up through the configured remote without force. | Main developer |
| P1 | Contextual warnings generalize beyond literal phrases | Real-model smoke: all three benign examples had no warning; three of five risky examples produced validated warnings; two risky outputs were withheld for invalid evidence. | Preserve failures, evaluate new pre-labeled examples after the current prompt is frozen, and describe the small sample honestly. No probability or validated-accuracy claim. | Context owner + independent notification QA + judge-feedback owner |
| P1 | Prior caller-ID risk produces cautious early notice | Database helper counts three distinct prior context-model-warned calls, excludes the current call, and reports `identityVerified:false` / `analysisRequired:true`. | Integrate only for the guard purpose; same-call escalation must count once. Verify withdrawal/expiry removes history and fresh analysis still runs. Never permanently label or block a person from this threshold. | Main developer + caller owner + backend QA |
| P1 | Three independent QA lanes run on source changes | Independent backend, voice, and notification/UI reviews have found and reproduced real issues. Backend QA is preparing the three-lane runner; independent voice QA is reviewing the current runtime and offline-lane safety. Neither is a running watcher yet. | Finish the runner and permanent Beacon contracts, then start it from the main session after manual integration/build. It must avoid generated files, real service calls, unchanged reruns, and competing builds. Agent review rounds rotate within the session limit. | Delivery lead + existing QA owners |
| P1 | Judge feedback becomes verified changes | Prior recommendations drove real-call work, pre-enrollment, dynamic history, unknown-location ownership, and honest evaluation. | Keep each recommendation linked to an owner, implementation, verification evidence, and disposition in `JUDGE_FEEDBACK.md`; reopen any failed acceptance gate. | `judge_feedback_loop` |
| P1 | Demo and submission claims match evidence | Initial Devpost entry exists. State Farm, T-Mobile, Photon, General/Beginner are the intended targets. | Refresh stale setup/about documents, record the help/callback and guarded-warning flows, include limitations, and finish submission before noon. Do not claim unrelated sponsor integrations. | Main developer + judge-feedback owner |

## Critical path and coordination

1. Finish ETA/store integration and the current triage patch, then run the compiled regression tests. Caller database work must preserve existing repeat-call compatibility.
2. Apply outbound configuration without dialing; finish recipient pairing and select a persistent worker lifecycle. Keep one intended dispatcher/worker route rather than silently splitting versions.
3. Verify the current intake and callback, then the two-party scam scenario and a benign urgent control. Capture actual device display and timing, not only API success.
4. Close defects with independent QA, commit task-sized changes, and deploy the clean tested source. Refresh documentation and the demonstration around the resulting behavior.

The session permits four active agents total, including the main developer. The delivery and judge leads occupy two child slots during coordination checkpoints. Development/QA owners therefore run in bounded rotations; automated test processes, once prepared and started by the main developer, can keep checking changed files while owners rotate. No checklist entry should claim seven simultaneous agents or continuous checks before those processes are actually running.

Use existing owners first. Create another subagent only for a specific critical task that lacks a suitable existing owner and cannot be completed within the current ownership boundaries. No new agent is needed merely because a slot becomes free.

The current single Photon number serves operator-selected intake and guard test modes sequentially. Demonstrate and label those modes honestly; do not claim simultaneous hotline and resident protection or arbitrary personal-number screening. A no-cost DTMF selector could be considered after the core flows pass, but a new routing path must not displace the actual resident-warning proof. A second paid number is not authorized.

Hosted Build preparation is complete but not deployed or image-tested. Its reported 10–20 second cold start exceeds the current 15-second inbound ringing timeout; a deliberate scoped timeout change and a cold-call check are required before switching. Never silently run two differently configured workers with the same dispatch name.

## Test and evidence boundaries

- Settled contextual backend/client checkpoint: **131/131** checks passed before the subsequent ETA integration. This does not establish that every current working-tree change passes.
- Latest voice owner reported **68** offline tests after progress polling integration. Verify the final combined voice suite after all source changes and before restart/deployment.
- Caller helper checks and facts checks prove those local modules; they do not prove production integration or physical phone delivery.
- The frozen 28-example literal-rule challenge set remains **TP 0, FP 2, TN 12, FN 14**. Later improvements must not overwrite that record or turn known repaired examples into independent accuracy.
- Model smoke latency is not phone-to-device latency. A private push receipt is device-reported display, not proof that a person read the warning.
- Configured response zones and responder profiles are prototype fixtures. Spoken location matching is not GPS, live flood sensing, verified responder identity, or operational dispatch.

## Spending and privacy boundaries

- Photon: one number already provisioned using **$2** existing credit; the approved total is **$5 existing credit, no cash**, with no paid-plan or SMS campaign upgrade. Calls are metered by answered rounded minutes and each PSTN leg is separate.
- LiveKit: existing Build plan with fixed free allowances; model checks are limited to **$0.25 existing inference credit**. The last reported tariff estimate was approximately **$0.00255** across nine successful billed model responses, within 18 total attempts. This is not a finalized invoice.
- Keep credentials, contact numbers, provider metadata, private warning links, and raw call content out of public screenshots, Git, task logs, and watcher output. Use consenting fictional test scenarios.
- Keep scheduled retention and withdrawal consistent across transcripts, evidence, contacts, risk records, warning access, and subscriptions. Do not promise deletion from external providers or a recipient device.

## Next coordination checkpoint

- Main developer: finish the current ETA fixes and CallerStore integration; preserve raw/private fields and the legacy repeat-call key.
- Judge-feedback owner: the 17-item ledger and six fresh pre-labeled, unscored semantic cases are prepared. Reopen its review at the next integrated or physical-demo gate; no paid holdout requests have been made.
- Backend QA: prepare the debounced three-lane watcher; launch nothing long-running from a child.
- Voice QA: complete the independent offline runtime/SDK review and check that the voice watcher lane uses dummy service credentials.
- UI QA: once the delivery lead yields a slot, promote Beacon area/urgency/history/ETA/privacy VM acceptance checks to permanent tests and verify the UI lane covers them.
- Delivery lead: yield a coordination slot for the three-QA round, then update this matrix on meaningful evidence or regressions. Hand verified completions to the judge-feedback owner; do not spend a slot on idle polling.
