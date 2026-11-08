# Pharos Photon voice runtime

The runtime has two modes for consenting teammates using fictional scenarios:

- **Intake:** Photon SIP caller → LiveKit STT and short spoken intake → consented finalized text → Pharos → Beacon case. A human responder owns prioritization and real-world action.
- **Guard:** Photon protected number → consent gate → second SIP leg to a fixed, pre-consenting resident test phone. Only the incoming caller's track is transcribed. Pharos analyzes each finalized utterance and can return a recipient warning before the call ends. Guard calls must be stored as `purpose=guard`, never help cases.

The guard relay is implemented but has **not been tested against a real trunk or phone**. Its outbound dialing is disabled by default. Starting the runtime does not buy a number, upgrade a plan, or place a call. The separate, explicit SIP setup command below configures an existing LiveKit project and an already purchased Photon number.

The intake opening is brief and interruptible: “Pharos test line, not emergency dispatch. May I share a short transcript with responders? Say yes or no.” After a clear yes, it immediately asks what is happening and the current location, skipping facts already stated. A caller can combine consent and facts in one answer. For immediate danger, the prompt skips routine readbacks and asks only essential missing facts. It does not request a name.

For repeat help calls, the intake asks whether a caller who is calling back means the same situation or a new request, then collects their current location and needs. No name, case number, or particular phrase is required to receive help. The agent does not retrieve or read previous case facts; a fresh danger report is included even if an older request exists.

Only actual SIP **intake** calls send the inbound `sip.phoneNumber` as `callerNumber` in the authenticated `call.started` event. The runtime drops its transient copy after acknowledgment and never includes the number in later events or logs. Guard calls and WebRTC calls omit this field, even if a browser supplies a SIP-looking attribute. The Worker HMAC-hashes the number for a linkage hint; caller ID does not authenticate a person. Server-side matching also requires explicit same-situation intent and a strong current-location match before updating an eligible existing request. Otherwise the report remains a new case for human review.

## Setup

