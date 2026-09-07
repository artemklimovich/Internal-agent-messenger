import { magConfig } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import { sshReverseCommand } from "@/lib/tunnels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  startSwarmRuntime();
  const store = getStore();
  const state = store.snapshot();
  return Response.json({
    ok: true,
    mag: magConfig(),
    space: state.space,
    members: state.members,
    rooms: state.rooms,
    messages: state.messages,
    tunnels: state.tunnels.map((tunnel) => ({
      ...tunnel,
      sshCommand: sshReverseCommand(tunnel),
    })),
  });
}
