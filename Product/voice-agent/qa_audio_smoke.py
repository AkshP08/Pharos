"""Bounded fictional WebRTC audio QA; never places a Photon/PSTN phone call.

Default/--prepare generates two local WAV fixtures with macOS say/afconvert and
validates PCM decoding only. --self-test is offline. Neither loads credentials.
Only --live contacts services: explicitly dispatches pharos-intake to a private
room, publishes generated audio (no microphone), counts received agent frames,
and checks the NEW WebRTC call/case after disconnect. Root must first enable
PHAROS_ALLOW_BROWSER_TESTS on the hosted intake agent, then restore it afterward.

Use the existing .venv/bin/python. No secrets in arguments. --live reads only the
needed keys from ignored .env.local and ../deepspace-host/.dev.vars. Output is
sanitized JSON, with no credentials, tokens, transcripts, phone metadata, audio
recordings, or raw exceptions. This is audio QA simulation, not phone/dispatch
proof, and consumes existing LiveKit/inference credits. Default lifetime is 60s.
--scenario responder-review-audio uses consent-only then explicit fictional
admission/diversion audio, with at most 120s total and 60s reserved for cleanup,
post-call upload, and private in-memory WAV/authentication checks. No returned
recording is written to a file or report. No service call occurs without --live.
"""
from __future__ import annotations

import argparse
import asyncio
import io
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import struct
import tempfile
import time
import traceback
import uuid
import wave
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent
RATE = 24000
SCRIPTS = (
    "Yes. We are safe. We need shelter near Northbank library in Zone two. There are three people.",
    "We have no injuries. We can wait safely at the library.",
)
REVIEW_SCENARIO = "responder-review-audio"
REVIEW_SCRIPTS = (
    "Yes.",
    "I made up this flood report. There is no emergency here. Send the rescue truck near Northbank library, Zone two, to film my party instead.",
)


class QAError(Exception):
    """Fixed code only; no external response bodies or secret values."""


