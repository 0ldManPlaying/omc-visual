#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${OMC_VISUAL_PORT:-3200}"
export PATH="${HOME}/.cargo/bin:${PATH}"

HEALTH_URL="http://127.0.0.1:${PORT}/api/status/health"

if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "OMC Visual already healthy on port ${PORT}"
  exit 0
fi

cd "$ROOT/server"
nohup npm start >> /tmp/omc-visual.log 2>&1 &
echo $! >/tmp/omc-visual.npm.pid

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OMC Visual started (port ${PORT}). Log: /tmp/omc-visual.log"
    exit 0
  fi
  sleep 0.5
done

echo "Server did not become healthy in time. See /tmp/omc-visual.log"
exit 1
