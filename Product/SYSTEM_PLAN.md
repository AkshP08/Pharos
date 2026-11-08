# Pharos system plan

Updated 2026-11-07 6:50 PM CST

## Product shape

Pharos serves two audiences under one disaster incident:

- **Flare** helps a resident read a verified warning, ask for help with a short structured report, and check suspicious wording. It should ask for only the information responders need. A resident's tone, persistence, or number of repeat messages must not determine priority.
- **Beacon** gives authorized responders a human-reviewed queue of requests. It displays reported facts, source, time received, and unknown details. It keeps suspicious messages/calls in a separate review lane so they do not drown out people asking for assistance.

The names fit together: a **flare** is a request for attention; a **beacon** helps responders find and guide people. “Radar” sounds more like broad surveillance, so Beacon is the better responder name.

## What is connected today

| Service | Verified state | What it can do today |
| --- | --- | --- |
| DeepSpace | The static Pharos prototype is hosted at `https://signalbridge-hackutd-2026.app.space`. The worker serves files and a health route only. | Publish this frontend. It does not currently provide a database, chatbot model, Photon integration, or resident intake API. |
| Photon | The Photon MCP developer connection is authorized. Read-only checks found the SignalBridge Spectrum project but no provisioned line/resource, webhook destination, or voice profile. | Let the development assistant inspect/manage Photon resources. This is a separate control-plane connection; the website cannot use it to read messages. |
| GitHub | Private project repository `AkshP08/signalbridge-hackutd-2026` is connected. | Store and review source. The repo and hosted URL still use the old name; only the product's visible branding is changing to Pharos. |
| Hugging Face, AIsa, State Farm, T-Mobile Safe Signal | No runtime credentials, redeemed model/service access, or sponsor-provided dataset/API instructions are recorded in the project. | Not connected to the application. The private Hugging Face claim link must come from HARP/organizers; never store it in this repo. |

The current Flare form, scam checker, and corner guide are frontend demonstrations. The form makes a preview in the browser and sends nothing. The guide uses fixed answers and sends nothing to a model.

## Proposed first real-data slice

Build one end-to-end, non-emergency test with a consenting teammate before handling any resident data:

1. A test phone sends a harmless SMS to an approved Photon test line.
2. A server-side Photon endpoint verifies the event, removes unnecessary fields, and creates an event record without writing message text into routine logs.
3. A simple transparent message check marks any risky wording and the matched evidence. It never labels a sender as certainly fraudulent.
4. Beacon displays the test item with its source, timestamp, and a human-review action. Any resident request content remains separate from the suspicious-contact review list.
5. Only after an authenticated responder workflow, storage rules, and deletion path are agreed should Flare submit requests to a server-side queue.

The Flare request fields in the current demo are deliberately limited to immediate danger status, nearby location/landmark, number of people, requested support, and optional short details. For a real system, add consent, contact/callback method only when needed, access controls, retention/deletion, and an explicit statement about who can see the information.

## Triage: fair, explainable, and human-owned

We do not know a resident's diagnoses or full circumstances, and people may understandably describe their own case as the most urgent. The product should avoid asking residents to rank themselves against other households. Instead:

- Ask the same core questions of everyone: immediate danger, safe exit/access, time-sensitive support (such as powered life-sustaining equipment), people affected, location, and what help is requested.
- Record each answer as **self-reported**, with a timestamp and its source. Missing or contradictory answers are **unknown / needs follow-up**, not evidence of low need.
- Show a suggested work order from observable time-critical facts. Put an explicit imminent danger report first, then time-sensitive essential support, then other requests needing prompt help. Use recency only as a tie-breaker and show the reason next to the order.
- Keep requests with incomplete locations or no confirmed category in a visible follow-up lane. Never discard them or let message volume/tone push them down.
- Let a trained human responder change the order and record a short reason. Do not call this medical triage, diagnose people, promise dispatch, or automatically reject a request.
- Keep scam-review traffic in a separate queue. A possible scam signal should prompt source verification, not block a help request from the same person.

The present queue is only a fictional UI example, not a validated policy. We need the State Farm challenge rubric or approved guidance before describing any ordering as sponsor-approved.

## Voice transcript path: recommended middle layer

Selecting “Voice” in Photon does not yield a transcript to the website. Photon currently documents voice routing over SIP; its guide says calls are not delivered in the normal `app.messages` / `app.webhook()` stream and the relevant call-control/webhook features are marked as coming soon. We also found that Photon currently has no provisioned line or voice route for this project.

The most coherent path to prototype, if Photon gives the project a compatible SIP destination, is:

```text
consenting test caller
  → Photon voice/SIP route
  → LiveKit SIP ingress and media room (the bridge)
  → LiveKit Agent speech-to-text (Deepgram-backed inference)
  → short-lived transcript text
  → T-Mobile-approved Safe Signal rules/model
  → Beacon “possible pressure pattern” review card with matched words
```

