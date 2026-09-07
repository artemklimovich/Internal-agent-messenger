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
            Закрытый контур: если WireGuard уже поднят, Hive его подхватывает и рисует карту. Второй overlay 10.42 — только если своего туннеля нет. С улицы только UDP WG. Reverse SSH — запас. Рация и админка машин — один контур.
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
  const hubIp = data.overlay?.hubIp || "10.42.0.1";
  const livePeers = data.overlay?.peers?.length
    ? data.overlay.peers
    : data.tunnels.map((tunnel) => ({
        ip: tunnel.overlayIp,
        status: tunnel.status,
        handle: data.members.find((item) => item.id === tunnel.agentId)?.handle,
      }));
  const nodes = [
    { id: "hub", label: `хаб ${hubIp}`, status: "up" as const, x: 160, y: 120 },
    ...livePeers.map((peer, index) => {
      const n = livePeers.length || 1;
      const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
      const handle = peer.handle || data.members.find((item) => data.tunnels.find((t) => t.overlayIp === peer.ip)?.agentId === item.id)?.handle;
      return {
        id: peer.ip,
        label: `${handle ? `@${handle} ` : ""}${peer.ip}`,
        status: peer.status,
        x: 160 + Math.cos(angle) * 95,
        y: 120 + Math.sin(angle) * 78,
      };
    }),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Карта туннеля {data.overlay?.iface ? `· ${data.overlay.iface}` : ""}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">
          Звезда: хаб видит каждую машину по IP. Hop через 2–3 узла — да, если маршрут и AllowedIPs знают, где она. Не полный mesh агент-агент.
        </p>
        <svg viewBox="0 0 320 240" className="h-56 w-full">
          {nodes
            .filter((node) => node.id !== "hub")
            .map((node) => (
              <line
                key={`hub-${node.id}`}
                x1={160}
                y1={120}
                x2={node.x}
                y2={node.y}
                className={node.status === "down" ? "stroke-rose-400/30" : "stroke-amber-200/40"}
                strokeWidth="1.5"
              />
            ))}
          {nodes.map((node) => (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.id === "hub" ? 16 : 12}
                className={
                  node.status === "up" ? "fill-amber-300" : node.status === "degraded" ? "fill-orange-400" : "fill-zinc-500"
                }
              />
              <text x={node.x} y={node.y + 28} textAnchor="middle" className="fill-current text-[10px]">
                {node.label.replace(/\b10\.\d+\.\d+\./, ".")}
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
            WG {tunnel.status} · handshake {tunnel.wireguard.lastHandshakeAt ? new Date(tunnel.wireguard.lastHandshakeAt).toLocaleTimeString() : "нет"}
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
  const [hint, setHint] = useState<string>("");
  const [adopted, setAdopted] = useState(false);
  const [agents, setAgents] = useState<Array<{ agentId: string; overlayIp: string; conf: string }>>([]);
  useEffect(() => {
    void fetch("/api/hive/tunnels")
      .then((response) => response.json())
      .then((json: {
        hubWgConfig?: string;
        overlay?: { agents?: Array<{ agentId: string; overlayIp: string; conf: string }>; hint?: string; adopted?: boolean; iface?: string; hubIp?: string };
      }) => {
        setHub(json.hubWgConfig ?? "");
        setAgents(json.overlay?.agents ?? []);
        setHint(json.overlay?.hint ?? "");
        setAdopted(Boolean(json.overlay?.adopted));
      })
      .catch(() => undefined);
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{adopted ? "WireGuard уже стоит — Hive его подхватил" : "WireGuard: новый overlay 10.42 только если своего ещё нет"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          {hint || "Пакет ноды проверяет wg: если интерфейс живой — рисуем карту и будим по его IP. Если нет — ставим WG вместе с hive-node."}
        </p>
        {adopted ? null : (
          <>
            {hub ? <pre className="max-h-48 overflow-auto rounded-md bg-black/30 p-2 text-[11px] whitespace-pre-wrap">{hub}</pre> : null}
            {agents.map((item) => (
              <pre key={item.agentId} className="max-h-40 overflow-auto rounded-md bg-black/30 p-2 text-[11px] whitespace-pre-wrap">
                {item.conf}
              </pre>
            ))}
          </>
        )}
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
