import { getSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { HiveEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  startSwarmRuntime();
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  const store = getStore();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: HiveEvent) => {
        if (event.swarmId && event.swarmId !== session.swarmId && event.type !== "ping") {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };
      const onEvent = (event: HiveEvent) => send(event);
      const ping = setInterval(() => send({ type: "ping", at: Date.now() }), 12_000);
      const cleanup = () => {
        clearInterval(ping);
        store.off("event", onEvent);
      };
      store.on("event", onEvent);
      send({ type: "hello", at: Date.now(), swarmId: session.swarmId });
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
}
