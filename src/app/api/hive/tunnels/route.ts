import { exportRegistryToMag, magConfig } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import {
  nextOverlayIp,
  nextReversePort,
  sshReverseCommand,
  wgKeyPair,
  wireguardPeerConfig,
} from "@/lib/tunnels";
import type { Tunnel } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  startSwarmRuntime();
  const store = getStore();
  const state = store.snapshot();
  return Response.json({
    mag: magConfig(),
    tunnels: state.tunnels.map((tunnel) => ({
      ...tunnel,
      sshCommand: sshReverseCommand(tunnel),
      wgConfig: tunnel.wireguard
        ? wireguardPeerConfig(tunnel, state.tunnels)
        : null,
    })),
    knowledgeBase: store.exportKnowledgeBase(),
  });
}

export async function POST(request: Request) {
  startSwarmRuntime();
  const body = (await request.json()) as {
    agentId?: string;
    kind?: Tunnel["kind"];
    host?: string;
    user?: string;
    endpoint?: string;
    exportToMag?: boolean;
  };

  if (body.exportToMag) {
    const mag = await exportRegistryToMag();
    return Response.json({ mag, knowledgeBase: getStore().exportKnowledgeBase() });
  }

  if (!body.agentId) {
    return Response.json({ error: "agentId required" }, { status: 400 });
  }
  const store = getStore();
  const state = store.snapshot();
  const existing = state.tunnels.find((t) => t.agentId === body.agentId);
  const keys = wgKeyPair();
  const tunnel: Tunnel = {
    id: existing?.id ?? `tun-${body.agentId}`,
    agentId: body.agentId,
    kind: body.kind ?? "both",
    overlayIp: existing?.overlayIp ?? nextOverlayIp(state.tunnels),
    status: "up",
    ssh: {
      host: body.host ?? existing?.ssh?.host ?? "node.local",
      user: body.user ?? existing?.ssh?.user ?? "openclaw",
      reversePort: existing?.ssh?.reversePort ?? nextReversePort(state.tunnels),
      gatewayPort: 18789,
      status: "up",
    },
    wireguard: {
      publicKey: keys.publicKey,
      endpoint: body.endpoint,
      listenPort: 51820,
      allowedIps: "",
      lastHandshakeAt: Date.now(),
      fallback: body.kind === "wireguard",
    },
    magSpace: state.space.name,
    notes: existing?.notes ?? "Обновлено из Hive.",
  };
  tunnel.wireguard!.allowedIps = `${tunnel.overlayIp}/32`;
  store.upsertTunnel(tunnel);
  return Response.json({
    tunnel,
    sshCommand: sshReverseCommand(tunnel),
    wireguardPrivateKey: keys.privateKey,
    wgConfig: wireguardPeerConfig(tunnel, store.snapshot().tunnels, keys.privateKey),
  });
}
