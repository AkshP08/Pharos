"""Testable call state and ordered, retry-safe delivery; no LiveKit dependencies."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("pharos-voice-agent")


class ConfigurationError(ValueError):
    pass


class DeliveryError(RuntimeError):
    """A sanitized transport failure; never includes request text or credentials."""


@dataclass(frozen=True)
class ConsentAnswer:
    decision: bool | None
    remainder: str = ""


def is_consent_withdrawal(text: str) -> bool:
    """Recognize explicit stop requests before persisting the request itself."""
    value = re.sub(r"\s+", " ", text.replace("’", "'")).strip()
    return bool(re.search(
        r"(?:^|[.!?;]\s*)(?:please\s+)?(?:stop|quit|end)\s+(?:recording|transcribing|transcription|saving|storing|monitoring|screening)\b"
        r"|\b(?:i|we)\s+(?:withdraw|revoke|cancel)\s+(?:(?:my|our|the)\s+)?consent\b"
        r"|\b(?:i|we)\s+(?:do not|don't|no longer)\s+(?:agree|consent)\b"
        r"|(?:^|[.!?;,]\s*)(?:please\s+)?(?:do not|don't)\s+(?:record|transcribe|save|store)\b",
        value, re.I,
    ))


def parse_consent(text: str) -> ConsentAnswer:
    """Separate uncertainty about agreement from uncertain need/location facts."""
    normalized = re.sub(r"\s+", " ", text.replace("’", "'")).strip()
    if is_consent_withdrawal(normalized):
        return ConsentAnswer(False)
    if re.match(r"^(?:no|nope|stop|i decline|i refuse)\b", normalized, re.I):
        return ConsentAnswer(False)
    match = re.match(r"^(?:(?:yes|yeah|yep)\b[\s,!.;-]*(?:i (?:agree|consent)\b[\s,!.;-]*)?|i (?:agree|consent)\b[\s,!.;-]*)(.*)$", normalized, re.I)
    if not match:
        return ConsentAnswer(None)
    remainder = match[1].strip(" ,!.;-")
    if (re.fullmatch(r"(?:no|nope)[\s,!.;-]*(?:stop)?", remainder, re.I)
            or re.match(r"^(?:but|if|unless|provided|only if)\b", remainder, re.I)
            or re.fullmatch(r"(?:maybe|not sure|unsure|i (?:do not|don't) know)", remainder, re.I)
            or re.search(r"\b(?:maybe|not sure|unsure)\b.{0,30}\b(?:consent|agree|recording|transcription|sharing)\b", remainder, re.I)):
        return ConsentAnswer(None)
    return ConsentAnswer(True, remainder)


@dataclass(frozen=True)
class Settings:
    api_url: str
    ingest_token: str
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str
    mode: str = "intake"
    agent_name: str = "pharos-intake"
    stt_model: str = "deepgram/nova-3"
    llm_model: str = "google/gemma-4-31b-it"
    tts_model: str = "fishaudio/s2.1-pro"
    tts_voice: str = "fa4c9eb3dccc4806b382b40d61c6b10a"
    guard_resident_number: str = ""
    outbound_trunk_id: str = ""
    guard_relay_enabled: bool = False
    guard_resident_consented: bool = False
    guard_allowed_callers: tuple[str, ...] = ()
    guard_max_seconds: int = 300
    test_caller_numbers: tuple[str, ...] = ()
    allow_browser_tests: bool = False
    max_call_seconds: int = 180
    semantic_guard_review: bool = True

    @classmethod
    def from_env(cls, environ: dict[str, str]) -> Settings:
        return cls(
            api_url=environ.get("PHAROS_API_URL", "").rstrip("/"),
            ingest_token=environ.get("PHAROS_INGEST_TOKEN", ""),
            livekit_url=environ.get("LIVEKIT_URL", ""),
            livekit_api_key=environ.get("LIVEKIT_API_KEY", ""),
            livekit_api_secret=environ.get("LIVEKIT_API_SECRET", ""),
            mode=environ.get("PHAROS_CALL_MODE", "intake"),
            agent_name=environ.get("PHAROS_AGENT_NAME", "pharos-intake"),
            stt_model=environ.get("PHAROS_STT_MODEL", cls.stt_model),
            llm_model=environ.get("PHAROS_LLM_MODEL", cls.llm_model),
            tts_model=environ.get("PHAROS_TTS_MODEL", cls.tts_model),
            tts_voice=environ.get("PHAROS_TTS_VOICE", cls.tts_voice),
            guard_resident_number=environ.get("PHAROS_GUARD_RESIDENT_NUMBER", ""),
            outbound_trunk_id=environ.get("LIVEKIT_OUTBOUND_TRUNK_ID", ""),
            guard_relay_enabled=environ.get("PHAROS_ENABLE_GUARD_RELAY") == "true",
            guard_resident_consented=environ.get("PHAROS_GUARD_RESIDENT_CONSENTED") == "true",
            guard_allowed_callers=tuple(value.strip() for value in environ.get("PHAROS_GUARD_ALLOWED_CALLERS", "").split(",") if value.strip()),
            guard_max_seconds=int(environ.get("PHAROS_GUARD_MAX_SECONDS", "300")),
            test_caller_numbers=tuple(value.strip() for value in environ.get("PHAROS_TEST_CALLER_NUMBERS", "").split(",") if value.strip()),
            allow_browser_tests=environ.get("PHAROS_ALLOW_BROWSER_TESTS") == "true",
            max_call_seconds=int(environ.get("PHAROS_MAX_CALL_SECONDS", "180")),
            semantic_guard_review=environ.get("PHAROS_SEMANTIC_GUARD_REVIEW", "true") == "true",
        )

    def validate(self) -> None:
        required = {
            "PHAROS_API_URL": self.api_url, "PHAROS_INGEST_TOKEN": self.ingest_token,
            "LIVEKIT_URL": self.livekit_url, "LIVEKIT_API_KEY": self.livekit_api_key,
            "LIVEKIT_API_SECRET": self.livekit_api_secret,
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise ConfigurationError("Missing settings: " + ", ".join(missing))
        parsed = urlparse(self.api_url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ConfigurationError("PHAROS_API_URL must be a plain origin without credentials or query parameters")
        if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
            raise ConfigurationError("PHAROS_API_URL must use HTTPS, except for loopback development")
        if not self.livekit_url.startswith("wss://"):
            raise ConfigurationError("LIVEKIT_URL must use wss://")
        if self.mode not in {"intake", "guard"}:
            raise ConfigurationError("PHAROS_CALL_MODE must be intake or guard")
        if not self.test_caller_numbers and not self.allow_browser_tests:
            raise ConfigurationError("Set PHAROS_TEST_CALLER_NUMBERS to consenting test callers before accepting public phone calls")
        if any(not re.fullmatch(r"\+[1-9]\d{6,14}", number) for number in self.test_caller_numbers):
            raise ConfigurationError("PHAROS_TEST_CALLER_NUMBERS must contain E.164 numbers")
        if not 30 <= self.max_call_seconds <= 300:
            raise ConfigurationError("PHAROS_MAX_CALL_SECONDS must be between 30 and 300")
        if self.mode == "guard":
            if not self.guard_relay_enabled or not self.guard_resident_consented:
                raise ConfigurationError("Guard relay requires PHAROS_ENABLE_GUARD_RELAY=true and PHAROS_GUARD_RESIDENT_CONSENTED=true after cost/teammate-consent review")
            if not self.outbound_trunk_id:
                raise ConfigurationError("Guard relay requires LIVEKIT_OUTBOUND_TRUNK_ID")
            if not re.fullmatch(r"\+[1-9]\d{6,14}", self.guard_resident_number):
                raise ConfigurationError("Guard relay requires a valid E.164 PHAROS_GUARD_RESIDENT_NUMBER")
            guard_callers = self.guard_allowed_callers or self.test_caller_numbers
            if not guard_callers or any(not re.fullmatch(r"\+[1-9]\d{6,14}", number) for number in guard_callers):
                raise ConfigurationError("Guard relay requires an E.164 PHAROS_GUARD_ALLOWED_CALLERS test allowlist")
            if not 30 <= self.guard_max_seconds <= 900:
                raise ConfigurationError("PHAROS_GUARD_MAX_SECONDS must be between 30 and 900")


class VoiceEventClient:
    def __init__(self, api_url: str, token: str, *, client: httpx.AsyncClient | None = None,
                 attempts: int = 4, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        self.api_url = api_url.rstrip("/")
        self.token = token
        self.attempts = attempts
        self.sleep = sleep
        self.client = client or httpx.AsyncClient(timeout=8.0, follow_redirects=False)
        self._owns_client = client is None

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def post(self, event: str, call_id: str, **payload: Any) -> dict[str, Any]:
        event_key = f"{call_id}:{event}:{payload.get('sequence', payload.get('consent', ''))}"
        # Stable across retry attempts; no transcript content in headers/identifiers.
        event_id = hashlib.sha256(event_key.encode()).hexdigest()
        body = {"event": event, "callId": call_id, "eventId": event_id, **payload}
        for attempt in range(self.attempts):
            try:
                response = await self.client.post(
                    f"{self.api_url}/api/voice/ingest",
                    headers={"Authorization": f"Bearer {self.token}", "Idempotency-Key": event_id},
                    json=body,
                )
            except httpx.TransportError:
                retryable = True
                status = "network"
            else:
                if 200 <= response.status_code < 300:
                    try:
                        result = response.json()
                    except ValueError:
                        raise DeliveryError("Voice backend returned an invalid acknowledgment") from None
                    if not isinstance(result, dict) or result.get("accepted") is not True:
                        raise DeliveryError("Voice backend did not acknowledge the event")
                    return result
                status = str(response.status_code)
                retryable = response.status_code in {408, 425, 429} or response.status_code >= 500
            if not retryable or attempt + 1 == self.attempts:
                raise DeliveryError(f"Voice event {event} was not delivered (status {status})") from None
            logger.warning("Voice event delivery will retry; event=%s attempt=%d status=%s", event, attempt + 1, status)
            await self.sleep(min(0.25 * (2 ** attempt), 2.0))
        raise DeliveryError("Voice delivery exhausted its retry budget")


WarningCallback = Callable[[dict[str, Any]], Awaitable[None]]
ReviewerFactory = Callable[[], Any]


def _semantic_reviewer() -> Any:
    # Intake and old/mock runtimes never import inference for this feature.
    from pharos_semantic import SemanticReviewer
    return SemanticReviewer()


class CallEventStream:
    """One in-memory ordered outbox per call, with sequence-idempotent retries."""
    def __init__(self, client: VoiceEventClient, call_id: str, *, purpose: str,
                 on_warning: WarningCallback | None = None, transport: str = "sip",
                 caller_number: str | None = None, semantic_review: bool = False,
                 reviewer_factory: ReviewerFactory | None = None):
        self.client = client
        self.call_id = call_id
        self.purpose = purpose
        self.transport = transport
        # Only authenticated SIP intake metadata may be sent for server-side
        # HMAC linkage. Never accept a browser attribute or a guard recipient.
        self._caller_number = (caller_number.strip() if purpose == "intake" and transport == "sip"
                               and isinstance(caller_number, str)
                               and re.fullmatch(r"\+[1-9]\d{6,14}", caller_number.strip()) else None)
        self._started = False
        self.on_warning = on_warning
        self.consented = False
        self.declined = False
        self.sequence = 0
        self.closed = False
        self.warning_url: str | None = None
        self._tail: asyncio.Task[dict[str, Any]] | None = None
        self._finish_task: asyncio.Task[None] | None = None
        self._seen_warnings: set[str] = set()
        self.delivery_failed = False
        self.revoked = False
        self._revocation_task: asyncio.Task[dict[str, Any]] | None = None
        self.semantic_review = purpose == "guard" and semantic_review
        self._reviewer_factory = reviewer_factory or _semantic_reviewer
        self._semantic_reviewer: Any = None
        self._semantic_task: asyncio.Task[None] | None = None
        self._semantic_close_task: asyncio.Task[None] | None = None
        self._semantic_stopped = False
        self._semantic_parts: list[str] = []
        self._semantic_pending: tuple[int, str] | None = None
        self._latest_caller_sequence: int | None = None
        self._semantic_requests = 0

    async def start(self) -> None:
        if self._started:
            return
        payload = {"purpose": self.purpose, "transport": self.transport}
        if self.semantic_review:
            payload["analysisMode"] = "semantic"
        if self._caller_number is not None:
            payload["callerNumber"] = self._caller_number
        result = await self.client.post("call.started", self.call_id, **payload)
        self.warning_url = result.get("warningUrl")
        self._started = True
        self._caller_number = None

    def _semantic_current(self, sequence: int) -> bool:
        return (self.semantic_review and self.consented and not self.closed and not self.revoked
                and not self._semantic_stopped and sequence == self._latest_caller_sequence)

    async def _notify_warning(self, result: dict[str, Any], *, semantic_sequence: int | None = None) -> None:
        if self.revoked or (semantic_sequence is not None and not self._semantic_current(semantic_sequence)):
            return
        warning = result.get("warning")
        if isinstance(warning, dict) and warning.get("id") and warning["id"] not in self._seen_warnings:
            self._seen_warnings.add(warning["id"])
            if self.on_warning:
                try:
                    await self.on_warning(warning)
                except Exception:
                    logger.error("Recipient warning callback failed; warning delivery needs review")

    def _acknowledge_semantic_caller(self, sequence: int, text: str) -> None:
        if not self.semantic_review or self.closed or self.revoked or not self.consented:
            return
        # Append only an acknowledged, consented caller turn. Assistant text and
        # private phone metadata never enter the reviewer context.
        self._semantic_parts.append(text)
        self._semantic_pending = (sequence, "\n".join(self._semantic_parts))
        if self._semantic_task is None:
            self._semantic_task = asyncio.create_task(self._review_semantic_pending())

    async def _post_semantic(self, event: str, sequence: int, **payload: Any) -> None:
        if not self._semantic_current(sequence):
            return
        try:
            result = await self.client.post(event, self.call_id, sequence=sequence, **payload)
        except DeliveryError:
            # Optional analysis never blocks/fails the transcript outbox, and no
            # heuristic substitutes a warning for an unavailable review.
            logger.error("Semantic review acknowledgment unavailable")
            return
        await self._notify_warning(result, semantic_sequence=sequence)

    async def _review_semantic_pending(self) -> None:
        snapshot = ""
        try:
            while self._semantic_pending is not None and not self._semantic_stopped:
                sequence, snapshot = self._semantic_pending
                self._semantic_pending = None
                if not self._semantic_current(sequence):
                    snapshot = ""
                    continue
                if self._semantic_requests >= 8:
                    snapshot = ""
                    await self._post_semantic("pressure.unavailable", sequence)
                    continue
                self._semantic_requests += 1
                try:
                    if self._semantic_reviewer is None:
                        self._semantic_reviewer = self._reviewer_factory()
                    review = await self._semantic_reviewer.review(snapshot)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    # Invalid output, timeout, provider/factory failure all mean
                    # unavailable. No transcript or provider exception is logged.
                    snapshot = ""
                    await self._post_semantic("pressure.unavailable", sequence)
                else:
                    snapshot = ""
                    await self._post_semantic("pressure.review", sequence, review=review)
        finally:
            snapshot = ""
            self._semantic_task = None

    def _stop_semantic(self) -> None:
        # This runs synchronously at the same gate as close/withdrawal; no later
        # turn or late model result may restart analysis or retain our context.
        self._semantic_stopped = True
        self._semantic_parts.clear()
        self._semantic_pending = None
        self._latest_caller_sequence = None
        task = self._semantic_task
        if task is not None:
            task.cancel()
        if not self.semantic_review or self._semantic_close_task is not None:
            return

        async def close_reviewer() -> None:
            if task is not None:
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            reviewer, self._semantic_reviewer = self._semantic_reviewer, None
            if reviewer is not None:
                try:
                    await reviewer.aclose()
                except Exception:
                    logger.error("Semantic reviewer cleanup unavailable")

        self._semantic_close_task = asyncio.create_task(close_reviewer())

    async def _close_semantic(self) -> None:
        if self._semantic_close_task is not None:
            await asyncio.shield(self._semantic_close_task)

    def enqueue(self, event: str, **payload: Any) -> asyncio.Task[dict[str, Any]]:
        previous = self._tail

        async def deliver() -> dict[str, Any]:
            if previous is not None:
                await previous
            if self.revoked and event == 'turn':
                return {"accepted": True, "skippedForRevocation": True}
            try:
                result = await self.client.post(event, self.call_id, **payload)
            except DeliveryError:
                self.delivery_failed = True
                raise
            if event == "turn" and payload.get("role") == "caller":
                self._acknowledge_semantic_caller(payload["sequence"], payload["text"])
            await self._notify_warning(result)
            return result

        task = asyncio.create_task(deliver())
        self._tail = task
        # Retrieve background assistant-turn errors without dumping PII-bearing tracebacks.
        def observe(done: asyncio.Task[dict[str, Any]]) -> None:
            if not done.cancelled() and done.exception() is not None:
                logger.error("Voice event not acknowledged; event=%s", event)
        task.add_done_callback(observe)
        return task

    async def consent(self, value: bool) -> None:
        if self.closed or self.consented or self.declined:
            return
        await self.enqueue("consent", consent=value)
        self.consented = value
        self.declined = not value

    def turn(self, role: str, text: str) -> asyncio.Task[dict[str, Any]] | None:
        if not self.consented or self.closed or self.declined or not text.strip():
            return None
        if role not in {"caller", "agent"}:
            raise ValueError("Unsupported voice role")
        sequence = self.sequence
        self.sequence += 1
        if role == "caller" and self.semantic_review:
            self._latest_caller_sequence = sequence
        return self.enqueue("turn", role=role, text=text.strip()[:1800], sequence=sequence)

    def begin_revocation(self) -> asyncio.Task[dict[str, Any]]:
        # Close the local gate synchronously, including final-transcript callbacks.
        self.revoked = True
        self.consented = False
        self.declined = True
        self.closed = True
        self.warning_url = None
        self._caller_number = None
        self._stop_semantic()
        if self._revocation_task is None:
            previous = self._tail

            async def revoke_after_pending() -> dict[str, Any]:
                if previous is not None:
                    try:
                        await previous
                    except DeliveryError:
                        self.delivery_failed = True
                # A prior delivery failure must not prevent privacy revocation.
                try:
                    return await self.client.post("consent.revoked", self.call_id)
                finally:
                    await self._close_semantic()

            self._revocation_task = asyncio.create_task(revoke_after_pending())
        return self._revocation_task

    async def revoke(self) -> None:
        await asyncio.shield(self.begin_revocation())

    async def finish(self) -> None:
        # Multiple close/disconnect/shutdown hooks converge on this one completion.
        if self._finish_task is None:
            self.closed = True
            self._caller_number = None
            self._stop_semantic()
            self._finish_task = asyncio.create_task(self._finish())
        await asyncio.shield(self._finish_task)

    async def _finish(self) -> None:
        await self._close_semantic()
        if self.revoked:
            try:
                await self.revoke()
            except DeliveryError:
                # Bounded final retry; never reopen the transcript gate.
                await self.client.post("consent.revoked", self.call_id)
            return
        if self._tail is not None:
            try:
                await self._tail
            except DeliveryError:
                self.delivery_failed = True
        if not self.consented:
            if not self.declined:
                await self.client.post("consent", self.call_id, consent=False)
                self.declined = True
            return
        await self.client.post("call.ended", self.call_id, deliveryFailed=self.delivery_failed)
