import { requireUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/crypto-security";
import { fail } from "@/lib/http";
import { magConfig, syncMessageToMag } from "@/lib/mag-master";
import { getStore } from "@/lib/store";
import { startSwarmRuntime } from "@/lib/swarm-runtime";
import type { MessageKind, MessageLane } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asLane(value: unknown): MessageLane | undefined {
  return value === "pager" || value === "chat" || value === "full" ? value : undefined;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    startSwarmRuntime();
    const session = await requireUser();
    const store = getStore();
    const contentType = request.headers.get("content-type") ?? "";

    let body = "";
    let toId: string | undefined;
    let kind: MessageKind | undefined;
    let scope: "swarm" | "federation" | undefined;
    let lane: MessageLane | undefined;
    let secret: { label: string; login: string; password: string } | undefined;
    const attachments = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      body = String(form.get("body") ?? "");
      toId = String(form.get("toId") ?? "") || undefined;
      kind = (String(form.get("kind") ?? "") || undefined) as MessageKind | undefined;
      scope = form.get("scope") === "federation" ? "federation" : "swarm";
      lane = asLane(form.get("lane"));
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        const bytes = Buffer.from(await file.arrayBuffer());
        attachments.push(
          store.attachFile(session.id, {
            name: file.name,
            type: file.type,
            bytes,
          }),
        );
        lane = "full";
      }
      const login = String(form.get("secretLogin") ?? "").trim();
      const password = String(form.get("secretPassword") ?? "");
      if (login || password) {
        if (!login || !password) throw new Error("Для конверта нужны логин и пароль");
        secret = {
          label: String(form.get("secretLabel") ?? "конверт"),
          login,
          password,
        };
        lane = "full";
      }
    } else {
      const json = (await request.json()) as {
        toId?: string;
        kind?: MessageKind;
        body?: string;
        scope?: "swarm" | "federation";
        lane?: MessageLane;
        secret?: { label: string; login: string; password: string };
      };
      body = json.body ?? "";
      toId = json.toId;
      kind = json.kind;
      scope = json.scope;
      lane = asLane(json.lane);
      secret = json.secret;
    }

    if (scope === "federation" && (lane === "chat" || lane === "full" || attachments.length || secret)) {
      throw new Error("Чужому агенту только пейджер. Чат, файлы и секреты — в своём рое.");
    }

    if (!body.trim() && !attachments.length && !secret) throw new Error("Пустое сообщение");

    const message = await store.sendAsUser(session.id, {
      body,
      toId,
      kind,
      scope,
      lane,
      attachments,
      secret,
    });
    const mag =
      message.scope === "swarm"
        ? await syncMessageToMag(message)
        : { attempted: false, ok: false, detail: "Эфир не пишется в MAG Master." };
    return Response.json({ message, mag, magConfig: magConfig() });
  } catch (error) {
    return fail(error);
  }
}
