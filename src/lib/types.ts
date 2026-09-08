export type ActorKind = "human" | "agent";
export type Presence = "free" | "busy" | "blocked" | "offline";
export type OsKind = "linux" | "windows" | "android" | "macos";
export type MessageKind =
  | "page"
  | "task_assigned"
  | "progress"
  | "blocked"
  | "done"
  | "free"
  | "chat"
  | "artifact"
  | "secret"
  | "system";
export type MessageLane = "pager" | "chat" | "full";
export type AttachmentKind = "image" | "video" | "document" | "skill" | "kb" | "secret";
export type RoomType = "swarm" | "ether";
export type TunnelKind = "ssh" | "wireguard" | "both" | "none";
export type LinkStatus = "up" | "degraded" | "down";
export type UserRole = "user" | "admin" | "system";
export type MessageScope = "swarm" | "federation";

export const SCHEMA_VERSION = 2;
export const SWARM_PAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const FED_PAGE_TTL_MS = 2 * 60 * 60 * 1000;
export const SWARM_CHAT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SWARM_FULL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SWARM_PAGE_MAX = 280;
export const FED_PAGE_MAX = 140;
export const SWARM_CHAT_MAX = 8000;
export const SWARM_FULL_CAPTION_MAX = 4000;
export const SWARM_KEEP = 80;
export const SWARM_CHAT_KEEP = 400;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** Operator-tunable rules. Defaults match the open-source slice; nothing here is a hard protocol law. */
export interface SwarmPolicy {
  overlayOnly: boolean;
  etherInbound: boolean;
  etherPagerOnly: boolean;
  etherAllowFiles: boolean;
  overlayWake: boolean;
  etherMax: number;
  swarmPageMax: number;
  /** Hive-слой: какой @handle пишет в какой MAG projectId. Пусто — кабинетный проект хаба. */
  magProjectsByHandle: Record<string, string>;
}

export const DEFAULT_POLICY: SwarmPolicy = {
  overlayOnly: false,
  etherInbound: true,
  etherPagerOnly: true,
  etherAllowFiles: false,
  overlayWake: true,
  etherMax: FED_PAGE_MAX,
  swarmPageMax: SWARM_PAGE_MAX,
  magProjectsByHandle: {},
};

export function resolvePolicy(swarm: { overlayOnly?: boolean; policy?: Partial<SwarmPolicy> }): SwarmPolicy {
  const overlayOnly = swarm.policy?.overlayOnly ?? Boolean(swarm.overlayOnly);
  const stored = swarm.policy;
  return {
    overlayOnly,
    etherInbound: stored?.etherInbound ?? (stored ? DEFAULT_POLICY.etherInbound : !overlayOnly),
    etherPagerOnly: stored?.etherPagerOnly ?? DEFAULT_POLICY.etherPagerOnly,
    etherAllowFiles: stored?.etherAllowFiles ?? DEFAULT_POLICY.etherAllowFiles,
    overlayWake: stored?.overlayWake ?? DEFAULT_POLICY.overlayWake,
    etherMax: stored?.etherMax ?? DEFAULT_POLICY.etherMax,
    swarmPageMax: stored?.swarmPageMax ?? DEFAULT_POLICY.swarmPageMax,
    magProjectsByHandle: { ...DEFAULT_POLICY.magProjectsByHandle, ...(stored?.magProjectsByHandle ?? {}) },
  };
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  disabled?: boolean;
  createdAt: number;
}

export interface MagConnect {
  apiUrl: string;
  gatewayUrl: string;
  projectId: string;
  keyEnc: { iv: string; ciphertext: string; tag: string };
  connectedAt: number;
}

export interface MagInventory {
  ok: boolean;
  detail: string;
  projectId: string;
  agentName?: string;
  agentMode?: string;
  agentEnabled?: boolean;
  webhookConfigured?: boolean;
  webhookFiredByMag: boolean;
  projects: Array<{ id: string; name: string; companyId?: string | null }>;
  capabilities: {
    comments: boolean;
    kbRead: boolean;
    kbWrite: boolean;
    tasks: boolean;
    inbox: boolean;
  };
  inboxOpen?: number;
  tasks: Array<{
    id: string;
    title: string;
    status?: string;
    projectId?: string;
    projectName?: string;
    dueAt?: string;
  }>;
  magPolicy: {
    allowedProjectIds: string[];
    allowedActions: string[];
    effectiveActions: string[];
    mcpPolicy?: string;
  };
  notes: string[];
}

export interface Swarm {
  id: string;
  ownerUserId: string;
  name: string;
  magProjectId?: string;
  publicUrl?: string;
  peerInviteHash?: string;
  magConnect?: MagConnect;
  overlayOnly?: boolean;
  policy?: Partial<SwarmPolicy>;
  /** Unix ms; hive-nodes refuse new model wakes while Date.now() < haltUntil */
  haltUntil?: number;
  /** qa = one reply then done; qaq = reply as page so the peer asks again */
  talkMode?: "qa" | "qaq";
}

export interface PeerHub {
  id: string;
  ownerSwarmId: string;
  url: string;
  name: string;
  tokenEnc: { iv: string; ciphertext: string; tag: string };
  lastOkAt?: number;
  lastError?: string;
  cache?: EtherAgent[];
}

