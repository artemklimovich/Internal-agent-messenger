import { getStore } from "./store";
import type { Message } from "./types";

const DELAYS = {
  ack: 900,
  work: 2200,
  finish: 4200,
};

function later(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startSwarmRuntime() {
  const globalRef = globalThis as unknown as { __hiveSwarm?: boolean };
  if (globalRef.__hiveSwarm) return;
  globalRef.__hiveSwarm = true;

  const store = getStore();
  store.on("event", (event: { type: string; message?: Message }) => {
    if (event.type !== "message" || !event.message) return;
    void react(event.message);
  });
  setInterval(() => {
    const snap = store.snapshot();
    for (const member of snap.members) {
      if (member.simulated) store.heartbeat(member.id);
    }
  }, 12_000);
}

async function react(message: Message) {
  const store = getStore();
  const state = store.snapshot();
  const target = state.members.find((m) => m.id === message.toId);
  if (!target?.simulated) return;
  if (message.fromId === target.id) return;
  if (message.kind !== "task_assigned" && message.kind !== "chat") return;
  if (message.kind === "chat" && !message.body.includes(`@${target.handle}`)) return;

  const task =
    message.taskRef ??
    (message.body.match(/#(\d+)/)
      ? { magTaskId: message.body.match(/#(\d+)/)![1], title: message.body }
      : { magTaskId: "new", title: message.body });

  await later(DELAYS.ack);
  store.setPresence(target.id, "busy", task.magTaskId);
  store.send({
    roomId: message.roomId,
    fromId: target.id,
    toId: message.fromId,
    kind: "progress",
    body: `Взял #${task.magTaskId}. ${task.title}. Коротко отпишусь по ходу.`,
    taskRef: task,
  });

  await later(DELAYS.work);
  const blocked = task.magTaskId.endsWith("2") || /windows|wg|wireguard/i.test(task.title);
  if (blocked && target.id === "agent-windows") {
    store.setPresence(target.id, "blocked", task.magTaskId);
    store.send({
      roomId: message.roomId,
      fromId: target.id,
      toId: message.fromId,
      kind: "blocked",
      body: `Проблема по #${task.magTaskId}: исходящий SSH режется корп. фаерволом. Поднимаю WireGuard fallback и продолжаю через overlay 10.42.0.3.`,
      taskRef: task,
    });
    await later(DELAYS.finish);
  } else {
    await later(DELAYS.work);
  }

  store.send({
    roomId: message.roomId,
    fromId: target.id,
    toId: message.fromId,
    kind: "done",
    body: `Закрыл #${task.magTaskId}. Короткий отчёт в MAG Master. Свободен для новой работы.`,
    taskRef: { ...task, status: "done" },
  });
  store.setPresence(target.id, "free");
  const snap = store.snapshot();
  const dispatcher = snap.members.find((member) => member.id === message.fromId);
  if (dispatcher?.kind === "agent" && dispatcher.currentTaskId === task.magTaskId) {
    store.setPresence(dispatcher.id, "free");
  }
}

export async function playHandoffDemo() {
  const store = getStore();
  const id = String(240 + Math.floor(Math.random() * 50));
  store.send({
    roomId: "swarm",
    fromId: "agent-orchestrator",
    toId: "agent-linux",
    kind: "task_assigned",
    body: `@linux поставил задачу #${id} «Проверить health MAG Master MCP и обновить реестр туннелей в KB». Жду исполнения.`,
    taskRef: {
      magTaskId: id,
      title: "Проверить health MAG Master MCP и обновить реестр туннелей в KB",
      status: "todo",
    },
  });
  store.setPresence("agent-orchestrator", "busy", id);
  return { taskId: id };
}
