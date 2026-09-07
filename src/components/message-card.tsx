import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Member, Message } from "@/lib/types";
import { useState } from "react";

const KIND_LABEL: Record<Message["kind"], string> = {
  page: "Пейдж",
  task_assigned: "Поставил задачу · жду",
  progress: "В работе",
  blocked: "Проблема",
  done: "Закрыл · свободен",
  free: "Свободен",
  chat: "Чат",
  artifact: "Файл",
  secret: "Конверт",
  system: "Система",
};

const LANE_LABEL: Record<Message["lane"], string> = {
  pager: "пейджер",
  chat: "чат",
  full: "полный",
};

export function MessageCard({
  message,
  from,
  to,
}: {
  message: Message;
  from?: Member;
  to?: { handle: string };
}) {
  const [opened, setOpened] = useState<{ login: string; password: string } | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const time = new Date(message.createdAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  async function reveal() {
    if (!message.secretId) return;
    setRevealError(null);
    const response = await fetch("/api/hive/secrets/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secretId: message.secretId }),
    });
    const json = (await response.json()) as {
      error?: string;
      secret?: { payload: { login: string; password: string } };
    };
    if (!response.ok) {
      setRevealError(json.error ?? "не открылся");
      return;
    }
    setOpened(json.secret?.payload ?? null);
  }

  return (
    <article
      className={cn(
        "rounded-xl border bg-card/80 px-3 py-2.5 shadow-sm",
        message.kind === "task_assigned" && "border-amber-400/50 bg-amber-400/5",
        message.kind === "blocked" && "border-rose-400/40 bg-rose-400/5",
        message.kind === "done" && "border-emerald-400/40 bg-emerald-400/5",
        message.kind === "progress" && "border-sky-400/35 bg-sky-400/5",
        message.lane === "chat" && "border-sky-300/25",
        message.lane === "full" && "border-violet-400/35",
        message.scope === "federation" && "border-teal-400/30",
      )}
    >
      <header className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className={from?.kind === "agent" ? "font-medium text-amber-200" : "font-medium text-teal-200"}>
          @{from?.handle ?? "?"}
        </span>
        {to ? <span className="text-muted-foreground">→ @{to.handle}</span> : null}
        <Badge variant="outline">{KIND_LABEL[message.kind]}</Badge>
        <Badge variant="secondary">{LANE_LABEL[message.lane ?? "pager"]}</Badge>
        {message.scope === "federation" ? <Badge variant="secondary">эфир · только пейджер</Badge> : null}
        {message.taskRef ? <Badge variant="secondary">MAG #{message.taskRef.magTaskId}</Badge> : null}
        <span className="ml-auto text-muted-foreground">
          {time} · до {new Date(message.expiresAt).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
        </span>
      </header>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.body}</p>
      {message.attachments?.length ? (
        <div className="mt-2 space-y-2">
          {message.attachments.map((file) =>
            file.kind === "secret" ? (
              <div key={file.id} className="rounded-lg border border-violet-400/30 bg-violet-400/5 p-2 text-sm">
                <p className="text-xs text-muted-foreground">Запечатано · {file.name}</p>
                {opened ? (
                  <p className="mt-1 font-mono text-xs">
                    {opened.login} / {opened.password}
                  </p>
                ) : (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => void reveal()}>
                    Открыть в своём рое
                  </Button>
                )}
                {revealError ? <p className="mt-1 text-xs text-rose-300">{revealError}</p> : null}
              </div>
            ) : file.kind === "image" ? (
              <a key={file.id} href={`/api/hive/files/${file.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/hive/files/${file.id}`} alt={file.name} className="mt-1 max-h-48 rounded-lg border" />
              </a>
            ) : file.kind === "video" ? (
              <video key={file.id} controls className="mt-1 max-h-56 w-full rounded-lg border" src={`/api/hive/files/${file.id}`} />
            ) : (
              <a
                key={file.id}
                className="block rounded-lg border px-3 py-2 text-sm underline"
                href={`/api/hive/files/${file.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {file.kind === "skill" ? "Скилл" : "Файл"} · {file.name}
              </a>
            ),
          )}
        </div>
      ) : null}
    </article>
  );
}
