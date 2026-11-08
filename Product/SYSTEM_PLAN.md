# Pharos system plan

Updated 2026-11-07 7:15 PM CST

## Product shape

Pharos serves two audiences under one disaster incident:

- **Flare is voice-first.** A resident calls the Pharos line and speaks naturally; the voice agent asks a few short questions, confirms what it heard, and creates a structured request for human review. The website form is a fallback for someone who can use it, not the main crisis path. A resident's tone, persistence, or number of repeat messages must not determine priority.
- **Beacon** gives authorized responders a human-reviewed queue of requests. It displays reported facts, source, time received, and unknown details. It keeps suspicious messages/calls in a separate review lane so they do not drown out people asking for assistance.

The names fit together: a **flare** is a request for attention; a **beacon** helps responders find and guide people. “Radar” sounds more like broad surveillance, so Beacon is the better responder name.

## What is connected today

| Service | Verified state | What it can do today |
| --- | --- | --- |
| DeepSpace | The static Pharos prototype is hosted at `https://signalbridge-hackutd-2026.app.space`. The worker serves files and a health route only. | Publish this frontend. It does not currently provide a database, chatbot model, Photon integration, or resident intake API. |
| Photon | The Photon MCP developer connection is authorized. Read-only checks found the SignalBridge Spectrum project but no provisioned line/resource, webhook destination, or voice profile. | Let the development assistant inspect/manage Photon resources. This is a separate control-plane connection; the website cannot use it to read messages. |
| GitHub | Private project repository `AkshP08/signalbridge-hackutd-2026` is connected. | Store and review source. The repo and hosted URL still use the old name; only the product's visible branding is changing to Pharos. |
| Hugging Face, AIsa, State Farm, T-Mobile Safe Signal | No runtime credentials, redeemed model/service access, or sponsor-provided dataset/API instructions are recorded in the project. | Not connected to the application. The private Hugging Face claim link must come from HARP/organizers; never store it in this repo. |

The current voice-call panel previews a fictional phone conversation; it does not place a call or use the microphone. The short Flare web form is a fallback that makes a local preview and sends nothing. The scam checker is a local rule demo. The animated corner Guide uses fixed answers and sends nothing to a model.

## Proposed first real-data slice: call-first

Build one end-to-end, non-emergency test with a consenting teammate before handling any resident data:

1. The test caller dials the approved Photon voice line and hears a brief disclosure that they are speaking with an automated intake helper, plus a way to reach emergency services/human help when appropriate.
2. Photon routes the call over SIP to LiveKit. A LiveKit voice agent transcribes speech and asks, in order: “Are you in immediate danger?”, “What location or nearby landmark should responders use?”, and “What help is most urgent right now?” It can ask one short follow-up about people affected or a time-critical support need if the caller's answer makes that useful.
3. The agent accepts ordinary speech, offers keypad/DTMF where supported, tolerates silence/unclear answers, and asks once for clarification. Unanswered details stay **unknown**; the agent must not make the caller repeat a long form or treat silence as low need.
4. Before creating the report, the agent reads back a very short summary and asks for correction/confirmation. It extracts only the structured facts needed for a responder: safety report, location, requested help, and any volunteered time-critical context. It does not ask for a diagnosis or a ranking against other callers.
5. A protected backend creates the request and Beacon shows the source as a phone call, timestamp, self-reported details, unknown fields, transcript-derived evidence, and a human-review action. A human owns dispatch and can reorder/clarify.
6. If transcript content includes high-specificity scam tactics, a separate Beacon review flag quotes the phrase and why it triggered. The voice agent continues to collect the caller's help request; a flag must never end the call, discard the report, or prove intent.
7. SMS/web form remain backup channels, not prerequisites to asking for help.

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

## Voice transcript path: product's primary intake channel

The intended product interaction is an actual telephone call, not a resident filling out a webpage. Photon 2.0 documents inbound and outbound calls over SIP and publishes a LiveKit cookbook for connecting Photon calls to LiveKit rooms. This gives us a concrete voice integration direction. The stable Spectrum messaging docs separately state that voice calls are not ordinary `app.messages` / `app.webhook()` text-message events; that is why call audio should enter over the voice SIP integration instead of being treated like an SMS payload. The current project still has no provisioned line or voice route.

The most coherent path to prototype, if Photon gives the project a compatible SIP destination, is:

```text
consenting test caller
  → Pharos number/voice route in Photon 2.0
  → Photon SIP cookbook connection to LiveKit room
  → LiveKit voice agent: streaming speech-to-text + short spoken prompts
  → minimum structured help request + brief read-back confirmation
  → protected Pharos request API
  → Beacon human-reviewed call request
                   ↘ Safe Signal content check → separate review flag + quoted phrase
```

Photon's published 2.0 material explicitly says its phone calls connect to voice tools over SIP and names a LiveKit cookbook; LiveKit documents inbound SIP participants joining a room where an agent can answer. So Photon → LiveKit is now the **primary integration to attempt**, rather than treating voice as a stretch item. It still needs actual line/route setup and a consenting end-to-end call before we say it works in our account. Keep the call agent deliberately small: safety, location, requested help, short confirmation, then human review. An unanswered or ambiguous response is retained as unknown and handed to a person, not silently filled by an LLM.

