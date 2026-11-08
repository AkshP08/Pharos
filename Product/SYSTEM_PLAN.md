# Pharos system plan

Updated 2026-11-07 9:27 PM CST

## Product shape

Pharos serves two audiences under one disaster incident:

- **Flare is voice-first.** A resident calls the Pharos line and speaks naturally; a voice agent discloses transcription, asks a few short questions, and prepares a request for human review. The website form is a fallback. The demo does not intercept someone's personal carrier calls or automatically move those calls based on location.
- **Beacon** gives responders a service-area queue. It shows reported facts, the call/transcript record, unknown details, suggested urgency, and why the system suggested it. Scam wording sits in a separate review lane so a warning never blocks a help request.
- **Pharos Guide** is a small animated Pharaoh in the corner. It answers fixed product and safety questions; it is not a general emergency-advice chatbot.

The names fit together: a **flare** is a request for attention; a **beacon** helps responders find and guide people.

## Built and connected today

| Component | Current implementation | Still needed |
| --- | --- | --- |
| DeepSpace app | Public Pharos site and Worker API. SQLite-backed Durable Object storage keeps incidents, zones, responder profiles, calls, transcript turns, cases, scam reviews, and audit events across reloads. | Deploy the current code revision and configure protected secrets before any real call data. |
| Call workbench | A synthetic transcript creates a persisted call, case, area match, urgency suggestion, responder eligibility list, and separate scam review using the same server rules as the voice path. | End-to-end Photon/LiveKit phone test. |
| Voice agent | `Product/voice-agent/agent.py` uses LiveKit Agents with LiveKit Inference STT/LLM/TTS. It sends finalized, speaker-labeled text over a bearer-protected API only after the caller agrees to transcript retention. | LiveKit project, SIP trunk/dispatch rule, agent credentials, Photon Voice line, SIP destination, and a consenting test call. |
| Location and responder routing | Spoken landmark/address or coordinates are matched against configured response zones. Eligibility checks zone, capabilities, approval, availability, and capacity. The desk can filter cases by area. | Replace fictional areas with an agreed incident map and verified local responder profiles. The prototype has one shared responder password and an optional separate coordinator password, not individual accounts. |
| Urgency and scam review | Transparent transcript rules return tier/reason and exact wording signals. Scam review is stored separately. | Sponsor guidance, evaluation, and calibration. The rules are not a validated dispatch or fraud model. |
| Photon | The developer MCP connection is authorized; the SignalBridge project has no provisioned call line or SIP route. | The Photon account owner must choose/configure a line and inspect voice-route cost/security. The $100 wallet was confirmed, but its eligibility for line/voice charges is unknown. No number was purchased. |

The public Worker is in **demo-only** mode until responder password and session secrets are configured. It masks non-synthetic records and allows only synthetic demo interactions. Live call ingest remains disabled until protected responder access and the shared bearer token are set. Demo examples are marked fictional.

## End-to-end information flow

```text
caller dials a provisioned Pharos / Photon voice line
  → Photon routes the call over SIP to LiveKit
  → LiveKit STT processes speech, including the consent response
  → agent discloses transcription and sharing; a clear yes is required
  → after yes, agent asks safety → location → requested help → useful time detail
  → finalized transcript turns are sent to /api/voice/ingest with a bearer token
  → at call end, Pharos parses facts, matches area, suggests urgency, checks wording
  → SQLite-backed storage keeps the call and the linked case/review
  → Beacon filters by service area and an eligible responder claims the case
  → a human responder owns any real-world action or dispatch
```

The agent asks for a short read-back confirmation, but the server derives structured fields from transcript facts; it does not yet accept a separate structured JSON extraction or explicit field-correction event. A caller who corrects themselves can restate the answer in the transcript. A disconnected caller may leave a partial case with unknown fields. The server does not publish an unfinished case to the queue on every utterance; it creates/updates the case when the call ends.

**Audio and consent detail:** LiveKit's speech recognizer has to process audio to recognize “yes” or “no” after the disclosure. Pharos does not store audio, and its Worker refuses to store transcript turns until the consent event is accepted. The spoken notice says transcript text is deleted after 24 hours; the operator may choose a shorter retention period. After expiry, call/case text and scam evidence snippets are scrubbed while summary fields remain. LiveKit/Photon's own transport and retention behavior must be reviewed before a real call.

## Location and service-area routing

Ordinary phone calls do not provide Pharos with reliable GPS location. The agent asks for an address or nearby landmark. The backend then:

1. extracts the caller's answer to the location question (or a location phrase in the caller's words);
2. matches an exact configured alias/ZIP, or coordinates inside a configured zone boundary;
3. records the matched zone, or places the case in **Unassigned · location follow-up**;
4. lists responders whose approved profile covers that zone, has a matching capability (or `general`), is available, and has remaining case capacity.

The desk's area filter lets a coordinator inspect each area while preserving urgency ordering inside the chosen area. Unmatched locations stay visible; they are not silently sent to an arbitrary responder. The included Trinity River zones and sample responders are fictional fixtures.

## Suggested urgency and fairness

