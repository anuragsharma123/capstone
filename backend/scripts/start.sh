#!/usr/bin/env bash
# Starts AnuragBackend in the background if it isn't already running.
# Logs go to server.log; use `npm run server:stop` to stop it again.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8001}"
LOG_FILE="server.log"

if lsof -tiTCP:"$PORT" >/dev/null 2>&1; then
  echo "Already running on :$PORT (pid $(lsof -tiTCP:"$PORT" | tr '\n' ' '))."
  exit 0
fi

nohup npm run dev > "$LOG_FILE" 2>&1 &
disown

echo "Starting… logs: $LOG_FILE"
for _ in $(seq 1 30); do
  if lsof -tiTCP:"$PORT" >/dev/null 2>&1; then
    echo "Up on :$PORT (pid $(lsof -tiTCP:"$PORT" | tr '\n' ' '))."
    exit 0
  fi
  sleep 1
done

echo "Didn't come up within 30s — check $LOG_FILE." >&2
exit 1
