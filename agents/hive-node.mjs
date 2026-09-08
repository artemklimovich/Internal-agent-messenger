#!/usr/bin/env node
/**
 * MAG Hive node — SSE inbox + short pager ack (not OpenClaw execution).
 *
 *   HIVE_HUB_URL=… HIVE_AGENT_KEY=hive_… node hive-node.mjs
 *   HIVE_AUTO_ACK=0 — only log, do not reply
 */
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const hub = (process.env.HIVE_HUB_URL || "http://127.0.0.1:43147").replace(/\/$/, "");
const key = process.env.HIVE_AGENT_KEY || "";
const wakePort = Number(process.env.HIVE_WAKE_PORT || 18790);
const autoAck = process.env.HIVE_AUTO_ACK !== "0";
const wakeOpenclaw = process.env.HIVE_WAKE_OPENCLAW === "1";
let wakingUntil = 0;
let haltUntil = 0;
let haltGeneration = 0;
let currentChild = null;
if (!key) {
  console.error("Задайте HIVE_AGENT_KEY из кабинета своего роя (ключ показывается один раз).");
  process.exit(1);
}

const hostAgent = process.env.OPENCLAW_AGENT || "main";

function discoverOpenclawAgents() {
  const fromEnv = (process.env.HIVE_OPENCLAW_AGENTS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length) return [...new Set(fromEnv)];
  const configPath =
    process.env.OPENCLAW_CONFIG || join(process.env.HOME || homedir(), ".openclaw", "openclaw.json");
  try {
    if (!existsSync(configPath)) return [hostAgent];
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const allow = cfg?.agents?.entries?.[hostAgent]?.subagents?.allowAgents;
    if (Array.isArray(allow) && allow.length) {
      return [...new Set(allow.map((item) => String(item).toLowerCase()).filter(Boolean))];
    }
    const entries = cfg?.agents?.entries && typeof cfg.agents.entries === "object" ? Object.keys(cfg.agents.entries) : [];
    return entries.length ? entries.map((item) => item.toLowerCase()) : [hostAgent];
  } catch {
    return [hostAgent];
  }
}

function openclawDisplayName(id) {
  const configPath =
    process.env.OPENCLAW_CONFIG || join(process.env.HOME || homedir(), ".openclaw", "openclaw.json");
  try {
    if (!existsSync(configPath)) return id;
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const name = cfg?.agents?.entries?.[id]?.name;
    return typeof name === "string" && name.trim() ? name.trim() : id;
  } catch {
    return id;
  }
}

function subagentPayload() {
  return discoverOpenclawAgents().map((handle) => ({ handle, name: openclawDisplayName(handle) }));
}

function resolveWakeAgent(message) {
  const listed = discoverOpenclawAgents();
  const hinted = String(message.openclawAgent || message.toHandle || "")
    .replace(/^@/, "")
    .toLowerCase();
  if (hinted && listed.includes(hinted)) return hinted;
  const toId = String(message.toId || "");
  if (toId && idToHandle.has(toId)) {
    const handle = String(idToHandle.get(toId)).toLowerCase();
    if (listed.includes(handle)) return handle;
  }
  const body = String(message.body || "");
  for (const id of listed) {
    if (id !== hostAgent && body.includes(`@${id}`)) return id;
  }
  return hostAgent;
}

let since = 0;
let catchUp = true;
let talkMode = "qa";
const acked = new Set();
/** member.id → handle (включая человека-оператора) */
const idToHandle = new Map();

function applyTalkMode(mode) {
  talkMode = mode === "qaq" ? "qaq" : "qa";
}

async function refreshRoster() {
  const rpc = await json("/api/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "hive_roster", arguments: {} },
    }),
  });
  const text = rpc?.result?.content?.[0]?.text;
  if (!text) return;
  const parsed = JSON.parse(text);
  applyTalkMode(parsed.talkMode);
  idToHandle.clear();
  for (const member of parsed.members || []) {
    if (member.id && member.handle) idToHandle.set(member.id, member.handle);
  }
}

function senderHandle(message) {
  const fromId = String(message.fromId || "");
  if (idToHandle.has(fromId)) return idToHandle.get(fromId);
  const colon = fromId.lastIndexOf(":");
  if (colon >= 0) return fromId.slice(colon + 1);
  return undefined;
}

function isHalted() {
  return Date.now() < haltUntil;
}