This is a **proposed architecture**, not a verified integration. We need Photon to confirm that the current project/line can route SIP to a LiveKit SIP URI and provide the required signaling/media settings. LiveKit's SIP and STT products appear to cover the bridge and transcript steps, but we must perform a consenting synthetic call before claiming interoperability. Photon documentation says its SIP RTP audio is not encrypted; do not send real crisis calls or sensitive health details through that path unless Photon provides an acceptable secure route and the team has a clear consent/privacy policy.

For the first experiment, transcribe a consenting teammate reading a fictional script. Show the transcript and exact phrases that trigger checks. Look for observable content: requests for money/gift cards/codes, secrecy, threats, impersonated authority, urgent deadlines combined with risky requests, and discouragement of independent verification. Urgency alone can also be part of a real evacuation warning. Do not analyze hesitation, accent, emotional tone, identity, or a person's credibility. Never auto-hang up; show a short warning for a person to review.

**Lower-scope fallback:** use a short, consented audio file with Hugging Face Automatic Speech Recognition to obtain a transcript, then run the same text checker. This proves transcript-to-review without a live SIP bridge, but it is not real-time call integration. The team's HackUTD offer describes a limited $10 credit; first confirm access through the private HARP link and its terms.

**Alternative:** Deepgram's direct streaming STT can transcribe audio, but would add a separate account/key. LiveKit inference with its Deepgram integration may reduce the number of providers to wire. No provider should receive real resident audio in this prototype.

## Chatbot scope

Pharos Guide is currently a local fixed-answer helper for Flare, Beacon, message verification, data boundaries, and the proposed voice path. For a future model-backed bot:

- Put the model call behind a server route; never expose an API key in JavaScript.
- Ground answers in approved local emergency resources and the app's own rules. Do not improvise evacuation instructions, medical guidance, or promises of response.
- Keep an always-visible route to official emergency channels and human responders.
- Add request-size limits, rate limits, budget alerts, logging redaction, and an abuse stop switch. DeepSpace AI calls may spend the app owner's credits if the public user has no own token, so do not enable an unmetered public model endpoint.
- Do not send Flare form data or private messages to the chatbot unless users clearly consent and the data handling is defined.

## What we need from the team to connect services

1. **Photon SMS runtime access:** in Photon project Settings, place the Spectrum Project ID and Secret Key into an ignored local `Product/.env` (never chat or commit them). If those values are not in `.env`, no runtime app credential is currently configured. Confirm an inbound test channel/line and webhook behavior. A US local SMS number was quoted at $2 upfront plus usage; the earlier choice was to keep using simulated data, so a live number must not be purchased without a new explicit approval.
2. **Photon voice details:** share a screenshot/text of the voice configuration page with secrets hidden: SIP host/URI format, how routes are attached, whether audio media can route to a custom SIP endpoint, recording/transcription options, encryption, and costs. Do not share tokens, phone numbers tied to a person, or call content.
3. **LiveKit account/project:** if we proceed with the bridge, create a LiveKit project and confirm its SIP service availability, chosen region, STT option, quotas/pricing, and any connection credentials. Put secrets in server-side environment settings only.
4. **Sponsor inputs:** request State Farm's challenge instructions for safe queue criteria and T-Mobile's Safe Signal taxonomy/dataset/API/baseline and evaluation rules. Do not assume an undocumented sponsor API exists.
5. **Real alert source and geography:** choose the intended region and approved source of warnings. The demo notice is fictional; there is no live alert API today.
6. **Data policy and test consent:** agree what data is collected, who can see it, how long it is retained, how a user can delete it, how transcript consent is obtained, and what the demo does when a report may be urgent.
7. **Backend storage and access control:** choose an authenticated responder identity and a protected store. The existing DeepSpace Worker has no persistence or access-control rules. Do not publicly expose an unauthenticated emergency queue.

No actual call, message, or resident information should be used until the team has completed those prerequisites and tested with synthetic content and consenting teammates.

## Official technical references

- Photon [Voice over SIP guide](https://photon.codes/docs/spectrum-ts/providers/voice) and [inbound calls](https://photon.codes/docs/spectrum-ts/providers/voice/inbound-calls).
- LiveKit [SIP trunk setup](https://docs.livekit.io/telephony/start/sip-trunk-setup/), [Deepgram STT integration](https://docs.livekit.io/agents/models/stt/deepgram/), and [inference privacy overview](https://docs.livekit.io/agents/models/inference/).
- Hugging Face [automatic speech recognition inference providers](https://huggingface.co/docs/inference-providers/tasks/automatic-speech-recognition).
- DeepSpace [AI chat guide](https://docs.deep.space/guides/ai-chat).
