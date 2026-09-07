import { getSession } from "@/lib/auth";
import { fail } from "@/lib/http";
import { assertOverlayClient } from "@/lib/overlay";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    startSwarmRuntime();
    const store = getStore();
    const key = request.headers.get("x-hive-key");
    let agentId = new URL(request.url).searchParams.get("agentId");
    if (key) {
      const agent = store.agentByKey(key);
      if (!agent) throw new Error("unauthorized");
      assertOverlayClient(request, store.swarmById(agent.swarmId));
      agentId = agent.id;
      store.heartbeat(agent.id);
    } else {
      const session = await getSession();
      if (!session) throw new Error("unauthorized");
      if (agentId) {
        const agent = store.memberById(agentId);
        if (!agent || agent.swarmId !== session.swarmId) throw new Error("forbidden");
      } else {
        return Response.json({ error: "agentId required" }, { status: 400 });
      }
    }
    const after = new URL(request.url).searchParams.get("after");
    const messages = store.inbox(agentId!, after ? Number(after) : undefined);
    return Response.json({ agentId, messages });
  } catch (error) {
    return fail(error);
  }
}
