"use client";

import { ArchitectureView } from "@/components/architecture-view";
import { MessageCard } from "@/components/message-card";
import { TunnelsView } from "@/components/tunnels-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useHive } from "@/hooks/use-hive";
import { cn } from "@/lib/utils";
import type { MessageKind, Presence } from "@/lib/types";
import {
  BookOpen,
  Bot,
  MessageSquare,
  Network,
  Radio,
  Send,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type View = "chat" | "tunnels" | "plan";

const PRESENCE: Record<Presence, string> = {
  free: "свободен",
  busy: "в работе",
  blocked: "проблема",
  offline: "офлайн",
};

const QUICK: Array<{ kind: MessageKind; label: string; template: string }> = [
  {
    kind: "task_assigned",
    label: "Поставил задачу",
    template: "@linux поставил задачу #243 «Коротко опиши статус роя». Жду исполнения.",
  },
  {
    kind: "blocked",
    label: "Проблема",
    template: "Проблема: не могу достучаться до агента, SSH down, пробую WireGuard.",
  },
  {
    kind: "done",
    label: "Закрыл, свободен",
    template: "Закрыл задачу. Короткий отчёт в MAG Master. Свободен для новой работы.",
  },
  {
    kind: "free",
    label: "Свободен",
    template: "Свободен, могу взять следующую задачу из MAG Master.",
  },
];

export function HiveApp() {
  const { data, error, loading, send, membersById, refresh } = useHive();
  const [view, setView] = useState<View>("chat");
  const [roomId, setRoomId] = useState("swarm");
  const [me, setMe] = useState("human-artem");
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<MessageKind>("chat");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const roomMessages = useMemo(
    () => (data?.messages ?? []).filter((message) => message.roomId === roomId),
    [data, roomId],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMessages.length, roomId]);

  async function onSend() {
    if (!draft.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await send({ roomId, fromId: me, kind, body: draft.trim() });
      setDraft("");
      setKind("chat");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "не отправилось");
    } finally {
      setSending(false);
    }
  }

  async function playDemo() {
    await fetch("/api/hive/demo", { method: "POST" });
    await refresh();
  }

  async function resetDemo() {
    await fetch("/api/hive/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    });
    await refresh();
  }

  async function exportKb() {
    setExporting(true);
    setExportNote(null);
    try {
      const response = await fetch("/api/hive/tunnels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportToMag: true }),
      });
      const json = (await response.json()) as {
        mag?: { detail?: string };
        knowledgeBase?: string;
      };
      setExportNote(
        json.mag?.detail ??
          "Реестр сформирован. Без ключа MAG Master скопируйте markdown в базу знаний вручную.",
      );
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : "экспорт не удался");
    } finally {
      setExporting(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Подключаюсь к рою…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p>Hive не поднялся: {error}</p>
        <Button onClick={() => void refresh()}>Повторить</Button>
      </div>
    );
  }

  if (!data) return null;
  const online = data.members.filter((m) => m.presence !== "offline").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="size-5 text-amber-300" />
          <div>
            <p className="text-sm font-semibold tracking-wide">MAG Hive</p>
            <p className="text-xs text-muted-foreground">{data.space.name}</p>
          </div>
        </div>
        <Badge variant="outline">{online} в сети</Badge>
        <Badge variant={data.mag.hasKey ? "default" : "secondary"}>
          MAG Master {data.mag.hasKey ? "ключ есть" : "локальный режим"}
        </Badge>
        <nav className="ml-auto flex flex-wrap gap-1">
          <NavBtn active={view === "chat"} onClick={() => setView("chat")} icon={MessageSquare}>
            Рой
          </NavBtn>
          <NavBtn active={view === "tunnels"} onClick={() => setView("tunnels")} icon={Network}>
            Туннели
          </NavBtn>
          <NavBtn active={view === "plan"} onClick={() => setView("plan")} icon={BookOpen}>
            План
          </NavBtn>
        </nav>
      </header>

      {view === "plan" ? <ArchitectureView /> : null}
      {view === "tunnels" ? (
        <ScrollArea className="min-h-0 flex-1">
          <TunnelsView
            data={data}
            onExport={() => void exportKb()}
            exporting={exporting}
            exportNote={exportNote}
          />
        </ScrollArea>
      ) : null}

      {view === "chat" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex w-full shrink-0 flex-col overflow-hidden border-b md:w-72 md:min-h-0 md:border-r md:border-b-0">
            <div className="flex gap-2 p-3">
              <Button size="sm" className="flex-1" onClick={() => void playDemo()}>
                Проиграть сцену
              </Button>
              <Button size="sm" variant="outline" onClick={() => void resetDemo()}>
                Сброс
              </Button>
            </div>
            <ScrollArea className="h-40 md:h-auto md:min-h-0 md:flex-1">
              <p className="px-3 pb-1 text-[11px] tracking-wider text-muted-foreground uppercase">
                Каналы
              </p>
              {data.rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setRoomId(room.id)}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent",
                    room.id === roomId && "bg-accent",
                  )}
                >
                  <span>{room.title}</span>
                  {room.subtitle ? (
                    <span className="text-xs text-muted-foreground">{room.subtitle}</span>
                  ) : null}
                </button>
              ))}
              <p className="mt-3 px-3 pb-1 text-[11px] tracking-wider text-muted-foreground uppercase">
                Участники
              </p>
              {data.members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setMe(member.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent",
                    me === member.id && "bg-accent",
                  )}
                >
                  {member.kind === "agent" ? (
                    <Bot className="size-4 text-amber-300" />
                  ) : (
                    <User className="size-4 text-teal-300" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    @{member.handle}
                    <span className="block text-[11px] text-muted-foreground">
                      {PRESENCE[member.presence]}
                      {member.currentTaskId ? ` · #${member.currentTaskId}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      member.presence === "free" && "bg-emerald-400",
                      member.presence === "busy" && "bg-amber-400",
                      member.presence === "blocked" && "bg-rose-400",
                      member.presence === "offline" && "bg-zinc-500",
                    )}
                  />
                </button>
              ))}
            </ScrollArea>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-b px-4 py-2 text-sm">
              <p className="font-medium">{data.rooms.find((r) => r.id === roomId)?.title}</p>
              <p className="text-xs text-muted-foreground">
                Пишете как {membersById.get(me)?.kind === "agent" ? "агент" : "человек"} @
                {membersById.get(me)?.handle}. Команда видит тот же канал.
              </p>
            </div>
            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="space-y-2 p-3 md:p-4">
                {roomMessages.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    В этом канале пока тихо. Поставьте задачу агенту или нажмите «Проиграть сцену».
                  </p>
                ) : (
                  roomMessages.map((message) => (
                    <MessageCard
                      key={message.id}
                      message={message}
                      from={membersById.get(message.fromId)}
                      to={message.toId ? membersById.get(message.toId) : undefined}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
            <div className="border-t p-3">
              <div className="mb-2 flex flex-wrap gap-1">
                {QUICK.map((item) => (
                  <Button
                    key={item.kind}
                    type="button"
                    size="sm"
                    variant={kind === item.kind ? "default" : "outline"}
                    onClick={() => {
                      setKind(item.kind);
                      setDraft(item.template);
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Коротко: поставил задачу / проблема / закрыл и свободен"
                  className="min-h-16 resize-none"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <Button className="self-end" disabled={sending || !draft.trim()} onClick={() => void onSend()}>
                  <Send className="size-4" />
                </Button>
              </div>
              {sendError ? <p className="mt-2 text-xs text-rose-300">{sendError}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      <nav className="flex border-t md:hidden">
        <MobileTab active={view === "chat"} onClick={() => setView("chat")} icon={MessageSquare} label="Рой" />
        <MobileTab active={view === "tunnels"} onClick={() => setView("tunnels")} icon={Network} label="Туннели" />
        <MobileTab active={view === "plan"} onClick={() => setView("plan")} icon={BookOpen} label="План" />
      </nav>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Radio;
  children: string;
}) {
  return (
    <Button size="sm" variant={active ? "default" : "ghost"} onClick={onClick}>
      <Icon className="size-4" />
      {children}
    </Button>
  );
}

function MobileTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Radio;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 py-2 text-[11px]",
        active ? "text-amber-200" : "text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
