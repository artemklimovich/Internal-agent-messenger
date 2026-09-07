import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { magConfig, syncMessageToMag } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { MessageKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    startSwarmRuntime();
    const session = await requireUser();
    const body = (await request.json()) as {
      toId?: string;
      kind?: MessageKind;
      body?: string;
      scope?: "swarm" | "federation";
    };
    if (!body.body?.trim()) throw new Error("Пустой пейдж");
    const message = getStore().sendAsUser(session.id, {
      body: body.body,
      toId: body.toId,
      kind: body.kind,
      scope: body.scope,
    });
    const mag = message.scope === "swarm" ? await syncMessageToMag(message) : { attempted: false, ok: false, detail: "Эфир не пишется в MAG Master." };
    return Response.json({ message, mag, magConfig: magConfig() });
  } catch (error) {
    return fail(error);
  }
}
