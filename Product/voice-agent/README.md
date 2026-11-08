# Pharos Photon voice agent

This service accepts inbound SIP calls explicitly routed from a Photon Voice line to a LiveKit SIP trunk. It asks for consent to transcript retention, conducts Pharos's short voice intake, and sends finalized speaker-labeled text turns to the protected Pharos Worker API. It does not save raw audio or send audio to the Worker.

**Audio-processing detail:** LiveKit's speech recognition processes the caller's audio, including the yes/no consent response after the agent's first spoken disclosure. Pharos does not persist transcript text until the caller clearly agrees. A caller who declines is not asked intake questions or stored as a transcript.

## Run locally

1. Install Python 3.11+ and `uv`.
2. Copy `.env.local.example` to `.env.local`; fill in the LiveKit project URL/API key/API secret, deployed Pharos URL, and the same random `PHAROS_INGEST_TOKEN` configured in DeepSpace. Keep `.env.local` private.
3. From this folder, run `uv sync`, then `uv run python agent.py dev`.
4. Configure the Photon Voice line's inbound SIP destination using Photon’s [LiveKit cookbook](https://photon.codes/docs/beta/cookbooks). The current Photon account has no provisioned line or inbound SIP route, so this agent cannot receive a real phone call yet.
5. In the Pharos Worker, set `PHAROS_RESPONDER_PASSWORD`, `PHAROS_COORDINATOR_PASSWORD`, `PHAROS_SESSION_SECRET`, and `PHAROS_INGEST_TOKEN`; also set `LIVEKIT_URL` and `PHOTON_VOICE_LINE_ID`. Set `PHAROS_VOICE_ROUTE_READY=true` only after an end-to-end synthetic test call works.

The default models use LiveKit Inference for Deepgram Nova 3 speech recognition, Gemma 4 conversation, and Fish Audio speech. LiveKit account access, usage limits, credit, and pricing apply; model IDs can be overridden in `.env.local`.

## Events sent to Pharos

- `call.started` stores a random Pharos call ID and timestamps, not the LiveKit room name or caller's phone number.
- `consent` starts or declines transcript retention.
- `turn` sends final speaker-labeled transcript text only after consent. It updates the call record but does not create a dispatch case on every partial utterance.
- `call.ended` closes the session and asks the Pharos Worker to analyze the transcript, create/update a help case, match its location, suggest urgency, and create a separate scam review when wording signals are present.

Pharos keeps synthetic demo data separate from live records and expires live transcript text after 24 hours by default. This prototype does not intercept calls to a person's regular phone; only calls explicitly routed to the Photon test line reach this agent. The shared responder/coordinator passwords are for the hackathon demo, not production account security.
