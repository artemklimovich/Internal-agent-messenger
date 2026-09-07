"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HivePayload } from "@/hooks/use-hive";
import { recommendedPath } from "@/lib/tunnel-path";
import type { Member, Tunnel } from "@/lib/types";
import { useEffect, useState } from "react";

export function TunnelsView({
  data,
  onExport,
  exporting,
  exportNote,
}: {
  data: HivePayload;
  onExport: () => void;
  exporting: boolean;
  exportNote: string | null;
}) {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-[0.2em] text-amber-200/80 uppercase">Только свой рой</p>
          <h2 className="mt-1 text-2xl font-semibold">Туннели своих машин</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Закрытый контур: HTTP хаба на 10.42.0.1, с улицы только UDP WireGuard. Reverse SSH — запас, если WG ещё не поднят. Overlay — не эфир.
          </p>
        </div>
        <Button onClick={onExport} disabled={exporting}>
          {exporting ? "Экспорт…" : "В KB MAG Master"}
        </Button>
      </div>
      {exportNote ? (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-sm">
          {exportNote}
        </p>
      ) : null}
      <Mesh data={data} />
      <OverlayConfigs />
      <div className="grid gap-3 lg:grid-cols-2">
        {data.tunnels.map((tunnel) => {
          const member = data.members.find((item) => item.id === tunnel.agentId);
          return <TunnelCard key={tunnel.id} tunnel={tunnel} member={member} />;
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Фрагмент для MAG Master KB</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-80 overflow-auto rounded-lg bg-black/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {kbPreview(data)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

function Mesh({ data }: { data: HivePayload }) {
  const nodes = data.tunnels.map((tunnel, index) => {
    const n = data.tunnels.length || 1;
    const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
    return {
      tunnel,
      member: data.members.find((item) => item.id === tunnel.agentId),
      x: 160 + Math.cos(angle) * 95,
      y: 120 + Math.sin(angle) * 78,
    };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Меш роя</CardTitle>
      </CardHeader>
      <CardContent>
        <svg viewBox="0 0 320 240" className="h-56 w-full">
          {nodes.map((from) =>
            nodes.map((to) =>
              from.tunnel.id < to.tunnel.id ? (
                <line
                  key={`${from.tunnel.id}-${to.tunnel.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={
                    from.tunnel.status === "down" || to.tunnel.status === "down"
                      ? "stroke-rose-400/30"
                      : "stroke-amber-200/25"
                  }
                  strokeWidth="1"
                />
              ) : null,
            ),
          )}
          {nodes.map((node) => (
            <g key={node.tunnel.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r="14"
                className={
                  node.tunnel.status === "up"
                    ? "fill-amber-300"
                    : node.tunnel.status === "degraded"
                      ? "fill-orange-400"
                      : "fill-zinc-500"
                }
              />
              <text
                x={node.x}
                y={node.y + 28}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                @{node.member?.handle} · {node.tunnel.overlayIp.replace("10.42.0.", ".")}
              </text>
            </g>
          ))}
        </svg>
      </CardContent>
    </Card>
  );
}

function TunnelCard({ tunnel, member }: { tunnel: Tunnel & { sshCommand?: string | null }; member?: Member }) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            @{member?.handle} · {tunnel.overlayIp}
          </CardTitle>
          <Badge variant={tunnel.status === "up" ? "default" : "outline"}>{tunnel.status}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{recommendedPath(tunnel)}</p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          {member?.os} · {member?.machine ?? "своя машина"} · туннель {tunnel.kind}
        </p>
        {tunnel.ssh ? (
          <p className="text-muted-foreground">
            Reverse {tunnel.ssh.status}: хаб 127.0.0.1:{tunnel.ssh.reversePort} → агент 127.0.0.1:
            {tunnel.ssh.wakePort ?? 18790}/hive/wake. Белый IP агента не нужен.
          </p>
        ) : null}
        {tunnel.wireguard ? (
          <p className="text-muted-foreground">
            WG {tunnel.wireguard.fallback ? "fallback" : "primary"} · {tunnel.wireguard.publicKey.slice(0, 16)}…
          </p>
        ) : null}
        <p>{tunnel.notes}</p>
        {tunnel.sshCommand ? (
          <div>
            <p className="text-[11px] text-muted-foreground">На машине агента (или `agents/hive-join.sh`):</p>
            <pre className="overflow-x-auto rounded-md bg-black/30 p-2 text-[11px]">{tunnel.sshCommand}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OverlayConfigs() {
  const [hub, setHub] = useState<string>("");
  const [agents, setAgents] = useState<Array<{ agentId: string; overlayIp: string; conf: string }>>([]);
  useEffect(() => {
    void fetch("/api/hive/tunnels")
      .then((response) => response.json())
      .then((json: { hubWgConfig?: string; overlay?: { agents?: Array<{ agentId: string; overlayIp: string; conf: string }> } }) => {
        setHub(json.hubWgConfig ?? "");
        setAgents(json.overlay?.agents ?? []);
      })
      .catch(() => undefined);
  }, []);
  if (!hub && agents.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">WireGuard: хаб 10.42.0.1 и агенты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          На хабе: сохранить как /etc/wireguard/hive0.conf → wg-quick up hive0, затем HIVE_BIND=10.42.0.1. Приватные ключи не в эфир и не в MAG KB.
        </p>
        {hub ? <pre className="max-h-48 overflow-auto rounded-md bg-black/30 p-2 text-[11px] whitespace-pre-wrap">{hub}</pre> : null}
        {agents.map((item) => (
          <pre key={item.agentId} className="max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[11px] whitespace-pre-wrap">
            {item.conf}
          </pre>
        ))}
      </CardContent>
    </Card>
  );
}

function kbPreview(data: HivePayload) {
  return [
    `# Реестр своего роя MAG Hive`,
    `Рой: ${data.swarm.name}`,
    ...data.tunnels.map((tunnel) => {
      const member = data.members.find((item) => item.id === tunnel.agentId);
      return `- @${member?.handle} ${tunnel.overlayIp} ${tunnel.kind} ${tunnel.status}`;
    }),
  ].join("\n");
}
