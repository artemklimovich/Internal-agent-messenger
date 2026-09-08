import { setSessionCookie } from "@/lib/auth";
import { assertBrowserOrigin, rateLimit, requestIp } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertBrowserOrigin(request);
    const ip = requestIp(request);
    if (!rateLimit(`login:${ip}`, 8, 10 * 60_000)) {
      throw new Error("не вышло");
    }
    const body = (await request.json()) as { email?: string; password?: string; website?: string };
    if (body.website) throw new Error("не вышло");
    const user = getStore().login(body.email ?? "", body.password ?? "");
    await setSessionCookie(user);
    return Response.json({ user, welcome: true });
  } catch (error) {
    return fail(error);
  }
}
