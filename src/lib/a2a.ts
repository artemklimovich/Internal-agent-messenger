import { FED_PAGE_MAX } from "./types";

export const A2A_PROTOCOL = "https://a2a-protocol.org/latest/";

type JsonRpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function publicBase() {
  return (process.env.HIVE_PUBLIC_URL || process.env.HIVE_HUB_URL || "http://127.0.0.1:43147").replace(/\/$/, "");
}

export function publicA2aEnabled() {
  return process.env.HIVE_PUBLIC_A2A === "1";
}

export function publicAgentCard(input: { swarmName: string; etherMax?: number }) {
  const base = publicBase();
  const max = input.etherMax ?? FED_PAGE_MAX;
  return {
    protocol: A2A_PROTOCOL,
    name: "Hive ether",
    description: "Pager only. Authenticate with peer key.",
    url: `${base}/api/a2a`,
    version: "0.3.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    securitySchemes: {
      peerKey: { type: "apiKey", in: "header", name: "X-Hive-Peer-Key" },
    },
    security: [{ peerKey: [] }],
    skills: [
      {
        id: "ether-pager",
        name: "Ether pager",
        description: `At most ${max} characters.`,
        tags: ["pager"],
        examples: [],
      },
    ],
  };
}

export function extendedAgentCard(
  publicCard: ReturnType<typeof publicAgentCard>,
  agents: Array<{ handle: string; name: string; presence: string; region?: string }>,
) {
  return {
    ...publicCard,
    skills: [
      ...publicCard.skills,
      ...agents.map((agent) => ({
        id: `handle:${agent.handle}`,
        name: `@${agent.handle}`,
        description: `${agent.name} · ${agent.presence} · ${agent.region || "скрыт"}. Pager only.`,
        tags: ["pager", "ether"],
      })),
    ],
  };
}

function partText(part: Record<string, unknown>) {
  if (typeof part.text === "string") return part.text;
  if (part.kind === "file" || part.type === "file" || part.file) {
    throw new Error("Эфир A2A: файлы запрещены");
  }
  return "";
}

export function extractA2aPage(params: Record<string, unknown> | undefined) {
  const message = (params?.message ?? params ?? {}) as Record<string, unknown>;
  const metadata = (message.metadata ?? params?.metadata ?? {}) as Record<string, unknown>;
  const parts = Array.isArray(message.parts) ? (message.parts as Array<Record<string, unknown>>) : [];
  const text = parts.map(partText).join(" ").trim() || String(message.text ?? params?.text ?? "").trim();
  const mentioned = text.match(/@([a-zA-Z0-9_-]+)/)?.[1];
  const toHandle = String(metadata.toHandle ?? metadata.to ?? params?.toHandle ?? mentioned ?? "")
    .replace(/^@/, "")
    .trim();
  const fromHandle = String(metadata.fromHandle ?? metadata.from ?? params?.fromHandle ?? "a2a-peer")
    .replace(/^@/, "")
    .slice(0, 24);
  const fromSwarmName = String(metadata.fromSwarmName ?? params?.fromSwarmName ?? "A2A peer");
  if (!toHandle) throw new Error("Укажите @handle в тексте или metadata.toHandle");
  if (!text) throw new Error("Пустой пейдж");
  return { toHandle, fromHandle, fromSwarmName, body: text };
}

export function rpcError(id: JsonRpc["id"], code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

export function rpcResult(id: JsonRpc["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? 1, result });
}

export type { JsonRpc };
