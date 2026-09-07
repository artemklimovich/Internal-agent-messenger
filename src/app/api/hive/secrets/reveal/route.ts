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
    const body = (await request.json()) as { secretId?: string };
    if (!body.secretId) throw new Error("secretId required");
    const secret = getStore().revealSecret(session.id, body.secretId);
    return Response.json({ ok: true, secret });
  } catch (error) {
    return fail(error);
  }
}
