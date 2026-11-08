# Photon and LiveKit setup status

Updated November 8, 2026. **One real consenting fictional Photon intake has passed end to end and the backend is deployed.** A two-party protected-call warning, physical Phone B banner, and current-build spoken ETA have not yet been demonstrated. Follow [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for the remaining manual checks.

## Existing resources—do not provision duplicates

| Item | Current state |
| --- | --- |
| Photon console | [Photon2.0 Beta](https://app.beta.photon.codes), existing project `SignalBridge`, Messaging Free. The stable console is a different surface. |
| Pharos number | **+1 (617) 993-9206**. One number was provisioned by the owner using $2 existing credit. Last verified wallet: $98 before later metered call reconciliation. |
| Inbound route | Default Photon SIP profile with saved TLS destination/authentication; LiveKit number-scoped inbound trunk and individual-call dispatch to `pharos-intake`. Consenting test caller allowlist configured. Ring timeout 60 seconds; call duration cap 180 seconds. |
| Outbound route | Owner enabled Photon outbound and saved its one-time password privately. SHA-256/TLS endpoint verified; scoped LiveKit outbound trunk created. No two-phone relay call is verified yet. |
| Web backend | Existing DeepSpace app deployed with selected server secrets and VAPID configuration. Health/auth/assets checks pass; one real intake remains persisted. |
| Voice hosting | **Hosted startup: RUNNING; overall audio acceptance OPEN.** Synthetic WebRTC speech/persistence/disconnect/room deletion passed, but a later generic library remark lost the precise area. Fix/rerun pending. Old local worker stopped; no new Photon call is implied. |
| SMS | Disabled. No campaign, paid-plan upgrade, or SMS delivery is authorized or demonstrated. |

The earlier number purchase failed at the card/entitlement gate without creating a resource. The owner subsequently completed provisioning and both SIP credential handoffs. Do not ask for these steps again or expose the private credential files.

## Two test modes and phone roles

- **Photon number:** receives the routed call and exposes its audio to LiveKit.
- **Phone A:** the consenting caller. It plays a resident in help mode and the suspicious caller in guard mode.
- **Phone B:** a different consenting teammate. It receives the guard relay and uses the paired warning PWA.

Help mode is Phone A→Photon→automated intake→Beacon. Guard mode is Phone A→Photon/LiveKit→Phone B, with incoming caller text reviewed for pressure. The single number serves these modes **sequentially**; the operator switches runtime/dispatch explicitly. Do not claim concurrent service or arbitrary screening of calls to Phone B's usual number.

Only the configured test callers are admitted. That list controls temporary access and billing exposure; it is not a scam classifier. Caller contacts are encrypted with separate help/risk lookups. Returning help reports require current-location/same-situation checks; three distinct previously warned guard calls may trigger a cautious history notice while current speech analysis continues.

## Operator readiness

1. Check the current hosted version, selected mode, and location-regression rerun. Startup reports Running and the old local worker is stopped. A WebRTC test proved speech/persistence/cleanup boundaries but failed overall because precise area was lost after generic library wording. Neither that simulation nor the earlier real call establishes all current-build behavior.
2. Confirm intake/guard mode, allowed Phone A, fixed Phone B, loop guards, 180-second cap, and backend URL/token privately. Do not print test numbers or credential values. The prepared setup scripts inspect by default and must not be used to create duplicate resources.
3. For guard, confirm the outbound trunk and explicit relay/recipient-consent flags. A normal PSTN phone cannot display LiveKit room-data messages; Phone B's PWA supplies foreground/push warnings. Pair it before calling using the runbook.
4. Check deployed health/auth/assets and the current source stamp. After each publish, `/build.json` must match the intended committed source with `dirty:false`.
5. Run the four manual checks with fictional facts. Do not mark the guard/banner gate passed until the recipient device actually shows the warning before hangup. Record device display separately from provider acceptance.

LiveKit Build can cold-start free hosted agents in approximately 10–20 seconds; the scoped ring timeout was raised to 60 seconds to accommodate that. The service is still a prototype and does not promise emergency pickup or response times. Hosted startup reports Running. The current WebRTC audio test has working speech/persistence/cleanup but needs its area-retention fix and rerun before overall acceptance. See [deployment preparation](voice-agent/HOSTED_DEPLOYMENT.md) and the [official deployment guide](https://docs.livekit.io/deploy/agents/managing-deployments/#cold-start).

## Observed rates and approved credit limits

These are the observations used during this build, not a finalized invoice. Provider metering/quotes remain authoritative.

| Item | Observed rate/boundary |
| --- | --- |
| Photon number | $2/month until released; first $2 used existing credit. |
| US/Canada voice | $0.013 per rounded answered minute **per leg**; guard has two PSTN legs. |
| Optional SMS | $0.01/part plus carrier fees; campaign eligibility is separate. Disabled. |
| 10DLC campaign | $20 submission and $15/month activated campaign were listed. Not authorized. |
| LiveKit Build | $0 plan; separate 1,000 third-party SIP minutes, 1,000 agent-session minutes, and $2.50 inference credit were listed. Free included allowances are hard caps, not automatic paid overage. |
| Gemma context model | $0.40/M input, $0.20/M cached input, $1.20/M output tokens. STT/TTS and other voice usage are separate. |

The authorization is **one Photon number and at most $5 total existing Photon credit, no cash, no paid-plan/SMS campaign upgrade**. After the $2 number, up to $3 was allocated to test-call usage; subtract metered calls rather than treating the entire wallet as the budget. Do not purchase a second number to avoid the mode switch.

The separate model-check cap is **$0.25 existing LiveKit inference credit**. Latest recorded tariff estimate: approximately $0.0043104 across15 known responses and24 attempts, including 9 earlier DNS failures. This is not a billing statement or all-in voice cost. Build fixed-cap behavior is documented in [LiveKit quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/#metered-resources); model rates are in [LiveKit inference pricing](https://livekit.com/pricing/inference).

## What can be claimed

The Photon→LiveKit→speech→persistent Beacon intake integration has one real consenting fictional call as evidence. A browser/WebRTC audio simulation must be labeled as such. Local regression lanes currently pass152 backend, 76 voice, 35 UI checks; these are not phone/banner proof. The frozen fresh six-case actual-model check returned three benign and three risky validated decisions; the earlier two risky evidence-validation failures remain open. Neither set establishes population accuracy.

State Farm scope is changing needs/urgency/area/accountability; T-Mobile scope is content-grounded manipulation warnings using team-created scenarios; Photon scope is the actual routed call. Do not imply sponsor-approved emergency policy or claim unintegrated MongoDB/Tiger Data/Gemini API/Solana/Vultr tracks. The project log and judge-feedback ledger record the remaining evidence gates.
