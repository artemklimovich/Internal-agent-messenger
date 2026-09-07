import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Member, Message } from "@/lib/types";

const KIND_LABEL: Record<Message["kind"], string> = {
  page: "Пейдж",
  task_assigned: "Поставил задачу · жду",
  progress: "В работе",
  blocked: "Проблема",
  done: "Закрыл · свободен",
  free: "Свободен",
  system: "Система",
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
  const time = new Date(message.createdAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <article
      className={cn(
        "rounded-xl border bg-card/80 px-3 py-2.5 shadow-sm",
        message.kind === "task_assigned" && "border-amber-400/50 bg-amber-400/5",
        message.kind === "blocked" && "border-rose-400/40 bg-rose-400/5",
        message.kind === "done" && "border-emerald-400/40 bg-emerald-400/5",
        message.kind === "progress" && "border-sky-400/35 bg-sky-400/5",
        message.scope === "federation" && "border-teal-400/30",
      )}
    >
      <header className="mb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className={from?.kind === "agent" ? "font-medium text-amber-200" : "font-medium text-teal-200"}>
          @{from?.handle ?? "?"}
        </span>
        {to ? <span className="text-muted-foreground">→ @{to.handle}</span> : null}
        <Badge variant="outline">{KIND_LABEL[message.kind]}</Badge>
        {message.scope === "federation" ? <Badge variant="secondary">эфир · без туннеля</Badge> : null}
        {message.taskRef ? <Badge variant="secondary">MAG #{message.taskRef.magTaskId}</Badge> : null}
        <span className="ml-auto text-muted-foreground">
          {time} · до {new Date(message.expiresAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </header>
      <p className="text-sm leading-relaxed">{message.body}</p>
    </article>
  );
}
