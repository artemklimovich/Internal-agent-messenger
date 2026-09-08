import { extendedAgentCard, extractA2aPage, publicA2aEnabled, publicAgentCard, rpcError, rpcResult, type JsonRpc } from "@/lib/a2a";
import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import { FED_PAGE_MAX } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function peerToken(request: Request) {
  return (
    request.headers.get("x-hive-peer-key") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

export async function GET(request: Request) {
  try {
    startSwarmRuntime();
    const store = getStore();
    const token = peerToken(request);
    if (!token && !publicA2aEnabled()) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const card = publicAgentCard({ swarmName: store.publicSwarmName(), etherMax: FED_PAGE_MAX });
    if (!token) return Response.json(card);
    const agents = store.federationEther(token);
    return Response.json(extendedAgentCard(card, agents));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    startSwarmRuntime();
    const rpc = (await request.json()) as JsonRpc;
    const id = rpc.id ?? 1;
    const method = rpc.method || "";
    if (method === "initialize" || method === "agent/getAuthenticatedExtendedCard") {
      const token = peerToken(request);
      if (!token && !publicA2aEnabled()) {
        return rpcError(id, -32001, "unauthorized", 401);
      }
      const store = getStore();
      const card = publicAgentCard({ swarmName: store.publicSwarmName(), etherMax: FED_PAGE_MAX });
      if (!token) return rpcResult(id, card);
      const agents = store.federationEther(token);
      return rpcResult(id, extendedAgentCard(card, agents));
    }
    if (method === "message/stream" || method === "tasks/resubscribe") {
      return rpcError(id, -32601, "unsupported", 200);
    }
    if (method !== "message/send" && method !== "tasks/send") {
      return rpcError(id, -32601, "unsupported", 200);
    }
    const token = peerToken(request);
    if (!token) return rpcError(id, -32001, "unauthorized", 401);
    const page = extractA2aPage(rpc.params);
    const message = getStore().ingestPeerPage(token, {
      ...page,
      hubUrl: request.headers.get("origin") || undefined,
    });
    return rpcResult(id, {
      id: message.id,
      contextId: message.swarmId,
      status: { state: "completed", timestamp: new Date(message.createdAt).toISOString() },
      artifacts: [
        {
          artifactId: message.id,
          parts: [{ kind: "text", text: `paged @ handle, ${message.body.length} chars, hive ether` }],
        },
      ],
      kind: "task",
      metadata: { hive: "ether", lane: "pager", mag: false, overlay: false },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ошибка";
    const code = message === "unauthorized" ? -32001 : -32602;
    return rpcError(1, code, message, message === "unauthorized" ? 401 : 200);
  }
}