function killCurrentAgent() {
  const child = currentChild;
  if (!child?.pid) return;
  const pid = child.pid;
  try {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => undefined);
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 1500);
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function applyHalt(until) {
  haltUntil = Number(until) || 0;
  if (!isHalted()) return;
  haltGeneration += 1;
  wakingUntil = 0;
  killCurrentAgent();
  console.log(JSON.stringify({ type: "hive_halt", haltUntil }));
  void setPresence("free", undefined).catch(() => undefined);
}

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

function radioBody(who, text, max = 280) {
  const raw = String(text || "").trim().replace(/\s+/g, " ");
  const handle = `@${who}`;
  const body = raw.toLowerCase().startsWith(handle.toLowerCase()) ? raw : `${handle} ${raw}`;
  return body.slice(0, max);
}

function laneMax(lane) {
  if (lane === "chat") return 8000;
  if (lane === "full") return 4000;
  return 280;
}

function incomingLane(message) {
  const lane = message.lane || "pager";
  return lane === "chat" || lane === "full" ? lane : "pager";
}

function parseOutLane(text, fallback) {
  const raw = String(text || "");
  const match = raw.match(/РОК_СЛОЙ\s*[:\s]*(pager|chat|full|пейджер|чат|полный)/i);
  let lane = fallback;
  if (match) {
    const value = match[1].toLowerCase();
    lane = value === "chat" || value === "чат" ? "chat" : value === "full" || value === "полный" ? "full" : "pager";
  }
  const fact = raw
    .replace(/\s*РОК_ЗНАКОМСТВО\s*/gi, " ")
    .replace(/\s*РОК_СЛОЙ\s*[:\s]*(pager|chat|full|пейджер|чат|полный)\s*/gi, " ")
    .trim();
  return { lane, fact };
}

function replyKindFor(lane, { radio, magWork, qaq }) {
  if (lane === "chat") return "chat";
  if (lane === "full") return "artifact";
  if (radio || magWork || !qaq) return "done";
  return "page";
}

function isMeet(message) {
  if (message.kind === "done") return false;
  if (message.taskRef?.magTaskId) return false;
  const body = String(message.body || "");
  if (/MAG\s*#\d+/i.test(body) || /#\d{1,6}/.test(body)) return false;
  const text = body.toLowerCase();
  return /знакомств|представ|кто ты|где стоишь|какой ip|встречн|overlay|10\.66|hive-meet|кто из нас/.test(text);
}

function isRadioCheck(message) {
  if (isMeet(message)) return false;
  if (message.kind === "done") return false;
  if (message.taskRef?.magTaskId) return false;
  const body = String(message.body || "");
  if (/MAG\s*#\d+/i.test(body) || /#\d{1,6}/.test(body)) return false;
  const text = body.toLowerCase();
  return /ты тут|проверка рации|агент-агент|на связи\s*\?/.test(text);
}

const recentFacts = [];

function factNorm(text) {
  return String(text || "")
    .replace(/@[\w-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 220);
}

function seenFact(text) {
  const n = factNorm(text);
  if (!n) return false;
  const now = Date.now();
  while (recentFacts.length && now - recentFacts[0].t > 120_000) recentFacts.shift();
  return recentFacts.some((item) => item.n === n);
}

function rememberFact(text) {
  const n = factNorm(text);
  if (!n) return;
  recentFacts.push({ n, t: Date.now() });
}

let qaqTurns = 0;

function shouldAck(message) {
  const kind = message.kind || "page";
  const lane = message.lane || "pager";
  const fromId = String(message.fromId || "");
  const fromHuman = fromId.startsWith("user-");
  const fromAgent = fromId.includes(":") && !fromHuman;
  if (fromHuman) qaqTurns = 0;
  if (kind === "progress" || kind === "blocked") return false;
  if (fromAgent && (kind === "chat" || kind === "artifact")) return false;
  if (seenFact(message.body)) return false;
  if (talkMode === "qaq" && fromAgent && (kind === "page" || kind === "chat" || kind === "done")) {
    qaqTurns += 1;
    if (qaqTurns > 4) {
      console.log(JSON.stringify({ type: "hive_qaq_cap", fromId, turns: qaqTurns }));
      return false;
    }
  }
  if (kind === "task_assigned" || kind === "page" || kind === "chat" || kind === "artifact" || kind === "secret") return true;
  if (lane === "chat" || lane === "full") return true;
  const self = process.env.OPENCLAW_AGENT || "main";
  if (kind === "done" && fromAgent && talkMode === "qaq") return true;
  if (kind === "done" && self === "main" && fromAgent) return true;
  return false;
}

async function hiveSend({ to, kind, body, lane = "pager", workTimer = false, as }) {
  const max = laneMax(lane);
  const rpc = await json("/api/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "hive_send",
        arguments: {
          to,
          lane,
          kind,
          body: String(body || "").slice(0, max),
          workTimer,
          ...(as ? { as } : {}),
        },
      },
    }),
  });
  const text = rpc?.result?.content?.[0]?.text;
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function hivePatch(id, patch) {
  if (!id) return;
  await json("/api/mcp", {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "hive_patch", arguments: { id, ...patch } },
    }),
  });
}

