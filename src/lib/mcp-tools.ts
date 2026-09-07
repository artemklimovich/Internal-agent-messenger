import { magConfig } from "./mag-master";
import { getStore } from "./store";
import { sshReverseCommand } from "./tunnels";
import type { MessageKind } from "./types";

export const HIVE_TOOLS = [
  {
    name: "hive_roster",
    description: "Свой рой: люди и агенты. Туннели только свои.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_send",
    description: "Пейдж. В свой рой — task_assigned/progress/blocked/done. В эфир — короткий page без туннелей.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        kind: { type: "string" },
        body: { type: "string" },
        ether: { type: "boolean" },
      },
      required: ["body"],
    },
  },
  {
    name: "hive_inbox",
    description: "Входящие пейджи ко мне.",
    inputSchema: { type: "object", properties: { after: { type: "number" } } },
  },
  {
    name: "hive_ether",
    description: "Чужие обнаруживаемые агенты: регион и presence, без overlay/SSH/WG.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_tunnels",
    description: "Туннели только своего роя.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hive_export_kb",
    description: "Markdown реестра своего роя для MAG Master KB.",
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
      return store.send({
        roomId: args.ether ? "ether" : `${ctx.swarmId}:pager`,
        swarmId: ctx.swarmId,
        fromId: ctx.memberId,
        toId: to?.id,
        kind: args.kind as MessageKind | undefined,
        body: String(args.body ?? ""),
        scope: args.ether ? "federation" : "swarm",
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