We do not know a resident's diagnoses or full circumstances, and people may understandably describe their own case as the most urgent. The voice agent asks the same short core questions rather than asking callers to rank themselves against other households.

The current server rules behave as follows:

| Suggested order | Transcript evidence (examples) | What Beacon says |
| --- | --- | --- |
| Immediate | Explicit yes to immediate danger, or phrases such as trapped, rising water inside, cannot breathe, unconscious, serious injury. | Caller-reported life-safety concern; human must confirm and use local procedures. |
| Time-sensitive | Essential medical support such as oxygen, powered device, medication, or dialysis. | Ask about timing/resources; this is not a medical assessment. |
| Urgent | Evacuation/transport, shelter, or basic supplies, with no immediate-danger statement. | Prompt assistance suggested; responder verifies. |
| Follow-up | Too little information, uncertain safety, or location that did not match an area. | Keep visible and clarify; missing information is not low priority. |

Calls are sorted by suggested tier, with older cases first inside a tier. Responders can filter the list by zone; eligibility is calculated for that zone and need. The current UI supports claiming and follow-up; it does not implement manual priority overrides with reason capture. No tier is a medical triage standard, sponsor-approved policy, dispatch instruction, or guarantee of response.

## Scam wording review

Pharos analyzes transcript/message **content**, never tone, accent, emotionality, hesitation, volume, caller identity, or how insistently someone asks for help. The rule set looks for:

- claimed authority such as a county, relief office, police, or government agency;
- artificial deadlines and pressure to act;
- requests for payment, passwords, one-time codes, or sensitive account data;
- demands to keep the contact secret or avoid independent verification;
- links/downloads and threats of losing help or being punished.

It records matched evidence phrases. A money/code request combined with pressure gets the highest demo label; multiple weaker signals can get a review label. Urgency alone is not a scam signal. The review suggests independent verification; it cannot authenticate the sender or prove intent. It never hangs up, blocks the call, or lowers/discards a help case.

## Commission the real phone path

1. Review Photon’s official [LiveKit cookbook](https://photon.codes/docs/beta/cookbooks), confirm how to provision the chosen Voice line and connect it to a LiveKit SIP trunk, and check all number/voice usage costs. The prior user choice was to keep using simulated data, so no number is purchased by this plan.
2. Create a LiveKit Cloud project, inbound SIP trunk/dispatch rule, and `pharos-intake` agent configuration.
3. Configure server-side DeepSpace secrets: `PHAROS_RESPONDER_PASSWORD`, `PHAROS_COORDINATOR_PASSWORD`, `PHAROS_SESSION_SECRET`, and `PHAROS_INGEST_TOKEN`. Also set `LIVEKIT_URL` and `PHOTON_VOICE_LINE_ID`. Do not expose or commit them.
4. In `Product/voice-agent`, copy `.env.local.example` to `.env.local`, fill the LiveKit URL/API key/API secret, deployed Pharos URL, and matching ingest token, install with `uv sync`, then run `uv run python agent.py dev`.
5. Have a consenting teammate use a fictional script. Confirm the disclosure/consent behavior, transcript accuracy, location match/unassigned behavior, urgency evidence, case persistence, 24-hour retention setting, and no raw-audio storage. Only then set `PHAROS_VOICE_ROUTE_READY=true` for the health display.

The LiveKit agent processes speech before consent to recognize the answer. Do not test with a real resident or sensitive information. Photon and LiveKit transport/security and retention terms must be reviewed first. The selected LiveKit Inference services may use credits or incur usage fees.

## External integrations and remaining team inputs

- The current Photon SIP → LiveKit flow does not require a Photon REST API key in the Pharos web app. Photon MCP is a separate developer control connection. A Photon HTTP API credential would only be needed for a later feature that calls Photon APIs directly, such as managing messages/lines from the app.
- Request State Farm's approved urgency or assistance-coordination guidance and T-Mobile Safe Signal's allowed dataset, tactic taxonomy, baseline, and evaluation requirements. Do not assume an undocumented sponsor API exists.
- There is no live alert source or outgoing warning-call workflow. The disaster alert shown in the product is fictional. Outgoing warnings would need an authoritative source, recipient opt-in/authorization, and a separate review.
- The public demo backend uses a shared responder password and optional coordinator password. This is only suitable for a demo; before production it needs individual identity, role management, audit/recovery processes, and reviewed data/privacy policy.

## Technical references

- Photon [Photon 2.0 announcement](https://photon.codes/blog/introducing-photon-2.0), [Beta cookbooks](https://photon.codes/docs/beta/cookbooks), and [voice over SIP guide](https://photon.codes/docs/spectrum-ts/providers/voice).
- LiveKit [inbound SIP workflow](https://docs.livekit.io/telephony/accepting-calls/workflow-setup/), [voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai/), [Deepgram STT](https://docs.livekit.io/agents/models/stt/deepgram/), and [transcript text](https://docs.livekit.io/agents/multimodality/text/).
- DeepSpace [project structure](https://docs.deep.space/get-started/project-structure), [deployment](https://docs.deep.space/concepts/deployment), and SQLite Durable Object storage through its Worker-compatible runtime.
- HackUTD official [challenge page](https://zeroday.hackutd.co/).