async function setPresence(presence, currentTaskId, asHandle) {
  await json("/api/hive/agents", {
    method: "PATCH",
    body: JSON.stringify({
      presence,
      currentTaskId,
      ...(asHandle ? { forHandle: asHandle } : {}),
    }),
  });
}

function parseJsonObject(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(stdout.slice(start, i + 1));
    }
  }
  return null;
}

function parseAgentReply(stdout) {
  try {
    const parsed = parseJsonObject(stdout);
    if (!parsed) return { ok: false, text: "", error: "модель молчит (нет JSON)" };
    const texts = (parsed?.result?.payloads || [])
      .map((item) => (item && item.text ? String(item.text) : ""))
      .filter(Boolean);
    const text = texts.join("\n").trim();
    if (parsed?.status && parsed.status !== "ok") {
      return { ok: false, text, error: parsed.summary || parsed.status };
    }
    if (!text) return { ok: false, text: "", error: parsed.summary || "пустой ответ" };
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: "", error: error instanceof Error ? error.message : "json" };
  }
}

function runOpenClawAgent(prompt, timeoutSec = Number(process.env.OPENCLAW_TIMEOUT || 90), agent = hostAgent) {
  const sessionKey =
    agent === hostAgent && process.env.OPENCLAW_SESSION_KEY
      ? process.env.OPENCLAW_SESSION_KEY
      : `agent:${agent}:hive-pager`;
  const bin = process.env.OPENCLAW_BIN || "openclaw";
  const msgFile = join(tmpdir(), `hive-wake-${process.pid}-${Date.now()}.txt`);
  writeFileSync(msgFile, prompt, "utf8");
  const logFile = msgFile.replace(/\.txt$/, ".log");
  const nodeDir = dirname(process.execPath);
  const gen = haltGeneration;
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (currentChild) currentChild = null;
      if (isHalted() || gen !== haltGeneration) resolve({ ok: false, halted: true, agent, stdout, logFile });
      else resolve(result);
    };
    if (isHalted()) {
      finish({ ok: false, halted: true, agent, stdout, logFile });
      return;
    }
    try {
      const logFd = openSync(logFile, "w");
      const child = spawn(
        bin,
        [
          "agent",
          "--agent",
          agent,
          "--session-key",
          sessionKey,
          "--message-file",
          msgFile,
          "--json",
          "--timeout",
          String(timeoutSec),
        ],
        {
          windowsHide: true,
          shell: process.platform === "win32",
          stdio: ["ignore", "pipe", logFd],
          env: {
            ...process.env,
            PATH: `${nodeDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH || ""}`,
          },
        },
      );
      currentChild = child;
      console.log(JSON.stringify({ type: "openclaw_wake", agent, sessionKey, pid: child.pid || null, logFile }));
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      const killTimer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }, (timeoutSec + 5) * 1000);
      child.on("error", (error) => {
        clearTimeout(killTimer);
        finish({ ok: false, agent, error: error.message, stdout, logFile });
      });
      child.on("exit", (code, signal) => {
        clearTimeout(killTimer);
        const parsed = parseAgentReply(stdout);
        if (parsed.ok) finish({ ok: true, agent, text: parsed.text, logFile, code });
        else {
          finish({
            ok: false,
            agent,
            error: parsed.error || `exit ${code}${signal ? `/${signal}` : ""}`,
            stdout,
            logFile,
            code,
          });
        }
      });
    } catch (error) {
      finish({
        ok: false,
        agent,
        error: error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "spawn failed",
        stdout,
        logFile,
      });
    }
  });
}

