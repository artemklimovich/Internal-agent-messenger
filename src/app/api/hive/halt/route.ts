import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    startSwarmRuntime();
    const session = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const store = getStore();
    const swarmId = session.swarmId;
    if (body.action === "resume") return Response.json({ ok: true, ...store.resumeModels(swarmId) });
    return Response.json({ ok: true, ...store.haltModels(swarmId) });
  } catch (error) {
    return fail(error);
  }
}