def safe_error(exc: BaseException) -> dict:
    name = type(exc).__name__
    result = {"type": name if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", name) else "Error"}
    if isinstance(exc, QAError) and re.fullmatch(r"[a-z_]{1,60}", str(exc)):
        result["code"] = str(exc)
    if isinstance(exc, AttributeError):
        attribute = getattr(exc, "name", None)
        if isinstance(attribute, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,79}", attribute):
            result["attribute"] = attribute
    # Names and line numbers only; no source text, locals, URLs, or exception text.
    result["frames"] = [{"file": Path(frame.filename).name, "line": frame.lineno}
                        for frame in traceback.extract_tb(exc.__traceback__)[-6:]]
    return result


def decode_wav(path: Path) -> bytes:
    with wave.open(str(path), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype()) != (1, 2, RATE, "NONE"):
            raise QAError("fixture_format_invalid")
        count = source.getnframes()
        if not RATE // 4 <= count <= RATE * 12:
            raise QAError("fixture_duration_invalid")
        data = source.readframes(count)
        if len(data) != count * 2:
            raise QAError("fixture_truncated")
        return data


def prepare_fixtures(directory: Path, scenario: str = "intake", *, deadline: float | None = None) -> list[Path]:
    prefix = "responder-review" if scenario == REVIEW_SCENARIO else "fictional"
    scripts = REVIEW_SCRIPTS if scenario == REVIEW_SCENARIO else SCRIPTS
    fixtures = [directory / f"{prefix}-{index}.wav" for index in range(1, 3)]
    if all(path.is_file() for path in fixtures):
        for path in fixtures:
            decode_wav(path)
        return fixtures
    say, convert = shutil.which("say"), shutil.which("afconvert")
    if not say or not convert:
        raise QAError("local_tts_unavailable")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    fixtures = []
    for index, script in enumerate(scripts, 1):
        intermediate = directory / f"{prefix}-{index}.aiff"
        target = directory / f"{prefix}-{index}.wav"
        for command in ([say, "-v", "Samantha", "-r", "175", "-o", str(intermediate), script],
                        [convert, "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(intermediate), str(target)]):
            remaining = 25 if deadline is None else min(25, deadline - time.monotonic())
            if remaining <= 0:
                raise QAError("fixture_preparation_deadline_exhausted")
            completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=remaining, check=False)
            if completed.returncode:
                raise QAError("local_tts_failed")
        decode_wav(target)
        intermediate.unlink(missing_ok=True)
        fixtures.append(target)
    return fixtures


def timestamp(value: str) -> float:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError, AttributeError):
        return 0


def select_new_call(overview: dict, started_at: float) -> tuple[dict | None, dict | None]:
    # Immediately exclude all other transports/old calls. Never print overview.
    matches = [call for call in overview.get("calls", []) if isinstance(call, dict)
               and call.get("transport") == "webrtc" and call.get("purpose") == "intake"
               and timestamp(call.get("startedAt")) >= started_at]
    if len(matches) > 1:
        raise QAError("ambiguous_new_webrtc_calls")
    if not matches:
        return None, None
    call = matches[0]
    case = next((item for item in overview.get("cases", []) if isinstance(item, dict)
                 and item.get("id") == call.get("caseId") and item.get("callId") == call.get("id")), None)
    return call, case


def safe_backend_result(call: dict, case: dict | None) -> dict:
    turns = call.get("turns", [])
    if not isinstance(turns, list):
        raise QAError("backend_turns_invalid")
    call_id = call.get("id")
    priority = case.get("priority") if case else None
    people = case.get("peopleCount") if case else None
    return {
        "callId": call_id if isinstance(call_id, str) and re.fullmatch(r"ph-call-[a-f0-9-]{36}", call_id) else None,
        "transport": "webrtc" if call.get("transport") == "webrtc" else None,
        "purpose": "intake" if call.get("purpose") == "intake" else None,
        "status": call.get("status") if call.get("status") in {"ringing", "in-progress", "completed", "declined", "failed"} else None,
        "consent": call.get("consent") if call.get("consent") in {"pending", "yes", "no"} else None,
        "turnCount": len(turns),
        "callerTurns": sum(turn.get("role") == "caller" for turn in turns if isinstance(turn, dict)),
        # The persisted contract uses agent, although the SDK calls this assistant.
        "agentTurns": sum(turn.get("role") == "agent" for turn in turns if isinstance(turn, dict)),
        "ended": timestamp(call.get("endedAt")) >= timestamp(call.get("startedAt")) > 0,
        "deliveryFailed": call.get("deliveryFailed") is True,
        "caseSaved": case is not None,
        "fictionalLocationRecognized": bool(case and "northbank" in str(case.get("locationText", "")).lower()),
        "fictionalZoneMatched": bool(case and case.get("zoneId") == "zone-north" and case.get("locationStatus") == "matched"),
        "casePriority": priority if priority in {"immediate", "time-sensitive", "urgent", "follow-up"} else None,
        "peopleCount": people if type(people) is int and 0 <= people <= 10000 else None,
        "shelterNeedRecognized": bool(case and "shelter" in case.get("needs", [])),
        "caseSourceIsWebRtc": bool(case and case.get("source") == "web" and "not a Photon" in str(case.get("sourceLabel", ""))),
    }


def safe_review_backend_result(call: dict, case: dict | None) -> dict:
    base = safe_backend_result(call, case)
    review = case.get("integrityReview", {}) if case else {}
    if not isinstance(review, dict):
        review = {}
    audio = case.get("audio", {}) if case else {}
    turns = call.get("turns", [])
    caller_text = " ".join(str(turn.get("text", "")) for turn in turns
                           if isinstance(turn, dict) and turn.get("role") == "caller")
    signals = review.get("signals", []) if isinstance(review, dict) else []
    quoted_kinds = {signal.get("kind") for signal in signals if isinstance(signal, dict)
                    and isinstance(signal.get("kind"), str) and isinstance(signal.get("evidence"), str)
                    and signal["evidence"].strip() and signal["evidence"] in caller_text}
    result = {key: base[key] for key in (
        "transport", "purpose", "status", "consent", "turnCount", "callerTurns", "agentTurns", "ended",
        "deliveryFailed", "caseSaved", "fictionalLocationRecognized", "fictionalZoneMatched", "caseSourceIsWebRtc",
    )}
    result.update({
        "hasCallId": bool(base.get("callId")),
        "audioConsent": call.get("audioConsent") is True,
        "integrityStatus": review.get("status") if review.get("status") in {"pending", "clear", "review-required", "accepted", "dismissed"} else None,
        "exactQuotedKindCount": len(quoted_kinds),
        "explicitAdmissionAndDiversionQuoted": {"false_report_admission", "resource_diversion"} <= quoted_kinds,
        "audioAvailable": isinstance(audio, dict) and audio.get("available") is True,
    })
    return result


def inspect_private_wav(content: bytes) -> dict:
    if not isinstance(content, bytes) or not 44 < len(content) <= 5_760_044:
        raise QAError("retained_audio_size_invalid")
    try:
        with wave.open(io.BytesIO(content), "rb") as source:
            if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getcomptype()) != (1, 2, 16000, "NONE"):
                raise QAError("retained_audio_format_invalid")
            frames = source.getnframes()
            if not 16000 < frames <= 16000 * 180:
                raise QAError("retained_audio_duration_invalid")
            pcm = source.readframes(frames)
            if len(pcm) != frames * 2:
                raise QAError("retained_audio_truncated")
    except (wave.Error, EOFError):
        raise QAError("retained_audio_format_invalid") from None
    active_samples = sum(abs(sample) > 180 for (sample,) in struct.iter_unpack("<h", pcm))
    pcm = b""
    if active_samples <= 16000:
        raise QAError("retained_audio_not_audible")
    return {"formatValid": True, "sampleRate": 16000, "channels": 1, "sampleBits": 16,
            "durationSeconds": round(frames / 16000, 3), "activeSeconds": round(active_samples / 16000, 3),
            "audioBytes": frames * 2}


