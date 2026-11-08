# Photon setup for Pharos

Updated 2026-11-07 9:27 PM CST

## Chosen integration

Pharos uses Photon for the **phone route**. The intended live flow is:

```text
Photon Voice line → SIP → LiveKit voice agent/STT → consented transcript → Pharos Worker → Beacon
```

The Pharos Worker, persistent store, call/session model, transcript analysis, area/urgency routing, and Python LiveKit agent are now implemented. Photon does not hand a phone transcript to the app simply because “Voice” was selected in onboarding. The Photon Voice line and its SIP route to LiveKit must still be provisioned and tested.

The app does not need a Photon REST API key for this specific SIP route. Photon MCP is connected to Codex as a developer control-plane tool; it does not stream the call into the website. A Photon API key would be needed only if a future feature makes direct HTTP API calls from Pharos.

## Current Photon project status

- The `SignalBridge` project exists in the connected Photon organization and is on the **Messaging Free** plan. The $0 base-fee period was reported through Dec 7, 2026.
- The organization wallet showed **$100.00 USD available**. The billing check did not confirm whether the credit covers a voice line, SIP, or usage charges.
- The project has no provisioned number/resource and no voice/SIP route. No number has been purchased. The user's earlier decision was to keep using simulated data; that choice remains in force unless changed.
- Photon listed $2 pay-in-advance for a US local number; carrier/usage costs may be separate. Check exact voice pricing and wallet eligibility in the dashboard before the owner decides to provision a line.
- Photon MCP OAuth is connected for developer-side project/billing operations. No credentials or tokens are stored in this repository.

## Set up a consenting synthetic call

1. In Photon, open the existing SignalBridge project and follow Photon 2.0's [LiveKit cookbook](https://photon.codes/docs/beta/cookbooks). Confirm the Voice line type, inbound SIP routing, number/line requirement, transport security, and total charges before provisioning anything.
2. In LiveKit Cloud, create the project and inbound SIP trunk/dispatch rule that sends the Photon call to an agent named `pharos-intake`.
3. Configure these secrets/variables in the DeepSpace Worker:
   - `PHAROS_RESPONDER_PASSWORD`
   - `PHAROS_COORDINATOR_PASSWORD` (separate password for approving new responder profiles)
   - `PHAROS_SESSION_SECRET` (long random signing secret)
   - `PHAROS_INGEST_TOKEN` (random bearer token shared only with the agent)
   - `LIVEKIT_URL`
   - `PHOTON_VOICE_LINE_ID`
   - `PHAROS_VOICE_ROUTE_READY=true` only after successful end-to-end testing
4. In `Product/voice-agent`, copy `.env.local.example` to `.env.local` and fill in the LiveKit URL/API key/API secret, the deployed Pharos URL, and the same `PHAROS_INGEST_TOKEN`. Keep `.env.local` private and untracked.
5. Run `uv sync` and `uv run python agent.py dev`. Call the test number from a consenting teammate using only a fictional script.
6. Confirm the voice disclosure and consent flow, transcript accuracy, area matching, suggested urgency/reason, persistent call/case display, and expiry behavior. Do not call the system live until these pass.

**Consent detail:** LiveKit's speech recognition must process the caller's audio to understand their yes/no answer after the spoken disclosure. Pharos does not write transcript turns to its database until the caller clearly says yes; it does not store raw audio. The LiveKit/Photon services still process call media, so review their security/retention terms and use fictional content for this prototype.

## Why automatic personal-call transfer is not part of this build

Pharos can track and analyze a call only after the caller dials a number routed to the Pharos/Photon line. The website cannot see a person's cellular location or intercept/redirect their normal carrier calls. Automatically routing ordinary calls based on affected-area location requires separate carrier/phone operating-system integration. Native call screening APIs also do not provide a general website with a live transcript from arbitrary personal calls.

For the demo, the caller dials the Pharos test line directly. The voice agent asks for a location or landmark and the backend matches it to configured response areas. If it cannot match the location, the case stays unassigned and flagged for follow-up.

## Sponsor challenge alignment

- **Photon:** phone-call experience and routing through Photon Voice/SIP into a voice agent. The current code is ready for integration but has no live Photon route yet.
- **State Farm:** help-request processing, explainable urgency suggestions, area/capability matching, case claim, and human-owned response. Confirm the challenge's specific criteria and do not call the current rules sponsor-approved.
- **T-Mobile Safe Signal:** transcript/message content checks for specific pressure tactics, with phrase evidence and a verification action. Do not call a sender a scammer; a content pattern cannot prove identity or intent. Request the sponsor's approved dataset, taxonomy, baseline, and evaluation requirements before making performance claims.

## Other channels and credits

- **SMS** can be a supporting message/report path later; no line or runtime messaging integration is currently set up.
- **iMessage** is optional and overlaps with SMS for the first demo.
- **WhatsApp** adds Meta Business API setup and is out of initial scope unless the target users/challenge require it.
- **Hugging Face $10 credit** is not required for this build because LiveKit Inference is selected for STT/LLM/TTS. The HackUTD claim link is private and must come from HARP/organizers if the team later wants to try it.
- Do not sign up for, provision, or use a paid route without the project owner reviewing the terms and costs.

## Official references

- [Photon 2.0 announcement](https://photon.codes/blog/introducing-photon-2.0)
- [Photon Beta cookbooks](https://photon.codes/docs/beta/cookbooks)
- [Photon Spectrum voice over SIP](https://photon.codes/docs/spectrum-ts/providers/voice)
- [LiveKit inbound SIP workflow](https://docs.livekit.io/telephony/accepting-calls/workflow-setup/)
- [LiveKit voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai/)
- [LiveKit Deepgram STT integration](https://docs.livekit.io/agents/models/stt/deepgram/)
- [LiveKit transcript text](https://docs.livekit.io/agents/multimodality/text/)
