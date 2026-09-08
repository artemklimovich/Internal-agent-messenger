import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  encryptSecret,
  decryptSecret,
  hashAgentKey,
  hashPassword,
  newAgentKey,
  newPeerKey,
  rateLimit,
  safeEqualHex,
  stripFederationBody,
  verifyPassword,
} from "./crypto-security";
import { nid } from "./id";
import { readAttachment, saveAttachment, swarmCryptoKey } from "./blobs";
import { createEmptyWorld, demoOwnedAgents, demoOwnedTunnels, handleFromEmail, provisionOwnedSwarm } from "./seed";
import { hubSshHost, nextOverlayIp, nextReversePort, reverseWakeUrl } from "./tunnels";
import {
  agentWireguardConf,
  HUB_OVERLAY_IP,
  hubWireguardConf,
  loadOrCreateAgentPair,
  overlayEndpoint,
  overlayHubUrl,
} from "./overlay";
import { adoptLiveTunnels, overlayHubIp, readLiveWireguard, wgInstallHint } from "./live-wg";
import type {
  AgentKey,
  Attachment,
  EtherAgent,
  HiveEvent,
  Member,
  Message,
  MessageLane,
  OsKind,
  PeerHub,
  SealedSecret,
  SendMessageInput,
  SessionUser,
  Tunnel,
  User,
  World,
  SwarmPolicy,
} from "./types";
import {
  FED_PAGE_TTL_MS,
  SCHEMA_VERSION,
  SWARM_CHAT_KEEP,
  SWARM_CHAT_MAX,
  SWARM_CHAT_TTL_MS,
  SWARM_FULL_CAPTION_MAX,
  SWARM_FULL_TTL_MS,
  SWARM_KEEP,
  SWARM_PAGE_TTL_MS,
  resolvePolicy,
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
    this.syncLiveTunnels();
  }

  syncLiveTunnels() {
    const { changed } = adoptLiveTunnels({
      members: this.world.members,
      tunnels: this.world.tunnels,
    });
    if (changed) this.persist();
  }

  private load(): World {
    try {
      const parsed = JSON.parse(readFileSync(DATA_PATH, "utf8")) as World;
      if (parsed.schemaVersion !== SCHEMA_VERSION || !parsed.users) {
        return createEmptyWorld();
      }
      parsed.secrets ??= [];
      parsed.peerHubs ??= [];
      parsed.demoMode ??= true;
      parsed.messages = parsed.messages.map((message) => ({
        ...message,
        lane: message.lane ?? "pager",
      }));
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

  swarmById(id: string) {
    return this.world.swarms.find((swarm) => swarm.id === id);
  }

  memberById(id: string) {
    return this.world.members.find((member) => member.id === id);
  }

  registrationOpen() {
    const humans = this.world.users.filter((user) => user.role !== "system").length;
    return humans === 0 || process.env.HIVE_ALLOW_REGISTER === "1";
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
      throw new Error("не вышло");
    }
    const humans = this.world.users.filter((user) => user.role !== "system").length;
    if (humans > 0 && process.env.HIVE_ALLOW_REGISTER !== "1") {
      throw new Error("не вышло");
    }
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
      throw new Error("не вышло");
    }
    const user = this.world.users.find((item) => item.email === key);
    if (!user || user.disabled || user.role === "system" || !verifyPassword(password, user.passwordHash)) {
      guard.fails += 1;
      if (guard.fails >= 8) guard.lockedUntil = Date.now() + 15 * 60_000;
      this.world.loginGuard[key] = guard;
      this.persist();
      throw new Error("не вышло");
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

  isDemoMode() {
    return this.world.demoMode !== false;
  }

  disableDemo(userId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const fakeIds = new Set(
      this.world.members.filter((member) => member.simulated).map((member) => member.id),
    );
    this.world.demoMode = false;
    this.world.members = this.world.members.filter((member) => !member.simulated);
    this.world.tunnels = this.world.tunnels.filter((tunnel) => !fakeIds.has(tunnel.agentId));
    this.world.agentKeys = this.world.agentKeys.filter((key) => !fakeIds.has(key.agentId));
    this.world.messages = this.world.messages.filter(
      (message) => !fakeIds.has(message.fromId) && !(message.toId && fakeIds.has(message.toId)),
    );
    this.world.swarms = this.world.swarms.filter(
      (item) => item.id !== "swarm-north" || this.world.members.some((member) => member.swarmId === item.id),
    );
    this.emitState(swarm.id);
    return { ok: true as const, demoMode: false as const };
  }

  enableDemo(userId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const t = Date.now();
    this.world.demoMode = true;
    if (!this.world.users.some((user) => user.id === "user-system")) {
      const empty = createEmptyWorld();
      this.world.users.push(...empty.users.filter((user) => !this.world.users.some((row) => row.id === user.id)));
    }
    if (!this.world.swarms.some((item) => item.id === "swarm-north")) {
      const empty = createEmptyWorld();
      this.world.swarms.push(...empty.swarms);
      this.world.members.push(
        ...empty.members.filter((member) => !this.world.members.some((row) => row.id === member.id)),
      );
    }
    const agents = demoOwnedAgents(swarm.id, t);
    for (const agent of agents) {
      if (!this.world.members.some((member) => member.id === agent.id || member.handle === agent.handle)) {
        this.world.members.push(agent);
      }
    }
    const present = agents.filter((agent) => this.world.members.some((member) => member.id === agent.id));
    for (const tunnel of demoOwnedTunnels(swarm.id, present, t)) {
      if (!this.world.tunnels.some((item) => item.id === tunnel.id)) this.world.tunnels.push(tunnel);
    }
    this.emitState(swarm.id);
    return { ok: true as const, demoMode: true as const };
  }

  viewer(userId: string) {
    this.purgeExpired();
    const user = this.userById(userId);
    const swarm = this.swarmByOwner(userId);
    if (!user || !swarm) throw new Error("unauthorized");
    const demo = this.isDemoMode();
    const members = this.world.members.filter(
      (member) => member.swarmId === swarm.id && (demo || !member.simulated),
    );
    const rooms = this.world.rooms.filter((room) => room.swarmId === swarm.id);
    const memberIds = new Set(members.map((member) => member.id));
    const messages = this.world.messages.filter(
      (message) =>
        message.expiresAt > Date.now() &&
        (message.swarmId === swarm.id ||
          (message.scope === "federation" &&
            (message.fromSwarmId === swarm.id || message.toSwarmId === swarm.id))) &&
        (demo ||
          memberIds.has(message.fromId) ||
          (message.toId ? memberIds.has(message.toId) : false) ||
          message.fromId === user.id),
    );
    const tunnels = this.world.tunnels.filter(
      (tunnel) => tunnel.swarmId === swarm.id && (demo || memberIds.has(tunnel.agentId)),
    );
    for (const peer of this.world.peerHubs.filter((item) => item.ownerSwarmId === swarm.id)) {
      if (!peer.lastOkAt || Date.now() - (peer.lastOkAt ?? 0) > 45_000) void this.refreshPeer(peer.id);
    }
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
      ether: [...this.ether(swarm.id), ...this.cachedRemoteEther(swarm.id)],
      peers: this.world.peerHubs
        .filter((peer) => peer.ownerSwarmId === swarm.id)
        .map((peer) => ({
          id: peer.id,
          url: peer.url,
          name: peer.name,
          lastOkAt: peer.lastOkAt,
          lastError: peer.lastError,
        })),
      mag: {
        connected: Boolean(swarm.magConnect),
        projectId: swarm.magConnect?.projectId ?? swarm.magProjectId,
        apiUrl: swarm.magConnect?.apiUrl,
        gatewayUrl: swarm.magConnect?.gatewayUrl,
        docs: "https://magaicrm.ru/help/docs/mcp/external-agents",
      },
      demoMode: demo,
      overlayOnly: resolvePolicy(swarm).overlayOnly,
      policy: resolvePolicy(swarm),
      overlay: {
        hubIp: overlayHubIp(),
        hubUrl: overlayHubUrl(),
        net: readLiveWireguard()?.net || "10.42.0.0/24",
        listenPort: readLiveWireguard()?.listenPort || 51820,
        endpoint: overlayEndpoint(),
        iface: readLiveWireguard()?.iface,
        adopted: Boolean(readLiveWireguard()),
        peers: (readLiveWireguard()?.peers ?? []).map((peer) => ({
          ip: peer.ip,
          status: peer.status,
          handle: this.world.tunnels.find((tunnel) => tunnel.overlayIp === peer.ip)
            ? this.world.members.find(
                (member) => member.id === this.world.tunnels.find((tunnel) => tunnel.overlayIp === peer.ip)?.agentId,
              )?.handle
            : undefined,
        })),
        note: readLiveWireguard()
          ? `${wgInstallHint()} Карта с ${readLiveWireguard()?.iface} ${readLiveWireguard()?.net}. Hop через 2–3 машины — если на хабе forwarding и AllowedIPs знают адрес.`
          : resolvePolicy(swarm).overlayOnly
            ? "HTTP своего роя на overlay. UDP 51820 — вход с NAT. Входящий эфир — отдельный переключатель."
            : "Можно включить закрытый контур: рация своего роя поедет внутри WireGuard. Это настройка, не закон протокола.",
      },
      publicUrl: swarm.publicUrl ?? process.env.HIVE_PUBLIC_URL ?? "",
      a2a: {
        cardUrl: `${(swarm.publicUrl || process.env.HIVE_PUBLIC_URL || "").replace(/\/$/, "")}/.well-known/agent.json`,
        rpcUrl: `${(swarm.publicUrl || process.env.HIVE_PUBLIC_URL || "").replace(/\/$/, "")}/api/a2a`,
        note: "MCP для рук, свой Hive для своих машин, A2A когда заговорит чужой рой.",
      },
      peerInviteSet: Boolean(swarm.peerInviteHash),
      lanes: {
        pager: { max: resolvePolicy(swarm).swarmPageMax, ttlHours: 24, etherMax: resolvePolicy(swarm).etherMax, etherTtlHours: 2 },
        chat: { max: SWARM_CHAT_MAX, ttlDays: 7, ownOnly: true },
        full: { captionMax: SWARM_FULL_CAPTION_MAX, ttlDays: 30, fileMb: 32, ownOnly: true },
      },
      pager: {
        mode: "pager" as const,
        swarmTtlHours: 24,
        etherTtlHours: 2,
        swarmMax: resolvePolicy(swarm).swarmPageMax,
        etherMax: resolvePolicy(swarm).etherMax,
      },
      haltUntil: swarm.haltUntil && swarm.haltUntil > Date.now() ? swarm.haltUntil : 0,
      talkMode: swarm.talkMode === "qaq" ? "qaq" : "qa",
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
          member.swarmId !== mySwarmId &&
          (this.isDemoMode() || !member.simulated),
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
    const requestedLane: MessageLane = input.lane ?? "pager";
    const scope = input.scope ?? "swarm";
    const fromSwarm = this.world.swarms.find((item) => item.id === from.swarmId);
    const policy = resolvePolicy(fromSwarm ?? {});
    const lane: MessageLane =
      scope === "federation" && policy.etherPagerOnly ? "pager" : requestedLane;
    const to = input.toId ? this.memberById(input.toId) : undefined;
    if (scope === "federation") {
      const blockedFiles = Boolean(input.attachments?.length || input.secret) && !policy.etherAllowFiles;
      const blockedChat = policy.etherPagerOnly && requestedLane !== "pager";
      if (blockedFiles || blockedChat) {
        throw new Error(
          policy.etherPagerOnly
            ? "Политика роя: чужому агенту только пейджер. Снимите «эфир только пейджер» в кабинете."
            : "Политика роя: файлы в эфир выключены.",
        );
      }
      if (!to) throw new Error("Эфир только к чужому агенту");
      const ghostHop = Boolean(from.peerHubId || to.peerHubId);
      if (!ghostHop && to.swarmId === from.swarmId) {
        throw new Error("Эфир только к чужому агенту");
      }
      if (!to.peerHubId && to.kind === "agent" && !to.discoverable) throw new Error("Агент скрыт из эфира");
    } else if (to && to.swarmId !== from.swarmId && !to.peerHubId) {
      throw new Error("В свой канал нельзя писать чужому рою");
    }

    const max =
      scope === "federation"
        ? policy.etherMax
        : lane === "chat"
          ? SWARM_CHAT_MAX
          : lane === "full"
            ? SWARM_FULL_CAPTION_MAX
            : policy.swarmPageMax;
    const raw = (input.body ?? "").trim().slice(0, max);
    const body = scope === "federation" ? stripFederationBody(raw, max) : raw;
    const attachments = lane === "full" ? [...(input.attachments ?? [])] : [];
    if (!body && !attachments.length && !input.secret) throw new Error("Пустое сообщение");

    let secretId: string | undefined;
    if (input.secret) {
      if (lane !== "full") {
        throw new Error("Секреты только в полном канале");
      }
      if (scope !== "swarm" && !policy.etherAllowFiles) {
        throw new Error("Политика роя: секреты в эфир выключены");
      }
      secretId = this.sealSecret(from.swarmId, input.secret);
      attachments.push({
        id: secretId,
        kind: "secret",
        name: input.secret.label || "конверт",
        mime: "application/x-hive-secret",
        size: 0,
      });
    }

    const kind =
      input.kind ??
      (secretId ? "secret" : attachments.length ? "artifact" : inferKind(body, scope, lane));
    const ttl =
      scope === "federation"
        ? FED_PAGE_TTL_MS
        : lane === "chat"
          ? SWARM_CHAT_TTL_MS
          : lane === "full"
            ? SWARM_FULL_TTL_MS
            : SWARM_PAGE_TTL_MS;
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
      lane,
      body: body || (secretId ? "Запечатанный конверт" : attachments[0]?.name ?? ""),
      taskRef:
        scope === "swarm"
          ? input.taskRef ??
            ((lane === "pager" || input.kind === "task_assigned" || /MAG\s*#\d+/i.test(body))
              ? parseTaskRef(body)
              : undefined)
          : input.taskRef,
      attachments: attachments.length ? attachments : undefined,
      secretId,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      workStartedAt: input.workTimer ? Date.now() : undefined,
    };
    this.world.messages.push(message);
    this.trimLane(from.swarmId, lane);
    this.applyPresence(message, from);
    from.lastSeenAt = Date.now();
    this.emit("event", {
      type: "message",
      at: message.createdAt,
      message: { ...message, secretId: message.secretId },
      swarmId: from.swarmId,
    } satisfies HiveEvent);
    this.persist();
    this.wakeAgent(message);
    return message;
  }

  patchOwnMessage(
    memberId: string,
    messageId: string,
    patch: { body?: string; workElapsedMs?: number },
  ) {
    const from = this.memberById(memberId);
    const message = this.world.messages.find((item) => item.id === messageId);
    if (!from || !message) throw new Error("unknown message");
    const allowed = message.fromId === memberId || this.hostOf(message.fromId)?.id === memberId;
    if (!allowed) throw new Error("forbidden");
    if (typeof patch.body === "string") message.body = patch.body.slice(0, 8000);
    if (typeof patch.workElapsedMs === "number" && Number.isFinite(patch.workElapsedMs)) {
      message.workElapsedMs = Math.max(0, Math.floor(patch.workElapsedMs));
    }
    this.emit("event", {
      type: "message",
      at: Date.now(),
      message: { ...message },
      swarmId: from.swarmId,
    } satisfies HiveEvent);
    this.persist();
    return clone(message);
  }

  async sendAsUser(
    userId: string,
    input: {
      body: string;
      toId?: string;
      kind?: Message["kind"];
      scope?: Message["scope"];
      lane?: MessageLane;
      attachments?: Attachment[];
      secret?: { label: string; login: string; password: string };
      magTaskId?: string;
    },
  ) {
    const swarm = this.swarmByOwner(userId);
    const from = this.world.members.find((member) => member.userId === userId);
    if (!swarm || !from) throw new Error("unauthorized");
    if (input.toId?.startsWith("peer:")) {
      const policy = resolvePolicy(swarm);
      const blocked =
        (policy.etherPagerOnly && (input.lane === "chat" || input.lane === "full")) ||
        (!policy.etherAllowFiles && (input.attachments?.length || input.secret));
      if (blocked) {
        throw new Error("Политика роя запрещает этот слой в эфир. Кабинет → правила.");
      }
      if (!rateLimit(`send:${userId}:ether`, 8, 60_000)) throw new Error("Слишком часто.");
      return this.sendToPeerHub(from.id, input.toId, input.body);
    }
    const mentioned = [...String(input.body ?? "").matchAll(/@([a-zA-Z0-9_-]+)/g)].map((item) => item[1]);
    let to = input.toId ? this.memberById(input.toId) : undefined;
    if (!to && mentioned.length) {
      to = this.world.members.find(
        (member) =>
          member.swarmId === swarm.id &&
          member.kind === "agent" &&
          !member.simulated &&
          mentioned.includes(member.handle),
      );
    }
    if (to?.simulated && mentioned.includes("office")) {
      to = this.world.members.find(
        (member) => member.swarmId === swarm.id && member.handle === "office" && !member.simulated,
      ) ?? to;
    }
    const scope = input.scope ?? (to && to.swarmId !== swarm.id ? "federation" : "swarm");
    const policy = resolvePolicy(swarm);
    const lane =
      scope === "federation" && policy.etherPagerOnly ? "pager" : (input.lane ?? "pager");
    const limit = scope === "federation" ? 8 : lane === "full" ? 12 : 40;
    if (!rateLimit(`send:${userId}:${lane}`, limit, 60_000)) {
      throw new Error("Слишком часто.");
    }
    if (scope === "federation") {
      const blockedFiles = Boolean(input.attachments?.length || input.secret) && !policy.etherAllowFiles;
      const blockedChat = policy.etherPagerOnly && (input.lane === "chat" || input.lane === "full");
      if (blockedFiles || blockedChat) {
        throw new Error("Политика роя запрещает этот слой в эфир. Кабинет → правила.");
      }
    }
    const roomId = scope === "federation" ? "ether" : `${swarm.id}:pager`;
    return this.send({
      roomId,
      swarmId: swarm.id,
      fromId: from.id,
      toId: to?.id,
      kind: input.kind,
      lane,
      body: input.body,
      scope,
      attachments: input.attachments,
      secret: input.secret,
      taskRef: input.magTaskId
        ? { magTaskId: String(input.magTaskId).replace(/^#/, ""), title: input.body.slice(0, 140) }
        : undefined,
    });
  }

  attachFile(userId: string, file: { name: string; type: string; bytes: Buffer }) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    return saveAttachment(swarm.id, file);
  }

  readFile(userId: string, fileId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const attachment = this.world.messages
      .filter((message) => message.swarmId === swarm.id)
      .flatMap((message) => message.attachments ?? [])
      .find((item) => item.id === fileId && item.kind !== "secret");
    if (!attachment) throw new Error("forbidden");
    return {
      bytes: readAttachment(swarm.id, fileId),
      name: attachment.name,
      mime: attachment.mime,
      swarmId: swarm.id,
    };
  }

  revealSecret(userId: string, secretId: string) {
    const swarm = this.swarmByOwner(userId);
    const secret = this.world.secrets.find((item) => item.id === secretId);
    if (!swarm || !secret || secret.swarmId !== swarm.id) throw new Error("forbidden");
    const payload = decryptSecret(secret, swarmCryptoKey(swarm.id));
    secret.opened = true;
    this.persist();
    return { label: secret.label, payload: JSON.parse(payload) as { login: string; password: string } };
  }

  playFullScene(userId: string) {
    if (!this.isDemoMode()) throw new Error("Демо выключено. Заведите живых агентов в кабинете.");
    const swarm = this.swarmByOwner(userId);
    const linux = this.world.members.find(
      (member) => member.swarmId === swarm?.id && member.handle === "linux",
    );
    const from = this.world.members.find((member) => member.userId === userId);
    if (!swarm || !linux || !from) throw new Error("unauthorized");
    const skill = saveAttachment(swarm.id, {
      name: "SKILL-smm.md",
      type: "text/markdown",
      bytes: Buffer.from(
        "# SMM publish\n\n1. Ролик и обложка — только из полного канала своего роя.\n2. Публикация через MAG Master Social Content, не напрямую «в эфир».\n3. Чужому агенту — пейджер, без файлов и паролей.\n",
        "utf8",
      ),
    });
    const cover = saveAttachment(swarm.id, {
      name: "reel-cover.png",
      type: "image/png",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABGUlEQVR4nO3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgbwM+AAH9nQ9FAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
    this.send({
      roomId: `${swarm.id}:pager`,
      swarmId: swarm.id,
      fromId: from.id,
      toId: linux.id,
      kind: "chat",
      lane: "chat",
      body: "@linux обнови скилл публикации: ролик сначала в MAG Master Studio, потом в соцсеть. В эфир файл и пароль не тащи — чужому только пейджер.",
      scope: "swarm",
    });
    this.send({
      roomId: `${swarm.id}:pager`,
      swarmId: swarm.id,
      fromId: from.id,
      toId: linux.id,
      kind: "artifact",
      lane: "full",
      body: "Скилл + обложка ролика. Видео для SMM кладите сюда же, в полный канал своего роя.",
      scope: "swarm",
      attachments: [skill, cover],
    });
    this.send({
      roomId: `${swarm.id}:pager`,
      swarmId: swarm.id,
      fromId: from.id,
      toId: linux.id,
      kind: "secret",
      lane: "full",
      body: "Доступ в MAG Studio — запечатанный конверт, только свой рой.",
      scope: "swarm",
      secret: { label: "MAG Studio SMM", login: "smm-linux", password: "demo-not-for-ether" },
    });
    return { ok: true };
  }

  playScene(userId: string) {
    if (!this.isDemoMode()) throw new Error("Демо выключено. Заведите живых агентов в кабинете.");
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

  expireStaleWork() {
    const now = Date.now();
    let changed = false;
    let swarmId: string | undefined;
    for (const message of this.world.messages) {
      if (message.kind !== "progress") continue;
      if (!message.workStartedAt || typeof message.workElapsedMs === "number") continue;
      const body = message.body || "";
      const limit = /работаю сам|читаю отчёт/.test(body) ? 480_000 : 120_000;
      if (now - message.workStartedAt < limit) continue;
      const elapsed = now - message.workStartedAt;
      message.workElapsedMs = elapsed;
      if (!/срыв:/.test(body)) {
        message.body = `${body.replace(/…$/, "")} — срыв: нода не вернула ответ (${Math.round(elapsed / 1000)}с).`.slice(0, 280);
      }
      const from = this.memberById(message.fromId);
      if (from?.kind === "agent" && from.presence === "busy") {
        from.presence = "free";
        from.currentTaskId = undefined;
      }
      swarmId = message.swarmId;
      changed = true;
    }
    if (changed) {
      this.persist();
      this.emit("event", { type: "state", at: now, swarmId });
    }
  }

  haltModels(swarmId: string, ms = 30 * 60 * 1000) {
    const swarm = this.swarmById(swarmId);
    if (!swarm) throw new Error("unknown swarm");
    swarm.haltUntil = Date.now() + ms;
    for (const member of this.world.members.filter((item) => item.swarmId === swarmId && item.kind === "agent")) {
      member.presence = "free";
      member.currentTaskId = undefined;
    }
    this.emit("event", {
      type: "halt",
      at: Date.now(),
      swarmId,
      haltUntil: swarm.haltUntil,
    } satisfies HiveEvent);
    this.persist();
    const payload = JSON.stringify({ type: "halt", haltUntil: swarm.haltUntil, at: Date.now() });
    const extra = ["http://127.0.0.1:18791/hive/wake"];
    for (const member of this.world.members.filter((item) => item.swarmId === swarmId && item.kind === "agent")) {
      const tunnel = this.world.tunnels.find((item) => item.agentId === member.id);
      extra.push(...([member.webhookUrl, tunnel ? reverseWakeUrl(tunnel) : null].filter(Boolean) as string[]));
    }
    for (const url of [...new Set(extra)]) {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hive-Event": "halt" },
        body: payload,
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined);
    }
    return { haltUntil: swarm.haltUntil };
  }

  resumeModels(swarmId: string) {
    const swarm = this.swarmById(swarmId);
    if (!swarm) throw new Error("unknown swarm");
    swarm.haltUntil = 0;
    this.emit("event", { type: "halt", at: Date.now(), swarmId, haltUntil: 0 } satisfies HiveEvent);
    this.persist();
    return { haltUntil: 0 };
  }

  isHalted(swarmId: string) {
    const swarm = this.swarmById(swarmId);
    return Boolean(swarm?.haltUntil && swarm.haltUntil > Date.now());
  }

  setTalkMode(swarmId: string, mode: "qa" | "qaq") {
    const swarm = this.swarmById(swarmId);
    if (!swarm) throw new Error("unknown swarm");
    swarm.talkMode = mode === "qaq" ? "qaq" : "qa";
    this.emit("event", {
      type: "talk",
      at: Date.now(),
      swarmId,
      talkMode: swarm.talkMode,
    } satisfies HiveEvent);
    this.persist();
    const payload = JSON.stringify({ type: "talk", talkMode: swarm.talkMode, at: Date.now() });
    const extra = ["http://127.0.0.1:18791/hive/wake"];
    for (const member of this.world.members.filter((item) => item.swarmId === swarmId && item.kind === "agent")) {
      const tunnel = this.world.tunnels.find((item) => item.agentId === member.id);
      extra.push(...([member.webhookUrl, tunnel ? reverseWakeUrl(tunnel) : null].filter(Boolean) as string[]));
    }
    for (const url of [...new Set(extra)]) {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hive-Event": "talk" },
        body: payload,
        signal: AbortSignal.timeout(4000),
      }).catch(() => undefined);
    }
    return { talkMode: swarm.talkMode };
  }

  heartbeat(memberId: string) {
    const member = this.memberById(memberId);
    if (!member) throw new Error("unknown member");
    member.lastSeenAt = Date.now();
    if (member.presence === "offline") member.presence = "free";
    for (const child of this.world.members.filter((item) => item.hostId === memberId)) {
      child.lastSeenAt = member.lastSeenAt;
      if (child.presence === "offline") child.presence = "free";
    }
    this.persist();
    return clone(member);
  }

  hostOf(memberId: string) {
    const member = this.memberById(memberId);
    if (!member) return undefined;
    if (member.hostId) return this.memberById(member.hostId) ?? member;
    return member;
  }

  hostedIds(agentId: string) {
    return [
      agentId,
      ...this.world.members.filter((item) => item.hostId === agentId).map((item) => item.id),
    ];
  }

  syncHostSubagents(hostId: string, agents: Array<{ handle: string; name?: string }>) {
    const host = this.memberById(hostId);
    if (!host || host.kind !== "agent" || host.hostId) return clone(host);
    const swarmId = host.swarmId;
    const wanted = new Set<string>();
    for (const row of agents) {
      const handle = String(row.handle || "")
        .replace(/^@/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 24);
      if (handle.length < 2 || handle === host.handle) continue;
      wanted.add(handle);
      const existing = this.world.members.find(
        (item) => item.swarmId === swarmId && item.kind === "agent" && item.handle === handle,
      );
      if (existing) {
        if (existing.peerHubId) continue;
        if (!existing.hostId && this.world.agentKeys.some((key) => key.agentId === existing.id)) continue;
        existing.hostId = host.id;
        existing.openclawId = handle;
        existing.name = (row.name || existing.name || handle).trim();
        existing.role = `подагент @${host.handle}`;
        existing.lastSeenAt = host.lastSeenAt;
        if (existing.presence === "offline") existing.presence = host.presence === "offline" ? "offline" : "free";
        continue;
      }
      this.world.members.push({
        id: `${swarmId}:${handle}`,
        swarmId,
        kind: "agent",
        name: (row.name || handle).trim(),
        handle,
        role: `подагент @${host.handle}`,
        os: host.os,
        presence: host.presence === "offline" ? "offline" : "free",
        lastSeenAt: host.lastSeenAt,
        machine: host.machine,
        region: host.region,
        capabilities: ["пейджер", "чат", "полный канал"],
        simulated: false,
        discoverable: false,
        hostId: host.id,
        openclawId: handle,
      });
    }
    this.world.members = this.world.members.filter((item) => {
      if (item.hostId !== host.id) return true;
      return wanted.has(item.handle);
    });
    this.emitState(swarmId);
    this.persist();
    return clone(host);
  }

  rotateAgentKey(userId: string, agentId: string) {
    const swarm = this.swarmByOwner(userId);
    const agent = this.memberById(agentId);
    if (!swarm || !agent || agent.swarmId !== swarm.id || agent.kind !== "agent") {
      throw new Error("forbidden");
    }
    if (agent.hostId) {
      throw new Error(`У подагента нет своего ключа — будит хост @${this.memberById(agent.hostId)?.handle ?? "host"}`);
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

  createAgent(
    userId: string,
    input: { handle: string; name: string; os: OsKind; role?: string; webhookUrl?: string },
  ) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const handle = input.handle.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
    if (handle.length < 2) throw new Error("Хэндл от 2 символов: латиница, цифры, _-");
    if (this.world.members.some((member) => member.swarmId === swarm.id && member.handle === handle)) {
      throw new Error("Такой @handle уже есть в рое");
    }
    const agent: Member = {
      id: `${swarm.id}:${handle}`,
      swarmId: swarm.id,
      kind: "agent",
      name: input.name.trim() || handle,
      handle,
      role: input.role?.trim() || "Исполнитель",
      os: input.os,
      presence: "offline",
      lastSeenAt: Date.now(),
      region: "свой контур",
      capabilities: ["пейджер", "чат", "полный канал"],
      simulated: false,
      discoverable: false,
      webhookUrl: sanitizeWebhook(input.webhookUrl),
    };
    this.world.members.push(agent);
    const tunnels = this.world.tunnels.filter((item) => item.swarmId === swarm.id);
    const reversePort = nextReversePort(tunnels);
    const wakePort = 18790;
    const overlayIp = nextOverlayIp(tunnels);
    const wg = loadOrCreateAgentPair(swarm.id, agent.id);
    this.world.tunnels.push({
      id: `${swarm.id}:tun-${handle}`,
      swarmId: swarm.id,
      agentId: agent.id,
      kind: "both",
      overlayIp,
      status: "down",
      ssh: {
        host: hubSshHost(),
        user: "claw",
        reversePort,
        gatewayPort: 18789,
        wakePort,
        status: "down",
      },
      wireguard: {
        publicKey: wg.publicKey,
        listenPort: 51820,
        allowedIps: `${overlayIp}/32`,
        fallback: false,
      },
      magSpace: "свой рой",
      notes: "Reverse SSH или WireGuard. Overlay 10.42.0.x не в эфир.",
    });
    if (!agent.webhookUrl) {
      agent.webhookUrl = `http://127.0.0.1:${reversePort}/hive/wake`;
    }
    const issued = this.rotateAgentKey(userId, agent.id);
    this.emitState(swarm.id);
    return { agent: clone(agent), key: issued.key };
  }

  setWebhook(userId: string, agentId: string, webhookUrl: string) {
    const swarm = this.swarmByOwner(userId);
    const agent = this.memberById(agentId);
    if (!swarm || !agent || agent.swarmId !== swarm.id || agent.kind !== "agent") {
      throw new Error("forbidden");
    }
    agent.webhookUrl = sanitizeWebhook(webhookUrl);
    this.emitState(swarm.id);
    return clone(agent);
  }

  setAgentMagProject(userId: string, agentId: string, magProjectId: string) {
    const swarm = this.swarmByOwner(userId);
    const agent = this.memberById(agentId);
    if (!swarm || !agent || agent.swarmId !== swarm.id || agent.kind !== "agent") {
      throw new Error("forbidden");
    }
    const projectId = magProjectId.trim();
    agent.magProjectId = projectId || undefined;
    const policy = resolvePolicy(swarm);
    const magProjectsByHandle = { ...policy.magProjectsByHandle };
    if (projectId) magProjectsByHandle[agent.handle] = projectId;
    else delete magProjectsByHandle[agent.handle];
    swarm.policy = { ...policy, magProjectsByHandle };
    this.emitState(swarm.id);
    return clone(agent);
  }

  connectMag(
    userId: string,
    input: { agentKey: string; projectId?: string; apiUrl?: string; gatewayUrl?: string },
  ) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const key = input.agentKey.trim();
    if (key.length < 8) throw new Error("Ключ MAG Master слишком короткий");
    const apiUrl = (input.apiUrl || "https://app.magaicrm.ru/api").replace(/\/$/, "");
    const gatewayUrl =
      (input.gatewayUrl || `${apiUrl.replace(/\/api$/, "")}/api/external-agents`).replace(/\/$/, "");
    swarm.magConnect = {
      apiUrl,
      gatewayUrl,
      projectId: (input.projectId || swarm.magProjectId || "mag-hive").trim(),
      keyEnc: encryptSecret(key, swarmCryptoKey(swarm.id)),
      connectedAt: Date.now(),
    };
    swarm.magProjectId = swarm.magConnect.projectId;
    this.emitState(swarm.id);
    return { connected: true, projectId: swarm.magConnect.projectId, gatewayUrl };
  }

  disconnectMag(userId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    swarm.magConnect = undefined;
    this.emitState(swarm.id);
    return { connected: false };
  }

  magCredentials(swarmId: string) {
    const swarm = this.world.swarms.find((item) => item.id === swarmId);
    if (!swarm?.magConnect) return null;
    return {
      apiUrl: swarm.magConnect.apiUrl,
      gatewayUrl: swarm.magConnect.gatewayUrl,
      projectId: swarm.magConnect.projectId,
      key: decryptSecret(swarm.magConnect.keyEnc, swarmCryptoKey(swarm.id)),
    };
  }

  setPublicUrl(userId: string, url: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    swarm.publicUrl = url.trim().replace(/\/$/, "");
    this.emitState(swarm.id);
    return { publicUrl: swarm.publicUrl };
  }

  setOverlayOnly(userId: string, enabled: boolean) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    swarm.overlayOnly = enabled;
    swarm.policy = { ...resolvePolicy(swarm), overlayOnly: enabled };
    if (enabled) {
      const tunnels = this.world.tunnels.filter(
        (tunnel) => tunnel.swarmId === swarm.id && !this.memberById(tunnel.agentId)?.peerHubId,
      );
      for (const tunnel of tunnels) {
        if (tunnel.overlayIp === HUB_OVERLAY_IP) tunnel.overlayIp = nextOverlayIp(tunnels.filter((item) => item.id !== tunnel.id));
        const pair = loadOrCreateAgentPair(swarm.id, tunnel.agentId);
        tunnel.kind = tunnel.ssh ? "both" : "wireguard";
        tunnel.wireguard = {
          publicKey: pair.publicKey,
          listenPort: 51820,
          allowedIps: `${tunnel.overlayIp}/32`,
          fallback: false,
        };
      }
    }
    this.emitState(swarm.id);
    return this.overlayBundle(swarm.id);
  }

  setPolicy(userId: string, patch: Partial<SwarmPolicy>) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    if (patch.overlayOnly === true && !resolvePolicy(swarm).overlayOnly) {
      this.setOverlayOnly(userId, true);
    }
    const current = resolvePolicy(swarm);
    const next = { ...current, ...patch };
    if (patch.magProjectsByHandle) {
      next.magProjectsByHandle = { ...current.magProjectsByHandle };
      for (const [handle, projectId] of Object.entries(patch.magProjectsByHandle)) {
        const key = handle.replace(/^@/, "").toLowerCase().trim();
        const value = String(projectId ?? "").trim();
        if (!key) continue;
        if (value) next.magProjectsByHandle[key] = value;
        else delete next.magProjectsByHandle[key];
      }
    }
    if (typeof next.etherMax === "number") next.etherMax = Math.min(2000, Math.max(40, Math.floor(next.etherMax)));
    if (typeof next.swarmPageMax === "number") {
      next.swarmPageMax = Math.min(2000, Math.max(80, Math.floor(next.swarmPageMax)));
    }
    swarm.policy = next;
    swarm.overlayOnly = next.overlayOnly;
    this.emitState(swarm.id);
    return { policy: resolvePolicy(swarm) };
  }

  overlayBundle(swarmId: string) {
    const swarm = this.world.swarms.find((item) => item.id === swarmId);
    if (!swarm) throw new Error("unknown swarm");
    this.syncLiveTunnels();
    const tunnels = this.world.tunnels.filter((tunnel) => tunnel.swarmId === swarmId);
    const live = readLiveWireguard();
    return {
      overlayOnly: resolvePolicy(swarm).overlayOnly,
      hubIp: overlayHubIp(),
      hubUrl: overlayHubUrl(),
      endpoint: overlayEndpoint(),
      listenPort: live?.listenPort || 51820,
      adopted: Boolean(live),
      iface: live?.iface,
      net: live?.net,
      hint: wgInstallHint(),
      hubConf: live ? "" : hubWireguardConf(swarmId, tunnels),
      agents: live
        ? []
        : tunnels.map((tunnel) => ({
            agentId: tunnel.agentId,
            overlayIp: tunnel.overlayIp,
            conf: agentWireguardConf(swarmId, tunnel),
          })),
    };
  }

  rotatePeerInvite(userId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    const token = newPeerKey();
    swarm.peerInviteHash = hashAgentKey(token);
    this.persist();
    return { token, publicUrl: swarm.publicUrl || process.env.HIVE_PUBLIC_URL || "" };
  }

  swarmByPeerKey(token: string) {
    const digest = hashAgentKey(token);
    return this.world.swarms.find((swarm) => swarm.peerInviteHash && safeEqualHex(swarm.peerInviteHash, digest));
  }

  addPeer(userId: string, input: { url: string; token: string; name?: string }) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    let url: string;
    try {
      url = new URL(input.url).origin;
    } catch {
      throw new Error("Некорректный URL чужого хаба");
    }
    if (this.world.peerHubs.some((peer) => peer.ownerSwarmId === swarm.id && peer.url === url)) {
      throw new Error("Этот хаб уже добавлен");
    }
    const peer: PeerHub = {
      id: nid("peer-"),
      ownerSwarmId: swarm.id,
      url,
      name: input.name?.trim() || url.replace(/^https?:\/\//, ""),
      tokenEnc: encryptSecret(input.token.trim(), swarmCryptoKey(swarm.id)),
    };
    this.world.peerHubs.push(peer);
    this.persist();
    void this.refreshPeer(peer.id);
    return { id: peer.id, url: peer.url, name: peer.name };
  }

  removePeer(userId: string, peerId: string) {
    const swarm = this.swarmByOwner(userId);
    if (!swarm) throw new Error("unauthorized");
    this.world.peerHubs = this.world.peerHubs.filter(
      (peer) => !(peer.id === peerId && peer.ownerSwarmId === swarm.id),
    );
    this.emitState(swarm.id);
  }

  cachedRemoteEther(swarmId: string): EtherAgent[] {
    return this.world.peerHubs
      .filter((peer) => peer.ownerSwarmId === swarmId)
      .flatMap((peer) =>
        (peer.cache ?? []).map((agent) => ({
          ...agent,
          id: `peer:${peer.id}:${agent.handle}`,
          remote: true,
          hubUrl: peer.url,
          swarmName: agent.swarmName || peer.name,
        })),
      );
  }

  async refreshPeer(peerId: string) {
    const peer = this.world.peerHubs.find((item) => item.id === peerId);
    if (!peer) return;
    const swarm = this.world.swarms.find((item) => item.id === peer.ownerSwarmId);
    if (!swarm) return;
    try {
      const token = decryptSecret(peer.tokenEnc, swarmCryptoKey(swarm.id));
      const response = await fetch(`${peer.url}/api/federation/ether`, {
        headers: { "X-Hive-Peer-Key": token },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`хаб ответил ${response.status}`);
      const json = (await response.json()) as { agents?: EtherAgent[] };
      peer.cache = json.agents ?? [];
      peer.lastOkAt = Date.now();
      peer.lastError = undefined;
    } catch (error) {
      peer.lastError = error instanceof Error ? error.message : "peer error";
    }
    this.persist();
  }

  federationEther(token: string) {
    const swarm = this.swarmByPeerKey(token);
    if (!swarm) throw new Error("unauthorized");
    if (!resolvePolicy(swarm).etherInbound) throw new Error("Политика роя: входящий эфир выключен");
    return this.world.members
      .filter((member) => member.swarmId === swarm.id && member.kind === "agent" && member.discoverable)
      .map((member) => ({
        id: member.id,
        handle: member.handle,
        name: member.name,
        os: member.os,
        presence: member.presence,
        region: member.region ?? "скрыт",
        swarmName: swarm.name,
        ownerName: this.userById(swarm.ownerUserId)?.name ?? "рой",
        lastSeenAt: member.lastSeenAt,
      }));
  }

  ingestPeerPage(
    token: string,
    input: { fromHandle: string; fromSwarmName: string; toHandle: string; body: string; hubUrl?: string },
  ) {
    const swarm = this.swarmByPeerKey(token);
    if (!swarm) throw new Error("unauthorized");
    if (!resolvePolicy(swarm).etherInbound) throw new Error("Политика роя: входящий эфир выключен");
    if (!rateLimit(`peer-in:${swarm.id}`, 20, 60_000)) throw new Error("Слишком часто.");
    const to = this.world.members.find(
      (member) =>
        member.swarmId === swarm.id &&
        member.kind === "agent" &&
        member.handle === input.toHandle.replace(/^@/, "") &&
        member.discoverable,
    );
    if (!to) throw new Error("Агент скрыт или не найден");
    const fromHandle = input.fromHandle.replace(/^@/, "").slice(0, 24) || "peer";
    const ghostId = `ghost:${swarm.id}:${fromHandle}`;
    let from = this.memberById(ghostId);
    if (!from) {
      from = {
        id: ghostId,
        swarmId: swarm.id,
        kind: "agent",
        name: fromHandle,
        handle: fromHandle,
        role: "Чужой хаб",
        presence: "free",
        lastSeenAt: Date.now(),
        region: input.hubUrl || "эфир",
        capabilities: ["пейджер"],
        discoverable: false,
        peerHubId: "inbound",
      };
      this.world.members.push(from);
    }
    const body = stripFederationBody(input.body, resolvePolicy(swarm).etherMax);
    if (!body) throw new Error("Пустой пейдж");
    return this.send({
      roomId: "ether",
      swarmId: swarm.id,
      fromId: from.id,
      toId: to.id,
      kind: "page",
      lane: "pager",
      body: `${body}`,
      scope: "federation",
    });
  }

  async sendToPeerHub(fromId: string, toId: string, body: string) {
    const [, peerId, handle] = toId.split(":");
    const from = this.memberById(fromId);
    const swarm = from ? this.world.swarms.find((item) => item.id === from.swarmId) : undefined;
    const peer = this.world.peerHubs.find((item) => item.id === peerId && item.ownerSwarmId === swarm?.id);
    if (!swarm || !from || !peer) throw new Error("Чужой хаб не найден");
    const cleaned = stripFederationBody(body, resolvePolicy(swarm).etherMax);
    if (!cleaned) throw new Error("Пустой пейдж");
    const token = decryptSecret(peer.tokenEnc, swarmCryptoKey(swarm.id));
    const a2aBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "message/send",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: cleaned }],
          metadata: { toHandle: handle, fromHandle: from.handle, fromSwarmName: swarm.name },
        },
      },
    });
    const headers = { "Content-Type": "application/json", "X-Hive-Peer-Key": token };
    let sent = false;
    try {
      const a2a = await fetch(`${peer.url}/api/a2a`, {
        method: "POST",
        headers,
        body: a2aBody,
        signal: AbortSignal.timeout(8000),
      });
      if (a2a.ok) {
        const json = (await a2a.json()) as { error?: { message?: string } };
        if (!json.error) sent = true;
      }
    } catch {
      /* Hive-native peer without A2A */
    }
    if (!sent) {
      const response = await fetch(`${peer.url}/api/federation/page`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fromHandle: from.handle,
          fromSwarmName: swarm.name,
          toHandle: handle,
          body: cleaned,
          hubUrl: swarm.publicUrl || process.env.HIVE_PUBLIC_URL || "",
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Чужой хаб: ${text.slice(0, 180) || response.status}`);
      }
    }
    const ghostId = `ghost-out:${peer.id}:${handle}`;
    let ghost = this.memberById(ghostId);
    if (!ghost) {
      ghost = {
        id: ghostId,
        swarmId: swarm.id,
        kind: "agent",
        name: handle,
        handle,
        role: "Чужой хаб",
        presence: "free",
        lastSeenAt: Date.now(),
        region: peer.name,
        capabilities: ["пейджер"],
        discoverable: false,
        peerHubId: peer.id,
      };
      this.world.members.push(ghost);
    }
    return this.send({
      roomId: "ether",
      swarmId: swarm.id,
      fromId: from.id,
      toId: ghost.id,
      kind: "page",
      lane: "pager",
      body: cleaned,
      scope: "federation",
    });
  }

  wakeAgent(message: Message) {
    const targets = this.world.members.filter((member) => {
      if (member.kind !== "agent" || member.peerHubId) return false;
      if (member.id === message.fromId) return false;
      if (message.toId === member.id) return true;
      return (
        message.scope === "swarm" &&
        message.swarmId === member.swarmId &&
        message.body.includes(`@${member.handle}`)
      );
    });
    const swarm = this.world.swarms.find((item) => item.id === message.swarmId);
    for (const target of targets) {
      const host = this.hostOf(target.id) ?? target;
      const body = JSON.stringify({
        type: "hive_page",
        at: message.createdAt,
        lane: message.lane,
        kind: message.kind,
        body: message.body,
        task: message.taskRef ?? null,
        fromId: message.fromId,
        toId: target.id,
        toHandle: target.handle,
        openclawAgent: target.openclawId || target.handle,
      });
      const tunnel = this.world.tunnels.find((item) => item.agentId === host.id);
      const hubIp = overlayHubIp();
      const overlayWake =
        swarm &&
        resolvePolicy(swarm).overlayWake &&
        tunnel &&
        tunnel.status !== "down" &&
        tunnel.overlayIp !== hubIp
          ? `http://${tunnel.overlayIp}:${tunnel.ssh?.wakePort ?? 18790}/hive/wake`
          : null;
      const urls = [...new Set([host.webhookUrl, tunnel ? reverseWakeUrl(tunnel) : null, overlayWake].filter(Boolean))] as string[];
      for (const url of urls) {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Hive-Event": "page" },
          body,
          signal: AbortSignal.timeout(4000),
        }).catch(() => undefined);
      }
    }
  }

  inbox(agentId: string, after?: number) {
    this.purgeExpired();
    const agent = this.memberById(agentId);
    if (!agent) throw new Error("unknown agent");
    const ids = new Set(this.hostedIds(agentId));
    const handles = [...ids]
      .map((id) => this.memberById(id)?.handle)
      .filter((handle): handle is string => Boolean(handle));
    return this.world.messages.filter((message) => {
      if (message.expiresAt <= Date.now()) return false;
      if (after && message.createdAt <= after) return false;
      const from = this.memberById(message.fromId);
    if (ids.has(message.fromId)) return false;
    if (message.toId && ids.has(message.toId)) return true;
    if (from?.kind === "agent" && from.id !== agentId && from.hostId !== agentId) return false;
    return (
      message.scope === "swarm" &&
      message.swarmId === agent.swarmId &&
      from?.kind === "human" &&
      handles.some((handle) => message.body.includes(`@${handle}`))
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

  publicSwarmName() {
    return this.world.swarms[0]?.name || "swarm";
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
    if (message.scope !== "swarm") return;
    const to = message.toId ? this.memberById(message.toId) : undefined;
    if (from.kind === "human" && to?.kind === "agent") {
      if (
        message.kind === "page" ||
        message.kind === "task_assigned" ||
        message.kind === "chat" ||
        message.kind === "artifact"
      ) {
        to.presence = "busy";
      }
      return;
    }
    if (from.kind !== "agent") return;
    if (message.kind === "task_assigned") {
      from.presence = "free";
      from.currentTaskId = undefined;
      if (to && to.kind === "agent") {
        to.presence = "busy";
        to.currentTaskId = message.taskRef?.magTaskId ?? to.currentTaskId;
      }
      return;
    }
    if (message.kind === "progress") {
      from.presence = "busy";
      from.currentTaskId = message.taskRef?.magTaskId ?? from.currentTaskId;
    }
    if (message.kind === "blocked") from.presence = "blocked";
    if (message.kind === "done" || message.kind === "free") {
      from.presence = "free";
      from.currentTaskId = undefined;
    }
  }

  private sealSecret(swarmId: string, secret: { label: string; login: string; password: string }) {
    const id = nid("sec-");
    const sealed = encryptSecret(
      JSON.stringify({ login: secret.login, password: secret.password }),
      swarmCryptoKey(swarmId),
    );
    const record: SealedSecret = {
      id,
      swarmId,
      label: (secret.label || "конверт").slice(0, 80),
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
      opened: false,
    };
    this.world.secrets.push(record);
    return id;
  }

  private trimLane(swarmId: string, lane: MessageLane) {
    const keep = lane === "pager" ? SWARM_KEEP : SWARM_CHAT_KEEP;
    const laneMsgs = this.world.messages.filter(
      (message) =>
        message.swarmId === swarmId &&
        message.scope === "swarm" &&
        (message.lane ?? "pager") === lane,
    );
    const extra = laneMsgs.sort((a, b) => b.createdAt - a.createdAt).slice(keep);
    const drop = new Set(extra.map((message) => message.id));
    this.world.messages = this.world.messages.filter((message) => !drop.has(message.id));
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

function inferKind(body: string, scope: Message["scope"], lane: MessageLane): Message["kind"] {
  if (scope === "federation") return "page";
  if (lane === "chat") return "chat";
  if (lane === "full") return "artifact";
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

function sanitizeWebhook(url?: string) {
  const value = (url ?? "").trim();
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("bad");
    const host = parsed.hostname.toLowerCase();
    if (host === "169.254.169.254" || host.endsWith(".metadata.google.internal")) {
      throw new Error("Webhook: этот хост нельзя");
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Webhook:")) throw error;
    throw new Error("Webhook: нужен http(s) URL");
  }
}

const globalForHive = globalThis as unknown as { __hiveStore?: HiveStore };

export function getStore(): HiveStore {
  if (!globalForHive.__hiveStore) {
    globalForHive.__hiveStore = new HiveStore();
  }
  return globalForHive.__hiveStore;
}
