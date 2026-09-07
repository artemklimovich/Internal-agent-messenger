#!/usr/bin/env node
/**
 * MAG Hive node — SSE wake, poll only as fallback.
 *   HIVE_HUB_URL=http://127.0.0.1:43147 HIVE_AGENT_KEY=hive_... node agents/hive-node.mjs
 */
const hub = (process.env.HIVE_HUB_URL || "http://127.0.0.1:43147").replace(/\/$/, "");
const key = process.env.HIVE_AGENT_KEY || "";
if (!key) {
  console.error("Задайте HIVE_AGENT_KEY из кабинета своего роя (ключ показывается один раз).");
  process.exit(1);
}

let since = 0;

async function json(path, init = {}) {
  const response = await fetch(`${hub}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Hive-Key": key,
      ...(init.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

function printMessage(message) {
  since = Math.max(since, message.createdAt || 0);
  console.log(
    JSON.stringify({
      type: "hive_inbox",
      lane: message.lane || "pager",
      kind: message.kind,
      body: message.body,
      task: message.taskRef || null,
      attachments: (message.attachments || []).map((item) => item.name),
    }),
  );
}

async function drainInbox() {
  await json("/api/hive/agents", { method: "PATCH", body: JSON.stringify({ heartbeat: true }) });
  const inbox = await json(`/api/hive/inbox?after=${since}`);
  for (const message of inbox.messages || []) printMessage(message);
}

async function listenSse() {
  const response = await fetch(`${hub}/api/hive/inbox/stream`, {
    headers: { "X-Hive-Key": key, Accept: "text/event-stream" },
  });
  if (!response.ok || !response.body) throw new Error(`sse ${response.status}`);
  console.log(`[hive-node] SSE ${hub}/api/hive/inbox/stream`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("sse closed");
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() || "";
    for (const chunk of chunks) {
      const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const event = JSON.parse(dataLine.slice(5).trim());
        if (event.message) printMessage(event.message);
      } catch {
        /* ignore */
      }
    }
  }
}

async function loop() {
  console.log(`[hive-node] ${hub}`);
  await drainInbox().catch((error) => console.error("[hive-node]", error.message || error));
  while (true) {
    try {
      await listenSse();
    } catch (error) {
      console.error("[hive-node] sse", error.message || error, "— fallback poll 20s");
      await drainInbox().catch((err) => console.error("[hive-node]", err.message || err));
      await new Promise((resolve) => setTimeout(resolve, 20_000));
    }
  }
}

loop();
