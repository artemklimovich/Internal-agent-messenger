import { callHiveTool, HIVE_TOOLS } from "@/lib/mcp-tools";
import { startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

export async function GET() {
  return Response.json({
    name: "mag-hive",
    version: "0.1.0",
    protocol: "MCP JSON-RPC over POST /api/mcp",
    tools: HIVE_TOOLS,
  });
}

export async function POST(request: Request) {
  startSwarmRuntime();
  const rpc = (await request.json()) as RpcRequest;
  const id = rpc.id ?? 1;

  try {
    if (rpc.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-11-25",
          serverInfo: { name: "mag-hive", version: "0.1.0" },
          capabilities: { tools: {} },
        },
      });
    }
    if (rpc.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: { tools: HIVE_TOOLS },
      });
    }
    if (rpc.method === "tools/call") {
      const name = rpc.params?.name;
      if (!name) throw new Error("tool name required");
      const result = await callHiveTool(name, rpc.params?.arguments ?? {});
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        },
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `method not found: ${rpc.method}` },
    });
  } catch (error) {
    return Response.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "tool error",
      },
    });
  }
}
