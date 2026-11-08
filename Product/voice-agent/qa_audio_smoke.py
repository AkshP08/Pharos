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
proof, and consumes existing LiveKit/inference credits. Maximum lifetime is 60s.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import traceback
import uuid
import wave

ROOT = Path(__file__).resolve().parent
RATE = 24000
SCRIPTS = (
    "Yes. We are safe. We need shelter near Northbank library in Zone two. There are three people.",
    "We have no injuries. We can wait safely at the library.",
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


def prepare_fixtures(directory: Path) -> list[Path]:
    fixtures = [directory / f"fictional-{index}.wav" for index in range(1, 3)]
    if all(path.is_file() for path in fixtures):
        for path in fixtures:
            decode_wav(path)
        return fixtures
    say, convert = shutil.which("say"), shutil.which("afconvert")
    if not say or not convert:
        raise QAError("local_tts_unavailable")
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    fixtures = []
    for index, script in enumerate(SCRIPTS, 1):
        intermediate = directory / f"fictional-{index}.aiff"
        target = directory / f"fictional-{index}.wav"
        for command in ([say, "-v", "Samantha", "-r", "175", "-o", str(intermediate), script],
                        [convert, "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1", str(intermediate), str(target)]):
            completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=25, check=False)
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


def passed(report: dict) -> bool:
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


async def run_live(fixtures: list[Path], max_seconds: int) -> dict:
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
    report = {"mode": "live_webrtc_audio_qa_simulation", "agentName": "pharos-intake",
              "notPhotonPhoneProof": True, "maxSeconds": max_seconds,
              "outboundPhoneCalls": 0, "microphoneUsed": False,
              "audioFramesReceived": 0, "activeAudioFrames": 0,
              "audioSamplesReceived": 0, "fixturesPublished": 0,
              "roomDisconnected": False, "roomDeleted": False}
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
        end = min(time.monotonic() + max_wait, deadline - 12)
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
        async with asyncio.timeout_at(deadline - 12):
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
            before = report["activeAudioFrames"]
            await publish(fixtures[1])
            report["secondResponseAudioObserved"] = await wait_for_quiet(before, 8)
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
                    report["backend"] = safe_backend_result(call, case)
                    if call.get("status") == "completed" and call.get("endedAt"):
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
    parser.add_argument("--max-seconds", type=int, default=60, choices=range(45, 61), metavar="45..60")
    parser.add_argument("--fixtures-dir", type=Path, help="Local fixture directory; default is a new private temporary directory.")
    args = parser.parse_args()
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
            fixtures = prepare_fixtures(directory)
            if args.live:
                report = asyncio.run(run_live(fixtures, args.max_seconds))
            else:
                report = {"mode": "prepare_only", "passed": True, "serviceCalls": 0,
                          "fixtures": [{"path": str(path), "seconds": round(len(decode_wav(path)) / (RATE * 2), 3)} for path in fixtures],
                          "liveRequires": "Explicit --live release after hosted browser tests enabled; restore false afterward."}
        print(json.dumps(report, sort_keys=True))
        return 0 if report.get("passed") else 1
    except Exception as exc:
        print(json.dumps({"passed": False, "error": safe_error(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
