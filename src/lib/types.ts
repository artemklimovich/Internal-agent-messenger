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
  | "system";
export type RoomType = "swarm" | "ether";
export type TunnelKind = "ssh" | "wireguard" | "both" | "none";
export type LinkStatus = "up" | "degraded" | "down";
export type UserRole = "user" | "admin" | "system";
export type MessageScope = "swarm" | "federation";

export const SCHEMA_VERSION = 2;
export const SWARM_PAGE_TTL_MS = 24 * 60 * 60 * 1000;
export const FED_PAGE_TTL_MS = 2 * 60 * 60 * 1000;
export const SWARM_PAGE_MAX = 280;
export const FED_PAGE_MAX = 140;
export const SWARM_KEEP = 80;

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  disabled?: boolean;
  createdAt: number;
}

export interface Swarm {
  id: string;
  ownerUserId: string;
  name: string;
  magProjectId?: string;
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
  body: string;
  taskRef?: TaskRef;
  createdAt: number;
  expiresAt: number;
}

export interface AgentKey {
  agentId: string;
  keyHash: string;
}

export interface HiveEvent {
  type: "state" | "message" | "presence" | "tunnel" | "demo" | "ping" | "hello";
  at: number;
  message?: Message;
  member?: Member;
  tunnel?: Tunnel;
  swarmId?: string;
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
  loginGuard: Record<string, { fails: number; lockedUntil?: number }>;
}

export interface SendMessageInput {
  roomId: string;
  swarmId: string;
  fromId: string;
  toId?: string;
  kind?: MessageKind;
  body: string;
  taskRef?: TaskRef;
  scope?: MessageScope;
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
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  swarmId: string;
  swarmName: string;
}
