#!/usr/bin/env bash
# Join MAG Hive from a machine WITHOUT a public/static IP.
#
# Closed overlay (preferred):
#   export HIVE_AGENT_KEY=hive_...
#   export HIVE_OVERLAY=1
#   export HIVE_OVERLAY_IP=10.42.0.3          # from Tunnels
#   export HIVE_WG_CONF=/etc/wireguard/hive0.conf
#   ./agents/hive-join.sh
#
# Fallback reverse SSH (no WireGuard yet):
#   export HIVE_HUB_URL=https://hive.example.com
#   export HIVE_REVERSE_PORT=22002
#   ./agents/hive-join.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${HIVE_AGENT_KEY:?set HIVE_AGENT_KEY}"
WAKE_PORT="${HIVE_WAKE_PORT:-18790}"
SSH_PID=""

if [[ "${HIVE_OVERLAY:-}" == "1" ]]; then
  export HIVE_HUB_URL="${HIVE_HUB_URL:-http://10.42.0.1:43147}"
  CONF="${HIVE_WG_CONF:-}"
  if [[ -n "$CONF" && -f "$CONF" ]]; then
    if command -v wg-quick >/dev/null 2>&1; then
      wg-quick up "$CONF" || wg-quick strip "$CONF" >/dev/null
    else
      echo "[hive-join] wg-quick не найден — поднимите интерфейс сами, conf: $CONF" >&2
    fi
  else
    echo "[hive-join] overlay: задайте HIVE_WG_CONF (файл с вкладки Туннели)." >&2
  fi
  if [[ -z "${HIVE_OVERLAY_IP:-}" ]]; then
    echo "Задайте HIVE_OVERLAY_IP (10.42.0.x агента)." >&2
    exit 1
  fi
  echo "[hive-join] overlay → $HIVE_HUB_URL  wake ${HIVE_OVERLAY_IP}:$WAKE_PORT"
  HIVE_WAKE_PORT="$WAKE_PORT" node "$ROOT/agents/hive-node.mjs" &
  NODE_PID=$!
  cleanup() { kill "$NODE_PID" 2>/dev/null || true; }
  trap cleanup EXIT INT TERM
  wait "$NODE_PID"
  exit 0
fi

HUB="${HIVE_HUB_URL:?set HIVE_HUB_URL or HIVE_OVERLAY=1}"
SSH_HOST="${HIVE_SSH_HOST:-}"
SSH_USER="${HIVE_SSH_USER:-claw}"
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
cleanup() { kill "$NODE_PID" ${SSH_PID:+$SSH_PID} 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait "$NODE_PID"
