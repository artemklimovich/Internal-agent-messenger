import { requireUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import { magConfig } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import { agentWireguardConf } from "@/lib/overlay";
import { sshReverseCommand } from "@/lib/tunnels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    startSwarmRuntime();
    const session = await requireUser();
    const view = getStore().viewer(session.id);
    const overlay = getStore().overlayBundle(session.swarmId);
    return Response.json({
      mag: magConfig(),
      overlay,
      tunnels: view.tunnels.map((tunnel) => ({
        ...tunnel,
        sshCommand: sshReverseCommand(tunnel),
        wgConfig: agentWireguardConf(session.swarmId, tunnel),
      })),
      hubWgConfig: overlay.hubConf,
      knowledgeBase: getStore().exportKnowledgeBase(session.swarmId),
    });
  } catch (error) {
    return fail(error);
  }
}
