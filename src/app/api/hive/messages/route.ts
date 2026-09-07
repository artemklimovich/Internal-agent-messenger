import { magConfig, syncMessageToMag } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { MessageKind, TaskRef } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  startSwarmRuntime();
  const body = (await request.json()) as {
    roomId?: string;
    fromId?: string;
    toId?: string;
    kind?: MessageKind;
    body?: string;
    taskRef?: TaskRef;
  };
  if (!body.fromId || !body.body?.trim()) {
    return Response.json({ error: "fromId and body required" }, { status: 400 });
  }
  const message = getStore().send({
    roomId: body.roomId ?? "swarm",
    fromId: body.fromId,
    toId: body.toId,
    kind: body.kind,
    body: body.body,
    taskRef: body.taskRef,
  });
  const mag = await syncMessageToMag(message);
  return Response.json({ message, mag, magConfig: magConfig() });
}