Use Python 3.11+ (the local tests used Python 3.13 and LiveKit Agents 1.8.11). From this directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install 'httpx>=0.27,<1' 'livekit-agents~=1.8.11' 'python-dotenv>=1,<2' 'truststore>=0.10,<1'
cp .env.local.example .env.local
```

If `.env.local` already exists, fill it in rather than replacing it. Set the LiveKit URL/API key/API secret, the deployed Pharos origin, and the same ingest token used by its Worker. Keep credentials private. The runtime loads `.env.local` relative to `agent.py`, even when launched from another directory.

Set `PHAROS_TEST_CALLER_NUMBERS` to the comma-separated E.164 numbers of consenting teammates. All incoming SIP callers must match that list before any model session begins. For a browser-only LiveKit Console test, explicitly set `PHAROS_ALLOW_BROWSER_TESTS=true`; this does not allow unlisted phone callers. Both modes enforce `PHAROS_MAX_CALL_SECONDS` (180 by default, allowed range 30–300). The budget starts at admission before backend retries, model startup, or disclosure; cleanup is registered before connection and always runs, including startup/loop-validation failures. It removes this call's SIP legs before potentially slow transcript/backend flushing. These are test safeguards, not a provider-level spend limit.

Check configuration without contacting any service, then start the agent:

```sh
.venv/bin/python agent.py --check-config
.venv/bin/python agent.py dev
```

If `uv` is installed, `uv sync` and `uv run python agent.py dev` are equivalent. Model calls use LiveKit Inference and its available account credits/limits; they are not free merely because the runtime starts locally. The default model IDs are Deepgram Nova-3, Gemma 4 31B, and Fish Audio S2.1 Pro; override them through the example env settings if needed.

Configure the Photon default Voice profile, an authenticated LiveKit inbound SIP trunk, and an individual-room dispatch rule launching the configured `PHAROS_AGENT_NAME` (default `pharos-intake`). Use the current [Photon LiveKit cookbook](https://photon.codes/docs/beta/cookbooks/voice/livekit). Prefer compatible TLS/SRTP settings on both sides. The development MCP connection is not the website's runtime credentials.

### Local SIP setup and phone-call worker

From the repository root, inspect or explicitly create only the scoped inbound trunk and individual dispatch rule for the already purchased hotline:

```sh
Product/voice-agent/.venv/bin/python Product/voice-agent/setup_inbound.py --number +16179939206
Product/voice-agent/.venv/bin/python Product/voice-agent/setup_inbound.py --number +16179939206 --apply
```

The script never purchases a number, places a call, creates an outbound trunk, or upgrades an account. Generated Digest credentials stay in ignored `Product/voice-agent/.env.sip.local`, with file permissions `0600`; it prints only resource IDs, configuration status, and that file's path. Configure the Photon Voice profile's inbound destination as `sips:570ptv6vlnd.sip.livekit.cloud` with **TLS**, enter the private file's `PHAROS_LIVEKIT_SIP_USERNAME` and `PHAROS_LIVEKIT_SIP_PASSWORD` locally, and use media encryption **Auto**. The LiveKit trunk permits SRTP, requires Digest authentication, is scoped to the hotline, and caps each call at 180 seconds. Individual rooms dispatch `pharos-intake` with random room suffixes. LiveKit retains private SIP metadata, including caller numbers and individual-room names; do not publish these in screenshots or application logs.

After filling the consenting teammates' `PHAROS_TEST_CALLER_NUMBERS` in `.env.local`, synchronize that allowlist to the existing owned trunk before starting the worker:

```sh
Product/voice-agent/.venv/bin/python Product/voice-agent/setup_inbound.py --number +16179939206 --apply --sync-test-callers
./Product/voice-agent/start_local_worker.sh
```

`--sync-test-callers` requires a nonempty list and changes only this owned trunk's allowed callers. It does not rotate credentials, replace media settings, touch another trunk, or change a matching dispatch rule. Repeating it with the same list is a no-op. The runtime independently rejects unlisted callers. The start script checks configuration, then registers a local worker with the named SIP dispatch; it runs on this laptop with no hosted-agent deployment and zero idle subprocesses. Leave the terminal and laptop awake for the call. Inference and phone transport still consume their providers' credits when a real call arrives. Stop with Control-C when testing ends. The hotline must also show active in Photon before an inbound call can reach it.

## Optional protected-call guard

Before setting `PHAROS_CALL_MODE=guard`, configure:

- `PHAROS_AGENT_NAME=pharos-guard` and a dispatch rule for this guard worker.
- `LIVEKIT_OUTBOUND_TRUNK_ID`: authenticated outbound Photon SIP trunk.
- `PHAROS_GUARD_RESIDENT_NUMBER`: the fixed E.164 number of the consenting test recipient.
- `PHAROS_GUARD_ALLOWED_CALLERS`: comma-separated E.164 numbers of consenting test callers. This optional narrower guard list falls back to `PHAROS_TEST_CALLER_NUMBERS`. Other callers are rejected before a recipient is dialed.
- `PHAROS_GUARD_RESIDENT_CONSENTED=true`: the recipient has already opted into this test and transcript warnings.
- `PHAROS_ENABLE_GUARD_RELAY=true`: explicit operator enable after reviewing call costs.
- `PHAROS_GUARD_MAX_SECONDS=300`: outbound-leg maximum; the shorter `PHAROS_MAX_CALL_SECONDS` cap also applies.
- `PHAROS_SEMANTIC_GUARD_REVIEW=true`: default for enabled guard mode; uses the bounded context reviewer below. Intake never enables this extra inference path.

The resident's phone must be separate from the caller and Photon line and must not forward back into Pharos. The runtime checks for obvious number loops. The incoming caller hears the disclosure and must clearly consent before the resident is dialed. The recipient's prior opt-in is essential because the outbound call joins the shared room as soon as they answer. Two phone legs may incur two provider charges. Use a separate guard dispatch/number or deliberately switch the test dispatch between demos; the current Python SDK allows one registered agent entrypoint per process.

A guard worker does not interrupt a call based on a risk score. It does not play warnings into the shared room where the other caller would hear them. It sends new backend warnings through a private `pharos.warning` room-data topic addressed only to the resident participant identity. **A normal PSTN phone cannot display that room-data message.** Actual SMS or push delivery is the Pharos backend's separate adapter and still requires its credentials/eligible sender/recipient binding. A provider-neutral callback can be supplied to `CallEventStream` for another approved delivery path. Duplicate warning IDs are suppressed.

If either phone participant leaves, or the configured duration expires, the job drains finalized text and removes this call's remaining SIP participants to avoid an orphan billable leg. Intake also removes its phone participant at its duration cap. A failed recipient connection produces a spoken failure notice, not a claim of successful protection.

### Context review during a protected call

Semantic guard calls start with `analysisMode=semantic`. Only after a consented caller turn is acknowledged does a separate task review the accumulated caller-only wording. Assistant replies and phone numbers are excluded. STT delivery continues while one review is in flight; subsequent caller turns coalesce into the newest pending snapshot. Each call allows at most eight review requests, using the existing LiveKit Inference account. The reviewer limits its request window and output size, validates a strict schema and exact evidence quotes, and considers attribution, negation, harmful requests, and pressure patterns across the supplied context. It does not infer a person's identity or diagnose them from voice.

The result is posted as `pressure.review` with the latest caller's global turn sequence (agent turns still occupy sequence numbers). The runtime checks that this caller sequence is still current before sending a result and before invoking the warning callback. The server must independently reject stale, closed, revoked, or mismatched-sequence results. An unavailable, invalid, timed-out, or exhausted review sends neutral `pressure.unavailable` for the current sequence; this mode does not replace a failed model review with a keyword/regex warning. A missing warning never certifies safety. New server warnings use the same private callback and ID deduplication as other warnings.

Withdrawal and completion immediately stop scheduling, clear the runtime's caller context/pending snapshot, cancel in-flight review work, and close the call's own lazy reviewer. Late results are ignored. Nothing is sent to this reviewer before clear consent or after the local withdrawal gate. The inference provider still processes submitted text under its account terms. Disabling semantic review is an explicit separate backend mode, not an automatic fallback after failure.

## Consent and delivery behavior

The pre-LLM hook requires a clear initial yes; qualified or ambiguous answers get one clarification and then stop. A no stops collection deterministically. After consent, an explicit “Stop recording” or “I withdraw consent” closes the local gate before the utterance can be saved or sent to the LLM. The ordered `consent.revoked` event asks Pharos to scrub transcript/evidence/warning access; previously consented minimal help-request facts may remain for human follow-up. The runtime does not promise deletion from providers' transient buffers or unrelated recipient enrollment. If backend revocation is not acknowledged, the caller is told collection stopped but deletion could not be confirmed. Uncertainty about facts (“Yes, not sure where I am”) does not negate clear agreement; contradictory agreement (“Yes, no, stop”) needs clarification. A combined answer such as “Yes, we need a ride near Riverbend” sends the consent acknowledgment first, then preserves the factual remainder once. Preemptive generation is disabled through the SDK's nested `turn_handling.preemptive_generation.enabled=false` option; a real-SDK test checks its effective value. LiveKit STT/turn handling still processes the choice before consent; no pre-consent text is delivered to Pharos.

`AgentSession.start(record=False)` explicitly disables this agent's audio, transcript, trace, and log recording, rather than inheriting the dashboard's recording preference. Pharos receives text only. Underlying Photon/LiveKit model and transport processing still applies; review account settings for service-wide retention.

A per-call ordered in-memory outbox delivers:

1. `call.started` with `purpose=intake|guard` and transport `sip|webrtc`; only SIP intake may include `callerNumber` for the server's protected repeat-call linkage. Semantic guard calls additionally specify `analysisMode=semantic`. The backend may return a private `warningUrl`.
2. `consent` before transcript storage.
3. `turn` with caller/agent role, bounded text, and a monotonic sequence.
4. `call.ended` after pending turns and SDK final-transcript flush; `deliveryFailed=true` reports incomplete transport. An explicit withdrawal instead sends `consent.revoked`, suppresses queued/new turns and warnings, and never reopens collection.

Transient network/408/425/429/5xx failures retry with the same event ID and body. Permanent failures do not retry. The backend must treat start events idempotently and deduplicate turn sequences. Failures are not silently reported as successful; intake tells the caller it cannot confirm delivery, and completion records transport failure when possible. This outbox is not a disk-backed recovery service: a machine crash can still lose undelivered turns. Raw transcripts/phone numbers/credentials are excluded from this code's log messages.

## Verification

```sh
.venv/bin/python -m unittest discover -s tests -v
```

The tests use mocked HTTP/voice callbacks and fictional inputs. They check clear versus ambiguous consent, decline, combined yes/facts, brief interruptible opening, effective SDK preemptive-generation settings, private failure diagnostics, startup configuration, ordered turns, stable retry IDs, permanent errors, duplicate warning suppression, partial completion after a delivery failure, explicit withdrawal without persisting the withdrawal itself, skipped queued turns on revocation, and teardown of phone legs after startup failures or an admission-time deadline. Semantic scheduling checks after-ack consent gating, caller-only coalescing, global sequence numbers, stale/late result rejection, cancellation and context removal, the eight-request cap, neutral unavailability, and intake isolation. SIP setup tests check mutation-free inspection, private credentials, scoped/idempotent creation, explicit allowlist-only synchronization, refusal to clear the list, and preservation of unowned resources. A real consenting intake call has reached backend completion; the guard relay and phone notification path still need a full real-call test.

Official references: [LiveKit voice quickstart](https://docs.livekit.io/agents/start/voice-ai/), [events and errors](https://docs.livekit.io/reference/agents/events/), [outbound calls](https://docs.livekit.io/telephony/making-calls/outbound-calls/), and [recording options](https://docs.livekit.io/reference/agents/session-recording-options/).
