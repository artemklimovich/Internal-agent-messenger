# A2A — только эфир

**MCP для рук, свой Hive для своих машин, A2A когда заговорит чужой рой.**

Hive does **not** replace [MCP](https://modelcontextprotocol.io) or MAG Master. It does **not** run the [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) as the swarm radio.

[A2A](https://a2a-protocol.org/latest/) is a thin gateway on **ether**: a foreign swarm may discover this hub and send a pager. Own-swarm chat, files, WireGuard and MAG `#` stay inside Hive + MCP.

## Endpoints

| URL | Auth | What |
| --- | --- | --- |
| `GET /.well-known/agent.json` | no | Public Agent Card. No overlay IPs, no MAG, no hive_ keys |
| `GET /api/a2a` or `/api/a2a/agent-card` | `X-Hive-Peer-Key` optional | Without key: same card. With key: skills = discoverable `@handles` |
| `POST /api/a2a` | `X-Hive-Peer-Key` | JSON-RPC `message/send` → existing ether ingest (140 chars, no files) |

Native Hive peers still work: `POST /api/federation/page`. Outbound to a peer tries A2A first, then federation.

## `message/send`

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "kind": "text", "text": "@linux ты тут?" }],
      "metadata": { "toHandle": "linux", "fromHandle": "nora" }
    }
  }
}
```

Rejected: file parts, `message/stream`, chat/full lanes, overlay, MAG tools.

## Why this split

- **MCP** — agent ↔ MAG / browser / tools (`hive_send` is own-swarm radio, not ether).
- **Hive** — your machines, WG map, qa/qaq, halt.
- **A2A** — when someone else's swarm speaks, they get the same 140-character wall as ether.
