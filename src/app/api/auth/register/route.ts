import { setSessionCookie } from "@/lib/auth";
import { assertSameOrigin, rateLimit } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!rateLimit(`reg:${request.headers.get("x-forwarded-for") ?? "ip"}`, 8, 60_000)) {
      throw new Error("Слишком много регистраций");
    }
    const body = (await request.json()) as { email?: string; password?: string; name?: string };
    const user = getStore().register({
      email: body.email ?? "",
      password: body.password ?? "",
      name: body.name ?? "",
    });
    await setSessionCookie(user);
    return Response.json({ user, welcome: true });
  } catch (error) {
    return fail(error);
  }
}
