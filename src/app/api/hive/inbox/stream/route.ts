import { fail } from "@/lib/http";
import { assertOverlayClient } from "@/lib/overlay";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { HiveEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    startSwarmRuntime();
    const store = getStore();
    const key = request.headers.get("x-hive-key");
    if (!key) throw new Error("unauthorized");
    const agent = store.agentByKey(key);
    if (!agent) throw new Error("unauthorized");
    assertOverlayClient(request, store.swarmById(agent.swarmId));
    store.heartbeat(agent.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: HiveEvent) => {
          if (event.type === "ping" || event.type === "hello") {
            enqueue(event);
            return;
          }
          if (event.type === "halt" && event.swarmId === agent.swarmId) {
            enqueue(event);
            return;
          }
          if (event.type === "talk" && event.swarmId === agent.swarmId) {
            enqueue(event);
            return;
          }
          if (event.type !== "message" || !event.message) return;
          const inbox = store.inbox(agent.id, event.message.createdAt - 1);
          if (!inbox.some((item) => item.id === event.message?.id)) return;
          enqueue(event);
        };
        const enqueue = (event: HiveEvent) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          } catch {
            cleanup();
          }
        };
        const ping = setInterval(() => send({ type: "ping", at: Date.now() }), 12_000);
        const cleanup = () => {
          clearInterval(ping);
          store.off("event", send);
        };
        store.on("event", send);
        enqueue({
          type: "hello",
          at: Date.now(),
          swarmId: agent.swarmId,
          haltUntil: store.swarmById(agent.swarmId)?.haltUntil,
          talkMode: store.swarmById(agent.swarmId)?.talkMode === "qaq" ? "qaq" : "qa",
        });
        request.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
