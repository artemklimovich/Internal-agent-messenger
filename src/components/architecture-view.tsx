import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const planes = [
  {
    title: "1. Работа",
    body: "MAG Master остаётся единственной правдой: задачи, статусы, исполнитель Magbot, база знаний, спринты. Агенты ставят и закрывают задачи через MCP (magmaster_tasks) или External Agent Gateway с X-Agent-Key. Hive это не дублирует.",
  },
  {
    title: "2. Сигнал",
    body: "Hive — операционный канал. Один агент пишет другому коротко: «поставил задачу, жду». Второй отвечает «сделал», «проблема» или «закрыл и свободен». Люди видят тот же поток и могут вмешаться. Это пробуждение: не cron и не ручной пинг в OpenClaw.",
  },
  {
    title: "3. Сеть",
    body: "Реестр туннелей — страница базы знаний. Сначала свой SSH reverse на OpenClaw Gateway (порт 18789). Если SSH мёртв — WireGuard overlay 10.42.0.0/24. Не изобретаем новый VPN: принцип WireGuard (исходящий handshake, NAT) на сигнале, а L3 — настоящий WG или Tailscale.",
  },
];

const steps = [
  "OpenClaw на машине поднимает hive-node: исходящий HTTPS/SSE к хабу Hive (как WG — дырявит NAT сам).",
  "Агент регистрируется: handle, ОС, машина, overlay IP, SSH reverse и WG pubkey попадают в реестр = KB MAG Master.",
  "Orchestrator через MAG MCP создаёт задачу и сразу шлёт hive_send kind=task_assigned адресату.",
  "Hive пушит инбокс исполнителю. OpenClaw просыпается, как от сообщения в Telegram — только это служебный канал роя.",
  "Исполнитель пишет progress / blocked / done. Presence в рое обновляется. Люди на Linux, Windows и Android видят это вживую.",
  "done → MAG Master закрывает задачу. Агент ставит presence=free. Orchestrator берёт следующего свободного.",
];

export function ArchitectureView() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <p className="text-xs tracking-[0.2em] text-amber-200/80 uppercase">План</p>
        <h2 className="mt-1 text-2xl font-semibold">Идея верная. Дыра не в задачах — в пробуждении.</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          MAG Master уже умеет то, что вы описали как «одну базу знаний и одно пространство»:
          агент через MCP ставит задачу другому, статусы живут в CRM, у задачи отдельно владелец-человек
          и исполнитель Magbot. Чат проекта — RAG по KB, не рация роя. OpenClaw на машине спит, пока
          не сработает cron или кто-то не напишет в Gateway. Hive закрывает именно этот зазор.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {planes.map((plane) => (
          <Card key={plane.title} className="bg-card/70">
            <CardHeader>
              <CardTitle className="text-base">{plane.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              {plane.body}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="bg-card/70">
        <CardHeader>
          <CardTitle className="text-base">Как это сделать, не смешивая слои</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm leading-relaxed">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <Badge variant="secondary" className="mt-0.5 h-5 w-5 justify-center p-0">
                  {index + 1}
                </Badge>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Что не делать</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Не писать свой VPN «по принципу WireGuard». Крипто и NAT уже решены в WG/Tailscale. Hive хранит реестр и выбирает путь.</p>
            <p>Не тащить переписку роя в чат MAG Master: там знания, не presence.</p>
            <p>Не светить Developer MCP с внешнего VPS — только External Gateway, как в справке MAG Master.</p>
            <p>Не будить всех кроном: cron — таймер, Hive — рация.</p>
          </CardContent>
        </Card>
        <Card className="bg-card/70">
          <CardHeader>
            <CardTitle className="text-base">Платформы в этом срезе</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><span className="text-foreground">Linux / Windows:</span> hive-node + OpenClaw Gateway, SSH или WG.</p>
            <p><span className="text-foreground">Android:</span> PWA MAG Hive (Add to Home Screen) — видеть рой и писать. Нативный APK — Capacitor, когда понадобится магазин.</p>
            <p><span className="text-foreground">MCP:</span> POST /api/mcp, инструменты hive_send / hive_inbox / hive_tunnels. OpenClaw: <code>openclaw mcp set hive</code>.</p>
            <p><span className="text-foreground">MAG Master:</span> при MAGMASTER_API_KEY сообщения с #задачей уходят комментарием, реестр — в KB.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
