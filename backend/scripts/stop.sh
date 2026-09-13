#!/usr/bin/env bash
# Stops whatever is listening on AnuragBackend's port — however it was
# started (npm run dev in a foreground terminal, or server:start in the
# background). Finds the real listener by port rather than a tracked PID
# file, since tsx runs the app as a child process with its own PID.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8001}"
PIDS="$(lsof -tiTCP:"$PORT" 2>/dev/null || true)"

if [ -z "$PIDS" ]; then
  echo "Not running on :$PORT."
  exit 0
fi

echo "Stopping pid(s): $(echo "$PIDS" | tr '\n' ' ')"
kill $PIDS
sleep 1

if lsof -tiTCP:"$PORT" >/dev/null 2>&1; then
  echo "Still up after SIGTERM — forcing." >&2
  kill -9 $(lsof -tiTCP:"$PORT") 2>/dev/null || true
fi

echo "Stopped."
