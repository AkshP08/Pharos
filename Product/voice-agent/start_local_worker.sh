#!/bin/sh
# A local production-mode worker can receive named SIP dispatch without a hosted
# agent deployment. It never places an outbound call just by starting.
set -eu
PHAROS_RUNTIME_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PHAROS_RUNTIME_PYTHON="$PHAROS_RUNTIME_DIR/.venv/bin/python"
if [ ! -x "$PHAROS_RUNTIME_PYTHON" ]; then
  echo "Create Product/voice-agent/.venv and install the documented dependencies first." >&2
  exit 1
fi
"$PHAROS_RUNTIME_PYTHON" "$PHAROS_RUNTIME_DIR/agent.py" --check-config
exec "$PHAROS_RUNTIME_PYTHON" "$PHAROS_RUNTIME_DIR/agent.py" start --log-level info