async function ackPager(message) {
  if (!autoAck) return;
  if (isHalted()) return;
  if (!shouldAck(message)) return;
  rememberFact(message.body);
  const id = message.id;
  if (id && acked.has(id)) return;
  if (id) {
    acked.add(id);
    if (acked.size > 200) acked.delete(acked.values().next().value);
  }
  if (idToHandle.size === 0 || (message.toId && !idToHandle.has(String(message.toId)))) {
    await refreshRoster().catch(() => undefined);
  }
  const to = senderHandle(message);
  const who = to || "оператор";
  const magId = message.taskRef?.magTaskId || (String(message.body || "").match(/MAG\s*#(\d{1,6})|#(\d{1,6})/) || []).slice(1).find(Boolean);
  const task = magId ? ` MAG #${magId}` : "";
  const radio = isRadioCheck(message);
  const meet = isMeet(message);
  const inLane = incomingLane(message);
  const files = (message.attachments || []).map((item) => item.name).filter(Boolean);
  const magWork =
    Boolean(magId) &&
    !radio &&
    (talkMode !== "qaq" || message.kind === "task_assigned");
  const self = resolveWakeAgent(message);
  const review =
    message.kind === "done" &&
    magWork &&
    talkMode !== "qaq" &&
    self === hostAgent;
  const qaq = talkMode === "qaq" && !radio && !magWork;
  const talkPager = inLane === "pager" && !magWork;
  const timeoutSec =
    talkPager || radio || meet || qaq
      ? Number(process.env.OPENCLAW_TIMEOUT || 90)
      : Number(process.env.OPENCLAW_WORK_TIMEOUT || 420);
  const layerHint =
    "Слои не смешивай. Пейджер — 1–2 фразы. Чат — абзацы. Полный — подпись к файлу/конверту. Чтобы сменить слой, последней строкой: РОК_СЛОЙ pager | РОК_СЛОЙ chat | РОК_СЛОЙ full.";
  const prompt = radio
    ? [
        "Слой: пейджер MAG Hive. Ответь одним коротким сообщением (1–2 фразы).",
        to ? `Отправитель: @${to}` : "Отправитель: оператор роя",
        "Текст:",
        String(message.body || ""),
        "Без инструментов и браузера. Проверка связи — только «на связи». Не дублируй @хэндл.",
      ].filter(Boolean).join("\n")
    : inLane === "chat"
      ? [
          `Слой: чат MAG Hive. Ты @${self}.`,
          `Пишет: @${who}`,
          "Текст:",
          String(message.body || ""),
          "Ответь 1–2 абзацами по делу. Не дублируй @хэндл.",
          qaq ? "Задай ОДИН встречный вопрос." : "",
          layerHint,
        ].filter(Boolean).join("\n")
    : inLane === "full"
      ? [
          `Слой: полный MAG Hive. Ты @${self}.`,
          `Пишет: @${who}`,
          files.length ? `Вложения: ${files.join(", ")}` : "Вложений нет — это подпись/конверт на полном слое.",
          "Текст:",
          String(message.body || ""),
          "Ответь подписью к файлу: что это, зачем, что делать дальше. Не пересказывай весь файл. Не дублируй @хэндл.",
          layerHint,
        ].filter(Boolean).join("\n")
    : meet || qaq || talkPager
      ? [
          `Слой: пейджер MAG Hive. Ты @${self}.`,
          `Пишет: @${who}`,
          "Текст:",
          String(message.body || ""),
          "Ответь 2–4 короткими фразами. Без браузера и MAG. Не дублируй @хэндл.",
          qaq ? "Задай ОДИН встречный вопрос. Не пиши done." : "",
          layerHint,
        ].filter(Boolean).join("\n")
    : review
      ? [
          "Слой: пейджер. Входящий отчёт. Ты оркестратор @main.",
          `Отправитель: @${who}`,
          magId ? `Задача MAG #${magId} проект ${process.env.MAGMASTER_PROJECT_ID || "mag-hive"}.` : "",
          "Текст отчёта:",
          String(message.body || ""),
          "Проверь: факт + источник (URL). Если хватает — complete_task через MAG Gateway CLI и коротко подтверди в пейджере.",
          "Длинное — РОК_СЛОЙ chat. Не дублируй @хэндл.",
          layerHint,
        ].filter(Boolean).join("\n")
      : [
          "Слой: пейджер. Рабочая постановка.",
          to ? `Отправитель: @${to}` : "Отправитель: оператор роя",
          magId ? `Задача MAG #${magId} (${process.env.MAGMASTER_PROJECT_ID || "mag-hive"}).` : "",
          "Текст постановки:",
          String(message.body || ""),
          "Сделай работу. В пейджер — короткий итог. Подробности — РОК_СЛОЙ chat. Файл — РОК_СЛОЙ full.",
          "Не дублируй @хэндл.",
          layerHint,
        ].filter(Boolean).join("\n");

  if (!wakeOpenclaw) {
    await hiveSend({
      as: self,
      to,
      kind: "blocked",
      body: radioBody(who, "рация жива, модель выключена (HIVE_WAKE_OPENCLAW)."),
    });
    return;
  }
  if (Date.now() < wakingUntil) {
    await hiveSend({
      as: self,
      to,
      kind: "progress",
      body: radioBody(who, "уже думаю над другим пейджем, подождите."),
    });
    return;
  }

  wakingUntil = Date.now() + (timeoutSec + 20) * 1000;
  const workStarted = Date.now();
  let statusCardId;
  try {
    const statusCard = await hiveSend({
      as: self,
      to,
      kind: "progress",
      workTimer: !radio,
      body: radioBody(
        who,
        review ? `читаю отчёт${task}…` : radio ? "думаю…" : inLane !== "pager" || meet || qaq || talkPager ? "отвечаю…" : `взял${task}: работаю сам, в пейджер вернусь с итогом.`,
      ),
    });
    statusCardId = statusCard?.id;
    await setPresence("busy", magId, self);
    console.log(JSON.stringify({ type: "hive_ack", to: who, task: task || null, wake: true, talkMode, lane: inLane, mode: radio ? "radio" : review ? "review" : inLane !== "pager" || meet || qaq ? "talk" : "work", card: statusCardId || null }));

    const result = await runOpenClawAgent(prompt, timeoutSec, self);
    const elapsed = Date.now() - workStarted;
    if (result.halted) {
      if (statusCardId && !radio) {
        await hivePatch(statusCardId, {
          workElapsedMs: elapsed,
          body: radioBody(who, `остановлено человеком${task}.`).slice(0, 280),
        }).catch(() => undefined);
      }
      await setPresence("free", undefined, self);
      console.log(JSON.stringify({ type: "hive_halted_run", to: who }));
      return;
    }
    if (statusCardId && !radio) {
      const base = radioBody(
        who,
        review ? `читал отчёт${task}.` : inLane !== "pager" || meet || qaq || talkPager ? "ответил." : `взял${task}: работал сам.`,
      );
      await hivePatch(statusCardId, {
        workElapsedMs: elapsed,
        body: `${base} Занятость ${Math.round(elapsed / 1000)}с.`.slice(0, 280),
      }).catch(() => undefined);
    }

    if (result.ok) {
      const parsed = parseOutLane(String(result.text || ""), inLane);
      const replyLane = parsed.lane;
      const fact = parsed.fact;
      const replyKind = replyKindFor(replyLane, { radio, magWork, qaq });
      if (replyLane !== inLane && inLane === "pager") {
        await hiveSend({
          as: self,
          to,
          kind: qaq ? "page" : "done",
          lane: "pager",
          body: radioBody(who, replyLane === "chat" ? "дальше в чат." : "дальше в полный.", 280),
        });
      }
      await hiveSend({
        as: self,
        to,
        kind: replyKind,
        lane: replyLane,
        body: radioBody(who, magId && replyLane === "pager" ? `MAG #${magId}: ${fact}` : fact, laneMax(replyLane)),
      });
      if ((magWork || message.kind === "task_assigned") && replyLane !== "chat") {
        await hiveSend({
          as: self,
          to,
          kind: "chat",
          lane: "chat",
          body: radioBody(who, magId ? `MAG #${magId}: ${fact}` : fact, laneMax("chat")),
        });
      }
      await setPresence("free", undefined, self);
      console.log(JSON.stringify({ type: "hive_done", to: who, chars: result.text.length, lane: replyLane }));
      rememberFact(fact);
    } else {
      const reason = String(result.error || "ошибка").replace(/\s+/g, " ").slice(0, 140);
      await hiveSend({
        as: self,
        to,
        kind: "blocked",
        body: radioBody(who, `не ответил: ${reason}`),
      });
      await setPresence("free", undefined, self);
      console.error(JSON.stringify({ type: "hive_wake_fail", error: reason, logFile: result.logFile }));
    }
  } catch (error) {
    console.error("[hive-node] ack", error.message || error);
    try {
      await hiveSend({
        as: self,
        to,
        kind: "blocked",
        body: `@${who} сбой рации: ${String(error.message || error).slice(0, 120)}`,
      });
      await setPresence("free", undefined, self);
    } catch {
      /* ignore */
    }
  } finally {
    wakingUntil = 0;
  }
}

function printMessage(message) {
  since = Math.max(since, message.createdAt || 0);
  console.log(
    JSON.stringify({
      type: "hive_inbox",
      id: message.id,
      fromId: message.fromId,
      lane: message.lane || "pager",
      kind: message.kind,
      body: message.body,
      task: message.taskRef || null,
      attachments: (message.attachments || []).map((item) => item.name),
    }),
  );
  void ackPager(message);
}

async function drainInbox() {
  await json("/api/hive/agents", { method: "PATCH", body: JSON.stringify({ heartbeat: true, subagents: subagentPayload() }) });
  const inbox = await json(`/api/hive/inbox?after=${since}`);
  const messages = inbox.messages || [];
  if (catchUp) {
    for (const message of messages) since = Math.max(since, message.createdAt || 0);
    catchUp = false;
    const last = [...messages].reverse().find((message) => {
      const kind = message.kind || "page";
      return kind === "task_assigned" || kind === "page" || kind === "chat" || kind === "artifact" || kind === "secret";
    });
    const age = last ? Date.now() - (last.createdAt || 0) : 1e12;
    if (last && age < 180_000) printMessage(last);
    return;
  }
  for (const message of messages) printMessage(message);
}

function guessOverlayIp() {
  if (process.env.HIVE_OVERLAY_IP) return process.env.HIVE_OVERLAY_IP.trim();
  const nets = networkInterfaces();
  for (const addrs of Object.values(nets)) {
    for (const addr of addrs || []) {
      const family = addr.family === "IPv4" || addr.family === 4;
      if (!family || addr.internal) continue;
      if (addr.address.startsWith("10.42.0.") || /^10\.\d+\.\d+\.\d+$/.test(addr.address)) return addr.address;
    }
  }
  return "";
}

function listenWake() {
  const hosts = ["127.0.0.1"];
  const overlayIp = guessOverlayIp();
  if (overlayIp) hosts.push(overlayIp);
  const handler = (request, response) => {
    if (request.method !== "POST" || request.url !== "/hive/wake") {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const event = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (event.type === "halt" || event.haltUntil) applyHalt(event.haltUntil);
        else if (event.type === "talk" || event.talkMode) applyTalkMode(event.talkMode);
        else if (event.message) printMessage(event.message);
        else if (event.body) printMessage(event);
      } catch {
        /* ignore */
      }
      void drainInbox().catch(() => undefined);
      response.writeHead(204);
      response.end();
    });
  };
  for (const host of hosts) {
    createServer(handler).listen(wakePort, host, () => {
      console.log(`[hive-node] wake ${host}:${wakePort}/hive/wake`);
    });
  }
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
      const lines = chunk.split("\n");
      const eventName = (lines.find((line) => line.startsWith("event:")) || "event: message").slice(6).trim();
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const event = JSON.parse(dataLine.slice(5).trim());
        if (eventName === "halt" || event.type === "halt") applyHalt(event.haltUntil);
        else if (eventName === "talk" || event.type === "talk") applyTalkMode(event.talkMode);
        else if (eventName === "hello") {
          if (event.haltUntil) applyHalt(event.haltUntil);
          if (event.talkMode) applyTalkMode(event.talkMode);
        } else if (eventName === "ping" || event.type === "ping") {
          void json("/api/hive/agents", { method: "PATCH", body: JSON.stringify({ heartbeat: true, subagents: subagentPayload() }) }).catch(() => undefined);
        } else if (event.message) printMessage(event.message);
      } catch {
        /* ignore */
      }
    }
  }
}

async function loop() {
  console.log(`[hive-node] ${hub} autoAck=${autoAck}`);
  await refreshRoster().catch((error) => console.error("[hive-node] roster", error.message || error));
  await setPresence("free", undefined).catch(() => undefined);
  listenWake();
  await drainInbox().catch((error) => console.error("[hive-node]", error.message || error));
  const stop = () => {
    wakingUntil = 0;
    if (currentChild) {
      try {
        currentChild.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    void setPresence("free", undefined).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
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
