"use client";

import { ArchitectureView } from "@/components/architecture-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HivePayload } from "@/hooks/use-hive";
import type { Member, OsKind } from "@/lib/types";
import { Bot } from "lucide-react";
import { useState } from "react";

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

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Кабинет роя</h2>
          <p className="text-sm text-muted-foreground">Ключи, MAG Master, чужие хабы. Не вторая CRM.</p>
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
          {data.overlay?.note} Хаб: {data.overlay?.hubUrl}. С улицы только UDP {data.overlay?.listenPort} (
          {data.overlay?.endpoint}). Чужих в туннель не пускаем.
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
            На VPS: <code>HIVE_BIND=10.42.0.1 npm start</code> и <code>wg-quick up</code> из конфига на вкладке «Туннели».
            Агент: <code>HIVE_HUB_URL=http://10.42.0.1:43147</code> + <code>HIVE_OVERLAY=1 ./agents/hive-join.sh</code>
          </p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-xl border p-3">
        <h3 className="font-medium">MAG Master External MCP</h3>
        <p className="text-xs text-muted-foreground">
          {data.mag.connected
            ? `Подключено в кабинете · проект ${data.mag.projectId}`
            : data.mag.hasKey
              ? "Ключ только в .env хаба. Для витрины вставьте X-Agent-Key сюда — кабинет важнее env."
              : "Не подключено — пейджер с #id не пишет в карточку."}{" "}
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
                .then(() => {
                  setMagKey("");
                  onError(null);
                  return onRefresh();
                })
                .catch((err: Error) => onError(err.message));
            }}
          >
            Подключить
          </Button>
          {data.mag.connected ? (
            <Button size="sm" variant="outline" onClick={() => void cabinet({ action: "disconnect-mag" }).then(() => onRefresh())}>
              Отключить
            </Button>
          ) : null}
        </div>
      </section>

      <section className="space-y-2 rounded-xl border p-3">
        <h3 className="font-medium">Эфир между хабами</h3>
        <p className="text-xs text-muted-foreground">
          Публичный URL своего Hive + токен. Чужой оператор добавляет ваш URL и токен. Только пейджер.
        </p>
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

function AgentRow({
  agent,
  onRotate,
  onDiscoverable,
  onWebhook,
}: {
  agent: Member;
  onRotate: () => void;
  onDiscoverable: () => void;
  onWebhook: (url: string) => void;
}) {
  const [url, setUrl] = useState(agent.webhookUrl ?? "");
  return (
    <div className="space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="size-4 text-amber-300" />
        @{agent.handle} · {agent.os} · {agent.discoverable ? "в эфире" : "только свой рой"}
        {agent.webhookUrl ? <span className="text-[11px] text-muted-foreground">webhook</span> : null}
        <Button size="sm" variant="outline" onClick={onRotate}>Новый ключ</Button>
        <Button size="sm" variant="ghost" onClick={onDiscoverable}>
          {agent.discoverable ? "Скрыть из эфира" : "Показать в эфире"}
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
