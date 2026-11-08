import asyncio
import base64
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pharos_audio import CallerAudioRecorder, PcmBuffer, MAX_PCM_BYTES, CHUNK_BYTES, MAX_CHUNKS, upload_recording, _caller_stream
from pharos_runtime import CallEventStream, DeliveryError, VoiceEventClient, parse_consent


class PcmBufferTests(unittest.TestCase):
    def test_cap_alignment_chunk_count_and_discard(self):
        buffer = PcmBuffer()
        self.assertFalse(buffer.append(b'\x12\x34' * (MAX_PCM_BYTES // 2 + 5)))
        self.assertEqual(buffer.byte_length, MAX_PCM_BYTES)
        chunks = list(buffer.chunks())
        self.assertEqual(len(chunks), MAX_CHUNKS)
        self.assertEqual(chunks[-1][0], 87)
        self.assertTrue(all(0 < len(pcm) <= CHUNK_BYTES and len(pcm) % 2 == 0 for _, pcm in chunks))
        self.assertEqual(sum(len(pcm) for _, pcm in chunks), MAX_PCM_BYTES)
        buffer.discard()
        self.assertEqual(buffer.byte_length, 0)
        self.assertEqual(list(buffer.chunks()), [])
        with self.assertRaises(ValueError):
            buffer.append(b'\x01')


class FakeStream:
    def __init__(self):
        self.events = asyncio.Queue()
        self.closed = False
    def __aiter__(self):
        return self
    async def __anext__(self):
        return await self.events.get()
    async def aclose(self):
        self.closed = True
    def frame(self, data=b'\x01\x02' * 320, sample_rate=16000):
        self.events.put_nowait(SimpleNamespace(frame=SimpleNamespace(data=data, sample_rate=sample_rate, num_channels=1)))


class AudioCaptureTests(unittest.IsolatedAsyncioTestCase):
    async def test_sdk_stream_forces_mono_pcm_rate_and_bounded_native_queue(self):
        with patch('livekit.rtc.AudioStream') as constructor:
            _caller_stream('fictional-caller-track')
            constructor.assert_called_once_with('fictional-caller-track', sample_rate=16000,
                                                num_channels=1, frame_size_ms=20, capacity=10)

    async def test_capture_is_impossible_before_ack_gate_and_duplicate_track_does_not_double_record(self):
        stream = FakeStream()
        factory = MagicMock(return_value=stream)
        recorder = CallerAudioRecorder(stream_factory=factory)
        self.assertFalse(recorder.start('fictional-caller-track'))
        factory.assert_not_called()
        recorder.allow()
        self.assertTrue(recorder.start('fictional-caller-track'))
        self.assertFalse(recorder.start('duplicate-track'))
        stream.frame()
        await asyncio.sleep(0)
        self.assertEqual(recorder.buffer.byte_length, 640)
        factory.assert_called_once_with('fictional-caller-track')
        await recorder.aclose()
        self.assertTrue(stream.closed)
        self.assertEqual(recorder.buffer.byte_length, 640)
        recorder.stop(discard=True)
        self.assertEqual(recorder.buffer.byte_length, 0)

    async def test_withdrawal_synchronously_discards_and_cancels_late_frames(self):
        stream = FakeStream()
        recorder = CallerAudioRecorder(stream_factory=lambda track: stream)
        recorder.allow()
        recorder.start('caller')
        stream.frame()
        await asyncio.sleep(0)
        recorder.stop(discard=True)
        self.assertEqual(recorder.buffer.byte_length, 0)
        stream.frame()
        await recorder.aclose(discard=True)
        self.assertEqual(recorder.buffer.byte_length, 0)
        self.assertTrue(stream.closed)
        self.assertFalse(recorder.start('another-track'))


class AudioConsentAndUploadTests(unittest.IsolatedAsyncioTestCase):
    def test_transcript_only_agreement_keeps_facts_without_audio_and_normal_yes_opts_in(self):
        for phrase in ('Transcript only, water is rising.', 'Yes, transcript only, water is rising.', 'Yes but transcript only. Water is rising.'):
            answer = parse_consent(phrase)
            self.assertTrue(answer.decision)
            self.assertFalse(answer.audio_consent)
            self.assertIn('water is rising', answer.remainder.lower())
        answer = parse_consent('Yes, water is rising.')
        self.assertTrue(answer.audio_consent)
        self.assertEqual(answer.remainder, 'water is rising')
        self.assertIsNone(parse_consent('He said transcript only.').decision)
        self.assertFalse(parse_consent('No, transcript only.').decision)

    async def test_audio_callback_waits_for_ack_and_withdrawal_closes_it_synchronously(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def post(event, *args, **kwargs):
            if event == 'consent':
                entered.set()
                await release.wait()
                self.assertEqual(kwargs, {'consent': True, 'audioConsent': True})
            return {'accepted': True}
        callback = MagicMock()
        stream = CallEventStream(SimpleNamespace(post=post), 'fixture', purpose='intake', on_audio_consent=callback)
        consent = asyncio.create_task(stream.consent(True, audio_consent=True))
        await entered.wait()
        callback.assert_not_called()
        self.assertFalse(stream.audio_consented)
        release.set()
        await consent
        callback.assert_called_once_with(True)
        revocation = stream.begin_revocation()
        self.assertFalse(stream.audio_consented)
        self.assertEqual(callback.call_args.args, (False,))
        await revocation
        await stream.finish()

    async def test_late_consent_ack_after_withdrawal_cannot_reopen_audio_or_transcript(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def post(event, *args, **kwargs):
            if event == 'consent':
                entered.set()
                await release.wait()
            return {'accepted': True}
        callback = MagicMock()
        stream = CallEventStream(SimpleNamespace(post=post), 'fixture', purpose='intake', on_audio_consent=callback)
        pending = asyncio.create_task(stream.consent(True, audio_consent=True))
        await entered.wait()
        revoked = stream.begin_revocation()
        release.set()
        await asyncio.gather(pending, revoked)
        self.assertFalse(stream.consented)
        self.assertFalse(stream.audio_consented)
        callback.assert_called_once_with(False)
        await stream.finish()

    async def test_audio_http_retry_preserves_sequence_body_auth_and_bounds(self):
        requests = []
        async def handler(request):
            requests.append(request)
            return httpx.Response(503 if len(requests) == 1 else 200, json={'accepted': True})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = VoiceEventClient('https://pharos.example', 'fixture-ingest', client=http, sleep=AsyncMock())
            await client.audio_chunk('fictional/call', 0, b'\x01\x02' * 32768)
            await client.audio_complete('fictional/call', 0)
            for sequence, pcm in ((88, b'\x01\x02'), (0, b'\x01'), (0, b'\x01\x02' * 32769)):
                with self.assertRaises(DeliveryError):
                    await client.audio_chunk('fixture', sequence, pcm)
        self.assertEqual(len(requests), 3)
        self.assertEqual(requests[0].content, requests[1].content)
        body = json.loads(requests[0].content)
        self.assertEqual(body['sequence'], 0)
        self.assertEqual(len(base64.b64decode(body['pcmBase64'])), CHUNK_BYTES)
        self.assertLessEqual(len(requests[0].content), 96 * 1024)
        self.assertTrue(all(request.headers['Authorization'] == 'Bearer fixture-ingest' for request in requests))
        self.assertIn('fictional%2Fcall/audio/chunks', requests[0].url.raw_path.decode())
        self.assertEqual(json.loads(requests[-1].content), {'lastSequence': 0})

    async def test_upload_completes_in_order_and_always_discards_plaintext(self):
        recorder = CallerAudioRecorder()
        recorder.buffer.append(b'\x01\x02' * (CHUNK_BYTES + 20))
        client = SimpleNamespace(audio_chunk=AsyncMock(return_value={'accepted': True}),
                                 audio_complete=AsyncMock(return_value={'accepted': True}))
        self.assertTrue(await upload_recording(client, 'fixture', recorder, can_upload=lambda: True))
        self.assertEqual([call.args[1] for call in client.audio_chunk.await_args_list], [0, 1, 2])
        client.audio_complete.assert_awaited_once_with('fixture', 2)
        self.assertEqual(recorder.buffer.byte_length, 0)

    async def test_unflagged_discard_and_upload_failure_never_leave_audio_or_claim_completion(self):
        for result in ({'accepted': True, 'discarded': True}, DeliveryError('private provider failure')):
            recorder = CallerAudioRecorder()
            recorder.buffer.append(b'\x01\x02' * CHUNK_BYTES)
            client = SimpleNamespace(audio_chunk=AsyncMock(**({'side_effect': result} if isinstance(result, Exception) else {'return_value': result})),
                                     audio_complete=AsyncMock())
            if isinstance(result, Exception):
                with self.assertRaises(DeliveryError):
                    await upload_recording(client, 'fixture', recorder, can_upload=lambda: True)
            else:
                self.assertFalse(await upload_recording(client, 'fixture', recorder, can_upload=lambda: True))
            client.audio_chunk.assert_awaited_once()
            client.audio_complete.assert_not_awaited()
            self.assertEqual(recorder.buffer.byte_length, 0)

    async def test_revocation_during_chunk_prevents_more_chunks_or_completion(self):
        recorder = CallerAudioRecorder()
        recorder.buffer.append(b'\x01\x02' * CHUNK_BYTES)
        allowed = True
        async def chunk(*args):
            nonlocal allowed
            allowed = False
            return {'accepted': True}
        client = SimpleNamespace(audio_chunk=AsyncMock(side_effect=chunk), audio_complete=AsyncMock())
        self.assertFalse(await upload_recording(client, 'fixture', recorder, can_upload=lambda: allowed))
        client.audio_chunk.assert_awaited_once()
        client.audio_complete.assert_not_awaited()
        self.assertEqual(recorder.buffer.byte_length, 0)

    async def test_cancelled_upload_immediately_releases_plaintext_without_completion(self):
        entered = asyncio.Event()
        async def chunk(*args):
            entered.set()
            await asyncio.Future()
        recorder = CallerAudioRecorder()
        recorder.buffer.append(b'\x01\x02' * CHUNK_BYTES)
        client = SimpleNamespace(audio_chunk=AsyncMock(side_effect=chunk), audio_complete=AsyncMock())
        task = asyncio.create_task(upload_recording(client, 'fixture', recorder, can_upload=lambda: True))
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(recorder.buffer.byte_length, 0)
        client.audio_complete.assert_not_awaited()

    async def test_capture_stops_at_pcm_cap_and_rejects_wrong_format_without_keeping_audio(self):
        stream = FakeStream()
        recorder = CallerAudioRecorder(stream_factory=lambda track: stream)
        recorder.allow()
        recorder.start('caller')
        stream.frame(data=b'\x01\x02' * (MAX_PCM_BYTES // 2 + 1))
        await asyncio.sleep(0)
        self.assertEqual(recorder.buffer.byte_length, MAX_PCM_BYTES)
        self.assertTrue(stream.closed)
        await recorder.aclose(discard=True)
        wrong = FakeStream()
        recorder = CallerAudioRecorder(stream_factory=lambda track: wrong)
        recorder.allow()
        recorder.start('caller')
        wrong.frame(sample_rate=8000)
        await asyncio.sleep(0)
        self.assertEqual(recorder.buffer.byte_length, 0)
        self.assertTrue(wrong.closed)
        await recorder.aclose(discard=True)


if __name__ == '__main__':
    unittest.main()
