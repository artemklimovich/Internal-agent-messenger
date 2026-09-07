import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nid } from "./id";
import { createSeed } from "./seed";
import type {
  HiveEvent,
  HiveState,
  Member,
  Message,
  RegisterAgentInput,
  SendMessageInput,
  Tunnel,
} from "./types";

const DATA_PATH = join(process.cwd(), ".data", "hive.json");

function clone<T>(value: T): T {
  return structuredClone(value);
}

class HiveStore extends EventEmitter {
  private state: HiveState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.setMaxListeners(200);
    this.state = this.load();
    this.touchHumans();
  }

  private load(): HiveState {
    try {
      const raw = readFileSync(DATA_PATH, "utf8");
      const parsed = JSON.parse(raw) as HiveState;
      if (!parsed?.members?.length || !parsed?.rooms?.length) {
        return createSeed();
      }
      return parsed;
    } catch {
      return createSeed();
    }
  }

  private touchHumans() {
    const t = Date.now();
    for (const member of this.state.members) {
      if (member.kind === "human") member.lastSeenAt = t;
    }
  }

  snapshot(): HiveState {
    return clone(this.state);
  }

  private emitState() {
    this.emit("event", {
      type: "state",
      at: Date.now(),
    } satisfies HiveEvent);
    this.queuePersist();
  }

  private queuePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        mkdirSync(dirname(DATA_PATH), { recursive: true });
        writeFileSync(DATA_PATH, JSON.stringify(this.state, null, 2));
      } catch (error) {
        console.error("hive persist failed", error);
      }
    }, 250);
  }

  resetDemo() {
    this.state = createSeed();
    this.emitState();
    return this.snapshot();
  }

  send(input: SendMessageInput): Message {
    const from = this.state.members.find((m) => m.id === input.fromId);
    if (!from) throw new Error(`unknown member ${input.fromId}`);
    const room = this.state.rooms.find((r) => r.id === input.roomId);
    if (!room) throw new Error(`unknown room ${input.roomId}`);

    const mentioned = this.parseMention(input.body);
    const toId = input.toId ?? mentioned?.id;
    const kind = input.kind ?? inferKind(input.body);

    const message: Message = {
      id: nid("msg-"),
      roomId: input.roomId,
      fromId: input.fromId,
      toId,
      kind,
      body: input.body.trim(),
      taskRef: input.taskRef ?? parseTaskRef(input.body),
      createdAt: Date.now(),
    };

    this.state.messages.push(message);
    this.applyPresenceFromMessage(message);
    from.lastSeenAt = Date.now();

    this.emit("event", {
      type: "message",
      at: message.createdAt,
      message,
    } satisfies HiveEvent);
    this.queuePersist();
    return message;
  }

  inbox(agentId: string, after?: number): Message[] {
    return this.state.messages.filter((message) => {
      if (after && message.createdAt <= after) return false;
      if (message.fromId === agentId) return false;
      if (message.toId === agentId) return true;
      const room = this.state.rooms.find((r) => r.id === message.roomId);
      if (room?.type === "swarm" && room.memberIds.includes(agentId)) {
        return (
          message.kind === "task_assigned" ||
          message.body.includes(`@${this.handleOf(agentId)}`)
        );
      }
      return false;
    });
  }

  setPresence(memberId: string, presence: Member["presence"], currentTaskId?: string) {
    const member = this.state.members.find((m) => m.id === memberId);
    if (!member) throw new Error(`unknown member ${memberId}`);
    member.presence = presence;
    member.lastSeenAt = Date.now();
    if (currentTaskId !== undefined) {
      member.currentTaskId = currentTaskId || undefined;
    }
    if (presence === "free") member.currentTaskId = undefined;
    this.emit("event", {
      type: "presence",
      at: Date.now(),
      member: clone(member),
    } satisfies HiveEvent);
    this.queuePersist();
    return clone(member);
  }

  heartbeat(memberId: string) {
    const member = this.state.members.find((m) => m.id === memberId);
    if (!member) throw new Error(`unknown member ${memberId}`);
    member.lastSeenAt = Date.now();
    if (member.presence === "offline") member.presence = "free";
    this.queuePersist();
    return clone(member);
  }

  registerAgent(input: RegisterAgentInput): Member {
    const handle = input.handle.replace(/^@/, "").toLowerCase();
    const existing = this.state.members.find(
      (m) => m.handle === handle || (input.id && m.id === input.id),
    );
    if (existing) {
      existing.name = input.name || existing.name;
      existing.os = input.os ?? existing.os;
      existing.machine = input.machine ?? existing.machine;
      existing.role = input.role ?? existing.role;
      existing.capabilities = input.capabilities ?? existing.capabilities;
      existing.lastSeenAt = Date.now();
      existing.presence = existing.presence === "offline" ? "free" : existing.presence;
      this.ensureSwarmMembership(existing.id);
      this.emitState();
      return clone(existing);
    }

    const member: Member = {
      id: input.id ?? nid("agent-"),
      kind: "agent",
      name: input.name,
      handle,
      role: input.role ?? "Исполнитель OpenClaw",
      os: input.os,
      presence: "free",
      lastSeenAt: Date.now(),
      machine: input.machine,
      capabilities: input.capabilities ?? ["hive"],
      magProjectId: input.magProjectId,
    };
    this.state.members.push(member);
    this.ensureSwarmMembership(member.id);
    this.emitState();
    return clone(member);
  }

  upsertTunnel(tunnel: Tunnel): Tunnel {
    const index = this.state.tunnels.findIndex(
      (item) => item.id === tunnel.id || item.agentId === tunnel.agentId,
    );
    if (index >= 0) this.state.tunnels[index] = tunnel;
    else this.state.tunnels.push(tunnel);
    this.emit("event", {
      type: "tunnel",
      at: Date.now(),
      tunnel,
    } satisfies HiveEvent);
    this.queuePersist();
    return clone(tunnel);
  }

  markOfflineStale(maxIdleMs = 45_000) {
    const t = Date.now();
    let changed = false;
    for (const member of this.state.members) {
      if (member.kind !== "agent") continue;
      if (t - member.lastSeenAt > maxIdleMs && member.presence !== "offline") {
        member.presence = "offline";
        changed = true;
      }
    }
    if (changed) this.emitState();
  }

  exportKnowledgeBase(): string {
    const { space, members, tunnels } = this.state;
    const lines = [
      `# Реестр роя MAG Hive`,
      ``,
      `Пространство: **${space.name}**`,
      `Проект MAG Master: \`${space.magProjectId}\``,
      `Компания: ${space.magCompany}`,
      `API: ${space.magApi}`,
      ``,
      `Это документ для базы знаний MAG Master. Агенты читают его, чтобы понимать, кто где живёт и каким туннелем достучаться.`,
      ``,
      `## Агенты`,
      ``,
      `| Хэндл | Роль | ОС | Машина | Статус | Overlay IP | Туннель |`,
      `| --- | --- | --- | --- | --- | --- | --- |`,
    ];
    for (const member of members) {
      const tunnel = tunnels.find((item) => item.agentId === member.id);
      lines.push(
        `| @${member.handle} | ${member.role} | ${member.os ?? "—"} | ${member.machine ?? "—"} | ${member.presence} | ${tunnel?.overlayIp ?? "—"} | ${tunnel?.kind ?? "none"} |`,
      );
    }
    lines.push("", "## Туннели", "");
    for (const tunnel of tunnels) {
      const member = members.find((item) => item.id === tunnel.agentId);
      lines.push(`### @${member?.handle ?? tunnel.agentId} · ${tunnel.overlayIp}`);
      lines.push("");
      lines.push(`- Тип: **${tunnel.kind}** (${tunnel.status})`);
      if (tunnel.ssh) {
        lines.push(
          `- SSH: \`${tunnel.ssh.user}@${tunnel.ssh.host}\` reverse :${tunnel.ssh.reversePort} → Gateway ${tunnel.ssh.gatewayPort} (${tunnel.ssh.status})`,
        );
      }
      if (tunnel.wireguard) {
        lines.push(
          `- WireGuard: pubkey \`${tunnel.wireguard.publicKey}\`${tunnel.wireguard.fallback ? " · fallback" : ""}`,
        );
        if (tunnel.wireguard.endpoint) {
          lines.push(`- Endpoint: \`${tunnel.wireguard.endpoint}\``);
        }
      }
      lines.push(`- Заметки: ${tunnel.notes}`);
      lines.push("");
    }
    lines.push("## Правило маршрута");
    lines.push("");
    lines.push("1. Сигналы и статусы — только через MAG Hive.");
    lines.push("2. Правда о задачах — только MAG Master (MCP / External Gateway).");
    lines.push("3. Свой SSH-туннель, если жив. Если SSH мёртв — WireGuard overlay.");
    lines.push("4. Не будить агента кроном, если можно написать ему `task_assigned`.");
    return lines.join("\n");
  }

  private ensureSwarmMembership(memberId: string) {
    const swarm = this.state.rooms.find((room) => room.id === "swarm");
    if (swarm && !swarm.memberIds.includes(memberId)) {
      swarm.memberIds.push(memberId);
    }
  }

  private handleOf(id: string) {
    return this.state.members.find((m) => m.id === id)?.handle ?? id;
  }

  private parseMention(body: string): Member | undefined {
    const match = body.match(/@([a-z0-9_-]+)/i);
    if (!match) return undefined;
    return this.state.members.find(
      (m) => m.handle.toLowerCase() === match[1].toLowerCase(),
    );
  }

  private applyPresenceFromMessage(message: Message) {
    const from = this.state.members.find((m) => m.id === message.fromId);
    if (!from || from.kind !== "agent") return;
    if (message.kind === "progress" || message.kind === "task_assigned") {
      from.presence = "busy";
      from.currentTaskId = message.taskRef?.magTaskId ?? from.currentTaskId;
    }
    if (message.kind === "blocked") {
      from.presence = "blocked";
      from.currentTaskId = message.taskRef?.magTaskId ?? from.currentTaskId;
    }
    if (message.kind === "done" || message.kind === "free") {
      from.presence = "free";
      from.currentTaskId = undefined;
    }
  }
}

function inferKind(body: string): Message["kind"] {
  const text = body.toLowerCase();
  if (text.includes("поставил задачу") || text.includes("жду исполнения")) {
    return "task_assigned";
  }
  if (text.includes("проблем") || text.includes("блок")) return "blocked";
  if (text.includes("закрыл") && (text.includes("свобод") || text.includes("готов"))) {
    return "done";
  }
  if (text.includes("свобод")) return "free";
  if (text.includes("взял") || text.includes("в работе") || text.includes("делаю")) {
    return "progress";
  }
  return "chat";
}

function parseTaskRef(body: string): Message["taskRef"] | undefined {
  const match = body.match(/#(\d+)/);
  if (!match) return undefined;
  return { magTaskId: match[1], title: body.slice(0, 140) };
}

const globalForHive = globalThis as unknown as { __hiveStore?: HiveStore };

export function getStore(): HiveStore {
  if (!globalForHive.__hiveStore) {
    globalForHive.__hiveStore = new HiveStore();
  }
  return globalForHive.__hiveStore;
}
