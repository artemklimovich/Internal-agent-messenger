import { getStore } from "./store";
import type { Message } from "./types";

const DELAYS = { ack: 800, work: 1800, finish: 3600 };

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
    void react(event.message).catch((error) => {
      console.error("hive runtime", error instanceof Error ? error.message : error);
    });
  });
  setInterval(() => {
    for (const member of store.snapshotMembers()) {
      if (member.simulated) store.heartbeat(member.id);
    }
  }, 12_000);
}

async function react(message: Message) {
  const store = getStore();
  const target = store.memberById(message.toId ?? "");
  if (!target?.simulated) return;
  if (message.fromId === target.id) return;

  if (message.scope === "federation") {
    await later(DELAYS.ack);
    store.send({
      roomId: "ether",
      swarmId: target.swarmId,
      fromId: target.id,
      toId: message.fromId,
      kind: "page",
      lane: "pager",
      body: `Принял пейдж. Я @${target.handle} из чужого роя — только пейджер, без чата, файлов и туннеля.`,
      scope: "federation",
    });
    return;
  }

  const lane = message.lane ?? "pager";
  if (lane === "chat") {
    await later(DELAYS.ack);
    store.send({
      roomId: message.roomId,
      swarmId: target.swarmId,
      fromId: target.id,
      toId: message.fromId,
      kind: "chat",
      lane: "chat",
      body: `Прочитал чат. Текст/скилл принял. Это не постановка задачи — MAG Master не трогаю.`,
      scope: "swarm",
    });
    return;
  }
  if (lane === "full") {
    await later(DELAYS.ack);
    const names = message.attachments?.map((item) => item.name).join(", ") || "конверт";
    store.send({
      roomId: message.roomId,
      swarmId: target.swarmId,
      fromId: target.id,
      toId: message.fromId,
      kind: "chat",
      lane: "chat",
      body: `Принял полный канал (${names}). Чужому эфиру это не отдам.`,
      scope: "swarm",
    });
    return;
  }

  if (message.kind !== "task_assigned" && message.kind !== "page") return;
  if (message.kind === "page" && !message.body.includes(`@${target.handle}`)) return;

  const task =
    message.taskRef ??
    (message.body.match(/#(\d+)/)
      ? { magTaskId: message.body.match(/#(\d+)/)![1], title: message.body }
      : { magTaskId: "new", title: message.body });

  await later(DELAYS.ack);
  store.setPresence(target.id, "busy", task.magTaskId);
  store.send({
    roomId: message.roomId,
    swarmId: target.swarmId,
    fromId: target.id,
    toId: message.fromId,
    kind: "progress",
    body: `Взял #${task.magTaskId}. Коротко отпишусь.`,
    taskRef: task,
    scope: "swarm",
  });

  await later(DELAYS.work);
  if (target.handle === "windows") {
    store.setPresence(target.id, "blocked", task.magTaskId);
    store.send({
      roomId: message.roomId,
      swarmId: target.swarmId,
      fromId: target.id,
      toId: message.fromId,
      kind: "blocked",
      body: `Проблема по #${task.magTaskId}: SSH down, поднимаю свой WireGuard. Чужому рою overlay не отдам.`,
      taskRef: task,
      scope: "swarm",
    });
    await later(DELAYS.finish);
  } else {
    await later(DELAYS.work);
  }

  store.send({
    roomId: message.roomId,
    swarmId: target.swarmId,
    fromId: target.id,
    toId: message.fromId,
    kind: "done",
    body: `Закрыл #${task.magTaskId}. Свободен.`,
    taskRef: { ...task, status: "done" },
    scope: "swarm",
  });
  store.setPresence(target.id, "free");
  const dispatcher = store.memberById(message.fromId);
  if (dispatcher?.kind === "agent" && dispatcher.currentTaskId === task.magTaskId) {
    store.setPresence(dispatcher.id, "free");
  }
}
