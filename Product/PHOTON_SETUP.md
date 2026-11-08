# Photon and LiveKit setup

Updated November 8, 2026 for the responder-only product. One earlier consenting fictional Photon intake reached Beacon. The new review/recording build requires its own acceptance; see [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

## Existing resources: update, do not duplicate

| Resource | State |
| --- | --- |
| Photon account | Existing `SignalBridge` project in the [Photon 2.0 Beta console](https://app.beta.photon.codes); stable console is a different surface. |
| Hotline | **+1 (617) 993-9206**, provisioned by the owner using $2 existing credit. Last observed wallet was $98 before later call reconciliation. |
| Inbound | Saved authenticated TLS Photon SIP destination, scoped LiveKit inbound trunk, individual dispatch to `pharos-intake`, consenting test-caller allowlist. Ring60seconds, call cap180seconds. |
| Hosted worker | Existing tracked LiveKit deployment in `voice-agent/livekit.toml`. An earlier hosted version passed synthetic speech/case/area/cleanup QA; the new review/audio image must be checked separately. Old local worker stopped. |
| Backend | Existing DeepSpace app/SQLite with selected secrets. No new storage account is needed for recordings. |
| Outbound/PWA/SMS | Outbound configuration exists from the earlier experiment; resident relay and SMS remain disabled. Phone B and resident enrollment are outside the current demo. |

The owner already completed the card, inbound, and outbound credential handoffs. Do not request them again or expose ignored credentials. Callers in the current scenario use **Phone A → Pharos → automated intake → Beacon**. The allowlist is a temporary test access/cost boundary, never a fraud feature.

## Before a coordinated test

1. Verify the existing current hosted agent is healthy, mode is `intake`, relay/browser tests are off, and no local worker competes for `pharos-intake`.
2. Verify the tested clean backend revision, auth protection, and `/build.json`. New intake needs review gating and private audio routes; older successful calls do not establish them.
3. Privately check the consenting Phone A, backend token,180-second cap, and budget. Never print phone numbers, keys, SIP passwords, or raw provider logs.
4. Use the three-call runbook: emotional genuine help, worsening callback, explicit concerning request with human decision and caller-audio playback.
5. For a recording, answer “yes” separately, then give facts after the prompt. “Transcript only” must work without recording or a fraud penalty.

Build hosting can sleep between calls; previously listed cold start was approximately10–20seconds, so the same owned trunk uses a60-second ring timeout. This is not an emergency pickup guarantee. No second number or new provider plan is authorized.

## Observed rates and authorization

Provider quotes/metering remain authoritative; these are recorded observations, not a final invoice.

| Item | Observed rate/limit |
| --- | --- |
| Photon number | $2/month until released; initial $2 used credit. |
| US/Canada voice | $0.013 per rounded answered minute, per PSTN leg. Current intake has one caller leg. |
| SMS | $0.01/part plus carrier fees; campaign eligibility separate. Disabled. |
| 10DLC campaign | $20 submission and $15/month were listed; not authorized. |
| LiveKit Build | $0 plan, fixed included1,000agent-session minutes,1,000third-partySIP minutes,$2.50inference credit were verified. No paid upgrade. |
| Gemma context review | $0.40/M input,$0.20/M cached input,$1.20/M output. Other STT/TTS/intake-model usage is separate. |

Authorization remains **one number, at most $5 total existing Photon credit, no cash, no paid-plan or SMS campaign upgrade**. Subtract the $2 number and metered tests from that cap rather than using the whole wallet. Context-model checks have a separate **$0.25 existing LiveKit credit cap**. Current recorded context tariff estimate is approximately$0.0062796 across21known responses; it is not an invoice or all-in voice cost.

Private caller-track recording uses the existing agent and encrypted SQLite chunks; no Egress service, recording API subscription, or new cloud storage is being provisioned. See [LiveKit quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/#metered-resources), [inference pricing](https://livekit.com/pricing/inference), and [hosted operation](voice-agent/HOSTED_DEPLOYMENT.md).

Claim the demonstrated Photon integration, changing State Farm coordination, and responder-facing T-Mobile content review with team-created scenarios. Do not claim arbitrary lie detection, operational emergency policy, unverified current-build phone playback, or unrelated sponsor integrations.
