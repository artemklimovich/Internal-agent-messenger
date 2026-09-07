import { magConfig } from "./mag-master";
import { getStore } from "./store";
import { nextOverlayIp, nextReversePort, sshReverseCommand, wgKeyPair, wireguardPeerConfig } from "./tunnels";
import type { MessageKind, OsKind, SendMessageInput, Tunnel } from "./types";

export const HIVE_TOOLS = [
  {
    name: "hive_roster",
    description:
      "Список людей и агентов MAG Hive: presence, машина, overlay IP, текущая задача.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_send",
    description:
      "Короткое сообщение в рой. kind: task_assigned | progress | blocked | done | free | chat.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "handle отправителя без @" },
        to: { type: "string", description: "handle получателя" },
        roomId: { type: "string", default: "swarm" },
        kind: {
          type: "string",
          enum: ["task_assigned", "progress", "blocked", "done", "free", "chat"],
        },
        body: { type: "string" },
        magTaskId: { type: "string" },
        title: { type: "string" },
      },
      required: ["from", "body"],
    },
  },
  {
    name: "hive_inbox",
    description: "Входящие для агента: новые поручения и ответы людей.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        after: { type: "number" },
      },
      required: ["handle"],
    },
  },
  {
    name: "hive_presence",
    description: "Обновить статус: free | busy | blocked | offline.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        presence: { type: "string", enum: ["free", "busy", "blocked", "offline"] },
        magTaskId: { type: "string" },
      },
      required: ["handle", "presence"],
    },
  },
  {
    name: "hive_tunnels",
    description: "Реестр туннелей. Агенты читают, где кто живёт и какой путь живой.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_register",
    description: "Зарегистрировать OpenClaw-агента и выдать overlay IP / SSH reverse / WG keys.",
    inputSchema: {
      type: "object",
      properties: {
        handle: { type: "string" },
        name: { type: "string" },
        os: { type: "string", enum: ["linux", "windows", "android", "macos"] },
        machine: { type: "string" },
        role: { type: "string" },
        prefer: { type: "string", enum: ["ssh", "wireguard", "both"] },
      },
      required: ["handle", "name"],
    },
  },
  {
    name: "hive_export_kb",
    description: "Markdown реестра роя для базы знаний MAG Master.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

function memberByHandle(handle: string) {
  const store = getStore();
  const key = handle.replace(/^@/, "").toLowerCase();
  const member = store.snapshot().members.find((m) => m.handle === key || m.id === handle);
  if (!member) throw new Error(`unknown handle ${handle}`);
  return member;
}

export async function callHiveTool(name: string, args: Record<string, unknown>) {
  const store = getStore();
  switch (name) {
    case "hive_roster":
      return {
        mag: magConfig(),
        members: store.snapshot().members,
      };
    case "hive_send": {
      const from = memberByHandle(String(args.from));
      const to = args.to ? memberByHandle(String(args.to)) : undefined;
      const input: SendMessageInput = {
        roomId: String(args.roomId ?? "swarm"),
        fromId: from.id,
        toId: to?.id,
        kind: (args.kind as MessageKind | undefined) ?? "chat",
        body: String(args.body ?? ""),
        taskRef: args.magTaskId
          ? {
              magTaskId: String(args.magTaskId),
              title: String(args.title ?? args.body ?? ""),
            }
          : undefined,
      };
      return store.send(input);
    }
    case "hive_inbox": {
      const member = memberByHandle(String(args.handle));
      const after = typeof args.after === "number" ? args.after : undefined;
      return store.inbox(member.id, after);
    }
    case "hive_presence": {
      const member = memberByHandle(String(args.handle));
      return store.setPresence(
        member.id,
        args.presence as "free" | "busy" | "blocked" | "offline",
        args.magTaskId ? String(args.magTaskId) : undefined,
      );
    }
    case "hive_tunnels": {
      const snap = store.snapshot();
      return snap.tunnels.map((tunnel) => ({
        ...tunnel,
        member: snap.members.find((m) => m.id === tunnel.agentId),
        sshCommand: sshReverseCommand(tunnel),
      }));
    }
    case "hive_register": {
      const member = store.registerAgent({
        handle: String(args.handle),
        name: String(args.name),
        os: args.os as OsKind | undefined,
        machine: args.machine ? String(args.machine) : undefined,
        role: args.role ? String(args.role) : undefined,
      });
      const snap = store.snapshot();
      const keys = wgKeyPair();
      const tunnel: Tunnel = {
        id: `tun-${member.id}`,
        agentId: member.id,
        kind: (args.prefer as Tunnel["kind"]) ?? "both",
        overlayIp: nextOverlayIp(snap.tunnels),
        status: "up",
        ssh: {
          host: member.machine ?? `${member.handle}.local`,
          user: "openclaw",
          reversePort: nextReversePort(snap.tunnels),
          gatewayPort: 18789,
          status: "up",
        },
        wireguard: {
          publicKey: keys.publicKey,
          listenPort: 51820,
          allowedIps: "",
          fallback: args.prefer === "wireguard",
        },
        magSpace: snap.space.name,
        notes: "Зарегистрирован через Hive MCP. Приватный WG-ключ выдан один раз, в реестре его нет.",
      };
      tunnel.wireguard!.allowedIps = `${tunnel.overlayIp}/32`;
      store.upsertTunnel(tunnel);
      return {
        member,
        tunnel,
        sshCommand: sshReverseCommand(tunnel),
        wireguard: {
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          config: wireguardPeerConfig(tunnel, store.snapshot().tunnels, keys.privateKey),
        },
      };
    }
    case "hive_export_kb":
      return { markdown: store.exportKnowledgeBase() };
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
