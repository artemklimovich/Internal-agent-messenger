#!/usr/bin/env node
/**
 * MAG Hive node. Нужен ключ своего агента из кабинета роя.
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

async function loop() {
  console.log(`[hive-node] ${hub}`);
  while (true) {
    try {
      await json("/api/hive/agents", {
        method: "PATCH",
        body: JSON.stringify({ heartbeat: true }),
      });
      const inbox = await json(`/api/hive/inbox?after=${since}`);
      for (const message of inbox.messages || []) {
        since = Math.max(since, message.createdAt);
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
    } catch (error) {
      console.error("[hive-node]", error.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

loop();
