import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const token = request.headers.get("x-hive-peer-key") ?? "";
    if (!token) throw new Error("unauthorized");
    const agents = getStore().federationEther(token);
    return Response.json({ agents });
  } catch (error) {
    return fail(error);
  }
}
