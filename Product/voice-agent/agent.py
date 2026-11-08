"""Photon SIP → LiveKit voice intake for Pharos.

This service never stores audio. After disclosing transcription and receiving
caller consent, it posts text turns to the protected Pharos Worker API. Case
priority and scam signals are derived server-side from explicit transcript
evidence; the LLM only conducts the short conversation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from typing import Any

import httpx
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions, inference

load_dotenv(".env.local")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("pharos-voice-agent")

API_URL = os.getenv("PHAROS_API_URL", "").rstrip("/")
INGEST_TOKEN = os.getenv("PHAROS_INGEST_TOKEN", "")
STT_MODEL = os.getenv("PHAROS_STT_MODEL", "deepgram/nova-3")
LLM_MODEL = os.getenv("PHAROS_LLM_MODEL", "google/gemma-4-31b-it")
TTS_MODEL = os.getenv("PHAROS_TTS_MODEL", "fishaudio/s2.1-pro")
TTS_VOICE = os.getenv("PHAROS_TTS_VOICE", "fa4c9eb3dccc4806b382b40d61c6b10a")

if not API_URL or not INGEST_TOKEN:
    logger.warning("PHAROS_API_URL or PHAROS_INGEST_TOKEN is not set; transcript delivery will fail until configured")

server = AgentServer()


class PharosIntakeAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions="""
You are Pharos, a brief automated voice intake helper in a disaster scenario.
You are not emergency dispatch and cannot promise help is coming. Speak in
short, calm sentences, ask one question at a time, and let the caller interrupt.

The very first spoken response must disclose: "Speech recognition will
process what you say so I can understand your choice. If you agree, Pharos
will save a text transcript and brief request summary for human responders.
Transcript text is deleted after 24 hours. To continue, say yes. You can hang
up at any time." Do not collect or repeat personal identifiers. If the caller does
not clearly consent, ask once for yes or no; if they decline, stop intake and
say you will not send their answers to Pharos. Never imply that the caller can
use a keypad unless the phone line has actually configured that option.

After clear consent, ask in this order, skipping a question only if the caller
already answered it:
1. "Are you in immediate danger right now?"
2. "Where are you, or what nearby address or landmark should responders use?"
3. "What help do you need most right now?"
4. Only if useful: "Is there a time-sensitive need I should include, such as
   a powered device or a safe way to leave?"
Never ask the caller to rate or compare their urgency. Do not diagnose. Treat
missing, uncertain, or contradictory answers as unknown and ask at most one
short clarification. Read back only the brief facts and ask the caller to
confirm or correct them. A correction should replace the earlier fact.

If the caller says they are checking a suspicious call or message, ask them to
quote or summarize the exact request. Do not claim to hear or inspect another
phone call that is not routed into this Pharos line. Do not call anyone a
scammer. If the wording includes a request for money, passwords, or codes, say
briefly not to pay or share codes and to verify using an official number found
independently. Urgency alone is not proof of fraud. If the same caller needs
disaster help, continue collecting that request.

Do not give evacuation routes, medical instructions, legal advice, or live
incident claims. If a caller describes immediate danger, tell them to contact
their local emergency number if they can, while continuing the short intake.
Never hang up, block, or lower a help request based on tone, accent, emotion,
hesitation, persistence, or a scam score. The Pharos server computes suggested
priority from explicit transcript facts; a human responder owns dispatch.
""".strip(),
        )


async def post_event(event: str, call_id: str, **payload: Any) -> None:
    if not API_URL or not INGEST_TOKEN:
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                f"{API_URL}/api/voice/ingest",
                headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
                json={"event": event, "callId": call_id, **payload},
            )
            response.raise_for_status()
    except Exception:
        logger.exception("Could not deliver voice event %s for call %s", event, call_id)


def yes_or_no(value: str) -> bool | None:
    normalized = re.sub(r"[^a-z ]", " ", value.lower())
    if re.search(r"\b(not sure|unsure|i do not know|i don t know|i dont know)\b", normalized):
        return None
    if re.search(r"\b(no|nope|i do not|i don t|i dont|decline|stop)\b", normalized):
        return False
    if re.search(r"\b(yes|yeah|yep|i agree|i consent)\b", normalized):
        return True
    return None


@server.rtc_session(agent_name="pharos-intake")
async def pharos_intake(ctx: agents.JobContext) -> None:
    call_id = f"ph-call-{uuid.uuid4()}"
    await post_event("call.started", call_id)
    session = AgentSession(
        stt=inference.STT(model=STT_MODEL, language="en"),
        llm=inference.LLM(model=LLM_MODEL),
        tts=inference.TTS(model=TTS_MODEL, voice=TTS_VOICE),
        turn_handling=TurnHandlingOptions(turn_detection=inference.TurnDetector()),
    )
    consented = False
    consent_decided = False
    sequence = 0
    delivery_tail: asyncio.Task[None] | None = None

    def schedule(event: str, **payload: Any) -> None:
        nonlocal delivery_tail
        previous = delivery_tail

        async def deliver_in_order() -> None:
            if previous is not None:
                await previous
            await post_event(event, call_id, **payload)

        delivery_tail = asyncio.create_task(deliver_in_order())

    @session.on("conversation_item_added")
    def on_conversation_item(event: Any) -> None:
        nonlocal consented, consent_decided, sequence
        item = getattr(event, "item", None)
        role = getattr(item, "role", "")
        text = getattr(item, "text_content", None) or getattr(item, "raw_text_content", None)
        if not text:
            return
        text = str(text).strip()
        if role == "user" and not consent_decided:
            decision = yes_or_no(text)
            if decision is None:
                return
            consent_decided = True
            consented = decision
            schedule("consent", consent=decision)
            return
        if not consented:
            return
        if role not in ("user", "assistant"):
            return
        mapped_role = "caller" if role == "user" else "agent"
        schedule("turn", role=mapped_role, text=text[:1800], sequence=sequence)
        sequence += 1

    @session.on("close")
    def on_session_close(_: Any) -> None:
        if consented:
            schedule("call.ended")
        elif not consent_decided:
            schedule("consent", consent=False)

    async def flush_events() -> None:
        if delivery_tail is not None:
            await delivery_tail

    ctx.add_shutdown_callback(flush_events)

    await session.start(room=ctx.room, agent=PharosIntakeAgent())
    await ctx.connect()
    await session.say(
        "Speech recognition will process what you say so I can understand your choice. "
        "If you agree, Pharos will save a text transcript and brief request summary for human responders. "
        "Transcript text is deleted after 24 hours. To continue, say yes. You can hang up at any time.",
        allow_interruptions=False,
    )


def main() -> None:
    agents.cli.run_app(server)


if __name__ == "__main__":
    main()
