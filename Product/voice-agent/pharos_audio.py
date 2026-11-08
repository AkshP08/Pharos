"""Consented caller-track PCM capture, bounded in memory; no files or providers.

The authenticated backend encrypts accepted PCM chunks and constructs WAV for
authorized playback. This module never interprets tone, pacing, or identity.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Iterator
from typing import Any

SAMPLE_RATE = 16_000
CHANNELS = 1
SAMPLE_BYTES = 2
MAX_SECONDS = 180
MAX_PCM_BYTES = SAMPLE_RATE * CHANNELS * SAMPLE_BYTES * MAX_SECONDS
CHUNK_BYTES = 65_536
MAX_CHUNKS = 88
logger = logging.getLogger("pharos-voice-agent")


class PcmBuffer:
    def __init__(self) -> None:
        self._pcm = bytearray()

    @property
    def byte_length(self) -> int:
        return len(self._pcm)

    def append(self, pcm: bytes) -> bool:
        if len(pcm) % SAMPLE_BYTES:
            raise ValueError("Invalid PCM sample alignment")
        remaining = MAX_PCM_BYTES - len(self._pcm)
        if remaining > 0:
            self._pcm.extend(pcm[:remaining])
        return len(self._pcm) < MAX_PCM_BYTES

    def chunks(self) -> Iterator[tuple[int, bytes]]:
        for sequence, start in enumerate(range(0, len(self._pcm), CHUNK_BYTES)):
            yield sequence, bytes(self._pcm[start:start + CHUNK_BYTES])

    def discard(self) -> None:
        # Zero retained plaintext before releasing the buffer's allocation.
        self._pcm[:] = b"\x00" * len(self._pcm)
        self._pcm.clear()


def _caller_stream(track: Any) -> Any:
    from livekit import rtc
    return rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=CHANNELS,
                           frame_size_ms=20, capacity=10)


class CallerAudioRecorder:
    def __init__(self, *, stream_factory: Callable[[Any], Any] = _caller_stream) -> None:
        self.buffer = PcmBuffer()
        self._stream_factory = stream_factory
        self._task: asyncio.Task[None] | None = None
        self._stream: Any = None
        self._allowed = False
        self._started = False
        self._stopped = False

    def allow(self) -> None:
        # Called only after the authenticated consent acknowledgment.
        if not self._stopped:
            self._allowed = True

    def start(self, track: Any) -> bool:
        if not self._allowed or self._stopped or self._started:
            return False
        self._started = True
        self._task = asyncio.create_task(self._capture(track))
        return True

    async def _capture(self, track: Any) -> None:
        try:
            if not self._allowed or self._stopped:
                return
            self._stream = self._stream_factory(track)
            async for event in self._stream:
                if not self._allowed or self._stopped:
                    break
                frame = event.frame
                if frame.sample_rate != SAMPLE_RATE or frame.num_channels != CHANNELS:
                    raise ValueError("Unexpected caller PCM format")
                if not self.buffer.append(bytes(frame.data)):
                    self._allowed = False
                    self._stopped = True
                    break
        except asyncio.CancelledError:
            raise
        except Exception:
            self._allowed = False
            self._stopped = True
            self.buffer.discard()
            logger.error("Caller audio capture unavailable; no provider details logged")
        finally:
            stream, self._stream = self._stream, None
            if stream is not None:
                try:
                    await stream.aclose()
                except Exception:
                    logger.error("Caller audio stream cleanup unavailable")

    def stop(self, *, discard: bool = False) -> None:
        self._allowed = False
        self._stopped = True
        if self._task is not None:
            self._task.cancel()
        if discard:
            self.buffer.discard()

    async def aclose(self, *, discard: bool = False) -> None:
        self.stop(discard=discard)
        if self._task is not None:
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None


async def upload_recording(client: Any, call_id: str, recorder: CallerAudioRecorder,
                           *, can_upload: Callable[[], bool]) -> bool:
    """Upload only while consent survives; the server decides retention eligibility."""
    last_sequence = None
    try:
        for sequence, pcm in recorder.buffer.chunks():
            if not can_upload():
                return False
            result = await client.audio_chunk(call_id, sequence, pcm)
            pcm = b""
            if result.get("discarded") is True or not can_upload():
                return False
            last_sequence = sequence
        if last_sequence is None or not can_upload():
            return False
        result = await client.audio_complete(call_id, last_sequence)
        return result.get("discarded") is not True and can_upload()
    finally:
        recorder.buffer.discard()

