"""Inspect/apply only LiveKit SIP configuration; never dials or purchases a number.

Credentials stay in an ignored chmod-0600 dotenv file, never stdout or CLI args.
Use an already provisioned Photon number; no LiveKit number or paid plan is created.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import sys
from pathlib import Path
from typing import Any

if sys.platform == "darwin":
    import truststore
    truststore.inject_into_ssl()

from dotenv import dotenv_values, load_dotenv
from google.protobuf.duration_pb2 import Duration
from livekit import api

ROOT = Path(__file__).resolve().parent
PRIVATE_FILE = ROOT / ".env.sip.local"
DEFAULT_SIP_URI = "sips:570ptv6vlnd.sip.livekit.cloud"
TRUNK_NAME = "Pharos Photon intake"
RULE_NAME = "Pharos intake individual rooms"


class SetupError(RuntimeError):
    pass


def save_private(path: Path, values: dict[str, str]) -> None:
    # Generated values, IDs, and SIP addresses contain no dotenv quoting syntax.
    body = "# Private generated LiveKit SIP credentials. Never commit or paste into chat.\n"
    body += "".join(f"{key}={value}\n" for key, value in values.items())
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w") as output:
            output.write(body)
    except BaseException:
        # fdopen owns/closed the descriptor after successful construction.
        raise


def inbound_request(number: str, username: str, password: str, allowed: list[str]) -> api.CreateSIPInboundTrunkRequest:
    return api.CreateSIPInboundTrunkRequest(trunk=api.SIPInboundTrunkInfo(
        name=TRUNK_NAME,
        numbers=[number],
        allowed_numbers=allowed,
        auth_username=username,
        auth_password=password,
        media_encryption=api.SIP_MEDIA_ENCRYPT_ALLOW,
        ringing_timeout=Duration(seconds=60),
        max_call_duration=Duration(seconds=180),
        krisp_enabled=False,
    ))


def dispatch_request(trunk_id: str, agent_name: str) -> api.CreateSIPDispatchRuleRequest:
    return api.CreateSIPDispatchRuleRequest(dispatch_rule=api.SIPDispatchRuleInfo(
        name=RULE_NAME,
        trunk_ids=[trunk_id],
        # Preserve SIP metadata for private allowlist and HMAC linkage. Do not
        # expose room names or participant phone metadata in a public frontend.
        hide_phone_number=False,
        rule=api.SIPDispatchRule(dispatch_rule_individual=api.SIPDispatchRuleIndividual(
            room_prefix="pharos-intake-", no_randomness=False,
        )),
        room_config=api.RoomConfiguration(
            empty_timeout=20, departure_timeout=20, max_participants=3,
            agents=[api.RoomAgentDispatch(agent_name=agent_name)],
        ),
    ))


async def prepare_owned_hosted_trunk(client: Any, trunk: api.SIPInboundTrunkInfo, number: str,
                                    saved: dict[str, str]) -> dict[str, Any]:
    username = saved.get("PHAROS_LIVEKIT_SIP_USERNAME")
    password = saved.get("PHAROS_LIVEKIT_SIP_PASSWORD")
    if (not username or not password
            or saved.get("PHAROS_LIVEKIT_INBOUND_TRUNK_ID") != trunk.sip_trunk_id
            or list(trunk.numbers) != [number] or trunk.auth_username != username):
        raise SetupError("Hosted preparation requires the exact locally owned inbound trunk and saved credentials")
    listed_password = trunk.auth_password
    redacted = (not listed_password or bool(re.fullmatch(r"\*+", listed_password))
                or listed_password.lower() in {"redacted", "[redacted]", "<redacted>"})
    if not redacted and listed_password != password:
        raise SetupError("Existing inbound credentials differ; no replacement or credential rotation was attempted")
    if trunk.max_call_duration.seconds != 180 or trunk.max_call_duration.nanos != 0:
        raise SetupError("Existing call duration differs from the expected test cap; it was preserved")

    changed = trunk.ringing_timeout.seconds != 60 or trunk.ringing_timeout.nanos != 0
    if changed:
        replacement = api.SIPInboundTrunkInfo()
        replacement.CopyFrom(trunk)
        # The field-update SDK omits ringing_timeout. Clone the complete current
        # trunk instead, restoring its SAME private password if listing hid it.
        replacement.auth_password = password if redacted else listed_password
        replacement.ringing_timeout.CopyFrom(Duration(seconds=60))
        trunk = await client.sip.update_inbound_trunk(trunk.sip_trunk_id, replacement)
    return {
        "inboundTrunkId": trunk.sip_trunk_id,
        "updatedRingingTimeout": changed,
        "ringingTimeoutSeconds": trunk.ringing_timeout.seconds,
        "maxCallDurationSeconds": trunk.max_call_duration.seconds,
        "callerAllowlistConfigured": bool(trunk.allowed_numbers),
        "createdInboundTrunk": False,
        "createdDispatchRule": False,
    }


async def configure(client: Any, number: str, *, apply: bool = False, private_file: Path = PRIVATE_FILE,
                    agent_name: str = "pharos-intake", allowed_callers: list[str] | None = None,
                    sync_test_callers: bool = False, prepare_hosted: bool = False) -> dict[str, Any]:
    if not re.fullmatch(r"\+[1-9]\d{6,14}", number):
        raise SetupError("An existing E.164 Photon number is required")
    allowed = list(dict.fromkeys(allowed_callers or []))
    if any(not re.fullmatch(r"\+[1-9]\d{6,14}", value) for value in allowed):
        raise SetupError("The test caller allowlist must contain E.164 numbers")
    if sync_test_callers and (not apply or not allowed):
        raise SetupError("Synchronizing test callers requires --apply and a nonempty local test caller allowlist")
    if prepare_hosted and (not apply or sync_test_callers):
        raise SetupError("Hosted preparation requires --apply and cannot be combined with allowlist synchronization")
    trunks = (await client.sip.list_inbound_trunk(api.ListSIPInboundTrunkRequest())).items
    rules = (await client.sip.list_dispatch_rule(api.ListSIPDispatchRuleRequest())).items
    candidates = [trunk for trunk in trunks if number in trunk.numbers]
    if len(candidates) > 1:
        raise SetupError("Multiple inbound trunks match this number; refusing an ambiguous change")
    result: dict[str, Any] = {
        "matchingInboundTrunks": len(candidates), "totalDispatchRules": len(rules),
        "callerAllowlistConfigured": bool(allowed), "applied": apply,
    }
    if not apply:
        return result

    saved = {key: value for key, value in dotenv_values(private_file).items() if value} if private_file.exists() else {}
    if prepare_hosted:
        if not candidates:
            raise SetupError("Hosted preparation only updates an existing owned inbound trunk; none was created")
        result.update(await prepare_owned_hosted_trunk(client, candidates[0], number, saved))
        return result
    username = saved.get("PHAROS_LIVEKIT_SIP_USERNAME") or f"pharos_{secrets.token_hex(8)}"
    password = saved.get("PHAROS_LIVEKIT_SIP_PASSWORD") or secrets.token_urlsafe(36)
    saved.update({
        "PHAROS_LIVEKIT_SIP_URI": DEFAULT_SIP_URI,
        "PHAROS_LIVEKIT_SIP_USERNAME": username,
        "PHAROS_LIVEKIT_SIP_PASSWORD": password,
    })
    if candidates:
        trunk = candidates[0]
        saved_trunk_id = saved.get("PHAROS_LIVEKIT_INBOUND_TRUNK_ID")
        if (list(trunk.numbers) != [number] or trunk.auth_username != username
                or (saved_trunk_id and saved_trunk_id != trunk.sip_trunk_id)):
            raise SetupError("An existing trunk is not owned by this local setup; no credential rotation or overwrite was attempted")
        if set(trunk.allowed_numbers) != set(allowed):
            if not sync_test_callers:
                raise SetupError("Existing trunk allowlist differs; rerun with --apply --sync-test-callers to update only this owned trunk")
            # This SDK method sends a field update, not a full replacement.
            # Omit credentials, number scope, media settings, and every other field.
            trunk = await client.sip.update_inbound_trunk_fields(trunk.sip_trunk_id, allowed_numbers=allowed)
            result["updatedCallerAllowlist"] = True
        else:
            result["updatedCallerAllowlist"] = False
        result["createdInboundTrunk"] = False
    else:
        # Persist before creation so a lost response can be safely reconciled by
        # listing the number/username rather than rotating or duplicating it.
        save_private(private_file, saved)
        trunk = await client.sip.create_inbound_trunk(inbound_request(number, username, password, allowed))
        result["createdInboundTrunk"] = True
    saved["PHAROS_LIVEKIT_INBOUND_TRUNK_ID"] = trunk.sip_trunk_id
    save_private(private_file, saved)

    matching_rules = [rule for rule in rules if trunk.sip_trunk_id in rule.trunk_ids]
    if len(matching_rules) > 1:
        raise SetupError("Multiple rules route this trunk; refusing an ambiguous change")
    if matching_rules:
        rule = matching_rules[0]
        if rule.name != RULE_NAME or list(rule.trunk_ids) != [trunk.sip_trunk_id] or [entry.agent_name for entry in rule.room_config.agents] != [agent_name]:
            raise SetupError("Existing rule does not match this scoped intake configuration; it was preserved")
        result["createdDispatchRule"] = False
    else:
        rule = await client.sip.create_dispatch_rule(dispatch_request(trunk.sip_trunk_id, agent_name))
        result["createdDispatchRule"] = True
    saved["PHAROS_LIVEKIT_DISPATCH_RULE_ID"] = rule.sip_dispatch_rule_id
    save_private(private_file, saved)
    result.update({
        "inboundTrunkId": trunk.sip_trunk_id,
        "dispatchRuleId": rule.sip_dispatch_rule_id,
        "agentName": agent_name,
        "credentialFile": str(private_file),
        "sipUri": DEFAULT_SIP_URI,
        "workerCanAcceptPhoneCalls": bool(allowed),
    })
    return result


async def main_async() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--number", required=True, help="Already provisioned Photon hotline number")
    parser.add_argument("--apply", action="store_true", help="Create only missing scoped SIP configuration; does not place a call")
    parser.add_argument("--sync-test-callers", action="store_true", help="With --apply, update only this owned trunk's nonempty test caller allowlist")
    parser.add_argument("--prepare-hosted", action="store_true", help="With --apply, change only this existing owned trunk's ringing timeout to 60 seconds")
    arguments = parser.parse_args()
    load_dotenv(ROOT / ".env.local")
    for name in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        if not os.getenv(name):
            raise SetupError(f"Missing local setting: {name}")
    allowed = [value.strip() for value in os.getenv("PHAROS_TEST_CALLER_NUMBERS", "").split(",") if value.strip()]
    async with api.LiveKitAPI() as client:
        result = await configure(client, arguments.number, apply=arguments.apply,
                                 agent_name=os.getenv("PHAROS_AGENT_NAME", "pharos-intake"), allowed_callers=allowed,
                                 sync_test_callers=arguments.sync_test_callers, prepare_hosted=arguments.prepare_hosted)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        asyncio.run(main_async())
    except SetupError as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    except Exception as error:
        # API errors may contain private connection details. Inspect privately in
        # the dashboard instead of printing raw exception text or response bodies.
        print(f"LiveKit setup failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1) from None
