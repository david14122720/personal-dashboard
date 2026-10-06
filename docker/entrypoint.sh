#!/usr/bin/env bash
# Personal Dashboard production entrypoint: run the Axum backend (:80) and
# the MCP Streamable HTTP server (:3002) side by side as PID 1.
#
# Fail fast: when either child exits, terminate the sibling and exit with
# the first child's status so the container restart policy brings both back.
# No silent MCP death — a crashed MCP restarts the whole container.
set -euo pipefail

# Honour an explicit command (`docker run <image> <cmd>`), as the previous
# CMD-based image did; with no args the container starts both services.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

MCP_PID=""
BACKEND_PID=""

terminate_sibling() {
  if [ -n "${MCP_PID}" ]; then kill -TERM "${MCP_PID}" 2>/dev/null || true; fi
  if [ -n "${BACKEND_PID}" ]; then kill -TERM "${BACKEND_PID}" 2>/dev/null || true; fi
}

# Forward docker stop (TERM) and Ctrl-C (INT) to both children.
trap terminate_sibling TERM INT

node /app/mcp-dashboard/dist/index.js &
MCP_PID=$!

/app/personal-dashboard-backend &
BACKEND_PID=$!

# Guarded so set -e does not skip the cleanup below on a non-zero exit.
STATUS=0
wait -n "${MCP_PID}" "${BACKEND_PID}" || STATUS=$?

# One child is gone: stop the sibling, reap both, exit with the first status.
terminate_sibling
wait "${MCP_PID}" 2>/dev/null || true
wait "${BACKEND_PID}" 2>/dev/null || true
exit "${STATUS}"
