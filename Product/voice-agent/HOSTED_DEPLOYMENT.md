# Hosted intake on LiveKit Build

Prepared only; no hosted deployment has been created by these files. The local
worker must remain the sole target until the operator deliberately switches.

LiveKit's free Build plan currently allows one hosted agent, 1,000 monthly agent
session minutes, $2.50 inference credit, and 1,000 third-party SIP minutes. Its
included allowances are hard caps: new requests fail after they are exhausted.
Agent compute is metered while connected to a session, not while idle. Photon
number/transport credit is separate. Stay on Build; do not add an upgrade or a
second deployment. These public limits were checked against the official
[pricing](https://livekit.com/pricing),
[quota](https://docs.livekit.io/deploy/admin/quotas-and-limits/#metered-resources),
and [billing](https://docs.livekit.io/deploy/admin/billing/#agent-deployment) pages.
The project's own displayed quota and remaining credits should also be checked
immediately before deployment.

Build agents can sleep when idle. A cold start adds about **10–20 seconds** before
the agent joins. The existing owned inbound trunk has been prepared and re-read
with a **60-second ringing timeout** and its existing **180-second call cap**.
Its caller allowlist, media configuration, credentials, and dispatch rule were
preserved. Free Build does not include always-warm hosting. See
[cold starts](https://docs.livekit.io/deploy/agents/managing-deployments/#cold-start).

For a future setup, this explicit command changes only the ringing timeout on
the exact locally owned existing trunk; it refuses new resources, changed
credentials, broader number scopes, or simultaneous allowlist changes:

```sh
Product/voice-agent/.venv/bin/python Product/voice-agent/setup_inbound.py --number +16179939206 --apply --prepare-hosted
```

The SDK cannot patch `ringing_timeout` alone, so the script copies the full
currently listed trunk, restores the same saved Digest password if the API
redacted it, and replaces only the timeout. Repeating it at 60 seconds is a
no-op. New trunks created by this setup also default to 60 seconds.

## Review and prepare

The image uses Python 3.13 on Debian slim, a non-root user, tested direct dependency
versions, and a fixed foreground `python agent.py start` command. It copies only
the three runtime modules. `.dockerignore` allowlists those modules and build
inputs, excluding every local env file, test, virtualenv, SIP credential, and
development log. Direct dependencies are pinned; their transitive dependencies
are resolved by pip during the hosted build. No local Docker daemon is required
because [LiveKit builds the image](https://docs.livekit.io/deploy/agents/builds/).
The official `lk` CLI v2.19.0 is installed. A Docker daemon is absent, so the
Linux image has not been built locally.

From the repository root, prepare the private intake-only runtime settings:

```sh
Product/voice-agent/.venv/bin/python Product/voice-agent/prepare_hosted_secrets.py --mode intake
```

This writes ignored `Product/voice-agent/.env.hosted.local` with permissions `0600`.
It includes only the backend URL/token, intake model options, consenting caller
allowlist, duration cap, agent name, and mode. It excludes local LiveKit keys,
SIP Digest credentials, Photon keys, recipient numbers, and unrelated settings.
LiveKit [injects its own URL/API credentials](https://docs.livekit.io/deploy/agents/secrets/#livekit-secrets).
The script prints key names only. It does not deploy, restart a worker, or call
any service. Re-run it if approved runtime settings change. For a later guard
deployment, `--mode guard` additionally requires all existing relay enable/consent
checks to pass; it does not turn those flags on automatically.

## Operator deployment after approval

The installed CLI can authenticate using the existing project's URL/API keys
from the ignored local env file; an additional OAuth login is unnecessary. A
read-only agent listing using those credentials has confirmed the Build slot is
empty. Never put keys in command arguments or print the loaded environment.
From the repository root, this read-only preflight keeps credentials in process
environment only:

```sh
Product/voice-agent/.venv/bin/python - <<'PY'
import subprocess
from dotenv import load_dotenv
load_dotenv('Product/voice-agent/.env.local')
subprocess.run(['lk', 'agent', 'list'], cwd='Product/voice-agent', check=True)
PY
```

Confirm the selected project is the existing `pharos-dkmaw3b9` project and the
Build plan is still active. After explicit deployment approval, use the same
environment-only authentication to create the single production agent:

```sh
Product/voice-agent/.venv/bin/python - <<'PY'
import subprocess
from dotenv import load_dotenv
load_dotenv('Product/voice-agent/.env.local')
subprocess.run(['lk', 'agent', 'create', '--region', 'us-east',
                '--secrets-file', '.env.hosted.local', '.'],
               cwd='Product/voice-agent', check=True)
subprocess.run(['lk', 'agent', 'status'], cwd='Product/voice-agent', check=True)
PY
```

Run `create` **only once**, when the Build deployment slot is empty. It deploys
to production and saves the agent ID/project in `livekit.toml`. `us-east` is a
documented hosting region; do not create a second region on this one-slot plan.
Keep the generated config for future updates. After creation, use `lk agent
deploy .` for code updates, and `lk agent update-secrets --secrets-file
.env.hosted.local .` only when intentionally changing runtime settings. Secret
updates restart the hosted agent. Consult the installed command's `--help`
before changing any version-specific flag.

The source still registers **`pharos-intake`**, which is the name in the existing
individual SIP dispatch rule. Hosting preserves this dispatch name. Once the
hosted deployment is healthy, stop the local `pharos-intake` worker so incoming
calls are not randomly split between local and hosted implementations. Check the
approved caller allowlist and cold-start timeout, then run one explicitly agreed
teammate test. Inspect private provider logs locally; do not post raw room names,
phone metadata, transcripts, or credentials in public screenshots or chat.

Official references: [deployment quickstart](https://docs.livekit.io/deploy/agents/quickstart/),
[CLI commands](https://docs.livekit.io/reference/developer-tools/livekit-cli/agent/deployment/),
[secret management](https://docs.livekit.io/deploy/agents/secrets/),
[hosting regions](https://docs.livekit.io/deploy/admin/regions/agent-deployment/).
