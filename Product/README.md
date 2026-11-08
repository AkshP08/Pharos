# Pharos

Pharos has two connected parts: **Flare**, a voice-first way for a person to report a disaster-related need, and **Beacon**, a responder desk that organizes those requests by service area and explainable urgency. Suspicious wording is reviewed in a separate lane so a scam warning never blocks a help request.

The deployed prototype now has a persistent backend. A synthetic transcript can create a tracked call, a help case, an area match, a suggested urgency tier, a responder eligibility list, and a separate scam review. The same server-side analysis runs after a consented Photon → LiveKit call transcript arrives. The public demo is still synthetic-only because the phone route and protected responder credentials have not been configured.

## Run the demo

Open [the live Pharos demo](https://signalbridge-hackutd-2026.app.space) or open `index.html` for a static visual preview. The interactive backend features require the deployed Worker or local DeepSpace runtime; opening the file directly cannot reach the API.

In Beacon, use **Run a synthetic call through the backend** to submit a fictional transcript. The server stores it in SQLite-backed Durable Object storage and returns the resulting call/case. The result includes the matched response area, suggested queue tier and reason, location gaps, eligible responders, and any exact scam-wording signals. Refresh the page to see persisted records. Synthetic data is clearly labelled and can be reset without deleting real records.

## System flow

```text
Photon Voice line
  → SIP route into LiveKit
  → LiveKit voice agent (STT + LLM conversation + TTS spoken intake)
  → consented text turns to the protected Pharos Worker API
  → persistent SQLite-backed call, transcript, case, and review records
  → Beacon filters by service area and shows suggested urgency
  → an eligible responder claims the case; a human owns dispatch
```

The voice agent discloses speech recognition and transcript sharing before it starts the intake. LiveKit speech recognition must process audio to recognize the caller's consent; Pharos does not persist transcript text until a clear yes is received. Raw audio is not written to Pharos storage. After consent, the agent asks about immediate danger, location, requested help, and useful time-sensitive details. At call end, the server analyzes the transcript and creates the case. A caller who disconnects early still produces a partial record with unknown fields where possible.

## What the backend does

- **Tracks call sessions:** random Pharos call ID, state, consent status, timestamps, transcript source, and linked case. LiveKit room names, phone numbers, and raw audio are not stored by this prototype.
- **Transcribes voice:** the Python LiveKit agent uses LiveKit Inference for speech-to-text, conversation, and speech output. It posts finalized text turns to `/api/voice/ingest`; the Worker never receives audio.
- **Matches location:** it uses caller-spoken address/landmark, configured alias/ZIP, or coordinates against configured response zones. An unmatched location stays visible as unassigned and requires follow-up. The included zones are fictional test data.
- **Suggests urgency transparently:** explicit life-safety phrases or a yes to immediate danger suggest `immediate`; an essential medical/powered-device need suggests `time-sensitive`; evacuation, shelter, or supplies suggest `urgent`; insufficient information suggests `follow-up`. Missing or uncertain details are not treated as low need. This is a prototype rule set, not a validated emergency triage standard.
- **Routes by service area and capability:** responders register zones, skills, availability, and current capacity. Only approved, available responders who cover that zone and need are listed as eligible. The desk filters the queue by area; responders claim cases, and assignment capacity is persisted.
- **Reviews suspicious content separately:** wording rules show matched phrases about authority, pressure, money/codes, secrecy, links, or threats. A possible-scam score cannot authenticate a sender, prove intent, hang up a call, or reduce the help case's priority.
- **Protects live data:** demo mode only returns synthetic records. Live mode requires server-side responder/session secrets and a separate bearer token for voice ingestion. Coordinator approval uses a separate password. Live transcript text is scrubbed within 24 hours (the operator may choose a shorter period); the user can still see the case summary and non-transcript fields after expiry.

## Connect a real call

1. Configure a Photon Voice line and route inbound SIP calls to the LiveKit SIP destination using Photon’s [LiveKit cookbook](https://photon.codes/docs/beta/cookbooks). No number has been purchased: the team previously chose to keep using simulated data. The Photon account has $100 of credits, but credit eligibility for a voice line/usage has not been confirmed.
2. Create a LiveKit Cloud project and configure its SIP inbound trunk/dispatch rule to launch the `pharos-intake` agent.
3. Copy `Product/voice-agent/.env.local.example` to `.env.local` and fill in LiveKit credentials, the deployed app URL, and the same random ingest token used by the Worker. Keep the file private.
4. Configure DeepSpace secrets: `PHAROS_RESPONDER_PASSWORD`, `PHAROS_COORDINATOR_PASSWORD`, `PHAROS_SESSION_SECRET`, and `PHAROS_INGEST_TOKEN`. Use strong, separate random values. Add `LIVEKIT_URL` and `PHOTON_VOICE_LINE_ID` as server variables. Do not set `PHAROS_VOICE_ROUTE_READY=true` until a consenting synthetic test call has passed end to end.
5. From `Product/voice-agent`, install with `uv sync`, start with `uv run python agent.py dev`, and place a fictional test call from a consenting teammate. Check transcript quality, location routing, urgency evidence, consent, and call completion before using the demo in a pitch.

The LiveKit model calls need a LiveKit Cloud account and may consume its inference/telephony credits or incur usage charges. No real resident data should be used for this hackathon prototype.

## Important boundaries

- The current app cannot automatically intercept or transfer ordinary calls on someone's personal phone based on their location. A call is trackable only after it reaches the configured Pharos/Photon line. Native call screening or carrier-based routing would require separate OS/carrier integration.
- A website cannot infer someone's location from a phone call. Pharos asks for a spoken landmark/address and matches it to configured areas; later, a trusted location provider could be added with explicit permission.
- The queue is not a medical or emergency dispatch system. It does not send responders, offer live warnings, or promise assistance.
- The single shared responder/coordinator passwords are for a demo, not a production identity system. Do not expose real emergency information through this prototype.
- The Photon MCP connection is for developer-side Photon operations. The public app does not need a Photon API key for the current SIP → LiveKit route; it does need a provisioned Photon line and configured SIP destination.

## Project files

- `index.html`, `styles.css`, `app.js` — Pharos Flare/Beacon interface, call workbench, scam review, and animated guide.
- `deepspace-host/worker.ts` — authenticated API routes and live voice-ingest endpoint.
- `deepspace-host/pharos-domain.ts` — transcript parsing, urgency/location routing, responder eligibility, and scam wording rules.
- `deepspace-host/pharos-store.ts` — SQLite-backed persistent records, retention, and audit events.
- `voice-agent/agent.py` — Photon SIP → LiveKit voice agent and consent-gated transcript delivery.
- `SYSTEM_PLAN.md` — product and triage decisions, implementation status, and boundaries.
- `PHOTON_SETUP.md` — Photon project status and line setup notes.
- `PROJECT_LOG.md` — timestamped implementation, obstacles, decisions, and screenshot checkpoints.
