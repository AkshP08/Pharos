"""Photon SIP -> LiveKit voice intake and opt-in protected test-call relay.

Provider session recording is disabled. Separately consented caller-only PCM
can be retained privately for human review; transcript-only callers keep audio
off. Guard mode never speaks warnings into a shared call.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
import traceback
import uuid

# Homebrew Python on macOS may lack a default CA bundle. Use the OS trust store;
# certificate verification remains enabled for LiveKit/Pharos HTTPS and WSS.
if sys.platform == "darwin":
    import truststore
    truststore.inject_into_ssl()
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.protobuf.duration_pb2 import Duration
from livekit import agents, api, rtc
from livekit.agents import Agent, AgentServer, AgentSession, StopResponse, inference, llm, room_io

from pharos_runtime import CallEventStream, ConfigurationError, DeliveryError, Settings, VoiceEventClient, is_consent_withdrawal, parse_consent
from pharos_audio import CallerAudioRecorder, upload_recording

# Resolve against this file so running from the repo root cannot load another .env.
load_dotenv(Path(__file__).with_name(".env.local"))
settings = Settings.from_env(dict(os.environ))
logger = logging.getLogger("pharos-voice-agent")
# This process runs on the demo laptop: avoid eight idle production processes.
server = AgentServer(num_idle_processes=0, shutdown_process_timeout=70.0)

INTAKE_INSTRUCTIONS = """
You are Pharos, a brief automated voice intake helper in a disaster scenario.
The caller has already agreed to transcript sharing. Do not ask for consent again.
You are not emergency dispatch and cannot promise help is coming. Speak in short,
calm sentences and let the caller interrupt. Get to the situation and location
immediately after consent. If neither is known, ask: "What's happening, and where
are you now?" If they already described their situation, ask only for their
current location when missing. An address or nearby landmark is enough.
Collect only missing, useful facts: current danger, current location, and the
help needed most. Ask how many people need help or a time-sensitive need only
when essential and not already stated. Never prolong the call to complete a form.
When the caller reports immediate danger, skip routine readbacks and confirmation
questions. Preserve their stated facts immediately, ask only for a missing
location or an essential need, and keep every reply especially short.
If the caller says they are "calling back" or updating a request, ask: "Is this
about the same situation or a new request?" Then ask "Where are you now?" unless
they already gave their current location. If return-call intent is unclear, you
may ask "If you're calling back, is this about the same situation or a new request?"
Never require the phrase "calling back", a name, or a case number to receive help.
Gather current facts from this caller; do not read out or assume any previous
case facts or imply caller ID verifies identity. A new report of danger must be
included even when the caller says this updates an earlier request. Do not claim
the reports were merged: the backend and a human responder determine linkage.
Never ask the caller to rate or compare urgency. Missing or conflicting facts are
unknown; ask at most one short clarification when it changes the help needed.
For a calm caller, a brief confirmation is optional when useful. Accept
corrections rather than repeating old facts.
Do not request names, passwords, account numbers, payment details, or codes.
Continue collecting the caller's help facts even if wording needs human review.
Never accuse the caller of lying, fraud, or abuse. A separate silent review checks
concrete requests for responder verification; it does not establish truth or intent.
Normal rescue requests, panic, inconsistent memories, corrections, and missing
location do not establish manipulation or a false report. Do not confront the
caller or claim their request has been accepted, rejected, or independently verified.
Do not give evacuation routes, medical instructions, or claims about live incidents.
For immediate danger, suggest contacting the local emergency number if they can.
Tone, accent, emotion, and persistence never determine priority or scam risk.
The Pharos backend suggests urgency from explicit facts; human responders own action.
Do not say the case was successfully saved or assistance dispatched: delivery is
confirmed separately by the server. Say the request is for human review.
Never invent an arrival estimate, responder availability, or claim help is on the
way. Only a separate authenticated server announcement may confirm response
progress or an ETA. If asked before one exists, say you do not yet have a
confirmed arrival estimate. Once essential facts are obtained, acknowledge the
request for human review once, briefly; do not keep repeating receipt language.
""".strip()

INTAKE_DISCLOSURE = (
    "Pharos test line, not emergency dispatch. "
    "May I share a transcript and call audio with responders? Say yes, transcript only, or no."
)
GUARD_DISCLOSURE = (
    "This is a Pharos protected test line. Before connecting you, speech recognition "
    "processes your choice. If you agree, your side of the conversation will be "
    "transcribed and checked for potentially manipulative requests. A short-lived "
    "text transcript and wording warnings may be shared with the consenting recipient. "
    "Say yes to agree, or no to stop."
)


def safe_failure_diagnostic(error: BaseException) -> str:
    """Expose code locations and identifier names, never values or frame locals."""
    identifier = lambda value: value if isinstance(value, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", value) else "withheld"
    error_class = identifier(type(error).__name__)
    attribute = identifier(getattr(error, "name", None))
    frames = []
    for frame in traceback.extract_tb(error.__traceback__)[-8:]:
        filename = Path(frame.filename).name
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.-]{0,99}", filename):
            filename = "withheld"
        frames.append(f"{filename}:{frame.lineno}")
    return f"voice.failure class={error_class} attribute={attribute} frames={','.join(frames) or 'none'}"


def yes_or_no(value: str) -> bool | None:
    """Compatibility helper for the original prototype."""
    return parse_consent(value).decision


async def announce_responder_progress(session: Any, stream: CallEventStream, update: dict[str, Any]) -> bool:
    """Speak server-authored facts only when the caller and voice pipeline pause."""
    if (not stream.consented or stream.closed or stream.revoked or not update.get("announce")
            or session is None or session.user_state == "speaking" or session.agent_state != "listening"):
        return False
    speech = session.say(update["message"], allow_interruptions=True)
    try:
        await speech
    except asyncio.CancelledError:
        # Await cancellation alone does not necessarily cancel SDK audio output.
        # A revoked/closed call must also stop an already queued announcement.
        if hasattr(speech, "interrupt"):
            speech.interrupt()
        raise
    return True


class PharosAgent(Agent):
    def __init__(self, stream: CallEventStream, ctx: agents.JobContext, *, guard: bool,
                 start_relay: Any = None) -> None:
        super().__init__(instructions=INTAKE_INSTRUCTIONS if not guard else "Silent consent-gated call monitor.",
                         **({"llm": None} if guard else {}))
        self.stream = stream
        self.ctx = ctx
        self.guard = guard
        self.start_relay = start_relay
        self.consent_attempts = 0
        self.stopped = False
        self.persisted_user_ids: set[str] = set()

    async def _say_then_stop(self, message: str) -> None:
        self.stopped = True
        try:
            await self.session.say(message, allow_interruptions=False)
        finally:
            self.session.shutdown(drain=True)
            self.ctx.shutdown("intake stopped")

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        # This hook executes before the LLM; preemptive generation is disabled.
        text = (new_message.text_content or "").strip()
        if self.stopped or not text:
            raise StopResponse()
        if self.stream.consented and is_consent_withdrawal(text):
            # Do not persist or forward the withdrawal utterance to the LLM.
            self.stopped = True
            self.persisted_user_ids.add(new_message.id)
            try:
                await self.stream.revoke()
            except DeliveryError:
                message = "I stopped transcript collection. I could not confirm removal of the earlier Pharos transcript; please contact the operator about deletion."
            else:
                message = "I stopped transcript collection and removed the Pharos transcript. Basic request facts may remain for human follow-up. Goodbye."
            await self._say_then_stop(message)
            raise StopResponse()
        try:
            if not self.stream.consented:
                answer = parse_consent(text)
                self.consent_attempts += 1
                if answer.decision is None:
                    if self.consent_attempts < 2:
                        await self.session.say("Please say yes if you agree to transcript sharing, or no to stop.", allow_interruptions=False)
                    else:
                        await self.stream.consent(False)
                        await self._say_then_stop("I did not receive clear consent. I will not send your answers to Pharos. Goodbye.")
                    raise StopResponse()
                await self.stream.consent(answer.decision, audio_consent=answer.audio_consent and not self.guard)
                if self.stopped or self.stream.revoked or self.stream.closed:
                    raise StopResponse()
                if not answer.decision:
                    await self._say_then_stop("I will not send your answers to Pharos. Goodbye.")
                    raise StopResponse()
                self.persisted_user_ids.add(new_message.id)
                if answer.remainder:
                    task = self.stream.turn("caller", answer.remainder)
                    if task is not None:
                        await task
                    new_message.content = [answer.remainder]
                else:
                    new_message.content = ["I consent. Please begin the short intake."]
                if self.guard:
                    await self.session.say("Thank you. Connecting your protected test call now.", allow_interruptions=False)
                    await self.start_relay()
                    raise StopResponse()
                return
            self.persisted_user_ids.add(new_message.id)
            task = self.stream.turn("caller", text)
            if task is not None:
                await task
            if self.guard:
                # Listen to the bound caller track, without replying into the two-party call.
                raise StopResponse()
        except DeliveryError:
            await self._say_then_stop("Pharos cannot save this request reliably right now. I cannot confirm it reached responders. Please use another trusted contact if you can.")
            raise StopResponse()


async def run_session(ctx: agents.JobContext, config: Settings) -> None:
    config.validate()
    guard = config.mode == "guard"
    resident_identity = f"pharos-resident-{uuid.uuid4().hex[:12]}"
    inbound: rtc.RemoteParticipant | None = None
    client: VoiceEventClient | None = None
    stream: CallEventStream | None = None
    session: AgentSession | None = None
    recorder = CallerAudioRecorder() if not guard else None
    audio_upload_task: asyncio.Task[bool] | None = None
    relay_created = False
    ended = asyncio.Event()
    cleanup_task: asyncio.Task[None] | None = None
    deadline = asyncio.get_running_loop().time() + config.max_call_seconds

    def request_end(reason: str) -> None:
        ended.set()
        if stream is not None:
            stream.stop_background()
        if recorder is not None:
            recorder.stop(discard=stream is None or not stream.audio_consented or stream.revoked)
        ctx.shutdown(reason)

    async def perform_cleanup() -> None:
        nonlocal audio_upload_task
        cleanup_started = asyncio.get_running_loop().time()
        ended.set()
        if stream is not None:
            stream.stop_background()
        if recorder is not None:
            recorder.stop(discard=stream is None or not stream.audio_consented or stream.revoked)
        # Release phone legs before potentially slow transcript/backend flushing.
        # Individual dispatch rooms contain this call only. If startup failed
        # before selecting its participant, still release any admitted SIP leg.
        identities = {resident_identity} if guard else set()
        if inbound is not None and inbound.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            identities.add(inbound.identity)
        elif inbound is None:
            identities.update(participant.identity for participant in ctx.room.remote_participants.values()
                              if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP)
        for identity in identities:
            if identity in ctx.room.remote_participants:
                try:
                    await asyncio.wait_for(ctx.api.room.remove_participant(
                        api.RoomParticipantIdentity(room=ctx.room.name, identity=identity)), timeout=8)
                except Exception:
                    logger.error("Could not clean up a test call participant")
        if recorder is not None:
            try:
                await asyncio.wait_for(recorder.aclose(
                    discard=stream is None or not stream.audio_consented or stream.revoked), timeout=3)
            except TimeoutError:
                recorder.stop(discard=True)
                logger.error("Caller audio close timed out; local audio discarded")
        if session is not None:
            try:
                await asyncio.wait_for(session.aclose(), timeout=8)
            except Exception:
                logger.error("Voice session did not finish its final transcript flush")
        if stream is not None:
            try:
                await asyncio.wait_for(stream.finish(), timeout=25)
            except (DeliveryError, TimeoutError):
                logger.error("Call finalization was not acknowledged; responder follow-up may be needed")
        if recorder is not None and stream is not None and client is not None:
            # Leave five seconds for SDK/client teardown inside the configured
            # 70-second process shutdown limit. Phone legs are already released.
            audio_timeout = min(45.0, max(0.0, 65.0 - (asyncio.get_running_loop().time() - cleanup_started)))
            if stream.audio_consented and not stream.revoked and recorder.buffer.byte_length and audio_timeout > 0:
                audio_upload_task = asyncio.create_task(upload_recording(
                    client, stream.call_id, recorder,
                    can_upload=lambda: stream.audio_consented and not stream.revoked,
                ))
                try:
                    await asyncio.wait_for(audio_upload_task, timeout=audio_timeout)
                except (DeliveryError, TimeoutError, asyncio.CancelledError):
                    logger.error("Private call audio upload did not complete")
                    recorder.buffer.discard()
            else:
                recorder.buffer.discard()
        if client is not None:
            await client.close()

    async def cleanup() -> None:
        nonlocal cleanup_task
        if cleanup_task is None:
            cleanup_task = asyncio.create_task(perform_cleanup())
        await asyncio.shield(cleanup_task)

    # Registered before connect, participant admission, validation of routing,
    # call.started retries, model initialization, or spoken disclosure.
    ctx.add_shutdown_callback(cleanup)
    try:
        # This budget covers the whole admitted lifetime, not just conversation
        # after model/TTS startup. Cancellation always enters the finally block.
        async with asyncio.timeout(config.max_call_seconds):
            await ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)
            inbound = await ctx.wait_for_participant()
            caller_number = inbound.attributes.get("sip.phoneNumber", "")
            is_phone = inbound.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
            if is_phone and caller_number not in config.test_caller_numbers:
                request_end("caller not allowed for this test")
                return
            if not is_phone and not config.allow_browser_tests:
                request_end("browser voice test not enabled")
                return
            if guard:
                photon_number = inbound.attributes.get("sip.trunkPhoneNumber", "")
                if not is_phone or caller_number not in (config.guard_allowed_callers or config.test_caller_numbers):
                    raise ConfigurationError("Guard caller is not on the configured consenting test allowlist")
                if config.guard_resident_number in {caller_number, photon_number}:
                    raise ConfigurationError("Guard resident must use a separate, non-forwarded test phone to avoid a call loop")

            client = VoiceEventClient(config.api_url, config.ingest_token)

            async def on_warning(warning: dict[str, Any]) -> None:
                # Normal PSTN phones need the backend's notification adapter.
                if guard and relay_created:
                    await ctx.room.local_participant.publish_data(
                        json.dumps({"type": "pharos.warning", "warning": warning}),
                        reliable=True, topic="pharos.warning", destination_identities=[resident_identity],
                    )
                logger.info("New wording warning received; level=%s", warning.get("level", "review"))

            async def on_progress(update: dict[str, Any]) -> bool:
                return await announce_responder_progress(session, stream, update)

            def on_audio_consent(allowed: bool) -> None:
                if recorder is None:
                    return
                if not allowed:
                    recorder.stop(discard=True)
                    if audio_upload_task is not None:
                        audio_upload_task.cancel()
                    return
                recorder.allow()
                for publication in inbound.track_publications.values():
                    if publication.track is not None and publication.track.kind == rtc.TrackKind.KIND_AUDIO:
                        recorder.start(publication.track)
                        break

            @ctx.room.on("track_subscribed")
            def on_caller_track(track: Any, publication: Any, participant: Any) -> None:
                if (recorder is not None and stream is not None and stream.audio_consented
                        and not stream.revoked and participant.identity == inbound.identity
                        and track.kind == rtc.TrackKind.KIND_AUDIO):
                    recorder.start(track)

            stream = CallEventStream(client, f"ph-call-{uuid.uuid4()}", purpose=config.mode,
                                     on_warning=on_warning, transport="sip" if is_phone else "webrtc",
                                     caller_number=caller_number if is_phone else None,
                                     semantic_review=config.semantic_guard_review,
                                     on_progress=on_progress if not guard else None,
                                     on_audio_consent=on_audio_consent if not guard else None)
            await stream.start()

            async def start_relay() -> None:
                nonlocal relay_created
                if relay_created:
                    return
                remaining = max(1, int(deadline - asyncio.get_running_loop().time()))
                try:
                    await ctx.api.sip.create_sip_participant(api.CreateSIPParticipantRequest(
                        sip_trunk_id=config.outbound_trunk_id,
                        sip_call_to=config.guard_resident_number,
                        room_name=ctx.room.name,
                        participant_identity=resident_identity,
                        participant_name="Consenting test recipient",
                        hide_phone_number=True,
                        wait_until_answered=True,
                        ringing_timeout=Duration(seconds=min(30, remaining)),
                        max_call_duration=Duration(seconds=min(config.guard_max_seconds, remaining)),
                        participant_attributes={"pharos.role": "resident"},
                    ), timeout=min(40, remaining))
                    relay_created = True
                except Exception:
                    logger.error("Protected test relay could not connect; inspect the provider dashboard privately")
                    if session is not None:
                        await session.say("The recipient could not be connected. This test call will end.", allow_interruptions=False)
                        session.shutdown(drain=True)
                    request_end("recipient unavailable")

            session = AgentSession(
                stt=inference.STT(model=config.stt_model, language="en"),
                **({} if guard else {"llm": inference.LLM(model=config.llm_model)}),
                tts=inference.TTS(model=config.tts_model, voice=config.tts_voice),
                turn_handling={"turn_detection": inference.TurnDetector(), "preemptive_generation": {"enabled": False}},
                session_close_transcript_timeout=3.0,
            )
            intake = PharosAgent(stream, ctx, guard=guard, start_relay=start_relay)

            @session.on("conversation_item_added")
            def on_item(event: Any) -> None:
                item = event.item
                if item.role == "assistant" and stream.consented:
                    stream.turn("agent", item.text_content or "")
                elif item.role == "user" and stream.consented and item.id not in intake.persisted_user_ids:
                    intake.persisted_user_ids.add(item.id)
                    text = item.text_content or ""
                    if is_consent_withdrawal(text):
                        intake.stopped = True
                        stream.begin_revocation()
                        request_end("transcript consent withdrawn")
                    else:
                        # Closing can commit a final transcript without the reply
                        # hook. Preserve only still-consented facts, once.
                        stream.turn("caller", text)

            @session.on("close")
            def on_close(_: Any) -> None:
                request_end("voice session closed")

            @ctx.room.on("participant_disconnected")
            def on_participant_left(participant: rtc.RemoteParticipant) -> None:
                if participant.identity in {inbound.identity, resident_identity}:
                    request_end("call participant disconnected")

            await session.start(
                room=ctx.room, agent=intake, record=False,
                room_options=room_io.RoomOptions(
                    participant_identity=inbound.identity,
                    audio_input=room_io.AudioInputOptions(pre_connect_audio=False),
                    text_input=False, text_output=False, close_on_disconnect=True,
                ),
            )
            await session.say(GUARD_DISCLOSURE if guard else INTAKE_DISCLOSURE, allow_interruptions=not guard)
            await ended.wait()
    except TimeoutError:
        request_end("configured test duration reached")
    except BaseException as error:
        if not isinstance(error, asyncio.CancelledError):
            logger.error(safe_failure_diagnostic(error))
        request_end("voice session could not continue")
        raise
    finally:
        await cleanup()

@server.rtc_session(agent_name=settings.agent_name)
async def pharos_intake(ctx: agents.JobContext) -> None:
    await run_session(ctx, settings)


def main() -> None:
    if "--help" in sys.argv or "-h" in sys.argv:
        agents.cli.run_app(server)
        return
    if "--check-config" in sys.argv:
        try:
            settings.validate()
        except (ConfigurationError, ValueError) as error:
            print(str(error))
            raise SystemExit(1) from None
        print(f"Configuration shape is valid; mode={settings.mode}. No network request or phone call was made.")
        return
    try:
        settings.validate()
    except (ConfigurationError, ValueError) as error:
        raise SystemExit(str(error)) from None
    agents.cli.run_app(server)


if __name__ == "__main__":
    main()
