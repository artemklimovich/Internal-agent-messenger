import { fail } from "@/lib/http";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    startSwarmRuntime();
    const token = request.headers.get("x-hive-peer-key") ?? "";
    if (!token) throw new Error("unauthorized");
    const body = (await request.json()) as {
      fromHandle?: string;
      fromSwarmName?: string;
      toHandle?: string;
      body?: string;
      hubUrl?: string;
    };
    if (!body.toHandle || !body.body || !body.fromHandle) throw new Error("Нужны toHandle, fromHandle, body");
    const message = getStore().ingestPeerPage(token, {
      fromHandle: body.fromHandle,
      fromSwarmName: body.fromSwarmName || "чужой хаб",
      toHandle: body.toHandle,
      body: body.body,
      hubUrl: body.hubUrl,
    });
    return Response.json({ ok: true, id: message.id });
  } catch (error) {
    return fail(error);
  }
}
