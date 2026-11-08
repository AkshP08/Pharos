# Photon setup for Pharos

Updated November 8, 2026. No actual Photon call or resident phone banner is verified yet.

## Integration and current account gate

```text
Photon number → SIP → LiveKit intake/STT → consented text → Pharos Worker → Beacon
Photon protected call → consent → fixed test-phone relay → pressure evidence → private warning PWA
```

The local implementation includes the intake/guard runtime, persistent partial cases, conservative returning-caller linkage, during-call pressure analysis, recipient pre-enrollment, Web Push, and an optional disabled Photon SMS adapter. The current revision still awaits production deployment. A development MCP connection does not carry call audio or constitute the product integration.

- Correct Photon 2.0 console: [Beta dashboard](https://app.beta.photon.codes). The stable dashboard is a different surface and initially showed different projects.
- Existing Beta project: `SignalBridge`, on Messaging Free. The owner provisioned **+1 (617) 993-9206** (`pho_res_01m6wx9yt0eh7v7afn2chrc96t`). The $2 number charge used existing credit; wallet balance is **$98**, leaving **$3** of the authorized $5 test budget.
- The number renews at **$2/month until released**. The owner authorized one US number and up to **$5 total existing credit**, with **no out-of-pocket charge, paid plan, or SMS campaign upgrade**. SMS activation and 10DLC remain pending; SMS is not allowed/enabled.
- An earlier automated purchase returned `402 ENTITLEMENT_REQUIRED` and the Beta UI exposed a card gate. The owner subsequently completed number provisioning. That earlier failed attempt did not create the number.
- LiveKit authentication succeeded. A default Photon SIP profile, inbound trunk `ST_woG6x8w9CBQY`, and dispatch rule `SDR_RbC59XSmabTo` for `pharos-intake` now exist. The Photon TLS destination form is prepared; the owner must enter the generated SIP authentication and save it. The consenting caller allowlist is still pending. No outbound guard trunk or actual audio/STT call is verified.

## Finish the help-call route

1. Finish the owner-only credential handoff: enter the generated SIP authentication and save the prepared Photon TLS destination. The number, default Voice profile, inbound trunk, and intake dispatch already exist; do not provision duplicates.
2. Check the saved route against the current [Photon LiveKit cookbook](https://photon.codes/docs/beta/cookbooks/voice/livekit), including compatible transport/security settings. A configured route is not proof that a call works.
3. Eleven selected app secrets have been uploaded with merge semantics and apply at deployment. They include protected responder/coordinator access, session/ingest values, LiveKit/route settings, and VAPID configuration; unrelated platform secrets were not replaced. Keep `PHAROS_VOICE_ROUTE_READY=false` until the real path passes.
4. Fill the ignored `voice-agent/.env.local` in place; do not overwrite existing credentials. Set the deployed app URL/shared ingest token and `PHAROS_TEST_CALLER_NUMBERS` to consenting teammates' E.164 numbers. Keep all credentials and test numbers out of Git and logs.
5. Install/run using [the voice runtime instructions](voice-agent/README.md). The runtime enforces an incoming caller allowlist and an admission-time duration cap (180 seconds by default). These safeguards are not a provider-level spend ceiling.
6. Test disclosure, decline, clear consent, partial updates before hang-up, location matching, disconnect/cleanup, persistence, and a worsening callback. Same-number linkage is a short-lived keyed hint plus explicit same-situation/current-location checks, not identity verification. Use fictional facts only.
7. Verify the published responder flow, then mark route-ready only after an actual Photon call succeeds end to end.

LiveKit STT processes audio to recognize the consent choice. Pharos stores text only after consent, stores no raw audio, and explicitly disables agent recording. Withdrawal stops collection and requests evidence/access/linkage scrubbing; minimal prior help facts may remain. Provider transport/model processing and retention still apply.

## Protected-call warning test

Guard mode is implemented but disabled until configured. It requires a separate fixed consenting test recipient, an outbound SIP trunk, explicit relay/recipient-consent flags, and review of both call legs' costs. Incoming caller consent precedes dialing the recipient. Guard calls never become help cases, and only incoming caller audio is transcribed.

Before calling, a signed-in responder uses **Enroll a test phone** to obtain the private 24-hour recipient link. Open/install the warning PWA on that phone and explicitly enable notifications. Installation and background-push support depend on the browser/OS. The private link is a credential: do not put it in logs, screenshots, or the submission. The current enrollment is a fixed demo-recipient scope, not a multi-user resident directory.

A normal PSTN phone cannot display LiveKit room-data warnings. The Web Push adapter supplies the phone-notification path; the foreground PWA also polls for warnings. Configure server-only `PHAROS_VAPID_PUBLIC_KEY`, `PHAROS_VAPID_PRIVATE_KEY`, and `PHAROS_VAPID_SUBJECT`. No actual banner is confirmed yet. Provider acceptance, device-reported display, and a person reading a warning are different events.

Optional SMS requires `PHAROS_SMS_ENABLED=true`, Photon project/API credentials, an eligible sender, and a fixed opted-in test recipient. It remains disabled. SMS registration/eligibility is unresolved and the owner has not approved a campaign upgrade. The SIP-only path does not require a Photon REST key in the web app; this SMS adapter does.

## Observed prices and spending boundary

These are the account/documentation observations made for this session, not a promise of an all-in bill. Recheck the specific quote before a charge.

| Item | Observed price | Detail |
| --- | --- | --- |
| Messaging Free | $0 base fee | Resources and usage are separate. |
| One US number | $2/month | Provisioned using $2 credit; $98 wallet remains; recurring until released. |
| US/Canada voice | $0.013 per billed minute per leg | Answered calls round up to a whole minute; a two-phone relay has two legs. |
| SMS | $0.01 per part plus carrier fees | Sender/campaign eligibility still unresolved. |
| 10DLC campaign | $20 submission; $15/month activated campaign | Not approved for this build. |
| LiveKit Build | Listed $0/month; 1,000 SIP minutes, 1,000 hosted-agent minutes, $2.50 inference credit | Separate allowances; account billing/overage behavior still needs checking. No paid upgrade selected. |

The approved cap is **$5 existing Photon credit and $0 cash**; **$2 is spent and $3 remains in that test budget**. Model/STT/TTS charges consume separate LiveKit allowances or credits. Do not assume an account credit makes every service or renewal free. The authoritative pricing/account checks and failed provisioning attempt belong in `PROJECT_LOG.md`.

## Demo claims and sponsor scope

Local verification passed **93 Worker/client/domain/notification tests and 22 voice-runtime tests**, including repeat-case regressions. These do not establish actual audio, phone routing, or a delivered notification. Production deployment is still pending.

- **Photon:** claim the real call integration only after the provisioned route is tested. Browser-audio tests stay labeled as browser tests.
- **State Farm:** changing reported urgency, area/capability matching, accountable ownership, and visible unknown-location follow-up; rules are not sponsor-approved dispatch policy.
- **T-Mobile:** team-created synthetic scenarios, exact psychological-pressure evidence, clear verification action, and a recipient-facing warning. Curated regression success is not independently measured real-world detection accuracy.
- **Other tracks:** MongoDB Atlas, Tiger Data, Gemini API, Solana, and Vultr are not integrated or claimed. Extra channels and vendor sign-ups are outside the immediate demonstration.

Pharos sees only calls deliberately routed through its number; it cannot intercept arbitrary personal calls or derive GPS from a phone number. Ordinary help calls remain phone-only; the optional PWA is for warning setup and display.

Official references: [Photon Beta cookbooks](https://photon.codes/docs/beta/cookbooks), [Photon billing](https://photon.codes/docs/beta/billing), [LiveKit inbound workflow](https://docs.livekit.io/telephony/accepting-calls/workflow-setup/), [voice quickstart](https://docs.livekit.io/agents/start/voice-ai/), and [LiveKit pricing](https://livekit.com/pricing).