export interface Member {
  id: string;
  swarmId: string;
  kind: ActorKind;
  userId?: string;
  name: string;
  handle: string;
  role: string;
  os?: OsKind;
  presence: Presence;
  currentTaskId?: string;
  lastSeenAt: number;
  machine?: string;
  region?: string;
  capabilities: string[];
  simulated?: boolean;
  magProjectId?: string;
  discoverable?: boolean;
  webhookUrl?: string;
  peerHubId?: string;
  /** Hive-node хоста (например @main). Подагент OpenClaw без своего hive_ ключа. */
  hostId?: string;
  openclawId?: string;
}

/** Какой MAG projectId разрешён этому агенту Hive. Не путать с «думает» на радио. */
export function hiveMagProjectFor(
  member: Member | undefined,
  swarm: {
    magProjectId?: string;
    magConnect?: { projectId?: string };
    policy?: Partial<SwarmPolicy>;
  },
  members: Member[],
): string | undefined {
  const cabinet = (swarm.magConnect?.projectId || swarm.magProjectId || "").trim();
  const map = swarm.policy?.magProjectsByHandle ?? {};
  const fromHandle = (handle: string, fallback?: string) => {
    const mapped = (map[handle] || "").trim();
    if (mapped) return mapped;
    return (fallback || "").trim();
  };
  if (!member) return cabinet || undefined;
  const own = fromHandle(member.handle, member.magProjectId);
  if (own) return own;
  if (member.hostId) {
    const host = members.find((item) => item.id === member.hostId);
    if (host) {
      const inherited = fromHandle(host.handle, host.magProjectId);
      if (inherited) return inherited;
    }
  }
  return cabinet || undefined;
}

export interface Tunnel {
  id: string;
  swarmId: string;
  agentId: string;
  kind: TunnelKind;
  overlayIp: string;
  status: LinkStatus;
  ssh?: {
    host: string;
    user: string;
    reversePort: number;
    gatewayPort: number;
    wakePort?: number;
    status: LinkStatus;
  };
  wireguard?: {
    publicKey: string;
    endpoint?: string;
    listenPort: number;
    allowedIps: string;
    lastHandshakeAt?: number;
    fallback: boolean;
  };
  magSpace?: string;
  notes: string;
}

export interface Room {
  id: string;
  swarmId: string;
  type: RoomType;
  title: string;
  subtitle?: string;
  memberIds: string[];
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  kbPath?: string;
}

export interface SealedSecret {
  id: string;
  swarmId: string;
  label: string;
  ciphertext: string;
  iv: string;
  tag: string;
  opened: boolean;
}

export interface TaskRef {
  magTaskId: string;
  title: string;
  status?: string;
}

export interface Message {
  id: string;
  roomId: string;
  swarmId: string;
  fromId: string;
  toId?: string;
  fromSwarmId: string;
  toSwarmId?: string;
  scope: MessageScope;
  kind: MessageKind;
  lane: MessageLane;
  body: string;
  taskRef?: TaskRef;
  attachments?: Attachment[];
  secretId?: string;
  createdAt: number;
  expiresAt: number;
  /** Client-ticking occupancy; no model tokens. Frozen when workElapsedMs is set. */
  workStartedAt?: number;
  workElapsedMs?: number;
}

export interface AgentKey {
  agentId: string;
  keyHash: string;
}

export interface HiveEvent {
  type: "state" | "message" | "presence" | "tunnel" | "demo" | "ping" | "hello" | "halt" | "talk";
  at: number;
  message?: Message;
  member?: Member;
  tunnel?: Tunnel;
  swarmId?: string;
  haltUntil?: number;
  talkMode?: "qa" | "qaq";
}

export interface World {
  schemaVersion: number;
  users: User[];
  swarms: Swarm[];
  members: Member[];
  rooms: Room[];
  messages: Message[];
  tunnels: Tunnel[];
  agentKeys: AgentKey[];
  secrets: SealedSecret[];
  peerHubs: PeerHub[];
  loginGuard: Record<string, { fails: number; lockedUntil?: number }>;
  /** false = учебные @linux/@nora и автосцена выключены. undefined = демо включено. */
  demoMode?: boolean;
}

export interface SendMessageInput {
  roomId: string;
  swarmId: string;
  fromId: string;
  toId?: string;
  kind?: MessageKind;
  lane?: MessageLane;
  body: string;
  taskRef?: TaskRef;
  scope?: MessageScope;
  attachments?: Attachment[];
  secret?: { label: string; login: string; password: string };
  workTimer?: boolean;
}

export interface RegisterAgentInput {
  id?: string;
  swarmId: string;
  name: string;
  handle: string;
  role?: string;
  os?: OsKind;
  machine?: string;
  capabilities?: string[];
  magProjectId?: string;
}

export interface EtherAgent {
  id: string;
  handle: string;
  name: string;
  os?: OsKind;
  presence: Presence;
  region?: string;
  swarmName: string;
  ownerName: string;
  lastSeenAt: number;
  remote?: boolean;
  hubUrl?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  swarmId: string;
  swarmName: string;
}
