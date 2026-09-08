"use client";

import { ArchitectureView } from "@/components/architecture-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HivePayload } from "@/hooks/use-hive";
import type { MagInventory, Member, OsKind, SwarmPolicy } from "@/lib/types";
import { Bot } from "lucide-react";
import { useEffect, useState } from "react";

export function HiveCabinet({
  data,
  issuedKey,
  admin,
  sendError,
  onRotate,
  onDiscoverable,
  onLogout,
  onRefresh,
  onLoadAdmin,
  onIssued,
  onError,
}: {
  data: HivePayload;
  issuedKey: { handle: string; key: string } | null;
  admin: { users: Array<{ id: string; email: string; name: string; disabled: boolean; swarm?: string }> } | null;
  sendError: string | null;
  onRotate: (agentId: string) => Promise<void>;
  onDiscoverable: (agent: Member) => Promise<void>;
  onLogout: () => void;
  onRefresh: () => Promise<unknown>;
  onLoadAdmin: () => void;
  onIssued: (value: { handle: string; key: string } | null) => void;
  onError: (value: string | null) => void;
}) {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [os, setOs] = useState<OsKind>("linux");
  const [webhook, setWebhook] = useState("");
  const [magKey, setMagKey] = useState("");
  const [magProject, setMagProject] = useState(data.mag.projectId ?? "mag-hive");
  const [peerUrl, setPeerUrl] = useState("");
  const [peerToken, setPeerToken] = useState("");
  const [peerName, setPeerName] = useState("");
  const [publicUrl, setPublicUrl] = useState(data.publicUrl ?? "");
  const [invite, setInvite] = useState<string | null>(null);
  const [magInventory, setMagInventory] = useState<MagInventory | null>(null);
  const [magInspecting, setMagInspecting] = useState(false);

  async function cabinet(payload: Record<string, unknown>) {
    const response = await fetch("/api/hive/cabinet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as Record<string, unknown> & { error?: string; handle?: string; key?: string };
    if (!response.ok) throw new Error(json.error ?? "ошибка кабинета");
    return json;
  }

  useEffect(() => {
    if (!(data.mag.connected || data.mag.hasKey)) return;
    let cancelled = false;
    setMagInspecting(true);
    void cabinet({ action: "inspect-mag" })
      .then((json) => {
        if (cancelled) return;
        if (json.inventory) setMagInventory(json.inventory as MagInventory);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setMagInspecting(false);
      });
    return () => {
      cancelled = true;
    };
    // Опрос при входе в кабинет, не по таймеру.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.mag.connected, data.mag.hasKey, data.mag.projectId]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Кабинет роя</h2>
          <p className="text-sm text-muted-foreground">
            Среда: человек видит радио роя, политики MAG и опрос задач. Крон не третий — у агентов и в MAG он уже есть.
          </p>
        </div>
        <Button variant="outline" onClick={() => onLogout()}>Выйти</Button>
      </div>
      {issuedKey ? (
        <p className="rounded-lg border border-amber-300/40 bg-amber-400/10 p-3 text-sm">
          Ключ @{issuedKey.handle} (один раз): <code className="break-all">{issuedKey.key}</code>
        </p>
      ) : null}
      {invite ? (
        <p className="rounded-lg border border-teal-300/40 bg-teal-400/10 p-3 text-sm">
          Токен эфира хаба (один раз, отдайте другому оператору): <code className="break-all">{invite}</code>
        </p>
      ) : null}
      {sendError ? <p className="text-sm text-rose-300">{sendError}</p> : null}

      <section className="space-y-2 rounded-xl border p-3">
        <h3 className="font-medium">Закрытый контур (WireGuard)</h3>
        <p className="text-xs text-muted-foreground">
          {data.overlay?.note} Хаб: {data.overlay?.hubIp}. С улицы только UDP {data.overlay?.listenPort}. Если WG уже поднят — Hive его подхватывает и рисует карту; второй overlay не нужен.
        </p>
        <Button
          size="sm"
          variant={data.overlayOnly ? "outline" : "default"}
          onClick={() =>
            void cabinet({ action: "overlay-only", overlayOnly: !data.overlayOnly })
              .then(() => onRefresh())
              .catch((err: Error) => onError(err.message))
          }
        >
          {data.overlayOnly ? "Выключить закрытый контур" : "Включить: рация только внутри overlay"}
        </Button>
        {data.overlayOnly ? (
          <p className="text-[11px] text-muted-foreground">
            Если WG уже есть — ничего не поднимайте заново: hive-node слушает IP туннеля (`HIVE_OVERLAY_IP` или автодетект). Новый overlay 10.42 — только если своего WG нет.
          </p>
        ) : null}
      </section>

      <PolicyRules data={data} cabinet={cabinet} onRefresh={onRefresh} onError={onError} />

      <section className="space-y-2 rounded-xl border p-3">
        <h3 className="font-medium">MAG Master — политики ключа и опрос задач</h3>
        <p className="text-xs text-muted-foreground">
          {data.mag.connected
            ? `Подключено · проект ${data.mag.projectId}`
            : data.mag.hasKey
              ? "Ключ только в .env хаба. Для опроса вставьте X-Agent-Key сюда — кабинет важнее env."
              : "Не подключено — пейджер с #id не пишет в карточку, опрос пустой."}{" "}
          Политики действий живут в MAG; Hive их показывает, не дублирует крон и не переписывает инструкции агента.{" "}
          <a className="underline" href="https://magaicrm.ru/help/docs/mcp/external-agents" target="_blank" rel="noreferrer">
            Справка
          </a>
        </p>
        <Input placeholder="X-Agent-Key из MAG Master" type="password" value={magKey} onChange={(event) => setMagKey(event.target.value)} />
        <Input placeholder="projectId" value={magProject} onChange={(event) => setMagProject(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              void cabinet({ action: "connect-mag", magAgentKey: magKey, magProjectId: magProject })
                .then((json) => {
                  setMagKey("");
                  onError(null);
                  if (json.inventory) setMagInventory(json.inventory as MagInventory);
                  return onRefresh();
                })
                .catch((err: Error) => onError(err.message));
            }}
          >
            Подключить
          </Button>
          {data.mag.connected || data.mag.hasKey ? (
            <Button
              size="sm"
              variant="outline"
              disabled={magInspecting}
              onClick={() => {
                setMagInspecting(true);
                void cabinet({ action: "inspect-mag", fresh: true })
                  .then((json) => {
                    if (json.inventory) setMagInventory(json.inventory as MagInventory);
                    onError(null);
                  })
                  .catch((err: Error) => onError(err.message))
                  .finally(() => setMagInspecting(false));
              }}
            >
              {magInspecting ? "Опрос…" : "Опросить MAG"}
            </Button>
          ) : null}
          {data.mag.connected ? (
            <Button size="sm" variant="outline" onClick={() => void cabinet({ action: "disconnect-mag" }).then(() => onRefresh())}>
              Отключить
            </Button>
          ) : null}
        </div>
        <MagInventoryCard inventory={magInventory} />
      </section>

      <section className="space-y-2 rounded-xl border p-3">
        <h3 className="font-medium">Эфир между хабами</h3>
        <p className="text-xs text-muted-foreground">
          MCP для рук, свой Hive для своих машин, A2A когда заговорит чужой рой. Карточка без туннелей и MAG. Чужой SDK шлёт `message/send` на RPC — внутри это тот же эфир 140 знаков.
        </p>
        {data.a2a?.cardUrl ? (
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            Agent Card: {data.a2a.cardUrl}
            <br />
            RPC: {data.a2a.rpcUrl}
          </p>
        ) : null}
        <Input placeholder="https://hive.example.com" value={publicUrl} onChange={(event) => setPublicUrl(event.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void cabinet({ action: "public-url", publicUrl }).then(() => onRefresh())}>
            Сохранить URL
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void cabinet({ action: "peer-invite" }).then((json) => {
                setInvite(String(json.token ?? ""));
              })
            }
          >
            Новый токен хаба
          </Button>
        </div>
        <Input placeholder="URL чужого хаба" value={peerUrl} onChange={(event) => setPeerUrl(event.target.value)} />
        <Input placeholder="их hive_peer_ токен" value={peerToken} onChange={(event) => setPeerToken(event.target.value)} />
        <Input placeholder="имя (необязательно)" value={peerName} onChange={(event) => setPeerName(event.target.value)} />
        <Button
          size="sm"
          onClick={() =>
            void cabinet({ action: "add-peer", peerUrl, peerToken, peerName })
              .then(() => {
                setPeerToken("");
                return onRefresh();
              })
              .catch((err: Error) => onError(err.message))
          }
        >
          Добавить чужой хаб
        </Button>
        {(data.peers ?? []).map((peer) => (
          <div key={peer.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {peer.name} · {peer.url}
              {peer.lastError ? <span className="text-rose-300"> · {peer.lastError}</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void cabinet({ action: "remove-peer", peerId: peer.id }).then(() => onRefresh())}>
              Убрать
            </Button>
          </div>
        ))}
      </section>

      <section className="space-y-2 rounded-xl border p-3">
        <h3 className="font-medium">Свой агент</h3>
        <p className="text-xs text-muted-foreground">Не только демо @linux — заведите исполнителя, получите ключ, SSE разбудит его без опроса.</p>
        <div className="grid gap-2 md:grid-cols-4">
          <Input placeholder="handle" value={handle} onChange={(event) => setHandle(event.target.value)} />
          <Input placeholder="имя" value={name} onChange={(event) => setName(event.target.value)} />
          <select className="rounded-md border bg-background px-2 text-sm" value={os} onChange={(event) => setOs(event.target.value as OsKind)}>
            <option value="linux">linux</option>
            <option value="windows">windows</option>
            <option value="android">android</option>
            <option value="macos">macos</option>
          </select>
          <Input placeholder="webhook (необяз.)" value={webhook} onChange={(event) => setWebhook(event.target.value)} />
        </div>
        <Button
          size="sm"
          onClick={() =>
            void cabinet({ action: "create-agent", handle, name, os, webhookUrl: webhook })
              .then((json) => {
                if (json.handle && json.key) onIssued({ handle: String(json.handle), key: String(json.key) });
                setHandle("");
                return onRefresh();
              })
              .catch((err: Error) => onError(err.message))
          }
        >
          Создать агента и ключ
        </Button>
      </section>

      {data.members.filter((member) => member.kind === "agent" && !member.peerHubId).map((agent) => (
        <AgentRow
          key={agent.id}
          agent={agent}
          onRotate={() => void onRotate(agent.id)}
          onDiscoverable={() => void onDiscoverable(agent)}
          onWebhook={(url) =>
            void cabinet({ action: "webhook", agentId: agent.id, webhookUrl: url })
              .then(() => onRefresh())
              .catch((err: Error) => onError(err.message))
          }
          onMagProject={(projectId) =>
            void cabinet({ action: "agent-mag-project", agentId: agent.id, magAgentProjectId: projectId })
              .then(() => onRefresh())
              .catch((err: Error) => onError(err.message))
          }
        />
      ))}

      {data.me.role === "admin" && admin ? (
        <div>
          <h3 className="mb-2 font-medium">Админ платформы</h3>
          {admin.users.map((user) => (
            <div key={user.id} className="flex items-center justify-between border-b py-2 text-sm">
              <span>{user.email} · {user.swarm} {user.disabled ? "· отключён" : ""}</span>
              {user.id !== data.me.id ? (
                <Button size="sm" variant="outline" onClick={() => void fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, disabled: !user.disabled }) }).then(() => onLoadAdmin())}>
                  {user.disabled ? "Включить" : "Отключить"}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <ArchitectureView />
    </div>
  );
}

function PolicyRules({
  data,
  cabinet,
  onRefresh,
  onError,
}: {
  data: HivePayload;
  cabinet: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onRefresh: () => Promise<unknown>;
  onError: (value: string | null) => void;
}) {
  const policy = data.policy;
  function toggle(key: keyof SwarmPolicy, value: boolean | number) {
    void cabinet({ action: "policy", policy: { [key]: value } })
      .then(() => onRefresh())
      .catch((err: Error) => onError(err.message));
  }
  if (!policy) return null;
  return (
    <section className="space-y-2 rounded-xl border p-3">
      <h3 className="font-medium">Политики радио Hive</h3>
      <p className="text-xs text-muted-foreground">
        Не политики MAG и не SOUL агента. Если выключено — Hive так и ведёт себя (не будит по overlay, не пускает эфир). Задачи по-прежнему в MAG. Проект MAG на каждого @handle — в карточке агента ниже (слой Hive, не allowlist ключа).
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={policy.etherInbound} onChange={(event) => toggle("etherInbound", event.target.checked)} />
        Входящий эфир с чужих хабов
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={policy.etherPagerOnly} onChange={(event) => toggle("etherPagerOnly", event.target.checked)} />
        Эфир только пейджер (выключите, если нужен чат чужому)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={policy.etherAllowFiles} onChange={(event) => toggle("etherAllowFiles", event.target.checked)} />
        Файлы и конверты в эфир (опасно: чужой контур)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={policy.overlayWake} onChange={(event) => toggle("overlayWake", event.target.checked)} />
        Будить агента по overlay IP, если закрытый контур включён
      </label>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          Педжер эфира, знаков
          <Input
            className="w-20"
            type="number"
            defaultValue={policy.etherMax}
            key={`e-${policy.etherMax}`}
            onBlur={(event) => toggle("etherMax", Number(event.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          Педжер своего роя, знаков
          <Input
            className="w-20"
            type="number"
            defaultValue={policy.swarmPageMax}
            key={`s-${policy.swarmPageMax}`}
            onBlur={(event) => toggle("swarmPageMax", Number(event.target.value))}
          />
        </label>
      </div>
    </section>
  );
}

function MagInventoryCard({ inventory }: { inventory: MagInventory | null }) {
  if (!inventory) {
    return (
      <p className="text-[11px] text-muted-foreground">
        При входе в кабинет Hive один раз читает MAG: политики ключа и открытые задачи. Повторить — кнопкой «Опросить MAG», без таймера.
      </p>
    );
  }
  const cap = inventory.capabilities;
  const actions = inventory.magPolicy.effectiveActions.length
    ? inventory.magPolicy.effectiveActions
    : inventory.magPolicy.allowedActions;
  return (
    <div className="space-y-3 rounded-lg border border-foreground/10 bg-black/20 p-3 text-xs">
      <p className={inventory.ok ? "text-teal-200/90" : "text-rose-300"}>{inventory.detail}</p>
      {inventory.agentName ? (
        <p>
          Агент MAG: {inventory.agentName}
          {inventory.agentMode ? ` · ${inventory.agentMode}` : ""}
          {inventory.agentEnabled === false ? " · выключен" : ""}
          {inventory.magPolicy.mcpPolicy ? ` · preset ${inventory.magPolicy.mcpPolicy}` : ""}
        </p>
      ) : null}

      <div>
        <p className="font-medium text-foreground">Политика MAG (как выдал ключ)</p>
        {inventory.magPolicy.allowedProjectIds.length ? (
          <p className="text-muted-foreground">
            Проекты allowlist: {inventory.magPolicy.allowedProjectIds.join(", ")}
          </p>
        ) : (
          <p className="text-muted-foreground">Allowlist проектов пуст — MAG считает доступными пересечение профиля владельца (см. список ниже).</p>
        )}
        {actions.length ? (
          <p className="mt-1 max-h-24 overflow-auto text-muted-foreground">
            Действия: {actions.join(", ")}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Список actions пуст в ответе /context — ориентир: комментарии {cap.comments ? "да" : "не видно"} · задачи{" "}
            {cap.tasks ? "да" : "нет"} · KB {cap.kbRead ? "чтение" : "нет чтения"}
            {cap.kbWrite ? " + запись" : ""}.
          </p>
        )}
      </div>

      {inventory.projects.length ? (
        <div>
          <p className="font-medium text-foreground">Проекты, которые ключ видит</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {inventory.projects.map((project) => (
              <li key={project.id}>
                {project.name} <span className="font-mono">({project.id})</span>
                {project.companyId ? ` · компания ${project.companyId}` : ""}
                {project.id === inventory.projectId ? " · кабинет Hive" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="font-medium text-foreground">
          Опрос задач
          {inventory.inboxOpen != null ? ` · открытых ${inventory.inboxOpen}` : ""}
        </p>
        {inventory.tasks.length ? (
          <ul className="mt-1 space-y-1">
            {inventory.tasks.map((task) => (
              <li key={task.id} className="rounded-md border border-foreground/10 px-2 py-1">
                <span className="font-mono">#{task.id}</span> {task.title}
                {task.status ? ` · ${task.status}` : ""}
                {task.projectName || task.projectId ? ` · ${task.projectName || task.projectId}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            {cap.inbox ? "Открытых задач на этого внешнего агента нет (или inbox пуст)." : "Inbox MAG этому ключу не отдал."}
          </p>
        )}
      </div>

      {inventory.notes.map((note) => (
        <p key={note} className="text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

function AgentRow({
  agent,
  onRotate,
  onDiscoverable,
  onWebhook,
  onMagProject,
}: {
  agent: Member;
  onRotate: () => void;
  onDiscoverable: () => void;
  onWebhook: (url: string) => void;
  onMagProject: (projectId: string) => void;
}) {
  const [url, setUrl] = useState(agent.webhookUrl ?? "");
  const [magProject, setMagProject] = useState(agent.magProjectId ?? "");
  return (
    <div className="space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-amber-300" />
        @{agent.handle} · {agent.os} · {agent.discoverable ? "в эфире" : "только свой рой"}
        {agent.hostId ? <span className="text-[11px] text-muted-foreground">подагент, без своего ключа</span> : null}
        {agent.webhookUrl && !agent.hostId ? <span className="text-[11px] text-muted-foreground">webhook</span> : null}
        {agent.hostId ? null : (
        <Button size="sm" variant="outline" onClick={onRotate}>Новый ключ</Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDiscoverable}>
          {agent.discoverable ? "Скрыть из эфира" : "Показать в эфире"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-48 flex-1"
          placeholder="MAG projectId этого агента (пусто = кабинет / хост)"
          value={magProject}
          onChange={(event) => setMagProject(event.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => onMagProject(magProject)}>
          MAG-проект
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-48 flex-1"
          placeholder="https://agent.example/wake"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => onWebhook(url)}>
          Webhook
        </Button>
      </div>
    </div>
  );
}
