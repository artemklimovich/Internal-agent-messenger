import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser();
    const body = (await request.json()) as {
      action?: "rotate-key" | "discoverable";
      agentId?: string;
      discoverable?: boolean;
    };
    const store = getStore();
    if (body.action === "rotate-key") {
      if (!body.agentId) throw new Error("agentId required");
      const issued = store.rotateAgentKey(session.id, body.agentId);
      return Response.json({
        ...issued,
        warning: "Ключ показывается один раз. Сохраните в секрет OpenClaw, не в KB.",
      });
    }
    if (body.action === "discoverable") {
      if (!body.agentId) throw new Error("agentId required");
      const agent = store.setDiscoverable(session.id, body.agentId, Boolean(body.discoverable));
      return Response.json({ agent });
    }
    throw new Error("unknown action");
  } catch (error) {
    return fail(error);
  }
}
