import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { probeMagKey } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import type { OsKind } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireUser();
    const body = (await request.json()) as {
      action?: string;
      agentId?: string;
      discoverable?: boolean;
      handle?: string;
      name?: string;
      os?: OsKind;
      role?: string;
      webhookUrl?: string;
      magAgentKey?: string;
      magProjectId?: string;
      magApiUrl?: string;
      magGatewayUrl?: string;
      peerUrl?: string;
      peerToken?: string;
      peerName?: string;
      peerId?: string;
      publicUrl?: string;
    };
    const store = getStore();
    switch (body.action) {
      case "rotate-key":
        if (!body.agentId) throw new Error("agentId required");
        return Response.json({
          ...store.rotateAgentKey(session.id, body.agentId),
          warning: "Ключ показывается один раз. Сохраните в секрет агента, не в KB MAG Master.",
        });
      case "discoverable":
        if (!body.agentId) throw new Error("agentId required");
        return Response.json({
          agent: store.setDiscoverable(session.id, body.agentId, Boolean(body.discoverable)),
        });
      case "create-agent": {
        const created = store.createAgent(session.id, {
          handle: body.handle ?? "",
          name: body.name ?? "",
          os: body.os === "windows" || body.os === "android" || body.os === "macos" ? body.os : "linux",
          role: body.role,
          webhookUrl: body.webhookUrl,
        });
        return Response.json({ ...created.agent, key: created.key });
      }
      case "webhook":
        if (!body.agentId) throw new Error("agentId required");
        return Response.json({ agent: store.setWebhook(session.id, body.agentId, body.webhookUrl ?? "") });
      case "connect-mag": {
        const connected = store.connectMag(session.id, {
          agentKey: body.magAgentKey ?? "",
          projectId: body.magProjectId,
          apiUrl: body.magApiUrl,
          gatewayUrl: body.magGatewayUrl,
        });
        const creds = store.magCredentials(session.swarmId);
        const probe = creds
          ? await probeMagKey(creds)
          : { ok: true, detail: "Ключ сохранён." };
        if (!probe.ok) {
          store.disconnectMag(session.id);
          throw new Error(probe.detail);
        }
        return Response.json({ ...connected, probe: probe.detail });
      }
      case "disconnect-mag":
        return Response.json(store.disconnectMag(session.id));
      case "peer-invite":
        return Response.json(store.rotatePeerInvite(session.id));
      case "add-peer":
        return Response.json(
          store.addPeer(session.id, {
            url: body.peerUrl ?? "",
            token: body.peerToken ?? "",
            name: body.peerName,
          }),
        );
      case "remove-peer":
        if (!body.peerId) throw new Error("peerId required");
        store.removePeer(session.id, body.peerId);
        return Response.json({ ok: true });
      case "public-url":
        return Response.json(store.setPublicUrl(session.id, body.publicUrl ?? ""));
      default:
        throw new Error("unknown action");
    }
  } catch (error) {
    return fail(error);
  }
}
