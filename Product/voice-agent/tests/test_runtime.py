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
    def test_failure_diagnostic_contains_only_code_locations_and_safe_identifiers(self):
        secret = 'private transcript +12025550199 api-key-private'
        try:
            raise AttributeError(secret, name='missing_sdk_method', obj=secret)
        except AttributeError as error:
            diagnostic = agent.safe_failure_diagnostic(error)
        self.assertIn('class=AttributeError attribute=missing_sdk_method', diagnostic)
        self.assertIn('test_runtime.py:', diagnostic)
        self.assertNotIn(secret, diagnostic)
        self.assertNotIn(str(Path(__file__).parent), diagnostic)
        unsafe = AttributeError(secret, name=secret, obj=secret)
        self.assertIn('attribute=withheld', agent.safe_failure_diagnostic(unsafe))

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


class SemanticSchedulingTests(unittest.IsolatedAsyncioTestCase):
    benign = {"shouldWarn": False, "level": "low", "signals": []}
    risky = {"shouldWarn": True, "level": "high", "signals": [
        {"kind": "money_or_secret", "evidence": "fictional payment"},
        {"kind": "isolation", "evidence": "keep this private"},
    ]}

    class ControlledReviewer:
        def __init__(self, *, return_after_cancel=False):
            self.requests = []
            self.entered = asyncio.Queue()
            self.aclose = AsyncMock()
            self.return_after_cancel = return_after_cancel
            self.cancelled = False

        async def review(self, text):
            self.requests.append(text)
            result = asyncio.get_running_loop().create_future()
            self.entered.put_nowait(result)
            try:
                return await result
            except asyncio.CancelledError:
                self.cancelled = True
                if self.return_after_cancel:
                    return SemanticSchedulingTests.risky
                raise

    async def fixture(self, reviewer, *, post_hook=None, purpose='guard', enabled=True):
        events = []
        callback = AsyncMock()
        async def post(event, call_id, **payload):
            events.append((event, payload))
            if post_hook:
                return await post_hook(event, payload)
            return {"accepted": True}
        factory = MagicMock(return_value=reviewer)
        stream = CallEventStream(SimpleNamespace(post=post), 'semantic-fixture', purpose=purpose,
                                 semantic_review=enabled, reviewer_factory=factory, on_warning=callback)
        await stream.start()
        return stream, events, callback, factory

    async def next_review(self, reviewer):
        return await asyncio.wait_for(reviewer.entered.get(), timeout=1)

    async def drain_review(self, stream):
        task = stream._semantic_task
        if task is not None:
            await asyncio.wait_for(asyncio.shield(task), timeout=1)

    async def test_starts_only_after_consented_caller_ack_and_uses_semantic_mode(self):
        reviewer = self.ControlledReviewer()
        turn_entered, release_turn = asyncio.Event(), asyncio.Event()
        async def post(event, payload):
            if event == 'turn':
                turn_entered.set()
                await release_turn.wait()
            return {"accepted": True}
        stream, events, _, factory = await self.fixture(reviewer, post_hook=post)
        self.assertEqual(events[0][1]['analysisMode'], 'semantic')
        self.assertIsNone(stream.turn('caller', 'Never analyze before consent'))
        await stream.consent(True)
        pending = stream.turn('caller', 'Consented fictional caller facts')
        await turn_entered.wait()
        factory.assert_not_called()
        release_turn.set()
        await pending
        result = await self.next_review(reviewer)
        self.assertEqual(reviewer.requests, ['Consented fictional caller facts'])
        result.set_result(self.benign)
        await self.drain_review(stream)
        self.assertEqual(events[-1], ('pressure.review', {'sequence': 0, 'review': self.benign}))
        await stream.finish()
        reviewer.aclose.assert_awaited_once()

    async def test_coalesces_latest_caller_snapshot_without_blocking_outbox_or_using_agent_text(self):
        reviewer = self.ControlledReviewer()
        stream, events, callback, _ = await self.fixture(reviewer)
        await stream.consent(True)
        await stream.turn('caller', 'First fictional statement')
        first_result = await self.next_review(reviewer)
        await stream.turn('agent', 'Assistant wording must not enter the review')
        await stream.turn('caller', 'Second fictional statement')
        await stream.turn('caller', 'Third fictional statement')
        self.assertEqual(len(reviewer.requests), 1)
        first_result.set_result(self.risky)
        latest_result = await self.next_review(reviewer)
        self.assertEqual(reviewer.requests[-1], 'First fictional statement\nSecond fictional statement\nThird fictional statement')
        self.assertFalse(any(event.startswith('pressure.') for event, _ in events))
        latest_result.set_result(self.benign)
        await self.drain_review(stream)
        self.assertEqual([payload['sequence'] for event, payload in events if event == 'pressure.review'], [3])
        callback.assert_not_awaited()
        await stream.finish()

    async def test_late_server_warning_is_suppressed_after_new_caller_turn_and_deduped(self):
        reviewer = self.ControlledReviewer()
        posting, release = asyncio.Event(), asyncio.Event()
        async def post(event, payload):
            if event == 'pressure.review':
                if payload['sequence'] == 0:
                    posting.set()
                    await release.wait()
                return {"accepted": True, "warning": {"id": "same-warning", "level": "high"}}
            return {"accepted": True}
        stream, _, callback, _ = await self.fixture(reviewer, post_hook=post)
        await stream.consent(True)
        await stream.turn('caller', 'First fictional statement')
        (await self.next_review(reviewer)).set_result(self.risky)
        await posting.wait()
        await stream.turn('caller', 'New fictional statement')
        release.set()
        (await self.next_review(reviewer)).set_result(self.risky)
        await self.drain_review(stream)
        callback.assert_awaited_once()
        await stream.turn('caller', 'Third fictional statement')
        (await self.next_review(reviewer)).set_result(self.risky)
        await self.drain_review(stream)
        callback.assert_awaited_once()
        await stream.finish()

    async def test_revoke_and_finish_cancel_drop_context_and_ignore_even_cancellation_resistant_results(self):
        for operation in ('revoke', 'finish'):
            with self.subTest(operation=operation):
                reviewer = self.ControlledReviewer(return_after_cancel=True)
                stream, events, callback, _ = await self.fixture(reviewer)
                await stream.consent(True)
                await stream.turn('caller', 'Previously consented fictional statement')
                await self.next_review(reviewer)
                if operation == 'revoke':
                    task = stream.begin_revocation()
                    self.assertFalse(stream.consented)
                else:
                    # finish's synchronous gate executes before its first await.
                    task = asyncio.create_task(stream.finish())
                    await asyncio.sleep(0)
                self.assertEqual(stream._semantic_parts, [])
                self.assertIsNone(stream._semantic_pending)
                self.assertIsNone(stream.turn('caller', 'Never collect after stopping'))
                await task
                await stream.finish()
                self.assertTrue(reviewer.cancelled)
                reviewer.aclose.assert_awaited_once()
                self.assertIsNone(stream._semantic_reviewer)
                self.assertFalse(any(event.startswith('pressure.') for event, _ in events))
                callback.assert_not_awaited()

    async def test_hard_review_budget_reports_unavailable_instead_of_fallback(self):
        reviewer = SimpleNamespace(review=AsyncMock(return_value=self.benign), aclose=AsyncMock())
        stream, events, callback, _ = await self.fixture(reviewer)
        await stream.consent(True)
        for index in range(10):
            await stream.turn('caller', f'Fictional caller statement {index}')
            await self.drain_review(stream)
        self.assertEqual(reviewer.review.await_count, 8)
        self.assertEqual([payload['sequence'] for event, payload in events if event == 'pressure.unavailable'], [8, 9])
        self.assertTrue(all(set(payload) == {'sequence'} for event, payload in events if event == 'pressure.unavailable'))
        callback.assert_not_awaited()
        await stream.finish()

    async def test_review_failure_is_neutral_and_failed_turn_ack_never_starts_inference(self):
        reviewer = SimpleNamespace(review=AsyncMock(side_effect=RuntimeError('private provider body')), aclose=AsyncMock())
        stream, events, callback, _ = await self.fixture(reviewer)
        await stream.consent(True)
        await stream.turn('caller', 'Fictional private caller statement')
        await self.drain_review(stream)
        self.assertEqual(events[-1], ('pressure.unavailable', {'sequence': 0}))
        callback.assert_not_awaited()
        await stream.finish()
        async def fail_turn(event, payload):
            if event == 'turn':
                raise DeliveryError('fixture delivery failure')
            return {'accepted': True}
        stream, events, _, factory = await self.fixture(reviewer, post_hook=fail_turn)
        await stream.consent(True)
        with self.assertRaises(DeliveryError):
            await stream.turn('caller', 'Unacknowledged fictional statement')
        factory.assert_not_called()
        self.assertFalse(any(event.startswith('pressure.') for event, _ in events))
        await stream.finish()

    async def test_intake_and_disabled_guard_never_enable_or_import_review(self):
        for purpose, enabled in (('intake', True), ('guard', False)):
            with self.subTest(purpose=purpose, enabled=enabled):
                reviewer = self.ControlledReviewer()
                stream, events, _, factory = await self.fixture(reviewer, purpose=purpose, enabled=enabled)
                self.assertNotIn('analysisMode', events[0][1])
                await stream.consent(True)
                await stream.turn('caller', 'Fictional caller statement')
                await stream.finish()
                factory.assert_not_called()
                reviewer.aclose.assert_not_awaited()


class AgentConsentTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_sdk_turn_options_disable_preconsent_speculation(self):
        session = agent.AgentSession(turn_handling={"turn_detection": "manual", "preemptive_generation": {"enabled": False}})
        try:
            self.assertFalse(session.options.turn_handling["preemptive_generation"]["enabled"])
        finally:
            await session.aclose()

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

    async def test_intake_opening_is_brief_interruptible_and_contains_consent_choice(self):
        self.assertLessEqual(len(agent.INTAKE_DISCLOSURE.split()), 25)
        self.assertNotRegex(agent.INTAKE_DISCLOSURE.lower(), r'photon|livekit|sdk|speech recognition|software')
        self.assertIn('transcript', agent.INTAKE_DISCLOSURE)
        self.assertIn('yes or no', agent.INTAKE_DISCLOSURE)
        config, context, remover = self.fixture()
        client = SimpleNamespace(post=AsyncMock(return_value={"accepted": True}), close=AsyncMock())
        handlers = {}
        def on(name):
            def register(callback):
                handlers[name] = callback
                return callback
            return register
        async def say(*args, **kwargs):
            handlers['close'](None)
        session = SimpleNamespace(on=on, start=AsyncMock(), say=AsyncMock(side_effect=say), aclose=AsyncMock())
        with patch.object(agent, 'VoiceEventClient', return_value=client), \
                patch.object(agent, 'AgentSession', return_value=session) as constructor, \
                patch.object(agent.inference, 'STT'), patch.object(agent.inference, 'LLM'), \
                patch.object(agent.inference, 'TTS'), patch.object(agent.inference, 'TurnDetector'):
            await agent.run_session(context, config)
        session.say.assert_awaited_once_with(agent.INTAKE_DISCLOSURE, allow_interruptions=True)
        self.assertEqual(constructor.call_args.kwargs['turn_handling']['preemptive_generation'], {'enabled': False})
        remover.assert_awaited_once()
        self.assertEqual([call.args[0] for call in client.post.await_args_list], ['call.started', 'consent'])

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
