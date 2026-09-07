#!/usr/bin/env node
/**
 * Stdio MCP adapter MAG Hive → OpenClaw / MAG Bot.
 * JSON-RPC with Content-Length (MCP spec).
 *
 *   HIVE_HUB_URL=http://127.0.0.1:43147 HIVE_AGENT_KEY=hive_... \
 *     node mcp/hive-mcp.mjs
 */
const hub = (process.env.HIVE_HUB_URL || "http://127.0.0.1:43147").replace(/\/$/, "");
const key = process.env.HIVE_AGENT_KEY || "";
if (!key) {
  console.error("[mag-hive] Set HIVE_AGENT_KEY from the swarm cabinet (shown once).");
}

async function rpc(method, params) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-Hive-Key"] = key;
  const response = await fetch(`${hub}/api/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
}

function write(message) {
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

function drain() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString("utf8");
    buffer = buffer.subarray(start + length);
    void handle(JSON.parse(body));
  }
}

async function handle(message) {
  if (message.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-11-25",
        serverInfo: { name: "mag-hive", version: "0.1.0" },
        capabilities: { tools: {} },
      },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list" || message.method === "tools/call") {
    const result = await rpc(message.method, message.params);
    write({ jsonrpc: "2.0", id: message.id, ...pick(result) });
    return;
  }
  write({
    jsonrpc: "2.0",
    id: message.id,
    error: { code: -32601, message: `method not found: ${message.method}` },
  });
}

function pick(result) {
  if (result.error) return { error: result.error };
  return { result: result.result };
}
