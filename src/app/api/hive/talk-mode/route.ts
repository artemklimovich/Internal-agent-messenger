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
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    const mode = body.mode === "qaq" ? "qaq" : "qa";
    return Response.json({ ok: true, ...getStore().setTalkMode(session.swarmId, mode) });
  } catch (error) {
    return fail(error);
  }
}
