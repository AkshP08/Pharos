# Pharos delivery acceptance

Updated for the user's responder-only pivot on November 8, 2026. Submission is noon CST. [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) defines the actual phone scenarios; [JUDGE_FEEDBACK.md](JUDGE_FEEDBACK.md) tracks critique and [PROJECT_LOG.md](PROJECT_LOG.md) records implementation/failures. Passing a helper test is not full-flow proof.

## Required product gates

| Gate | Implemented behavior | Required proof |
| --- | --- | --- |
| Current real hotline | Photon → hosted LiveKit → consented transcript → SQLite → Beacon. One earlier real intake succeeded. | New-build real call, short audio-aware opening, no duplicate worker, no unbounded or stranded phone legs. |
| Genuine help | No supported concern permits normal urgency/area workflow. Fear, confusion, and urgent rescue alone do not flag fraud. | Frightened genuine caller reaches correct queue and eligible assignment after completed review. |
| Human review | Same ranked queue, independent badge/evidence; pending/uncertain/unavailable/flagged/dismissed cannot claim or publish ETA. | Server tests plus actual UI/API bypass attempt, exact current source/version, reasoned accept/dismiss audit. |
| Concerning request | Explicit unsafe action with pressure, or explicit current false-report admission plus diversion, requires verification. | Exact quotes, no automatic truth/identity accusation, request remains visible, human decides. |
| Changing reports | Fresh facts and conservative callbacks update one eligible case without erasing history/ownership. | Real worsening callback preserves case/area, raises urgency, and invalidates stale ETA. |
| Private recording | Acknowledged recording consent; transcript-only option; caller-only bounded PCM; encrypted storage and authenticated WAV. | Current RTC/phone capture → uploaded recording → manual Beacon playback; no pre-consent/bot audio, no autoplay, logout/case-change cleanup. |
| Recording privacy | Source-scoped retention at most 24h; clear completed calls discard audio; withdrawal/expiry removes access and evidence. | Compiled authorization/retention/replay tests, exact historical evidence source, stale-review rejection after evidence deletion. |
| Honest progress | Eligible accepted case + explicit desk-reported state/ETA, never inferred dispatch/arrival. | Spoken update during real call; held or changed cases cannot retain misleading reassurance. |
| Release | Tested chunks committed and pushed with human identity; Vite refreshes maintained assets/stamp on direct deploy. | Clean deployment, served build.json matches intended SHA/dirty:false, auth and current UI verified. |
| Submission | Initial Devpost entry exists; relevant State Farm/T-Mobile/Photon/General/Beginner story. | Three-minute truthful video, canonical source/app/video links, final submission before noon. |

## Current verification boundaries

- Pre-pivot evidence includes one real Photon intake and one passing hosted synthetic WebRTC rerun after fixing a specific→generic location overwrite.
- The responder-context six-case evaluation returned six matching warning decisions and one expected tactic-category mismatch. It is not field accuracy or genuine-emergency verification.
- New offline voice, backend, audio/crypto, and Beacon tests must pass together on the final source. Use `node Product/qa-watch.mjs --status`; old counts/fingerprints are historical after edits.
- Three QA specialties rotate within the four-agent limit while independent watcher lanes check changed source. Pause/wait for the backend lane to be inactive before manual builds/deployments.
- Current-build real callback, actual spoken ETA, and captured caller-audio playback remain manual gates until observed. Do not substitute pasted transcripts or WebRTC and label them Photon calls.

## Scope and spending

Resident warning enrollment/PWA/push/SMS and two-party relay are **future work by explicit user decision**, not current delivery gates. Relay and SMS remain disabled. No second number or new recording/storage service is needed.

Existing limits: one Photon number, at most $5 existing credit/no cash/no paid upgrade or SMS campaign; at most $0.25 existing LiveKit model-check credit. Context tariff estimate is approximately $0.0062796 after 21 known responses, not an invoice or total voice cost. Keep credentials, private phone numbers, raw call content, and provider metadata out of Git/public captures.

Shared access, configured responder profiles/areas, caller-reported facts, and short synthetic evaluations remain prototype limits. MongoDB Atlas and other unintegrated sponsor APIs must not be claimed. Human playback does not turn tone or pacing into a scientifically validated lie detector.
