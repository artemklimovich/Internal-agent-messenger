import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireUser();
    return Response.json(getStore().adminOverview(session.id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser();
    const body = (await request.json()) as { userId?: string; disabled?: boolean };
    if (!body.userId) throw new Error("userId required");
    return Response.json(getStore().disableUser(session.id, body.userId, Boolean(body.disabled)));
  } catch (error) {
    return fail(error);
  }
}
