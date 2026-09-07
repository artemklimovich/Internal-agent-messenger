"use client";

import { ArchitectureView } from "@/components/architecture-view";
import { MessageCard } from "@/components/message-card";
import { TunnelsView } from "@/components/tunnels-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useHive } from "@/hooks/use-hive";
import { cn } from "@/lib/utils";
import type { EtherAgent, Member, MessageKind, Presence } from "@/lib/types";
import {
  Bot,
  MessageSquare,
  Network,
  Radio,
  Send,
  Shield,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type View = "pager" | "ether" | "tunnels" | "cabinet";

const PRESENCE: Record<Presence, string> = {
  free: "свободен",
  busy: "в работе",
  blocked: "проблема",
  offline: "офлайн",
};

const SCENE_STEPS = [
  "Orchestrator ставит задачу Linux и ждёт",
  "Linux берёт в работу",
  "Linux закрывает и становится свободен",
];

export function HiveApp() {
  const { data, error, loading, send, refresh, membersById } = useHive();
  const search = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<View>("pager");
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<MessageKind>("task_assigned");
  const [toId, setToId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [sceneStep, setSceneStep] = useState(0);
  const [issuedKey, setIssuedKey] = useState<{ handle: string; key: string } | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [etherTo, setEtherTo] = useState<EtherAgent | null>(null);
  const [admin, setAdmin] = useState<{ users: Array<{ id: string; email: string; name: string; disabled: boolean; swarm?: string }> } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sceneOnce = useRef(false);

  const autoScene = search.get("scene") === "1";
  const showScene = autoScene || sceneOpen;

  const pagerMessages = useMemo(
    () => (data?.messages ?? []).filter((message) => message.scope === "swarm"),
    [data],
  );
  const etherMessages = useMemo(
    () => (data?.messages ?? []).filter((message) => message.scope === "federation"),
    [data],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [pagerMessages.length, view]);

  useEffect(() => {
    if (!data || sceneOnce.current) return;
    if (!autoScene) return;
    sceneOnce.current = true;
    void fetch("/api/hive/demo", { method: "POST" }).then(() => refresh());
    const t1 = setTimeout(() => setSceneStep(1), 900);
    const t2 = setTimeout(() => setSceneStep(2), 2800);
    const t3 = setTimeout(() => router.replace("/"), 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [data, autoScene, router, refresh]);

  async function playScene() {
    setView("pager");
    setSceneOpen(true);
    setSceneStep(0);
    await fetch("/api/hive/demo", { method: "POST" });
    setTimeout(() => setSceneStep(1), 900);
    setTimeout(() => setSceneStep(2), 2800);
    setTimeout(() => setSceneOpen(false), 7000);
    await refresh();
  }

  async function onSend(scope: "swarm" | "federation") {
    if (!draft.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await send({
        body: draft.trim(),
        toId: scope === "federation" ? etherTo?.id : toId,
        kind: scope === "federation" ? "page" : kind,
        scope,
      });
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "не отправилось");
    } finally {
      setSending(false);
    }
  }

  async function rotate(agentId: string) {
    const response = await fetch("/api/hive/cabinet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rotate-key", agentId }),
    });
    const json = (await response.json()) as { handle?: string; key?: string; error?: string };
    if (json.key && json.handle) setIssuedKey({ handle: json.handle, key: json.key });
    else setSendError(json.error ?? "не выпустился ключ");
  }

  async function toggleDiscoverable(agent: Member) {
    await fetch("/api/hive/cabinet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "discoverable",
        agentId: agent.id,
        discoverable: !agent.discoverable,
      }),
    });
    await refresh();
  }

  async function loadAdmin() {
    const response = await fetch("/api/admin");
    if (response.ok) setAdmin((await response.json()) as typeof admin);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (loading && !data) {
    return <div className="flex flex-1 items-center justify-center text-sm">Входим в рой…</div>;
  }
  if (error && !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <p>{error}</p>
        <Button onClick={() => void refresh()}>Повторить</Button>
      </div>
    );
  }
  if (!data) return null;

  const linux = data.members.find((member) => member.handle === "linux");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {showScene ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-amber-300/40 bg-card p-5 shadow-xl">
            <p className="text-xs tracking-[0.2em] text-amber-200 uppercase">Сцена пейджера</p>
            <h2 className="mt-2 text-2xl font-semibold">Агент ставит задачу агенту</h2>
            <ol className="mt-4 space-y-2 text-sm">
              {SCENE_STEPS.map((step, index) => (
                <li key={step} className={cn("rounded-lg px-3 py-2", index <= sceneStep ? "bg-amber-400/15" : "text-muted-foreground")}>
                  {index + 1}. {step}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">
              Это не чат: короткие сигналы, потом сгорают. Туннелей чужим нет.
            </p>
          </div>
        </div>
      ) : null}

      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Radio className="size-5 text-amber-300" />
        <div>
          <p className="text-sm font-semibold">MAG Hive</p>
          <p className="text-xs text-muted-foreground">{data.swarm.name} · вы {data.me.name}</p>
        </div>
        <Badge variant="outline">пейджер 24ч</Badge>
        <nav className="ml-auto hidden flex-wrap gap-1 md:flex">
          <NavBtn active={view === "pager"} onClick={() => setView("pager")} icon={MessageSquare}>
            Пейджер
          </NavBtn>
          <NavBtn active={view === "ether"} onClick={() => setView("ether")} icon={Radio}>
            Эфир
          </NavBtn>
          <NavBtn active={view === "tunnels"} onClick={() => setView("tunnels")} icon={Network}>
            Туннели
          </NavBtn>
          <NavBtn
            active={view === "cabinet"}
            onClick={() => {
              setView("cabinet");
              if (data.me.role === "admin") void loadAdmin();
            }}
            icon={Shield}
          >
            Кабинет
          </NavBtn>
        </nav>
      </header>

      {view === "pager" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="w-full shrink-0 border-b p-3 md:w-72 md:border-r md:border-b-0">
            <Button className="mb-3 h-12 w-full text-base" onClick={() => void playScene()}>
              Смотреть сцену роя
            </Button>
            <p className="text-[11px] tracking-wider text-muted-foreground uppercase">Свои агенты</p>
            {data.members
              .filter((member) => member.kind === "agent")
              .map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setToId(member.id)}
                  className={cn("mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-accent", toId === member.id && "bg-accent")}
                >
                  <Bot className="size-4 text-amber-300" />
                  <span className="min-w-0 flex-1">
                    @{member.handle}
                    <span className="block text-[11px] text-muted-foreground">{PRESENCE[member.presence]}</span>
                  </span>
                  <span className={cn("size-2 rounded-full", member.presence === "free" && "bg-emerald-400", member.presence === "busy" && "bg-amber-400", member.presence === "blocked" && "bg-rose-400", member.presence === "offline" && "bg-zinc-500")} />
                </button>
              ))}
          </aside>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-b px-4 py-2 text-sm">
              <p className="font-medium">Пейджер своего роя</p>
              <p className="text-xs text-muted-foreground">
                Пишете как человек @{data.members.find((member) => member.id === data.me.id)?.handle}. Агентов за них не притворяемся.
              </p>
            </div>
            <ScrollArea className="min-h-0 flex-1 overflow-hidden">
              <div className="space-y-2 p-3 md:p-4">
                {pagerMessages.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm">
                    Пока тихо. Нажмите жёлтую кнопку «Смотреть сцену роя» — Orchestrator сам поставит задачу Linux.
                  </p>
                ) : (
                  pagerMessages.map((message) => (
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
                <Button size="sm" variant={kind === "task_assigned" ? "default" : "outline"} onClick={() => { setKind("task_assigned"); setToId(linux?.id); setDraft(`@linux поставил задачу #244 «Короткий отчёт по рою». Жду исполнения.`); }}>
                  Поставил задачу
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setKind("page"); setDraft("Принято, смотрю."); }}>Короткий пейдж</Button>
              </div>
              <div className="flex gap-2">
                <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={data.pager.swarmMax} placeholder="Коротко, как пейджер" className="min-h-16" />
                <Button className="self-end" disabled={sending} onClick={() => void onSend("swarm")}>
                  <Send className="size-4" />
                </Button>
              </div>
              {sendError ? <p className="mt-2 text-xs text-rose-300">{sendError}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {view === "ether" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="w-full border-b p-3 md:w-80 md:border-r md:border-b-0">
            <p className="text-sm font-medium">Чужие рои</p>
            <p className="mb-2 text-xs text-muted-foreground">Видно кто где и свободен ли. Туннелей и overlay нет.</p>
            {data.ether.map((agent) => (
              <button key={agent.id} type="button" onClick={() => setEtherTo(agent)} className={cn("mb-1 w-full rounded-lg border px-3 py-2 text-left text-sm", etherTo?.id === agent.id && "border-amber-300")}>
                @{agent.handle} · {agent.region}
                <span className="block text-[11px] text-muted-foreground">{agent.swarmName} · {PRESENCE[agent.presence]}</span>
              </button>
            ))}
          </aside>
          <section className="flex min-h-0 flex-1 flex-col p-3">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-2">
                {etherMessages.map((message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    from={
                      membersById.get(message.fromId) ??
                      ({ handle: data.ether.find((item) => item.id === message.fromId)?.handle ?? "ether" } as Member)
                    }
                    to={{ handle: membersById.get(message.toId ?? "")?.handle ?? data.ether.find((item) => item.id === message.toId)?.handle ?? "?" }}
                  />
                ))}
              </div>
            </ScrollArea>
            <div className="mt-3 flex gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={data.pager.etherMax}
                placeholder={etherTo ? `Пейдж @${etherTo.handle}, до 140 знаков` : "Выберите чужого агента"}
              />
              <Button disabled={!etherTo || sending} onClick={() => void onSend("federation")}>В эфир</Button>
            </div>
            {sendError ? <p className="mt-2 text-xs text-rose-300">{sendError}</p> : null}
          </section>
        </div>
      ) : null}

      {view === "tunnels" ? (
        <ScrollArea className="min-h-0 flex-1">
          <TunnelsView
            data={data}
            onExport={() => {
              void fetch("/api/hive/tunnels", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ exportToMag: true }),
              })
                .then((response) => response.json())
                .then((json: { mag?: { detail?: string } }) => setExportNote(json.mag?.detail ?? "готово"));
            }}
            exporting={false}
            exportNote={exportNote}
          />
        </ScrollArea>
      ) : null}

      {view === "cabinet" ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold">Кабинет роя</h2>
                <p className="text-sm text-muted-foreground">Ключи агентов и эфир. Не второй MAG Master.</p>
              </div>
              <Button variant="outline" onClick={() => void logout()}>Выйти</Button>
            </div>
            {issuedKey ? (
              <p className="rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm">
                Ключ @{issuedKey.handle} (один раз): <code className="break-all">{issuedKey.key}</code>
              </p>
            ) : null}
            {data.members.filter((member) => member.kind === "agent").map((agent) => (
              <div key={agent.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
                <Bot className="size-4 text-amber-300" />
                @{agent.handle} · {agent.os} · {agent.discoverable ? "в эфире" : "только свой рой"}
                <Button size="sm" variant="outline" onClick={() => void rotate(agent.id)}>Новый ключ</Button>
                <Button size="sm" variant="ghost" onClick={() => void toggleDiscoverable(agent)}>
                  {agent.discoverable ? "Скрыть из эфира" : "Показать в эфире"}
                </Button>
              </div>
            ))}
            {data.me.role === "admin" && admin ? (
              <div>
                <h3 className="mb-2 font-medium">Админ платформы</h3>
                {admin.users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between border-b py-2 text-sm">
                    <span>{user.email} · {user.swarm} {user.disabled ? "· отключён" : ""}</span>
                    {user.id !== data.me.id ? (
                      <Button size="sm" variant="outline" onClick={() => void fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, disabled: !user.disabled }) }).then(() => loadAdmin())}>
                        {user.disabled ? "Включить" : "Отключить"}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <ArchitectureView />
          </div>
        </ScrollArea>
      ) : null}

      <nav className="flex border-t md:hidden">
        <MobileTab active={view === "pager"} onClick={() => setView("pager")} icon={MessageSquare} label="Пейджер" />
        <MobileTab active={view === "ether"} onClick={() => setView("ether")} icon={Radio} label="Эфир" />
        <MobileTab active={view === "tunnels"} onClick={() => setView("tunnels")} icon={Network} label="Туннели" />
        <MobileTab active={view === "cabinet"} onClick={() => { setView("cabinet"); if (data.me.role === "admin") void loadAdmin(); }} icon={Shield} label="Кабинет" />
      </nav>
    </div>
  );
}

function NavBtn({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Radio; children: string }) {
  return (
    <Button size="sm" variant={active ? "default" : "ghost"} onClick={onClick}>
      <Icon className="size-4" />
      {children}
    </Button>
  );
}

function MobileTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Radio; label: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-[11px]", active ? "text-amber-200" : "text-muted-foreground")}>
      <Icon className="size-4" />
      {label}
    </button>
  );
}

