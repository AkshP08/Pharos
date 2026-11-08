"""Prepare an ignored, private runtime-only secrets file. Never deploys or dials."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import dotenv_values

from pharos_runtime import ConfigurationError, Settings

ROOT = Path(__file__).resolve().parent
COMMON_KEYS = (
    'PHAROS_API_URL', 'PHAROS_INGEST_TOKEN', 'PHAROS_STT_MODEL',
    'PHAROS_LLM_MODEL', 'PHAROS_TTS_MODEL', 'PHAROS_TTS_VOICE',
    'PHAROS_TEST_CALLER_NUMBERS', 'PHAROS_MAX_CALL_SECONDS',
)
GUARD_KEYS = (
    'PHAROS_ENABLE_GUARD_RELAY', 'PHAROS_GUARD_RESIDENT_CONSENTED',
    'PHAROS_GUARD_RESIDENT_NUMBER', 'PHAROS_GUARD_ALLOWED_CALLERS',
    'LIVEKIT_OUTBOUND_TRUNK_ID', 'PHAROS_GUARD_MAX_SECONDS',
    'PHAROS_SEMANTIC_GUARD_REVIEW',
)


def runtime_secrets(source: dict[str, str | None], mode: str) -> dict[str, str]:
    if mode not in {'intake', 'guard'}:
        raise ConfigurationError('Hosted mode must be intake or guard')
    keys = COMMON_KEYS + (GUARD_KEYS if mode == 'guard' else ())
    values = {key: source[key] for key in keys if source.get(key)}
    values.update({
        'PHAROS_CALL_MODE': mode,
        'PHAROS_AGENT_NAME': 'pharos-intake' if mode == 'intake' else 'pharos-guard',
        'PHAROS_ALLOW_BROWSER_TESTS': 'false',
    })
    if mode == 'intake':
        values['PHAROS_ENABLE_GUARD_RELAY'] = 'false'
    # LiveKit injects these at runtime. Shape-check without exporting local keys.
    validation = {**values, 'LIVEKIT_URL': 'wss://runtime-injected.livekit.cloud',
                  'LIVEKIT_API_KEY': 'runtime-injected', 'LIVEKIT_API_SECRET': 'runtime-injected'}
    Settings.from_env(validation).validate()
    return values


def write_private(path: Path, values: dict[str, str]) -> None:
    body = '# Runtime-only hosted settings. Never commit or paste into chat.\n'
    body += ''.join(key + '=' + json.dumps(value, ensure_ascii=False) + '\n' for key, value in values.items())
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('intake', 'guard'), default='intake')
    parser.add_argument('--output', type=Path, default=ROOT / '.env.hosted.local')
    arguments = parser.parse_args()
    path = arguments.output.resolve()
    if path.parent != ROOT or not (path.name.startswith('.env.') and path.name.endswith('.local')):
        raise ConfigurationError('Output must be an ignored .env.*.local file inside the voice-agent directory')
    source = dict(dotenv_values(ROOT / '.env.local', interpolate=False))
    values = runtime_secrets(source, arguments.mode)
    write_private(path, values)
    # Names are reviewable; private values never appear in stdout or arguments.
    print(json.dumps({'mode': arguments.mode, 'secretFile': str(path),
                      'keys': list(values), 'deployed': False}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ConfigurationError, ValueError) as error:
        print('Preparation stopped: ' + str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except Exception as error:
        print('Preparation failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1) from None
