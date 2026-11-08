"""No service calls, microphones, phone numbers, or live credentials are used."""
import asyncio
import time
import unittest
import sys
from pathlib import Path
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from livekit.agents import StopResponse, llm

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent
from agent import PharosAgent
from pharos_runtime import CallEventStream, ConfigurationError, DeliveryError, Settings, VoiceEventClient, parse_consent


class ConsentTests(unittest.TestCase):
    def test_requires_clear_initial_yes(self):
        for answer in ("I heard him say yes", "not sure", "maybe yes", "yes but only if", "yesterday", "okay"):
            self.assertIsNone(parse_consent(answer).decision, answer)
        for answer in ("no", "Nope, stop", "I don't consent", "Yes, don't record me"):
            self.assertFalse(parse_consent(answer).decision, answer)

    def test_preserves_combined_yes_and_facts(self):
        answer = parse_consent("Yes, we are near Riverbend and need a safe ride.")
        self.assertTrue(answer.decision)
        self.assertEqual(answer.remainder, "we are near Riverbend and need a safe ride")
        self.assertTrue(parse_consent("Yes, no one is injured.").decision)
        for text in ("Yes, not sure where I am", "Yes, maybe we need a ride"):
            self.assertTrue(parse_consent(text).decision, text)
            self.assertTrue(parse_consent(text).remainder, text)
        self.assertIsNone(parse_consent("Yes, no, stop").decision)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(api_url="https://pharos.example", ingest_token="fixture", livekit_url="wss://example.livekit.cloud", livekit_api_key="fixture", livekit_api_secret="fixture", test_caller_numbers=("+12025550102",))

    def test_no_public_insecure_backend(self):
        with self.assertRaises(ConfigurationError):
            replace(self.settings, api_url="http://public.example").validate()
        replace(self.settings, api_url="http://127.0.0.1:8786").validate()

    def test_guard_is_off_until_explicitly_configured(self):
        with self.assertRaises(ConfigurationError):
            replace(self.settings, mode="guard").validate()
        configured = replace(self.settings, mode="guard", guard_relay_enabled=True, guard_resident_consented=True,
                             outbound_trunk_id="ST_fixture", guard_resident_number="+12025550101", guard_allowed_callers=("+12025550102",))
        configured.validate()
        with self.assertRaises(ConfigurationError):
            replace(configured, guard_max_seconds=3600).validate()

    def test_public_phone_intake_also_requires_test_callers_and_duration_cap(self):
        with self.assertRaises(ConfigurationError):
            replace(self.settings, test_caller_numbers=()).validate()
        with self.assertRaises(ConfigurationError):
            replace(self.settings, max_call_seconds=3600).validate()
        replace(self.settings, test_caller_numbers=(), allow_browser_tests=True).validate()


class DeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_sip_intake_number_goes_only_to_authenticated_start_event(self):
        requests = []
        async def handler(request):
            requests.append(request)
            return httpx.Response(202, json={"accepted": True})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = VoiceEventClient("https://pharos.example", "fixture-token", client=http)
            stream = CallEventStream(client, "fixture-repeat-call", purpose="intake", transport="sip",
                                     caller_number="+12025550102")
            await stream.start()
            await stream.start()  # A local start retry cannot change the accepted payload.
            self.assertIsNone(stream._caller_number)
            await stream.consent(True)
            await stream.turn("caller", "I am calling back about the same fictional situation near Riverbend.")
            await stream.finish()
        import json
        bodies = [json.loads(request.content) for request in requests]
        self.assertEqual(bodies[0]["event"], "call.started")
        self.assertEqual(bodies[0]["callerNumber"], "+12025550102")
        self.assertEqual(requests[0].headers["Authorization"], "Bearer fixture-token")
        self.assertTrue(all("callerNumber" not in body for body in bodies[1:]))
        self.assertEqual(sum(body["event"] == "call.started" for body in bodies), 1)

    async def test_guard_browser_and_invalid_metadata_never_forward_a_number(self):
        for purpose, transport, number in (("guard", "sip", "+12025550102"),
                                           ("intake", "webrtc", "+12025550102"),
                                           ("intake", "sip", "not-an-e164-number")):
            with self.subTest(purpose=purpose, transport=transport):
                post = AsyncMock(return_value={"accepted": True})
                stream = CallEventStream(SimpleNamespace(post=post), "fixture", purpose=purpose,
                                         transport=transport, caller_number=number)
                await stream.start()
                self.assertNotIn("callerNumber", post.await_args.kwargs)
                self.assertIsNone(stream._caller_number)

    async def test_retry_reuses_event_id_and_preserves_body(self):
        requests = []
        async def handler(request):
            requests.append(request)
            return httpx.Response(503 if len(requests) == 1 else 202, json={"accepted": True})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = VoiceEventClient("https://pharos.example", "fixture", client=http, sleep=AsyncMock())
            result = await client.post("turn", "fixture-call", sequence=0, role="caller", text="Fictional help request")
        self.assertTrue(result["accepted"])
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"])
        self.assertEqual(requests[0].content, requests[1].content)

    async def test_permanent_errors_fail_without_retry_or_sensitive_error_text(self):
        seen = []
        async def handler(request):
            seen.append(request)
            return httpx.Response(403, json={"error": "never echo this body"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = VoiceEventClient("https://pharos.example", "fixture", client=http)
            with self.assertRaises(DeliveryError) as raised:
                await client.post("turn", "fixture-call", sequence=0, text="never echo private text")
        self.assertEqual(len(seen), 1)
        self.assertNotIn("private", str(raised.exception))
        self.assertNotIn("body", str(raised.exception))

    async def test_outbox_orders_turns_and_finalizes_only_once(self):
        events = []
        async def post(event, call_id, **payload):
            await asyncio.sleep(0)
            events.append((event, payload))
            return {"accepted": True}
        client = SimpleNamespace(post=post)
        stream = CallEventStream(client, "fixture", purpose="intake")
        await stream.start()
        self.assertIsNone(stream.turn("caller", "Do not save before consent"))
        await stream.consent(True)
        stream.turn("caller", "Fictional first answer")
        stream.turn("agent", "Where are you?")
        stream.turn("caller", "Fictional landmark")
        await asyncio.gather(stream.finish(), stream.finish())
        self.assertEqual([event for event, _ in events], ["call.started", "consent", "turn", "turn", "turn", "call.ended"])
        self.assertEqual([payload["sequence"] for event, payload in events if event == "turn"], [0, 1, 2])
        self.assertIsNone(stream.turn("caller", "Do not save after close"))

    async def test_duplicate_warning_is_delivered_once(self):
        callback = AsyncMock()
        async def post(event, call_id, **payload):
            return {"accepted": True, **({"warning": {"id": "warning-1", "level": "high"}} if event == "turn" else {})}
        stream = CallEventStream(SimpleNamespace(post=post), "fixture", purpose="guard", on_warning=callback)
        await stream.start()
        await stream.consent(True)
        await stream.turn("caller", "First fictional tactic")
        await stream.turn("caller", "Second fictional tactic")
        await stream.finish()
        callback.assert_awaited_once()

    async def test_transport_failure_still_marks_partial_end(self):
        events = []
        async def post(event, call_id, **payload):
            events.append((event, payload))
            if event == "turn":
                raise DeliveryError("fixture transport failure")
            return {"accepted": True}
        stream = CallEventStream(SimpleNamespace(post=post), "fixture", purpose="intake")
        await stream.start()
        await stream.consent(True)
        with self.assertRaises(DeliveryError):
            await stream.turn("caller", "Fictional missing turn")
        await stream.finish()
        self.assertEqual(events[-1], ("call.ended", {"deliveryFailed": True}))

    async def test_revocation_skips_queued_turns_and_waits_for_inflight_then_scrubs(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        events = []
        callback = AsyncMock()
        async def post(event, call_id, **payload):
            events.append((event, payload))
            if event == "turn":
                entered.set()
                await release.wait()
                return {"accepted": True, "warning": {"id": "late-warning"}}
            return {"accepted": True}
        stream = CallEventStream(SimpleNamespace(post=post), "fixture", purpose="guard", on_warning=callback)
        await stream.start()
        await stream.consent(True)
        first = stream.turn("caller", "Previously consented fictional facts")
        await entered.wait()
        second = stream.turn("caller", "Queued fictional facts")
        revocation = stream.begin_revocation()
        self.assertFalse(stream.consented)
        self.assertIsNone(stream.turn("caller", "Never send after withdrawal"))
        release.set()
        await asyncio.gather(first, second, revocation)
        await stream.finish()
        self.assertEqual([event for event, _ in events], ["call.started", "consent", "turn", "consent.revoked"])
        callback.assert_not_awaited()


class AgentConsentTests(unittest.IsolatedAsyncioTestCase):
    def agent(self):
        client = SimpleNamespace(post=AsyncMock(return_value={"accepted": True}))
        stream = CallEventStream(client, "fixture", purpose="intake")
        context = SimpleNamespace(shutdown=MagicMock())
        voice_agent = PharosAgent(stream, context, guard=False)
        session = SimpleNamespace(say=AsyncMock(), shutdown=MagicMock())
        # The real SDK's Agent.session property reads this activity handle.
        voice_agent._activity = SimpleNamespace(session=session)
        return voice_agent, stream, client, context, session

    async def test_ambiguous_answer_never_reaches_backend_or_llm(self):
        voice_agent, stream, client, context, session = self.agent()
        with self.assertRaises(StopResponse):
            await voice_agent.on_user_turn_completed(llm.ChatContext(), llm.ChatMessage(role="user", content=["Maybe"]))
        client.post.assert_not_awaited()
        self.assertFalse(stream.consented)
        session.say.assert_awaited_once()

    async def test_decline_stops_without_collecting_answers(self):
        voice_agent, stream, client, context, session = self.agent()
        with self.assertRaises(StopResponse):
            await voice_agent.on_user_turn_completed(llm.ChatContext(), llm.ChatMessage(role="user", content=["No"]))
        self.assertTrue(stream.declined)
        self.assertFalse(stream.consented)
        self.assertEqual(client.post.await_args.args[0], "consent")
        context.shutdown.assert_called_once()
        with self.assertRaises(StopResponse):
            await voice_agent.on_user_turn_completed(llm.ChatContext(), llm.ChatMessage(role="user", content=["Need help"]))
        self.assertEqual(client.post.await_count, 1)

    async def test_yes_and_facts_are_saved_once_after_consent_ack(self):
        voice_agent, stream, client, context, session = self.agent()
        message = llm.ChatMessage(role="user", content=["Yes, we need a ride near Riverbend."])
        await voice_agent.on_user_turn_completed(llm.ChatContext(), message)
        calls = client.post.await_args_list
        self.assertEqual([call.args[0] for call in calls], ["consent", "turn"])
        self.assertEqual(calls[1].kwargs["text"], "we need a ride near Riverbend")
        self.assertIn(message.id, voice_agent.persisted_user_ids)

    async def test_withdrawal_is_not_a_transcript_turn_and_blocks_future_collection(self):
        voice_agent, stream, client, context, session = self.agent()
        await voice_agent.on_user_turn_completed(llm.ChatContext(), llm.ChatMessage(role="user", content=["Yes"]))
        with self.assertRaises(StopResponse):
            await voice_agent.on_user_turn_completed(llm.ChatContext(), llm.ChatMessage(role="user", content=["Stop recording. I withdraw consent."]))
        self.assertEqual([call.args[0] for call in client.post.await_args_list], ["consent", "consent.revoked"])
        self.assertFalse(stream.consented)
        self.assertTrue(stream.revoked)
        self.assertTrue(voice_agent.stopped)
        self.assertIsNone(stream.turn("caller", "Never save this"))
        await stream.finish()
        self.assertEqual(client.post.await_count, 2)
        context.shutdown.assert_called_once()


class LifetimeTests(unittest.IsolatedAsyncioTestCase):
    def fixture(self):
        config = Settings(api_url="https://pharos.example", ingest_token="fixture", livekit_url="wss://fixture.livekit.cloud",
                          livekit_api_key="fixture", livekit_api_secret="fixture", test_caller_numbers=("+12025550102",))
        incoming = SimpleNamespace(identity="incoming-fixture", kind=agent.rtc.ParticipantKind.PARTICIPANT_KIND_SIP,
                                   attributes={"sip.phoneNumber": "+12025550102", "sip.trunkPhoneNumber": "+12025550103"})
        remover = AsyncMock()
        context = SimpleNamespace(connect=AsyncMock(), wait_for_participant=AsyncMock(return_value=incoming),
                                  room=SimpleNamespace(name="fixture-room", remote_participants={incoming.identity: incoming},
                                                       on=lambda name: lambda callback: callback),
                                  api=SimpleNamespace(room=SimpleNamespace(remove_participant=remover)),
                                  shutdown=MagicMock(), add_shutdown_callback=MagicMock())
        return config, context, remover

    async def test_start_event_failure_still_closes_admitted_phone_leg(self):
        config, context, remover = self.fixture()
        client = SimpleNamespace(post=AsyncMock(side_effect=DeliveryError("fixture")), close=AsyncMock())
        with patch.object(agent, "VoiceEventClient", return_value=client):
            with self.assertRaises(DeliveryError):
                await agent.run_session(context, config)
        context.add_shutdown_callback.assert_called_once()
        remover.assert_awaited_once()
        client.close.assert_awaited_once()
        context.shutdown.assert_called()

    async def test_guard_loop_validation_releases_phone_before_any_outbound_or_model(self):
        config, context, remover = self.fixture()
        config = replace(config, mode="guard", guard_relay_enabled=True, guard_resident_consented=True,
                         outbound_trunk_id="ST_fixture", guard_resident_number="+12025550102")
        with patch.object(agent, "VoiceEventClient") as client_constructor:
            with self.assertRaises(ConfigurationError):
                await agent.run_session(context, config)
        context.add_shutdown_callback.assert_called_once()
        remover.assert_awaited_once()
        client_constructor.assert_not_called()
        context.shutdown.assert_called()

    async def test_budget_covers_backend_start_retry_before_models_or_disclosure(self):
        config, context, remover = self.fixture()
        async def post(event, *args, **kwargs):
            if event == "call.started":
                await asyncio.sleep(60)
            return {"accepted": True}
        client = SimpleNamespace(post=post, close=AsyncMock())
        real_timeout = asyncio.timeout
        began = time.monotonic()
        with patch.object(agent, "VoiceEventClient", return_value=client), \
                patch.object(agent.asyncio, "timeout", side_effect=lambda seconds: real_timeout(0.01)), \
                patch.object(agent, "AgentSession") as session_constructor:
            await agent.run_session(context, config)
        self.assertLess(time.monotonic() - began, 1)
        remover.assert_awaited_once()
        session_constructor.assert_not_called()
        context.shutdown.assert_called_with("configured test duration reached")

    async def test_session_start_failure_closes_leg_client_and_session(self):
        config, context, remover = self.fixture()
        client = SimpleNamespace(post=AsyncMock(return_value={"accepted": True}), close=AsyncMock())
        session = SimpleNamespace(on=lambda name: lambda callback: callback,
                                  start=AsyncMock(side_effect=RuntimeError("fixture start failure")), aclose=AsyncMock())
        with patch.object(agent, "VoiceEventClient", return_value=client), \
                patch.object(agent, "AgentSession", return_value=session), \
                patch.object(agent.inference, "STT"), patch.object(agent.inference, "LLM"), \
                patch.object(agent.inference, "TTS"), patch.object(agent.inference, "TurnDetector"):
            with self.assertRaises(RuntimeError):
                await agent.run_session(context, config)
        remover.assert_awaited_once()
        session.aclose.assert_awaited_once()
        client.close.assert_awaited_once()

    async def test_browser_sip_looking_attribute_is_not_used_as_phone_metadata(self):
        config, context, remover = self.fixture()
        config = replace(config, allow_browser_tests=True)
        incoming = next(iter(context.room.remote_participants.values()))
        incoming.kind = agent.rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD
        # A browser can supply arbitrary attributes. It must not forge SIP linkage.
        incoming.attributes["sip.phoneNumber"] = "+12025550102"
        client = SimpleNamespace(post=AsyncMock(return_value={"accepted": True}), close=AsyncMock())
        session = SimpleNamespace(on=lambda name: lambda callback: callback,
                                  start=AsyncMock(side_effect=RuntimeError("fixture start failure")), aclose=AsyncMock())
        with patch.object(agent, "VoiceEventClient", return_value=client), \
                patch.object(agent, "AgentSession", return_value=session), \
                patch.object(agent.inference, "STT"), patch.object(agent.inference, "LLM"), \
                patch.object(agent.inference, "TTS"), patch.object(agent.inference, "TurnDetector"):
            with self.assertRaises(RuntimeError):
                await agent.run_session(context, config)
        start = client.post.await_args_list[0]
        self.assertEqual(start.args[0], "call.started")
        self.assertEqual(start.kwargs["transport"], "webrtc")
        self.assertNotIn("callerNumber", start.kwargs)
        remover.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
