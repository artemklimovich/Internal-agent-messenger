import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  hashAgentKey,
  hashPassword,
  newAgentKey,
  rateLimit,
  safeEqualHex,
  stripFederationBody,
  verifyPassword,
} from "./crypto-security";
import { nid } from "./id";
import { createEmptyWorld, handleFromEmail, provisionOwnedSwarm } from "./seed";
import type {
  AgentKey,
  EtherAgent,
  HiveEvent,
  Member,
  Message,
  SendMessageInput,
  SessionUser,
  Tunnel,
  User,
  World,
} from "./types";
import {
  FED_PAGE_MAX,
  FED_PAGE_TTL_MS,
  SCHEMA_VERSION,
  SWARM_KEEP,
  SWARM_PAGE_MAX,
  SWARM_PAGE_TTL_MS,
} from "./types";

const DATA_PATH = join(process.cwd(), ".data", "hive.json");

function clone<T>(value: T): T {
  return structuredClone(value);
}

class HiveStore extends EventEmitter {
  private world: World;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.setMaxListeners(200);
    this.world = this.load();
  }

  private load(): World {
    try {
      const parsed = JSON.parse(readFileSync(DATA_PATH, "utf8")) as World;
      if (parsed.schemaVersion !== SCHEMA_VERSION || !parsed.users) {
        return createEmptyWorld();
      }
      return parsed;
    } catch {
      return createEmptyWorld();
    }
  }

  private persist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        mkdirSync(dirname(DATA_PATH), { recursive: true });
        writeFileSync(DATA_PATH, JSON.stringify(this.world, null, 2));
      } catch (error) {
        console.error("hive persist failed", error);
      }
    }, 250);
  }

  private emitState(swarmId?: string) {
    this.emit("event", { type: "state", at: Date.now(), swarmId } satisfies HiveEvent);
    this.persist();
  }

  userById(id: string) {
    return this.world.users.find((user) => user.id === id);
  }

  swarmByOwner(userId: string) {
    return this.world.swarms.find((swarm) => swarm.ownerUserId === userId);
  }

  memberById(id: string) {
    return this.world.members.find((member) => member.id === id);
  }

  register(input: { email: string; password: string; name: string }): SessionUser {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Некорректный email");
    }
    if (input.password.length < 8) {
      throw new Error("Пароль от 8 символов");
    }
    if (this.world.users.some((user) => user.email === email)) {
      throw new Error("Такой email уже есть");
    }
    const humans = this.world.users.filter((user) => user.role !== "system").length;
    const user: User = {
      id: nid("user-"),
      email,
      passwordHash: hashPassword(input.password),
      name: input.name.trim() || handleFromEmail(email),
      role: humans === 0 ? "admin" : "user",
      createdAt: Date.now(),
    };
    const provisioned = provisionOwnedSwarm(user);
    this.world.users.push(user);
    this.world.swarms.push(provisioned.swarm);
    this.world.members.push(...provisioned.members);
    this.world.rooms.push(...provisioned.rooms);
    this.world.tunnels.push(...provisioned.tunnels);
    this.emitState(provisioned.swarm.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      swarmId: provisioned.swarm.id,
      swarmName: provisioned.swarm.name,
    };
  }

  login(email: string, password: string): SessionUser {
    const key = email.trim().toLowerCase();
    const guard = this.world.loginGuard[key] ?? { fails: 0 };
    if (guard.lockedUntil && guard.lockedUntil > Date.now()) {
      throw new Error("Слишком много попыток. Подождите 15 минут.");
    }
    const user = this.world.users.find((item) => item.email === key);
    if (!user || user.disabled || user.role === "system" || !verifyPassword(password, user.passwordHash)) {
      guard.fails += 1;
      if (guard.fails >= 8) guard.lockedUntil = Date.now() + 15 * 60_000;
      this.world.loginGuard[key] = guard;
      this.persist();
      throw new Error("Неверный email или пароль");
    }
    this.world.loginGuard[key] = { fails: 0 };
    const swarm = this.swarmByOwner(user.id);
    if (!swarm) throw new Error("У пользователя нет роя");
    this.persist();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      swarmId: swarm.id,
      swarmName: swarm.name,
    };
  }

  viewer(userId: string) {
    this.purgeExpired();
    const user = this.userById(userId);
    const swarm = this.swarmByOwner(userId);
    if (!user || !swarm) throw new Error("unauthorized");
    const members = this.world.members.filter((member) => member.swarmId === swarm.id);
    const rooms = this.world.rooms.filter((room) => room.swarmId === swarm.id);
    const messages = this.world.messages.filter(
      (message) =>
        message.expiresAt > Date.now() &&
        (message.swarmId === swarm.id ||
          (message.scope === "federation" &&
            (message.fromSwarmId === swarm.id || message.toSwarmId === swarm.id))),
    );
    const tunnels = this.world.tunnels.filter((tunnel) => tunnel.swarmId === swarm.id);
    return {
      me: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        swarmId: swarm.id,
        swarmName: swarm.name,
      },
      swarm,
      members,
      rooms,
      messages,
      tunnels,
      ether: this.ether(swarm.id),
      pager: {
        mode: "pager" as const,
        swarmTtlHours: 24,
        etherTtlHours: 2,
        swarmMax: SWARM_PAGE_MAX,
        etherMax: FED_PAGE_MAX,
      },
    };
  }

  viewerForSwarm(swarmId: string) {
    const swarm = this.world.swarms.find((item) => item.id === swarmId);
    if (!swarm) throw new Error("unknown swarm");
    return this.viewer(swarm.ownerUserId);
  }

  ether(mySwarmId: string): EtherAgent[] {
    return this.world.members
      .filter(
        (member) =>
          member.kind === "agent" &&
          member.discoverable &&
          member.swarmId !== mySwarmId,
      )
      .map((member) => {
        const swarm = this.world.swarms.find((item) => item.id === member.swarmId);
        const owner = swarm ? this.userById(swarm.ownerUserId) : undefined;
        return {
          id: member.id,
          handle: member.handle,
          name: member.name,
          os: member.os,
          presence: member.presence,
          region: member.region,
          swarmName: swarm?.name ?? "чужой рой",
          ownerName: owner?.role === "system" ? "чужая команда" : (owner?.name ?? "неизвестно"),
          lastSeenAt: member.lastSeenAt,
        };
      });
  }

  send(input: SendMessageInput): Message {
    const from = this.memberById(input.fromId);
    if (!from) throw new Error("unknown sender");
    const scope = input.scope ?? "swarm";
    const to = input.toId ? this.memberById(input.toId) : undefined;
    if (scope === "federation") {
      if (!to || to.swarmId === from.swarmId) {
        throw new Error("Эфир только к чужому агенту");
      }
      if (!to.discoverable) throw new Error("Агент скрыт из эфира");
    } else if (to && to.swarmId !== from.swarmId) {
      throw new Error("В свой пейджер нельзя писать чужому рою");
    }

    const max = scope === "federation" ? FED_PAGE_MAX : SWARM_PAGE_MAX;
    const raw = input.body.trim().slice(0, max);
    const body = scope === "federation" ? stripFederationBody(raw, max) : raw;
    if (!body) throw new Error("Пустой пейдж");

    const kind = input.kind ?? inferKind(body, scope);
    const ttl = scope === "federation" ? FED_PAGE_TTL_MS : SWARM_PAGE_TTL_MS;
    const message: Message = {
      id: nid("msg-"),
      roomId: input.roomId,
      swarmId: from.swarmId,
      fromId: from.id,
      toId: to?.id,
      fromSwarmId: from.swarmId,
      toSwarmId: to?.swarmId ?? from.swarmId,
      scope,
      kind,
      body,
      taskRef: scope === "swarm" ? input.taskRef ?? parseTaskRef(body) : undefined,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
    };
    this.world.messages.push(message);
    this.trimPager(from.swarmId);
    this.applyPresence(message, from);
    from.lastSeenAt = Date.now();
    this.emit("event", {
      type: "message",
      at: message.createdAt,
      message,
      swarmId: from.swarmId,
    } satisfies HiveEvent);
    this.persist();
    return message;
  }

  sendAsUser(userId: string, input: { body: string; toId?: string; kind?: Message["kind"]; scope?: Message["scope"] }) {
    if (!rateLimit(`send:${userId}`, input.scope === "federation" ? 8 : 30, 60_000)) {
      throw new Error("Слишком часто. Пейджер не чат.");
    }
    const swarm = this.swarmByOwner(userId);
    const from = this.world.members.find((member) => member.userId === userId);
    if (!swarm || !from) throw new Error("unauthorized");
    const to = input.toId ? this.memberById(input.toId) : undefined;
    const scope = input.scope ?? (to && to.swarmId !== swarm.id ? "federation" : "swarm");
    const roomId = scope === "federation" ? "ether" : `${swarm.id}:pager`;
    return this.send({
      roomId,
      swarmId: swarm.id,
      fromId: from.id,
      toId: input.toId,
      kind: input.kind,
      body: input.body,
      scope,
    });
  }

  playScene(userId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const orchestrator = this.world.members.find(
      (member) => member.swarmId === swarm.id && member.handle === "orchestrator",
    );
    const linux = this.world.members.find(
      (member) => member.swarmId === swarm.id && member.handle === "linux",
    );
    if (!orchestrator || !linux) throw new Error("в рое нет демо-агентов");
    const id = String(240 + Math.floor(Math.random() * 50));
    this.send({
      roomId: `${swarm.id}:pager`,
      swarmId: swarm.id,
      fromId: orchestrator.id,
      toId: linux.id,
      kind: "task_assigned",
      body: `@linux поставил задачу #${id} «Проверить health MAG Master MCP». Жду исполнения.`,
      taskRef: {
        magTaskId: id,
        title: "Проверить health MAG Master MCP",
        status: "todo",
      },
      scope: "swarm",
    });
    this.setPresence(orchestrator.id, "busy", id);
    return { taskId: id };
  }

  setPresence(memberId: string, presence: Member["presence"], currentTaskId?: string) {
    const member = this.memberById(memberId);
    if (!member) throw new Error("unknown member");
    member.presence = presence;
    member.lastSeenAt = Date.now();
    if (presence === "free") member.currentTaskId = undefined;
    else if (currentTaskId) member.currentTaskId = currentTaskId;
    this.emit("event", {
      type: "presence",
      at: Date.now(),
      member: clone(member),
      swarmId: member.swarmId,
    } satisfies HiveEvent);
    this.persist();
    return clone(member);
  }

  heartbeat(memberId: string) {
    const member = this.memberById(memberId);
    if (!member) throw new Error("unknown member");
    member.lastSeenAt = Date.now();
    if (member.presence === "offline") member.presence = "free";
    this.persist();
    return clone(member);
  }

  rotateAgentKey(userId: string, agentId: string) {
    const swarm = this.swarmByOwner(userId);
    const agent = this.memberById(agentId);
    if (!swarm || !agent || agent.swarmId !== swarm.id || agent.kind !== "agent") {
      throw new Error("forbidden");
    }
    const plaintext = newAgentKey();
    const record: AgentKey = { agentId, keyHash: hashAgentKey(plaintext) };
    this.world.agentKeys = this.world.agentKeys.filter((item) => item.agentId !== agentId);
    this.world.agentKeys.push(record);
    this.persist();
    return { agentId, handle: agent.handle, key: plaintext };
  }

  agentByKey(plaintext: string) {
    const digest = hashAgentKey(plaintext);
    const record = this.world.agentKeys.find((item) => safeEqualHex(item.keyHash, digest));
    if (!record) return null;
    return this.memberById(record.agentId) ?? null;
  }

  setDiscoverable(userId: string, agentId: string, discoverable: boolean) {
    const swarm = this.swarmByOwner(userId);
    const agent = this.memberById(agentId);
    if (!swarm || !agent || agent.swarmId !== swarm.id || agent.kind !== "agent") {
      throw new Error("forbidden");
    }
    agent.discoverable = discoverable;
    this.emitState(swarm.id);
    return clone(agent);
  }

  inbox(agentId: string, after?: number) {
    this.purgeExpired();
    const agent = this.memberById(agentId);
    if (!agent) throw new Error("unknown agent");
    return this.world.messages.filter((message) => {
      if (message.expiresAt <= Date.now()) return false;
      if (after && message.createdAt <= after) return false;
      if (message.fromId === agentId) return false;
      if (message.toId === agentId) return true;
      return (
        message.scope === "swarm" &&
        message.swarmId === agent.swarmId &&
        message.body.includes(`@${agent.handle}`)
      );
    });
  }

  adminOverview(userId: string) {
    const user = this.userById(userId);
    if (user?.role !== "admin") throw new Error("forbidden");
    return {
      users: this.world.users
        .filter((item) => item.role !== "system")
        .map((item) => ({
          id: item.id,
          email: item.email,
          name: item.name,
          role: item.role,
          disabled: Boolean(item.disabled),
          swarm: this.swarmByOwner(item.id)?.name,
          createdAt: item.createdAt,
        })),
      swarms: this.world.swarms.map((swarm) => ({
        id: swarm.id,
        name: swarm.name,
        owner: this.userById(swarm.ownerUserId)?.email,
        agents: this.world.members.filter((member) => member.swarmId === swarm.id && member.kind === "agent").length,
      })),
    };
  }

  disableUser(adminId: string, targetId: string, disabled: boolean) {
    const admin = this.userById(adminId);
    if (admin?.role !== "admin") throw new Error("forbidden");
    if (adminId === targetId) throw new Error("нельзя отключить себя");
    const target = this.userById(targetId);
    if (!target || target.role === "system") throw new Error("not found");
    target.disabled = disabled;
    this.persist();
    return { id: target.id, disabled: target.disabled };
  }

  snapshotMembers() {
    return this.world.members;
  }

  exportKnowledgeBase(swarmId: string) {
    const swarm = this.world.swarms.find((item) => item.id === swarmId);
    const members = this.world.members.filter((member) => member.swarmId === swarmId);
    const tunnels = this.world.tunnels.filter((tunnel) => tunnel.swarmId === swarmId);
    const lines = [
      `# Реестр своего роя MAG Hive`,
      ``,
      `Рой: **${swarm?.name ?? swarmId}**`,
      `Туннели только для своих машин. В эфир чужих роёв этот документ не отдаём.`,
      ``,
      `| Хэндл | Роль | Overlay | Туннель |`,
      `| --- | --- | --- | --- |`,
    ];
    for (const member of members) {
      if (member.kind !== "agent") continue;
      const tunnel = tunnels.find((item) => item.agentId === member.id);
      lines.push(
        `| @${member.handle} | ${member.role} | ${tunnel?.overlayIp ?? "—"} | ${tunnel?.kind ?? "none"} |`,
      );
    }
    return lines.join("\n");
  }

  private applyPresence(message: Message, from: Member) {
    if (from.kind !== "agent" || message.scope !== "swarm") return;
    if (message.kind === "progress" || message.kind === "task_assigned") {
      from.presence = "busy";
      from.currentTaskId = message.taskRef?.magTaskId ?? from.currentTaskId;
    }
    if (message.kind === "blocked") from.presence = "blocked";
    if (message.kind === "done" || message.kind === "free") {
      from.presence = "free";
      from.currentTaskId = undefined;
    }
  }

  private trimPager(swarmId: string) {
    const kept: Message[] = [];
    const swarmMsgs = this.world.messages.filter((message) => message.swarmId === swarmId && message.scope === "swarm");
    const extra = swarmMsgs.sort((a, b) => b.createdAt - a.createdAt).slice(SWARM_KEEP);
    const drop = new Set(extra.map((message) => message.id));
    for (const message of this.world.messages) {
      if (!drop.has(message.id)) kept.push(message);
    }
    this.world.messages = kept;
  }

  private purgeExpired() {
    const now = Date.now();
    const before = this.world.messages.length;
    this.world.messages = this.world.messages.filter((message) => message.expiresAt > now);
    if (this.world.messages.length !== before) this.persist();
  }

  upsertTunnel(tunnel: Tunnel) {
    const index = this.world.tunnels.findIndex((item) => item.id === tunnel.id);
    if (index >= 0) this.world.tunnels[index] = tunnel;
    else this.world.tunnels.push(tunnel);
    this.emit("event", { type: "tunnel", at: Date.now(), tunnel, swarmId: tunnel.swarmId } satisfies HiveEvent);
    this.persist();
    return clone(tunnel);
  }
}

function inferKind(body: string, scope: Message["scope"]): Message["kind"] {
  if (scope === "federation") return "page";
  const text = body.toLowerCase();
  if (text.includes("поставил задачу") || text.includes("жду исполнения")) return "task_assigned";
  if (text.includes("проблем") || text.includes("блок")) return "blocked";
  if (text.includes("закрыл") && text.includes("свобод")) return "done";
  if (text.includes("свобод")) return "free";
  if (text.includes("взял") || text.includes("в работе")) return "progress";
  return "page";
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
