import { publicA2aEnabled, publicAgentCard } from "@/lib/a2a";
import { getStore } from "@/lib/store";
import { FED_PAGE_MAX } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!publicA2aEnabled()) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json(publicAgentCard({ swarmName: getStore().publicSwarmName(), etherMax: FED_PAGE_MAX }), {
    headers: { "Cache-Control": "no-store" },
  });
}
