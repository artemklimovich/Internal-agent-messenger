import { requireUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import { magConfig } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import { sshReverseCommand } from "@/lib/tunnels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    startSwarmRuntime();
    const session = await requireUser();
    const view = getStore().viewer(session.id);
    return Response.json({
      ok: true,
      mag: magConfig(),
      ...view,
      tunnels: view.tunnels.map((tunnel) => ({
        ...tunnel,
        sshCommand: sshReverseCommand(tunnel),
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
