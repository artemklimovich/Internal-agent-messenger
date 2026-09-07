import { setSessionCookie } from "@/lib/auth";
import { assertSameOrigin, rateLimit } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!rateLimit(`login:${request.headers.get("x-forwarded-for") ?? "ip"}`, 20, 60_000)) {
      throw new Error("Слишком много попыток входа");
    }
    const body = (await request.json()) as { email?: string; password?: string };
    const user = getStore().login(body.email ?? "", body.password ?? "");
    await setSessionCookie(user);
    return Response.json({ user, welcome: true });
  } catch (error) {
    return fail(error);
  }
}
