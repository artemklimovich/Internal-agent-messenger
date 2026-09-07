import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { exportRegistryToMag, magConfig } from "@/lib/mag-master";
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

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    startSwarmRuntime();
    const session = await requireUser();
    const body = (await request.json()) as { exportToMag?: boolean };
    if (body.exportToMag) {
      const mag = await exportRegistryToMag(session.swarmId);
      return Response.json({
        mag,
        knowledgeBase: getStore().exportKnowledgeBase(session.swarmId),
      });
    }
    throw new Error("только экспорт реестра своего роя");
  } catch (error) {
    return fail(error);
  }
}
