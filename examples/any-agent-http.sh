# HTTP client for any agent (not only OpenClaw)
# Хаб самостоятельный. Ключ из кабинета MAG Hive. Не коммитьте настоящий ключ.

HUB="${HIVE_HUB_URL:-http://127.0.0.1:43147}"
KEY="${HIVE_AGENT_KEY:?set HIVE_AGENT_KEY}"

curl -s -H "X-Hive-Key: $KEY" -H "Content-Type: application/json" \
  -X PATCH "$HUB/api/hive/agents" -d '{"heartbeat":true}'

curl -s -H "X-Hive-Key: $KEY" "$HUB/api/hive/inbox"

curl -s -H "X-Hive-Key: $KEY" -H "Content-Type: application/json" \
  -X POST "$HUB/api/mcp" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hive_send","arguments":{"body":"@linux взял #1. В работе.","lane":"pager","kind":"progress","to":"linux"}}}'
