# Pharos voice intake

The current product is responder-facing: Photon routes a consenting test caller to `pharos-intake`; a brief conversation sends ordered text to Beacon, reviews concrete request concerns, and optionally captures private caller-only audio for human review. The earlier two-party Guard mode is retained as future experimental code; relay and SMS remain disabled.

## Existing setup

Use the existing `.venv`, ignored `.env.local`, provisioned Photon number, inbound trunk/dispatch, and tracked `livekit.toml`. Do not recreate resources or overwrite existing env files. Fill credentials locally, never in chat or command arguments. The runtime loads `.env.local` relative to `agent.py`.

```sh
Product/voice-agent/.venv/bin/python Product/voice-agent/agent.py --check-config
```

Ordinary LiveKit URLs require `wss://`. Hosted LiveKit injects an HTTPS gateway which its installed SDK maps to encrypted WSS; this is allowed only with the SDK's nonempty hosted-worker marker. Plaintext managed URLs are limited to exact loopback. URL credentials, query strings, fragments, malformed endpoints, and public plaintext are rejected. The backend requires HTTPS outside loopback development.

`PHAROS_TEST_CALLER_NUMBERS` admits only consenting test phones and limits billing exposure; it is not a fraud signal. `PHAROS_CALL_MODE=intake` is the current mode. Keep `PHAROS_ENABLE_GUARD_RELAY=false` and `PHAROS_ALLOW_BROWSER_TESTS=false` outside a deliberately bounded private synthetic test. The current call cap is 180 seconds; phone legs are removed before slower finalization/audio upload.

Changing approved callers requires both gates to match: update `PHAROS_TEST_CALLER_NUMBERS` in the ignored local/hosted settings, synchronize the existing owned SIP trunk with `setup_inbound.py --number <existing-hotline> --apply --sync-test-callers`, and apply the hosted caller secret with `lk agent update-secrets`. Secret updates restart the agent; wait for active calls to finish first. Keep personal numbers and generated secrets out of Git, verify the trunk's exact allowed-number set, and inspect hosted deployment status afterward. This does not change the hotline number or require a website deployment.

## Consent and audio

The opening briefly asks to share a transcript and caller audio, with **yes**, **transcript only**, and **no** choices. Transcript-only consent keeps audio disabled and preserves help facts. Explicit no-audio qualifications override a general yes. Clear sharing withdrawal closes local collection before the withdrawal text reaches the saved transcript/model and asks the backend to scrub relevant retained evidence. Do not promise deletion from external provider processing.

Audio capture starts only after the authenticated consent acknowledgment. If the caller says yes and facts in one utterance, those facts can reach the transcript while their raw audio may not be recorded. For a recorded demonstration, answer yes separately and give facts after the prompt. No pre-consent PCM is retained.

`pharos_audio.py` captures only the selected caller's remote track as 16kHz mono PCM16 in memory. Maximum duration is 180 seconds/5,760,000 bytes, split into at most 88 chunks of at most 65,536 bytes. It does not open the microphone, write a recording file, record Pharos, invoke Egress, or score tone/pacing. After phone removal and `call.ended`, bounded authenticated uploads let the backend decide retention; discard responses, failure, revocation, or cancellation clear the local buffer. Upload stays within the total cleanup/process shutdown deadline.

`AgentSession.start(record=False)` disables LiveKit's separate session recording. That does not disable this explicit, consented caller-audio feature. The Worker encrypts retained chunks and serves private WAV only to signed-in responders. Completed clear calls discard audio; flagged/reviewed evidence follows at-most-24-hour source-call retention. Transcript-only/failed/expired recordings remain unavailable without implying deception.

## Responder contextual review

The legacy setting `PHAROS_SEMANTIC_GUARD_REVIEW=true` now enables semantic review for intake as well. Intake uses `SemanticReviewer(context='responder')`; the future Guard context retains its separate contract.

Only acknowledged consented caller turns reach the bounded reviewer; assistant replies, phone numbers, and raw audio are excluded. One request is in flight, new snapshots coalesce, at most eight requests run per call, serialized input/schema is at most15KB, output at most800tokens, timeout8seconds, with no retries/tools. Exact quotation and strict known-category validation reject invalid output. Stale/late/canceled results cannot overwrite current evidence.

Responder output includes strict `uncertain:boolean`. Supported pressure toward a concrete unsafe request can flag a concern. An explicit current false-report admission plus resource-diversion request is a separate human-verification basis. Normal urgency, panic, confusing/corrected facts, missing names, and quoted victim/training accounts cannot alone establish fraud. Clear means no supported concern, not verified truth. Incomplete/failed/exhausted reviews become human review; the backend gates assignment/ETA until explicit acceptance.

The helper gathers situation/location first, skips known facts, and avoids routine readback during immediate danger. Its model never invents an ETA. Private progress polling speaks only current server-authored desk reports, waits for a quiet gap, suppresses duplicates, and stops on withdrawal/end.

## Wire and tests

- `POST /api/voice/ingest`: `call.started` with purpose/intake semantic mode/transport; consent with strict `audioConsent`; ordered caller/agent turns; contextual review/unavailable; withdrawal and completion.
- `GET /api/voice/calls/<id>/progress`: ingest-authorized minimal message, no public case dump.
- `POST /api/voice/calls/<id>/audio/chunks`: ingest-authorized `{sequence,pcmBase64}` fixed-format PCM.
- `POST /api/voice/calls/<id>/audio/complete`: `{lastSequence}`. Server `discarded:true` stops upload.
- `GET /api/cases/<id>/audio`: responder session only, never a URL token.

```sh
Product/voice-agent/.venv/bin/python -B -m unittest discover -s Product/voice-agent/tests
node Product/qa-watch.mjs --status
```

Offline tests use dummy credentials/mocked clients and do not prove real phone capture or playback. Root's watcher disables dotenv loading and network access for voice tests. `qa_audio_smoke.py` explicitly labels generated WebRTC audio as simulation; `--live` contacts the existing service only when deliberately authorized, and browser-test admission must be restored afterward. Current three-call acceptance is in [DEMO_RUNBOOK.md](../DEMO_RUNBOOK.md).

Use [HOSTED_DEPLOYMENT.md](HOSTED_DEPLOYMENT.md) to update the existing hosted agent. The one earlier real Photon intake and previous passing synthetic audio test are historical evidence; the new review/recording build needs its own full-flow check.

Official references: [LiveKit voice agents](https://docs.livekit.io/agents/start/voice-ai/), [AudioStream](https://docs.livekit.io/reference/python/livekit/rtc/audio_stream.html), [session recording options](https://docs.livekit.io/reference/agents/session-recording-options/), and [deployment management](https://docs.livekit.io/deploy/agents/managing-deployments/).