def review_audio_passed(report: dict) -> bool:
    backend, audio = report.get("backend", {}), report.get("audioProof", {})
    return bool(not any(report.get(key) for key in ("error", "backendError", "cleanupErrors"))
                and report.get("disclosureAudioObserved") and report.get("fixturesPublished") == 2
                and report.get("firstResponseAudioObserved") and report.get("secondResponseAudioObserved")
                and report.get("audioConsentAckBeforeFacts") and report.get("roomDisconnected") and report.get("roomDeleted")
                and backend.get("hasCallId") and backend.get("transport") == "webrtc" and backend.get("purpose") == "intake"
                and backend.get("status") == "completed" and backend.get("ended") and backend.get("consent") == "yes"
                and backend.get("audioConsent") and backend.get("callerTurns", 0) >= 1 and backend.get("agentTurns", 0) >= 1
                and backend.get("caseSaved") and backend.get("fictionalLocationRecognized") and backend.get("fictionalZoneMatched")
                and backend.get("caseSourceIsWebRtc") and not backend.get("deliveryFailed")
                and backend.get("integrityStatus") == "review-required" and backend.get("exactQuotedKindCount", 0) >= 2
                and backend.get("explicitAdmissionAndDiversionQuoted") and backend.get("audioAvailable")
                and audio.get("formatValid") and audio.get("sampleRate") == 16000 and audio.get("channels") == 1
                and audio.get("sampleBits") == 16 and audio.get("durationSeconds", 0) > 1 and audio.get("activeSeconds", 0) > 1
                and audio.get("authenticatedStatus") == 200 and audio.get("unauthenticatedStatus") == 401)


def passed(report: dict) -> bool:
    if report.get("scenario") == REVIEW_SCENARIO:
        return review_audio_passed(report)
    backend = report.get("backend", {})
    return bool(not any(report.get(key) for key in ("error", "backendError", "cleanupErrors"))
                and report.get("disclosureAudioObserved") and report.get("fixturesPublished") == 2
                and report.get("firstResponseAudioObserved") and report.get("secondResponseAudioObserved")
                and report.get("roomDisconnected") and report.get("roomDeleted")
                and backend.get("callId") and backend.get("transport") == "webrtc" and backend.get("purpose") == "intake"
                and backend.get("status") == "completed" and backend.get("ended")
                and backend.get("consent") == "yes" and backend.get("callerTurns", 0) >= 2
                and backend.get("agentTurns", 0) >= 1 and backend.get("caseSaved")
                and backend.get("fictionalLocationRecognized") and backend.get("peopleCount") == 3
                and backend.get("fictionalZoneMatched") and backend.get("casePriority") in {"immediate", "time-sensitive", "urgent", "follow-up"}
                and backend.get("shelterNeedRecognized") and backend.get("caseSourceIsWebRtc")
                and not backend.get("deliveryFailed"))


async def bounded(operation, timeout: float, deadline: float):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise QAError("qa_deadline_exhausted")
    async with asyncio.timeout(min(timeout, remaining)):
        return await operation()


async def cleanup_step(label: str, operation, timeout: float, deadline: float, errors: list) -> bool:
    try:
        await bounded(operation, timeout, deadline)
        return True
    except Exception as exc:
        errors.append({"operation": label, **safe_error(exc)})
        return False


