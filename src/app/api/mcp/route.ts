import { getSession } from "@/lib/auth";
import { callHiveTool, HIVE_TOOLS } from "@/lib/mcp-tools";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

async function actor(request: Request) {
  const key = request.headers.get("x-hive-key");
  if (key) {
    const agent = getStore().agentByKey(key);
    if (!agent) throw new Error("unauthorized");
    return { swarmId: agent.swarmId, memberId: agent.id };
  }
  const session = await getSession();
  if (!session) throw new Error("unauthorized");
  return { swarmId: session.swarmId, memberId: session.id };
}

export async function GET() {
  return Response.json({
    name: "mag-hive",
    version: "0.2.0",
    protocol: "MCP JSON-RPC. Нужна сессия или заголовок X-Hive-Key.",
    tools: HIVE_TOOLS,
  });
}

export async function POST(request: Request) {
  startSwarmRuntime();
  const rpc = (await request.json()) as RpcRequest;
  const id = rpc.id ?? 1;
  try {
    const ctx = await actor(request);
    if (rpc.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "mag-hive", version: "0.2.0" },
          capabilities: { tools: {} },
        },
      });
    }
    if (rpc.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id, result: { tools: HIVE_TOOLS } });
    }
    if (rpc.method === "tools/call") {
      const name = rpc.params?.name;
      if (!name) throw new Error("tool name required");
      const result = await callHiveTool(name, rpc.params?.arguments ?? {}, ctx);
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${rpc.method}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool error";
    const code = message === "unauthorized" || message === "forbidden" ? -32001 : -32000;
    return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status: message === "unauthorized" ? 401 : 200 });
  }
}
