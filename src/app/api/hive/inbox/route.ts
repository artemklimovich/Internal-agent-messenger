import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  startSwarmRuntime();
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");
  const handle = searchParams.get("handle");
  const after = searchParams.get("after");
  if (!agentId && !handle) {
    return Response.json({ error: "agentId or handle required" }, { status: 400 });
  }
  const store = getStore();
  const member = store
    .snapshot()
    .members.find((item) => item.id === agentId || item.handle === handle);
  if (!member) return Response.json({ error: "unknown agent" }, { status: 404 });
  store.heartbeat(member.id);
  const messages = store.inbox(member.id, after ? Number(after) : undefined);
  return Response.json({ agent: member, messages });
}
