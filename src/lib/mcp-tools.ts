import { magConfig } from "./mag-master";
import { getStore } from "./store";
import { sshReverseCommand } from "./tunnels";
import type { MessageKind } from "./types";

export const HIVE_TOOLS = [
  {
    name: "hive_roster",
    description:
      "RU: Свой рой — люди и агенты, туннели только свои. EN: Own swarm roster; tunnels are never exposed to foreign agents.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_send",
    description:
      "RU: Свой рой — lane pager (статус/задача), chat, full. Чужой эфир — только pager, ether:true. EN: Own swarm pager/chat/full; foreign ether is pager-only.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        kind: { type: "string" },
        body: { type: "string" },
        ether: { type: "boolean" },
        lane: { type: "string", enum: ["pager", "chat", "full"] },
      },
      required: ["body"],
    },
  },
  {
    name: "hive_inbox",
    description: "RU: Входящие ко мне. EN: Pages and messages addressed to this agent.",
    inputSchema: { type: "object", properties: { after: { type: "number" } } },
  },
  {
    name: "hive_ether",
    description:
      "RU: Чужие агенты — регион и presence, без overlay/SSH/WG. EN: Discoverable foreign agents: region and presence, no tunnels.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_tunnels",
    description: "RU: Туннели только своего роя. EN: Own-swarm tunnels only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_export_kb",
    description:
      "RU: Markdown реестра роя для базы знаний MAG Master. EN: Swarm registry markdown for the MAG Master knowledge base.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export async function callHiveTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { swarmId: string; memberId: string },
) {
  const store = getStore();
  const own = store.memberById(ctx.memberId);
  if (!own || own.swarmId !== ctx.swarmId) throw new Error("forbidden");
  const viewer = store.viewerForSwarm(ctx.swarmId);

  switch (name) {
    case "hive_roster":
      return {
        mag: magConfig(),
        members: viewer.members.map((member) => ({
          handle: member.handle,
          kind: member.kind,
          presence: member.presence,
          os: member.os,
          task: member.currentTaskId,
        })),
      };
    case "hive_send": {
      const toHandle = args.to ? String(args.to).replace(/^@/, "") : undefined;
      const to =
        toHandle
          ? viewer.members.find((member) => member.handle === toHandle) ??
            store.memberById(viewer.ether.find((item) => item.handle === toHandle)?.id ?? "")
          : undefined;
      const ether = Boolean(args.ether);
      const lane = ether ? "pager" : args.lane === "chat" || args.lane === "full" ? args.lane : "pager";
      if (ether && (args.lane === "chat" || args.lane === "full")) {
        throw new Error("Чужому агенту только пейджер");
      }
      return store.send({
        roomId: ether ? "ether" : `${ctx.swarmId}:pager`,
        swarmId: ctx.swarmId,
        fromId: ctx.memberId,
        toId: to?.id,
        kind: args.kind as MessageKind | undefined,
        lane,
        body: String(args.body ?? ""),
        scope: ether ? "federation" : "swarm",
      });
    }
    case "hive_inbox":
      return store.inbox(ctx.memberId, typeof args.after === "number" ? args.after : undefined);
    case "hive_ether":
      return store.ether(ctx.swarmId);
    case "hive_tunnels":
      return viewer.tunnels.map((tunnel) => ({
        ...tunnel,
        sshCommand: sshReverseCommand(tunnel),
      }));
    case "hive_export_kb":
      return { markdown: store.exportKnowledgeBase(ctx.swarmId) };
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
