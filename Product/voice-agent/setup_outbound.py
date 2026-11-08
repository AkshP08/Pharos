"""Inspect/create one Photon outbound trunk. This script never places a call.

Copy Photon outbound credentials (not the inbound LiveKit login) into the
ignored .env.outbound.local file. No credential is accepted in CLI arguments or
printed. Apply creates only missing configuration and refuses replacements.

Official walkthrough: https://photon.codes/docs/beta/cookbooks/voice/livekit
LiveKit: https://docs.livekit.io/telephony/making-calls/outbound-trunk/
Photon's walkthrough recommends SHA-256. The provider's Digest challenge selects
the algorithm; the LiveKit trunk has no separate algorithm/realm configuration.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
from typing import Any

if sys.platform == "darwin":
    import truststore
    truststore.inject_into_ssl()

from dotenv import dotenv_values, load_dotenv, set_key
from livekit import api

ROOT = Path(__file__).resolve().parent
PRIVATE_FILE = ROOT / ".env.outbound.local"
TRUNK_NAME = "Pharos Photon guarded relay"
REQUIRED = ("PHAROS_PHOTON_SIP_USERNAME", "PHAROS_PHOTON_SIP_PASSWORD",
            "PHAROS_PHOTON_SIP_HOST", "PHAROS_PHOTON_SIP_PORT")


class SetupError(RuntimeError):
    pass


def private_values(path: Path) -> dict[str, str]:
    return {key: value for key, value in dotenv_values(path).items() if value} if path.exists() else {}


def save_fields(path: Path, values: dict[str, str]) -> None:
    # python-dotenv preserves existing comments and quotes arbitrary passwords.
    # A private file must already exist; never create a credential template here.
    if not path.is_file() or path.is_symlink():
        raise SetupError("The private outbound credential file must be a regular local file")
    path.chmod(0o600)
    for key, value in values.items():
        set_key(str(path), key, value, quote_mode="always")
    path.chmod(0o600)


def credentials(values: dict[str, str]) -> tuple[str, str, str, str]:
    if any(not values.get(key) for key in REQUIRED):
        raise SetupError("Fill the Photon outbound username, password, host, and TLS port in .env.outbound.local")
    username, password, host, port = (values[key] for key in REQUIRED)
    if not re.fullmatch(r"[A-Za-z0-9_.@-]{1,200}", username) or len(password) < 8 or len(password) > 512 or any(ord(char) < 32 for char in password):
        raise SetupError("Invalid outbound credential shape")
    host = host.lower()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host) or not host.endswith(".photon.codes"):
        raise SetupError("Use the Photon profile's SIP connection hostname, without scheme, path, or port")
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise SetupError("Use the Photon profile's TLS connection port")
    algorithm = values.get("PHAROS_PHOTON_SIP_DIGEST", "SHA-256").lower().replace("-", "")
    if algorithm != "sha256":
        raise SetupError("This setup requires Photon SHA-256 authentication; it never downgrades to MD5")
    address = f"{host}:{int(port)}"
    fingerprint = hashlib.sha256((username + "\0" + password).encode()).hexdigest()
    return username, password, address, fingerprint


def outbound_request(number: str, username: str, password: str, address: str, owner: str) -> api.CreateSIPOutboundTrunkRequest:
    return api.CreateSIPOutboundTrunkRequest(trunk=api.SIPOutboundTrunkInfo(
        name=TRUNK_NAME, numbers=[number], address=address,
        transport=api.SIP_TRANSPORT_TLS, media_encryption=api.SIP_MEDIA_ENCRYPT_ALLOW,
        auth_username=username, auth_password=password,
        metadata=json.dumps({"pharosSetup": "outbound-v1", "owner": owner}, sort_keys=True),
        # destination_country pins the origin region; it is not a destination
        # allowlist. The guard runtime restricts dialing to its opted-in phone.
    ))


async def configure(client: Any, number: str, *, apply: bool = False,
                    private_file: Path = PRIVATE_FILE) -> dict[str, Any]:
    if not re.fullmatch(r"\+[1-9]\d{6,14}", number):
        raise SetupError("An existing E.164 Photon number is required")
    if private_file.is_symlink():
        raise SetupError("The private outbound credential file must not be a symlink")
    saved = private_values(private_file)
    trunks = (await client.sip.list_outbound_trunk(api.ListSIPOutboundTrunkRequest())).items
    candidates = [trunk for trunk in trunks if number in trunk.numbers
                  or trunk.sip_trunk_id == saved.get("LIVEKIT_OUTBOUND_TRUNK_ID")
                  or trunk.name == TRUNK_NAME]
    if len(candidates) > 1:
        raise SetupError("Multiple outbound trunks match this setup; no change was attempted")
    result: dict[str, Any] = {"matchingOutboundTrunks": len(candidates),
        "credentialFileConfigured": all(saved.get(key) for key in REQUIRED), "applied": apply}
    if not apply:
        return result

    username, password, address, fingerprint = credentials(saved)
    previous_fingerprint = saved.get("PHAROS_PHOTON_SIP_CREDENTIAL_FINGERPRINT")
    if previous_fingerprint and previous_fingerprint != fingerprint:
        raise SetupError("The saved outbound credential changed; no rotation or overwrite was attempted")
    owner = saved.get("PHAROS_LIVEKIT_OUTBOUND_OWNER_ID")
    if candidates:
        trunk = candidates[0]
        try:
            metadata = json.loads(trunk.metadata)
        except (TypeError, ValueError):
            metadata = None
        saved_id = saved.get("LIVEKIT_OUTBOUND_TRUNK_ID")
        if (not owner or metadata != {"pharosSetup": "outbound-v1", "owner": owner}
                or trunk.name != TRUNK_NAME or list(trunk.numbers) != [number]
                or trunk.auth_username != username or trunk.address != address
                or trunk.transport != api.SIP_TRANSPORT_TLS
                or trunk.media_encryption != api.SIP_MEDIA_ENCRYPT_ALLOW
                or saved_id and saved_id != trunk.sip_trunk_id):
            raise SetupError("An existing outbound trunk does not match this owned setup; it was preserved")
        result["createdOutboundTrunk"] = False
    else:
        if saved.get("LIVEKIT_OUTBOUND_TRUNK_ID"):
            raise SetupError("The saved outbound trunk was not found; refusing to recreate it automatically")
        owner = owner or secrets.token_hex(16)
        # Persist ownership before creating, so a lost response can be reconciled
        # by inspecting the same metadata instead of rotating or duplicating.
        save_fields(private_file, {"PHAROS_LIVEKIT_OUTBOUND_OWNER_ID": owner,
            "PHAROS_PHOTON_SIP_CREDENTIAL_FINGERPRINT": fingerprint})
        trunk = await client.sip.create_outbound_trunk(outbound_request(number, username, password, address, owner))
        result["createdOutboundTrunk"] = True
    save_fields(private_file, {"LIVEKIT_OUTBOUND_TRUNK_ID": trunk.sip_trunk_id,
                              "PHAROS_PHOTON_SIP_CREDENTIAL_FINGERPRINT": fingerprint})
    result.update(outboundTrunkId=trunk.sip_trunk_id, credentialFile=str(private_file),
                  transport="TLS", mediaEncryption="allow", callPlaced=False)
    return result


async def main_async() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--number", required=True, help="Already provisioned Photon caller-ID number")
    parser.add_argument("--apply", action="store_true", help="Create only missing scoped configuration; never dials")
    arguments = parser.parse_args()
    load_dotenv(ROOT / ".env.local")
    for name in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"):
        if not os.getenv(name):
            raise SetupError(f"Missing local setting: {name}")
    async with api.LiveKitAPI() as client:
        result = await configure(client, arguments.number, apply=arguments.apply)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        asyncio.run(main_async())
    except SetupError as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    except Exception as error:
        print(f"LiveKit outbound setup failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1) from None
