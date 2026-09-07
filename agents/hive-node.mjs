#!/usr/bin/env node
/**
 * MAG Hive node — тонкий клиент для машины с OpenClaw.
 * Держит исходящий канал к хабу (NAT-friendly), бьёт heartbeat и печатает инбокс.
 *
 *   HIVE_HUB_URL=http://127.0.0.1:43147 HIVE_HANDLE=linux node agents/hive-node.mjs
 */
const hub = (process.env.HIVE_HUB_URL || "http://127.0.0.1:43147").replace(/\/$/, "");
const handle = (process.env.HIVE_HANDLE || "linux").replace(/^@/, "");
const name = process.env.HIVE_NAME || handle;
const os = process.env.HIVE_OS || detectOs();
const machine = process.env.HIVE_MACHINE || `${os}-node`;

let agentId = process.env.HIVE_AGENT_ID || "";
let since = 0;

function detectOs() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "android") return "android";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

async function json(path, init) {
  const response = await fetch(`${hub}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body;
}

async function register() {
  const result = await json("/api/hive/agents", {
    method: "POST",
    body: JSON.stringify({
      id: agentId || undefined,
      handle,
      name,
      os,
      machine,
      role: "OpenClaw executor",
      capabilities: ["hive-node", "openclaw"],
    }),
  });
  agentId = result.member.id;
  console.log(`[hive-node] registered @${handle} as ${agentId} on ${hub}`);
}

async function heartbeat() {
  if (!agentId) return;
  await json("/api/hive/agents", {
    method: "PATCH",
    body: JSON.stringify({ id: agentId, heartbeat: true }),
  });
}

async function inbox() {
  const result = await json(
    `/api/hive/inbox?handle=${encodeURIComponent(handle)}&after=${since}`,
  );
  for (const message of result.messages) {
    since = Math.max(since, message.createdAt);
    console.log(
      JSON.stringify({
        type: "hive_inbox",
        kind: message.kind,
        from: message.fromId,
        body: message.body,
        task: message.taskRef || null,
        at: message.createdAt,
      }),
    );
  }
}

async function loop() {
  await register();
  while (true) {
    try {
      await heartbeat();
      await inbox();
    } catch (error) {
      console.error("[hive-node]", error.message || error);
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

loop().catch((error) => {
  console.error(error);
  process.exit(1);
});
