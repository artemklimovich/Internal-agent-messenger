#!/usr/bin/env node
/**
 * Stdio MCP adapter MAG Hive → OpenClaw / Hermes / MAG Bot.
 * Accepts MCP Content-Length frames or newline JSON.
 *
 *   HIVE_HUB_URL=http://127.0.0.1:43147 HIVE_AGENT_KEY=hive_... \
 *     node mcp/hive-mcp.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const name of ["hive.env", ".env"]) {
  const file = join(here, name);
  if (!existsSync(file) || process.env.HIVE_AGENT_KEY) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (k && process.env[k] == null) process.env[k] = v;
  }
}

const hub = (process.env.HIVE_HUB_URL || "http://127.0.0.1:43147").replace(/\/$/, "");
const key = process.env.HIVE_AGENT_KEY || "";
if (!key) {
  console.error("[mag-hive] Set HIVE_AGENT_KEY from the swarm cabinet (shown once).");
}

let framed = "length";

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
  if (framed === "line") {
    process.stdout.write(`${json}\n`);
    return;
  }
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
    if (buffer.length === 0) return;
    const asText = buffer.toString("utf8");
    if (/^Content-Length:/i.test(asText) || asText.startsWith("content-length:")) {
      framed = "length";
      const headerEnd = indexOfHeaderEnd(buffer);
      if (headerEnd === -1) return;
      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      const sep = headerSepLen(buffer, headerEnd);
      if (!match) {
        buffer = buffer.subarray(headerEnd + sep);
        continue;
      }
      const length = Number(match[1]);
      const start = headerEnd + sep;
      if (buffer.length < start + length) return;
      const body = buffer.subarray(start, start + length).toString("utf8");
      buffer = buffer.subarray(start + length);
      void handle(JSON.parse(body));
      continue;
    }
    const nl = buffer.indexOf(0x0a);
    if (nl === -1) return;
    framed = "line";
    let line = buffer.subarray(0, nl).toString("utf8").replace(/\r$/, "").trim();
    buffer = buffer.subarray(nl + 1);
    if (!line) continue;
    void handle(JSON.parse(line));
  }
}

function indexOfHeaderEnd(buf) {
  const crlf = buf.indexOf(Buffer.from("\r\n\r\n"));
  const lf = buf.indexOf(Buffer.from("\n\n"));
  if (crlf === -1) return lf;
  if (lf === -1) return crlf;
  return Math.min(crlf, lf);
}

function headerSepLen(buf, at) {
  if (buf.subarray(at, at + 4).toString("utf8") === "\r\n\r\n") return 4;
  return 2;
}

async function handle(message) {
  if (message.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2025-11-25",
        serverInfo: { name: "mag-hive", version: "0.3.0" },
        capabilities: { tools: {} },
      },
    });
    return;
  }
  if (message.method === "notifications/initialized" || message.method === "initialized") return;
  if (message.method === "tools/list" || message.method === "tools/call") {
    const result = await rpc(message.method, message.params);
    write({ jsonrpc: "2.0", id: message.id, ...pick(result) });
    return;
  }
  if (message.id === undefined || message.id === null) return;
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
