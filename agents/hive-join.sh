#!/usr/bin/env bash
# Join MAG Hive from a machine WITHOUT a public/static IP.
# Run this next to OpenClaw, not instead of it.
#
#   export HIVE_HUB_URL=https://hive.example.com
#   export HIVE_AGENT_KEY=hive_...          # cabinet, once
#   export HIVE_SSH_HOST=hive.example.com   # same VPS, sshd
#   export HIVE_REVERSE_PORT=22002          # from Tunnels tab
#   ./agents/hive-join.sh
#
# Two outbound sockets (both initiated HERE, NAT is fine):
#   1) HTTPS/SSE  — send + receive pager/chat/files
#   2) ssh -R      — hub POSTs /hive/wake into THIS localhost (encrypted SSH)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HUB="${HIVE_HUB_URL:?set HIVE_HUB_URL}"
KEY="${HIVE_AGENT_KEY:?set HIVE_AGENT_KEY}"
SSH_HOST="${HIVE_SSH_HOST:-}"
SSH_USER="${HIVE_SSH_USER:-claw}"
WAKE_PORT="${HIVE_WAKE_PORT:-18790}"
REVERSE_PORT="${HIVE_REVERSE_PORT:-}"

if [[ -z "$SSH_HOST" ]]; then
  SSH_HOST="$(node -e 'try { console.log(new URL(process.env.HIVE_HUB_URL).hostname || "") } catch { console.log("") }')"
fi
if [[ -z "$SSH_HOST" ]]; then
  echo "Задайте HIVE_SSH_HOST (хост хаба, куда ssh)." >&2
  exit 1
fi
if [[ -z "$REVERSE_PORT" ]]; then
  echo "Задайте HIVE_REVERSE_PORT с вкладки «Туннели» (например 22002)." >&2
  exit 1
fi

echo "[hive-join] node → $HUB  wake 127.0.0.1:$WAKE_PORT  ssh -R $REVERSE_PORT"
HIVE_WAKE_PORT="$WAKE_PORT" node "$ROOT/agents/hive-node.mjs" &
NODE_PID=$!
cleanup() { kill "$NODE_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

SSH=(ssh -N
  -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -R "${REVERSE_PORT}:127.0.0.1:${WAKE_PORT}"
  "${SSH_USER}@${SSH_HOST}")
if command -v autossh >/dev/null 2>&1; then
  AUTOSSH_GATETIME=0 autossh -M 0 "${SSH[@]:1}" &
  SSH_PID=$!
else
  "${SSH[@]}" &
  SSH_PID=$!
fi
cleanup() { kill "$NODE_PID" "$SSH_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait "$NODE_PID"
