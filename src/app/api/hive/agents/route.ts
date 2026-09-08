import { getSession } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { assertOverlayClient } from "@/lib/overlay";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { Presence } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    startSwarmRuntime();
    const store = getStore();
    const key = request.headers.get("x-hive-key");
    const body = (await request.json()) as {
      id?: string;
      presence?: Presence;
      currentTaskId?: string;
      heartbeat?: boolean;
      forHandle?: string;
      subagents?: Array<{ handle: string; name?: string }>;
    };
    let memberId = body.id;
    if (key) {
      const agent = store.agentByKey(key);
      if (!agent) throw new Error("unauthorized");
      assertOverlayClient(request, store.swarmById(agent.swarmId));
      memberId = agent.id;
      if (!body.heartbeat && body.forHandle) {
        const handle = body.forHandle.replace(/^@/, "").toLowerCase();
        const child = store.snapshotMembers().find(
          (item) =>
            item.swarmId === agent.swarmId &&
            item.handle === handle &&
            (item.id === agent.id || item.hostId === agent.id),
        );
        if (child) memberId = child.id;
      }
    } else {
      const session = await getSession();
      if (!session) throw new Error("unauthorized");
      const member = store.memberById(memberId ?? "");
      if (!member || member.swarmId !== session.swarmId) throw new Error("forbidden");
    }
    if (!memberId) throw new Error("id required");
    if (body.heartbeat) {
      const member = store.heartbeat(memberId);
      if (key && Array.isArray(body.subagents)) store.syncHostSubagents(memberId, body.subagents);
      return Response.json({ member });
    }
    if (!body.presence) throw new Error("presence or heartbeat required");
    return Response.json({
      member: store.setPresence(memberId, body.presence, body.currentTaskId),
    });
  } catch (error) {
    return fail(error);
  }
}
