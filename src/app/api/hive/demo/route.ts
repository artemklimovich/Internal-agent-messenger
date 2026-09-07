import { getStore } from "@/lib/store";
import { playHandoffDemo, startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  startSwarmRuntime();
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action === "reset") {
    return Response.json({ state: getStore().resetDemo() });
  }
  const demo = await playHandoffDemo();
  return Response.json({ ok: true, demo });
}
