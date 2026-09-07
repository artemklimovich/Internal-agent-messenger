import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { OsKind, Presence } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  startSwarmRuntime();
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    handle?: string;
    role?: string;
    os?: OsKind;
    machine?: string;
    capabilities?: string[];
  };
  if (!body.name || !body.handle) {
    return Response.json({ error: "name and handle required" }, { status: 400 });
  }
  const member = getStore().registerAgent({
    id: body.id,
    name: body.name,
    handle: body.handle,
    role: body.role,
    os: body.os,
    machine: body.machine,
    capabilities: body.capabilities,
  });
  return Response.json({ member });
}

export async function PATCH(request: Request) {
  startSwarmRuntime();
  const body = (await request.json()) as {
    id?: string;
    presence?: Presence;
    currentTaskId?: string;
    heartbeat?: boolean;
  };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  const store = getStore();
  if (body.heartbeat) {
    return Response.json({ member: store.heartbeat(body.id) });
  }
  if (!body.presence) {
    return Response.json({ error: "presence or heartbeat required" }, { status: 400 });
  }
  return Response.json({
    member: store.setPresence(body.id, body.presence, body.currentTaskId),
  });
}