For the first experiment, have a consenting teammate make a phone call and read a fictional flood-help script. Show the captured transcript, the structured fields, and any exact phrases that trigger checks. Analyze the conversation's **content**, not hesitation, accent, emotion, volume, identity, or how insistently the caller asks for help. High-specificity patterns include a demand for money/codes, secrecy, a threat, or an authority claim paired with a risky request. An urgent caller asking for evacuation is not suspicious simply because they sound urgent. Never auto-hang up or block the help request; surface a reason for a responder to check.

The Photon Voice guide notes an RTP encryption limitation on the SIP path; confirm the security behavior of the Photon 2.0/LiveKit cookbook route currently offered to this project before testing with anything sensitive. Use fictional speech and consenting teammates only. Do not store raw audio; define transcript consent, retention, deletion, and responder access before enabling real callers.

**Transcript-only fallback:** use a short, consented audio file with Hugging Face Automatic Speech Recognition to obtain a transcript, then run the same content check. This is useful for developing the phrase detector, but it does not satisfy the phone-first product experience or prove live call integration. The team's HackUTD offer describes a limited $10 credit; first confirm access through the private HARP link and its terms.

**Alternative:** Deepgram's direct streaming STT can transcribe audio, but would add a separate account/key. LiveKit inference with its Deepgram integration may reduce the number of providers to wire. No provider should receive real resident audio in this prototype.

## Chatbot scope

Pharos Guide is currently a local fixed-answer helper for Flare, Beacon, message verification, data boundaries, and the proposed voice path. For a future model-backed bot:

- Put the model call behind a server route; never expose an API key in JavaScript.
- Ground answers in approved local emergency resources and the app's own rules. Do not improvise evacuation instructions, medical guidance, or promises of response.
- Keep an always-visible route to official emergency channels and human responders.
- Add request-size limits, rate limits, budget alerts, logging redaction, and an abuse stop switch. DeepSpace AI calls may spend the app owner's credits if the public user has no own token, so do not enable an unmetered public model endpoint.
- Do not send Flare form data or private messages to the chatbot unless users clearly consent and the data handling is defined.

## What we need from the team to connect services

1. **Photon voice line and route:** in Photon, open the Voice cookbook / line calling settings and check how to attach the number to a LiveKit SIP destination. Share screenshots with keys and personal numbers hidden. The Photon project has no provisioned resources yet; the previous choice was to keep using simulated data, so do not provision a number or paid voice route without explicitly changing that choice. Confirm price/credit eligibility before any purchase.
2. **Photon runtime credentials:** put the runtime project ID and Secret/API key in a local ignored `.env` or a server-side secret setting only. Keep the user's developer OAuth/MCP connection separate from these app credentials; never paste secrets into chat or frontend JavaScript.
3. **LiveKit account/project:** create a LiveKit project for inbound SIP, configure its inbound trunk/dispatch rule per the Photon cookbook, choose a speech-to-text option, and keep credentials server-side. Confirm region, limits, and pricing before testing.
4. **Sponsor inputs:** request State Farm's challenge instructions for safe queue criteria and T-Mobile's Safe Signal taxonomy/dataset/API/baseline and evaluation rules. Do not assume an undocumented sponsor API exists.
5. **Real alert source and geography:** choose the intended region and approved source of warnings. The demo notice is fictional; there is no live alert API today. The phone call path is for incoming help requests; outgoing warning calls need verified alert content and an opt-in/authorized recipient design.
6. **Data policy and test consent:** agree what data is collected, who can see it, how long it is retained, how a user can delete it, what the voice disclosure says, how transcript consent is handled, and what the caller hears if the agent cannot understand or the request sounds urgent.
7. **Backend storage and access control:** choose an authenticated responder identity and protected store. The existing DeepSpace Worker has no persistence or access-control rules. Do not publicly expose an unauthenticated emergency queue.

No actual call, message, or resident information should be used until the team has completed those prerequisites and tested with synthetic content and consenting teammates.

## Official technical references

- Photon [Voice over SIP guide](https://photon.codes/docs/spectrum-ts/providers/voice) and [inbound calls](https://photon.codes/docs/spectrum-ts/providers/voice/inbound-calls).
- Photon [2.0 voice/SIP announcement](https://photon.codes/blog/introducing-photon-2.0) and [Beta Cookbooks](https://photon.codes/docs/beta/cookbooks) (LiveKit connection guide).
- LiveKit [SIP trunk setup](https://docs.livekit.io/telephony/start/sip-trunk-setup/), [Deepgram STT integration](https://docs.livekit.io/agents/models/stt/deepgram/), and [inference privacy overview](https://docs.livekit.io/agents/models/inference/).
- Hugging Face [automatic speech recognition inference providers](https://huggingface.co/docs/inference-providers/tasks/automatic-speech-recognition).
- DeepSpace [AI chat guide](https://docs.deep.space/guides/ai-chat).
