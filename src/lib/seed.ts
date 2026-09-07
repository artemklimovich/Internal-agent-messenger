import { nid } from "./id";
import type { Member, Room, Swarm, Tunnel, User, World } from "./types";
import { SCHEMA_VERSION } from "./types";

export function createEmptyWorld(): World {
  const t = Date.now();
  const system: User = {
    id: "user-system",
    email: "system@hive.internal",
    passwordHash: "!",
    name: "Hive",
    role: "system",
    disabled: true,
    createdAt: t,
  };
  const foreign: Swarm = {
    id: "swarm-north",
    ownerUserId: system.id,
    name: "Северная студия",
  };
  const nora: Member = {
    id: "swarm-north:nora",
    swarmId: foreign.id,
    kind: "agent",
    name: "Nora",
    handle: "nora",
    role: "Копирайтер OpenClaw",
    os: "linux",
    presence: "free",
    lastSeenAt: t,
    region: "Екатеринбург",
    capabilities: ["пейджер"],
    simulated: true,
    discoverable: true,
  };
  const mason: Member = {
    id: "swarm-north:mason",
    swarmId: foreign.id,
    kind: "agent",
    name: "Mason",
    handle: "mason",
    role: "Исследователь",
    os: "macos",
    presence: "busy",
    currentTaskId: "88",
    lastSeenAt: t,
    region: "Берлин",
    capabilities: ["пейджер"],
    simulated: true,
    discoverable: true,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [system],
    swarms: [foreign],
    members: [nora, mason],
    rooms: [],
    messages: [],
    tunnels: [],
    agentKeys: [],
    secrets: [],
    peerHubs: [],
    loginGuard: {},
    demoMode: true,
  };
}

export function provisionOwnedSwarm(user: User): {
  swarm: Swarm;
  members: Member[];
  rooms: Room[];
  tunnels: Tunnel[];
} {
  const t = Date.now();
  const swarm: Swarm = {
    id: nid("swarm-"),
    ownerUserId: user.id,
    name: `Рой ${user.name}`,
    magProjectId: "mag-hive",
  };
  const human: Member = {
    id: user.id,
    swarmId: swarm.id,
    kind: "human",
    userId: user.id,
    name: user.name,
    handle: handleFromEmail(user.email),
    role: "Оператор роя",
    presence: "free",
    lastSeenAt: t,
    capabilities: ["пейджер", "чат", "полный канал", "кабинет"],
    magProjectId: "mag-hive",
  };
  const agents = ownedAgents(swarm.id, t);
  const members = [human, ...agents];
  const rooms: Room[] = [
    {
      id: `${swarm.id}:pager`,
      swarmId: swarm.id,
      type: "swarm",
      title: "Пейджер своего роя",
      subtitle: "Короткие сигналы, сгорают за 24 часа",
      memberIds: members.map((item) => item.id),
    },
  ];
  const tunnels = ownedTunnels(swarm.id, agents, t);
  return { swarm, members, rooms, tunnels };
}

function ownedAgents(swarmId: string, t: number): Member[] {
  return [
    {
      id: `${swarmId}:orchestrator`,
      swarmId,
      kind: "agent",
      name: "Orchestrator",
      handle: "orchestrator",
      role: "Диспетчер OpenClaw",
      os: "linux",
      presence: "free",
      lastSeenAt: t,
      machine: "hive-hub / Ubuntu 24.04",
      region: "свой контур",
      capabilities: ["MCP MAG Master", "постановка"],
      simulated: true,
      magProjectId: "mag-hive",
      discoverable: false,
    },
    {
      id: `${swarmId}:linux`,
      swarmId,
      kind: "agent",
      name: "Linux Executor",
      handle: "linux",
      role: "Исполнитель",
      os: "linux",
      presence: "free",
      lastSeenAt: t,
      machine: "devbox / Ubuntu 24.04",
      region: "свой контур",
      capabilities: ["git", "SSH"],
      simulated: true,
      magProjectId: "mag-hive",
      discoverable: false,
    },
    {
      id: `${swarmId}:windows`,
      swarmId,
      kind: "agent",
      name: "Windows Builder",
      handle: "windows",
      role: "Сборка Windows",
      os: "windows",
      presence: "free",
      lastSeenAt: t,
      machine: "win-build / Windows 11",
      region: "свой контур",
      capabilities: ["WG overlay"],
      simulated: true,
      magProjectId: "mag-hive",
      discoverable: false,
    },
    {
      id: `${swarmId}:android`,
      swarmId,
      kind: "agent",
      name: "Android Eye",
      handle: "android",
      role: "Наблюдатель",
      os: "android",
      presence: "free",
      lastSeenAt: t,
      machine: "телефон / PWA",
      region: "свой контур",
      capabilities: ["пейджер"],
      simulated: true,
      magProjectId: "mag-hive",
      discoverable: false,
    },
  ];
}

function ownedTunnels(swarmId: string, agents: Member[], t: number): Tunnel[] {
  const byHandle = Object.fromEntries(agents.map((agent) => [agent.handle, agent]));
  return [
    {
      id: `${swarmId}:tun-orchestrator`,
      swarmId,
      agentId: byHandle.orchestrator.id,
      kind: "both",
      overlayIp: "10.42.0.2",
      status: "up",
      ssh: {
        host: "hive-hub.internal",
        user: "openclaw",
        reversePort: 22001,
        gatewayPort: 18789,
        status: "up",
      },
      wireguard: {
        publicKey: "oRch3str4t0rDemoKeyAAAAAAAAAAAAAAAAAAAAAA=",
        endpoint: "hive-hub.internal:51820",
        listenPort: 51820,
        allowedIps: "10.42.0.2/32",
        lastHandshakeAt: t,
        fallback: false,
      },
      magSpace: "свой рой",
      notes: "Туннель только внутри своего роя. В эфир не публикуется.",
    },
    {
      id: `${swarmId}:tun-linux`,
      swarmId,
      agentId: byHandle.linux.id,
      kind: "ssh",
      overlayIp: "10.42.0.3",
      status: "up",
      ssh: {
        host: "devbox.internal",
        user: "claw",
        reversePort: 22002,
        gatewayPort: 18789,
        status: "up",
      },
      magSpace: "свой рой",
      notes: "SSH reverse к своему Gateway.",
    },
    {
      id: `${swarmId}:tun-windows`,
      swarmId,
      agentId: byHandle.windows.id,
      kind: "wireguard",
      overlayIp: "10.42.0.4",
      status: "degraded",
      ssh: {
        host: "win-build.internal",
        user: "claw",
        reversePort: 22003,
        gatewayPort: 18789,
        status: "down",
      },
      wireguard: {
        publicKey: "w1nBu1ld3rDemoKeyAAAAAAAAAAAAAAAAAAAAAAA=",
        listenPort: 51820,
        allowedIps: "10.42.0.4/32",
        lastHandshakeAt: t,
        fallback: true,
      },
      magSpace: "свой рой",
      notes: "SSH режется, свой WG overlay. Чужим роям этот ключ не виден.",
    },
  ];
}

export function demoOwnedAgents(swarmId: string, t = Date.now()) {
  return ownedAgents(swarmId, t);
}

export function demoOwnedTunnels(swarmId: string, agents: Member[], t = Date.now()) {
  return ownedTunnels(swarmId, agents, t);
}

export function handleFromEmail(email: string) {
  return email.split("@")[0].replace(/[^a-z0-9_-]/gi, "").toLowerCase().slice(0, 24) || "ops";
}
