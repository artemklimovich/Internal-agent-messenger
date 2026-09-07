export type ActorKind = "human" | "agent";
export type Presence = "free" | "busy" | "blocked" | "offline";
export type OsKind = "linux" | "windows" | "android" | "macos";
export type MessageKind =
  | "chat"
  | "task_assigned"
  | "progress"
  | "blocked"
  | "done"
  | "free"
  | "system";
export type RoomType = "swarm" | "task" | "dm";
export type TunnelKind = "ssh" | "wireguard" | "both" | "none";
export type LinkStatus = "up" | "degraded" | "down";

export interface Member {
  id: string;
  kind: ActorKind;
  name: string;
  handle: string;
  role: string;
  os?: OsKind;
  presence: Presence;
  currentTaskId?: string;
  lastSeenAt: number;
  machine?: string;
  capabilities: string[];
  simulated?: boolean;
  magProjectId?: string;
}

export interface Tunnel {
  id: string;
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
  type: RoomType;
  title: string;
  subtitle?: string;
  taskId?: string;
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
  fromId: string;
  toId?: string;
  kind: MessageKind;
  body: string;
  taskRef?: TaskRef;
  createdAt: number;
}

export interface HiveEvent {
  type:
    | "state"
    | "message"
    | "presence"
    | "tunnel"
    | "demo"
    | "ping"
    | "hello";
  at: number;
  message?: Message;
  member?: Member;
  tunnel?: Tunnel;
}

export interface HiveState {
  space: {
    name: string;
    magProjectId: string;
    magCompany: string;
    magApi: string;
  };
  members: Member[];
  rooms: Room[];
  messages: Message[];
  tunnels: Tunnel[];
}

export interface SendMessageInput {
  roomId: string;
  fromId: string;
  toId?: string;
  kind?: MessageKind;
  body: string;
  taskRef?: TaskRef;
}

export interface RegisterAgentInput {
  id?: string;
  name: string;
  handle: string;
  role?: string;
  os?: OsKind;
  machine?: string;
  capabilities?: string[];
  magProjectId?: string;
}