def live_configuration() -> dict[str, str]:
    from dotenv import dotenv_values
    local = dotenv_values(ROOT / ".env.local")
    backend = dotenv_values(ROOT.parent / "deepspace-host" / ".dev.vars")
    values = {key: os.environ.get(key) or local.get(key) or ""
              for key in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "PHAROS_API_URL")}
    values["PHAROS_RESPONDER_PASSWORD"] = os.environ.get("PHAROS_RESPONDER_PASSWORD") or backend.get("PHAROS_RESPONDER_PASSWORD") or ""
    if not all(values.values()):
        raise QAError("required_local_configuration_missing")
    if not values["LIVEKIT_URL"].startswith("wss://") or not values["PHAROS_API_URL"].startswith("https://"):
        raise QAError("secure_service_urls_required")
    return values


async def run_live(fixtures: list[Path], max_seconds: float, scenario: str = "intake") -> dict:
    # Match the runtime's macOS Keychain trust roots before constructing clients.
    import truststore
    truststore.inject_into_ssl()
    import aiohttp
    import httpx
    from livekit import api, rtc

    config = live_configuration()
    started = time.monotonic()
    start_wall = datetime.now(timezone.utc).timestamp()
    deadline = started + max_seconds
    review_scenario = scenario == REVIEW_SCENARIO
    reserve_seconds = 60 if review_scenario else 12
    interaction_deadline = deadline - reserve_seconds
    report = {"mode": "live_webrtc_audio_qa_simulation", "agentName": "pharos-intake",
              "notPhotonPhoneProof": True, "maxSeconds": max_seconds,
              "outboundPhoneCalls": 0, "microphoneUsed": False,
              "audioFramesReceived": 0, "activeAudioFrames": 0,
              "audioSamplesReceived": 0, "fixturesPublished": 0,
              "roomDisconnected": False, "roomDeleted": False}
    if review_scenario:
        report["scenario"] = REVIEW_SCENARIO
    room_name = f"pharos-fictional-audio-qa-{uuid.uuid4().hex}"
    room = rtc.Room()
    source = None
    reader_tasks: set[asyncio.Task] = set()
    last_active = 0.0
    first_active = asyncio.Event()
    cleanup_errors = []
    lk = api.LiveKitAPI(config["LIVEKIT_URL"], config["LIVEKIT_API_KEY"], config["LIVEKIT_API_SECRET"],
                        timeout=aiohttp.ClientTimeout(total=5), failover=False)
    http = httpx.AsyncClient(base_url=config["PHAROS_API_URL"].rstrip("/"), timeout=4, follow_redirects=False)

    async def receive(track):
        nonlocal last_active
        stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1, capacity=200)
        try:
            async for event in stream:
                frame = event.frame
                report["audioFramesReceived"] += 1
                report["audioSamplesReceived"] += frame.samples_per_channel
                # PCM is counted only, never stored or sent to another recognizer.
                if any(abs(sample) > 180 for sample in frame.data):
                    last_active = time.monotonic()
                    report["activeAudioFrames"] += 1
                    if not first_active.is_set():
                        report["firstAgentAudioSeconds"] = round(last_active - started, 3)
                        first_active.set()
        finally:
            await stream.aclose()

    @room.on("track_subscribed")
    def on_track(track, publication, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            task = asyncio.create_task(receive(track))
            reader_tasks.add(task)
            # Keep completed tasks for explicit exception retrieval in cleanup.

    async def wait_for_quiet(after_active_count: int, max_wait: float):
        end = min(time.monotonic() + max_wait, interaction_deadline)
        while time.monotonic() < end:
            if report["activeAudioFrames"] > after_active_count and time.monotonic() - last_active >= 0.9:
                return True
            await asyncio.sleep(0.1)
        return False

    async def publish(path: Path):
        pcm = decode_wav(path)
        # 20ms, mono int16; AudioSource backpressure paces delivery in real time.
        size = RATE // 50 * 2
        for offset in range(0, len(pcm), size):
            chunk = pcm[offset:offset + size]
            await source.capture_frame(rtc.AudioFrame(chunk, RATE, 1, len(chunk) // 2))
        await source.wait_for_playout()
        report["fixturesPublished"] += 1

    created = False
    try:
        # Keep the interaction inside 48s even with a 20s hosted cold start.
        # The final 12s are for disconnect, room deletion, backend ACK, and closes.
        async with asyncio.timeout_at(interaction_deadline):
            login = await http.post("/api/auth/login", json={"password": config["PHAROS_RESPONDER_PASSWORD"]})
            if login.status_code != 200 or not http.cookies:
                raise QAError("backend_login_failed")
            await lk.room.create_room(api.CreateRoomRequest(name=room_name, empty_timeout=10, departure_timeout=10, max_participants=2))
            created = True
            token = (api.AccessToken(config["LIVEKIT_API_KEY"], config["LIVEKIT_API_SECRET"])
                     .with_identity(f"fictional-audio-qa-{uuid.uuid4().hex}")
                     .with_name("Fictional automated audio QA")
                     .with_ttl(timedelta(minutes=2))
                     .with_grants(api.VideoGrants(room_join=True, room=room_name, can_publish=True,
                                                   can_subscribe=True, can_publish_data=False))
                     .to_jwt())
            await room.connect(config["LIVEKIT_URL"], token, options=rtc.RoomOptions(auto_subscribe=True, connect_timeout=8))
            source = rtc.AudioSource(RATE, 1, queue_size_ms=200)
            track = rtc.LocalAudioTrack.create_audio_track("fictional-generated-audio", source)
            await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
            # Standard participant (no SIP attributes), microphone source classification
            # only: the track contains generated PCM and never opens a physical device.
            await lk.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(
                room=room_name, agent_name="pharos-intake", metadata=json.dumps({"qa": "fictional_webrtc_audio"})))
            await asyncio.wait_for(first_active.wait(), timeout=27)
            if not await wait_for_quiet(0, 10):
                raise QAError("disclosure_audio_not_finished")
            report["disclosureAudioObserved"] = True
            before = report["activeAudioFrames"]
            await publish(fixtures[0])
            report["firstResponseAudioObserved"] = await wait_for_quiet(before, 10)
            if not report["firstResponseAudioObserved"]:
                raise QAError("no_agent_audio_after_fictional_consent")
            if review_scenario:
                # A spoken post-consent prompt follows the ingest ACK. Confirm
                # the same separately in the backend before publishing facts.
                response = await http.get("/api/overview")
                if response.status_code != 200:
                    raise QAError("consent_ack_check_unavailable")
                call, _ = select_new_call(response.json(), start_wall)
                if not call or call.get("consent") != "yes" or call.get("audioConsent") is not True:
                    raise QAError("audio_consent_not_acknowledged")
                report["audioConsentAckBeforeFacts"] = True
            before = report["activeAudioFrames"]
            await publish(fixtures[1])
            report["secondResponseAudioObserved"] = await wait_for_quiet(before, 8)
            if review_scenario:
                # Give the one bounded review a chance to finish before hanging
                # up; finalization intentionally cancels pending model work.
                review_deadline = min(time.monotonic() + 8, interaction_deadline)
                while time.monotonic() < review_deadline:
                    response = await http.get("/api/overview")
                    if response.status_code != 200:
                        raise QAError("review_check_unavailable")
                    call, case = select_new_call(response.json(), start_wall)
                    if call and case:
                        result = safe_review_backend_result(call, case)
                        if result["integrityStatus"] == "review-required" and result["explicitAdmissionAndDiversionQuoted"]:
                            break
                    await asyncio.sleep(0.5)
    except Exception as exc:
        report["error"] = safe_error(exc)
    finally:
        # Cleanup is attempted for partial startup failures as well as success.
        for label, operation, seconds in (
            ("disconnect", room.disconnect, 2),
            ("delete_room", lambda: lk.room.delete_room(api.DeleteRoomRequest(room=room_name)), 3),
        ):
            if label == "delete_room" and not created:
                continue
            if await cleanup_step(label, operation, seconds, deadline - 2.2, cleanup_errors):
                report["roomDisconnected" if label == "disconnect" else "roomDeleted"] = True
        for task in reader_tasks:
            task.cancel()
        if reader_tasks:
            try:
                results = await bounded(lambda: asyncio.gather(*reader_tasks, return_exceptions=True), 0.7, deadline - 2.2)
            except Exception as exc:
                results = [exc]
            for result in results:
                if isinstance(result, Exception):
                    cleanup_errors.append({"operation": "audio_reader", **safe_error(result)})
        if source is not None:
            await cleanup_step("close_audio_source", source.aclose, 0.5, deadline - 2.2, cleanup_errors)
        # Only consume the uniquely new WebRTC intake. Other calls are not logged.
        try:
            while time.monotonic() < deadline - 2.2:
                response = await bounded(lambda: http.get("/api/overview"), 4, deadline - 2.2)
                if response.status_code != 200:
                    raise QAError("backend_overview_unavailable")
                call, case = select_new_call(response.json(), start_wall)
                if call:
                    report["backend"] = safe_review_backend_result(call, case) if review_scenario else safe_backend_result(call, case)
                    if call.get("status") == "completed" and call.get("endedAt"):
                        if not review_scenario:
                            break
                        if case and report["backend"]["audioAvailable"]:
                            path = f"/api/cases/{quote(str(case['id']), safe='')}/audio"
                            audio_response = await bounded(lambda: http.get(path), 4, deadline - 2.2)
                            if audio_response.status_code != 200:
                                raise QAError("retained_audio_fetch_failed")
                            report["audioProof"] = {**inspect_private_wav(audio_response.content), "authenticatedStatus": 200}
                            audio_response = None  # Never persist returned WAV bytes.
                            unsigned = http.build_request("GET", path)
                            unsigned.headers.pop("cookie", None)
                            unsigned.headers.pop("authorization", None)
                            rejected = await bounded(lambda: http.send(unsigned), 4, deadline - 2.2)
                            report["audioProof"]["unauthenticatedStatus"] = rejected.status_code
                            break
                await asyncio.sleep(min(0.7, max(0.01, deadline - time.monotonic() - 2.2)))
        except Exception as exc:
            report["backendError"] = safe_error(exc)
        await cleanup_step("close_http_client", http.aclose, 1, deadline, cleanup_errors)
        await cleanup_step("close_livekit_client", lk.aclose, 1, deadline, cleanup_errors)
    if cleanup_errors:
        report["cleanupErrors"] = cleanup_errors
    report["passed"] = passed(report)
    report["elapsedSeconds"] = round(time.monotonic() - started, 3)
    report["cost"] = "Not estimated: provider billing metrics required; no PSTN leg used."
    report["limitations"] = ["Generated fictional WebRTC audio; not a Photon/PSTN call.",
                             "Received audio energy proves audible output, not the exact spoken words.",
                             "No ETA mutation, real dispatch, notification permission, or physical phone test.",
                             "A completed backend call does not prove absence of hosted post-call errors; inspect safe cloud frames."]
    if review_scenario:
        # New scenario emits counts/status/durations only, never identifiers,
        # private WAV bytes, transcript snippets, or fixture paths.
        report.pop("cost", None)
        report.pop("limitations", None)
    return report


def self_test() -> dict:
    # Decoding boundary and transport/time/ambiguity checks, all local and secret-free.
    checks = 9
    with tempfile.TemporaryDirectory(prefix="pharos-audio-decoder-test-") as directory:
        path = Path(directory) / "fixture.wav"
        for channels, width, rate, seconds, accepted in ((1, 2, RATE, 1, True), (2, 2, RATE, 1, False),
                                                       (1, 1, RATE, 1, False), (1, 2, 16000, 1, False),
                                                       (1, 2, RATE, 0.1, False), (1, 2, RATE, 13, False)):
            with wave.open(str(path), "wb") as target:
                target.setnchannels(channels); target.setsampwidth(width); target.setframerate(rate)
                target.writeframes(b"\0" * int(rate * seconds) * channels * width)
            try:
                decode_wav(path)
                assert accepted
            except QAError:
                assert not accepted
        now = datetime.now(timezone.utc)
        fixture = {"id": "qa-new", "transport": "webrtc", "purpose": "intake", "startedAt": now.isoformat(), "caseId": "case-qa"}
        overview = {"calls": [dict(fixture, id="old", startedAt=(now - timedelta(hours=1)).isoformat()),
                               dict(fixture, id="phone", transport="sip"), fixture],
                    "cases": [{"id": "case-qa", "callId": "qa-new"}]}
        selected, case = select_new_call(overview, now.timestamp() - 1)
        assert selected["id"] == "qa-new" and case["callId"] == "qa-new"
        overview["calls"].append(dict(fixture, id="other-new"))
        try:
            select_new_call(overview, now.timestamp() - 1)
            raise AssertionError("ambiguous selection accepted")
        except QAError as exc:
            assert str(exc) == "ambiguous_new_webrtc_calls"
        error = safe_error(AttributeError("secret fixture value should never escape"))
        assert "secret fixture" not in json.dumps(error)
        # These are persisted domain roles, not SDK role aliases. Reproduces the
        # former always-zero assistant counter and ensures honest failure results.
        call = {**fixture, "id": "ph-call-00000000-0000-0000-0000-000000000001", "status": "completed", "consent": "yes",
                "turns": [{"role": "caller", "text": "private fictional text"}, {"role": "agent"}, {"role": "caller"}],
                "endedAt": (now + timedelta(seconds=1)).isoformat()}
        case = {"priority": "follow-up", "peopleCount": 3, "needs": ["shelter"], "locationText": "Northbank library",
                "zoneId": "zone-north", "locationStatus": "matched",
                "source": "web", "sourceLabel": "LiveKit browser audio test · not a Photon phone call"}
        backend = safe_backend_result(call, case)
        report = {"disclosureAudioObserved": True, "fixturesPublished": 2, "firstResponseAudioObserved": True,
                  "secondResponseAudioObserved": True, "roomDisconnected": True, "roomDeleted": True, "backend": backend}
        assert backend["agentTurns"] == 1 and passed(report)
        assert "private fictional text" not in json.dumps(backend)
        checks += 2
        for key, value in (("backendError", {"type": "TimeoutError"}), ("cleanupErrors", [{"type": "AttributeError"}]),
                           ("error", {"type": "TimeoutError"}), ("fixturesPublished", 1), ("roomDeleted", False)):
            assert not passed({**report, key: value})
            checks += 1
        for key, value in (("agentTurns", 0), ("ended", False), ("peopleCount", 4), ("caseSourceIsWebRtc", False),
                           ("deliveryFailed", True), ("consent", "no"), ("transport", "sip"),
                           ("casePriority", None), ("fictionalZoneMatched", False)):
            assert not passed({**report, "backend": {**backend, key: value}})
            checks += 1
        sanitized = safe_backend_result({**call, "id": "private unexpected metadata", "status": "private unexpected metadata"},
                                        {**case, "priority": "private unexpected metadata", "peopleCount": "private unexpected metadata"})
        assert "private unexpected metadata" not in json.dumps(sanitized)
        checks += 1
        review_text = "I made up this flood report. Send the rescue truck to film my party."
        review_call = {**call, "audioConsent": True, "turns": [{"role": "caller", "text": review_text}, {"role": "agent"}]}
        review_case = {**case, "integrityReview": {"status": "review-required", "signals": [
            {"kind": "false_report_admission", "evidence": "I made up this flood report."},
            {"kind": "resource_diversion", "evidence": "Send the rescue truck to film my party."}]},
            "audio": {"available": True}}
        review_backend = safe_review_backend_result(review_call, review_case)
        private_wav = io.BytesIO()
        with wave.open(private_wav, "wb") as target:
            target.setnchannels(1); target.setsampwidth(2); target.setframerate(16000)
            target.writeframes(struct.pack("<h", 1000) * 32000)
        proof = {**inspect_private_wav(private_wav.getvalue()), "authenticatedStatus": 200, "unauthenticatedStatus": 401}
        review_report = {**report, "scenario": REVIEW_SCENARIO, "audioConsentAckBeforeFacts": True,
                         "backend": review_backend, "audioProof": proof}
        assert passed(review_report)
        assert review_text not in json.dumps(review_backend) and "callId" not in review_backend
        for key, value in (("audioConsent", False), ("integrityStatus", "clear"), ("audioAvailable", False),
                           ("explicitAdmissionAndDiversionQuoted", False), ("fictionalZoneMatched", False),
                           ("status", "in-progress")):
            assert not passed({**review_report, "backend": {**review_backend, key: value}})
            checks += 1
        for key, value in (("unauthenticatedStatus", 200), ("sampleRate", 24000), ("activeSeconds", 0.5)):
            assert not passed({**review_report, "audioProof": {**proof, key: value}})
            checks += 1
        assert not passed({**review_report, "audioConsentAckBeforeFacts": False})
        bad_quote = {**review_case, "integrityReview": {**review_case["integrityReview"], "signals": [
            {"kind": "resource_diversion", "evidence": "a made-up quote"}]}}
        assert not safe_review_backend_result(review_call, bad_quote)["explicitAdmissionAndDiversionQuoted"]
        silent = io.BytesIO()
        with wave.open(silent, "wb") as target:
            target.setnchannels(1); target.setsampwidth(2); target.setframerate(16000)
            target.writeframes(b"\0\0" * 32000)
        try:
            inspect_private_wav(silent.getvalue())
            raise AssertionError("silent recording accepted")
        except QAError as exc:
            assert str(exc) == "retained_audio_not_audible"
        checks += 4

    async def timing_and_cleanup_checks():
        executed = []

        async def hang():
            await asyncio.Event().wait()

        began = time.monotonic()
        try:
            await bounded(hang, 1, began + 0.02)
            raise AssertionError("deadline did not cancel operation")
        except TimeoutError:
            assert time.monotonic() - began < 0.5

        async def success():
            executed.append("completed")

        try:
            await bounded(success, 1, time.monotonic() - 1)
            raise AssertionError("expired deadline executed operation")
        except QAError:
            assert not executed

        async def failing_close():
            raise AttributeError("private SDK exception value")

        errors = []
        deadline = time.monotonic() + 1
        assert not await cleanup_step("first_client", failing_close, 0.1, deadline, errors)
        assert await cleanup_step("second_client", success, 0.1, deadline, errors)
        assert executed == ["completed"] and errors[0]["type"] == "AttributeError"
        assert "private SDK exception value" not in json.dumps(errors)

    asyncio.run(timing_and_cleanup_checks())
    return {"mode": "offline_self_test", "passed": True, "checks": checks + 3, "serviceCalls": 0}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--prepare", action="store_true", help="Generate/validate local fixtures only (default).")
    mode.add_argument("--self-test", action="store_true", help="Run offline decoder/selection/privacy checks only.")
    mode.add_argument("--live", action="store_true", help="Explicitly authorize one bounded fictional WebRTC session using existing credits.")
    parser.add_argument("--scenario", choices=("intake", REVIEW_SCENARIO), default="intake",
                        help="Default intake proof or bounded private responder-review/audio proof.")
    parser.add_argument("--max-seconds", type=int, choices=range(45, 121), metavar="45..120")
    parser.add_argument("--fixtures-dir", type=Path, help="Local fixture directory; default is a new private temporary directory.")
    args = parser.parse_args()
    max_seconds = args.max_seconds if args.max_seconds is not None else (120 if args.scenario == REVIEW_SCENARIO else 60)
    if args.scenario == "intake" and not 45 <= max_seconds <= 60:
        parser.error("default intake scenario must stay within 45..60 seconds")
    if args.scenario == REVIEW_SCENARIO and not 90 <= max_seconds <= 120:
        parser.error("responder-review-audio requires 90..120 seconds including its 60-second finalization reserve")
    qa_started = time.monotonic()
    logging.disable(logging.CRITICAL)
    # Suppress raw third-party diagnostics, including native SDK stderr. Only our
    # fixed-code/safe-frame JSON leaves the process. No audio/token debugging.
    null = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null, 2)
    os.close(null)
    try:
        if args.self_test:
            report = self_test()
        else:
            directory = args.fixtures_dir or Path(tempfile.mkdtemp(prefix="pharos-fictional-audio-qa-"))
            fixtures = prepare_fixtures(directory, args.scenario,
                                        deadline=qa_started + max_seconds if args.scenario == REVIEW_SCENARIO else None)
            if args.live:
                remaining = max_seconds - (time.monotonic() - qa_started) if args.scenario == REVIEW_SCENARIO else max_seconds
                if args.scenario == REVIEW_SCENARIO and remaining < 90:
                    raise QAError("fixture_preparation_exhausted_live_budget")
                report = asyncio.run(run_live(fixtures, remaining, args.scenario))
                if args.scenario == REVIEW_SCENARIO:
                    report["elapsedSeconds"] = round(time.monotonic() - qa_started, 3)
            else:
                report = {"mode": "prepare_only", "passed": True, "serviceCalls": 0,
                          "fixtures": [{**({"path": str(path)} if args.scenario == "intake" else {}),
                                        "seconds": round(len(decode_wav(path)) / (RATE * 2), 3)} for path in fixtures],
                          "liveRequires": "Explicit --live release after hosted browser tests enabled; restore false afterward."}
                if args.scenario == REVIEW_SCENARIO:
                    report["scenario"] = REVIEW_SCENARIO
        print(json.dumps(report, sort_keys=True))
        return 0 if report.get("passed") else 1
    except Exception as exc:
        print(json.dumps({"passed": False, "error": safe_error(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
