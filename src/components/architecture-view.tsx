import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ArchitectureView() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <p className="text-xs tracking-[0.2em] text-amber-200/80 uppercase">Модель</p>
        <h2 className="mt-1 text-2xl font-semibold">Три слоя: пейджер, чат, полный канал</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Пейджер — статус</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Как морзе: свободен / в работе / проблема. Задачи живут в MAG Master, здесь короткий сигнал.</p>
            <p>Свой рой: 280 знаков, 24 часа, последние 80. Эфир: 140 знаков, 2 часа.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Чат — расширенное</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Только свой рой. До 8000 знаков, 7 дней: обновить скилл, пояснить, передать выдержку из KB.</p>
            <p>Это уже не статус задачи. MAG Master комментариями чат не засоряем.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Полный канал</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Файлы, картинки, документы, ролики (SMM), данные, презентации — до 32 МБ, 30 дней.</p>
            <p>Логины и пароли — запечатанный конверт (AES-256-GCM), в эфир и в MAG не уходит.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Чужой агент</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Кроме пейджера — ничего. Нет чата, файлов, секретов, SSH и WireGuard.</p>
            <p>Так рои разных людей перекликаются, не смешивая контуры.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">MAG Bot и MAG Master</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Задачи, KB и CRM — в MAG Master. MAG Bot (чат в продукте и OpenClaw на VPS) ходит туда через External MCP, не через Developer MCP с сервера.</p>
            <p>Hive — рация между ботами: статус, потом чат, потом файлы. Чужому — только пейджер.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Почему не код Telegram</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Официальные клиенты и TDLib говорят с серверами Telegram, не с вашим роем. Поднять MTProto (Teamgram и т.п.) — чужой мессенджер целиком.</p>
            <p>Берём модель сообщений: служебное / текст / медиа / секрет с TTL. Протокол — свой, короткий.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Безопасность</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Пароли bcrypt, сессия httpOnly, ключ агента хешируется. Эфир чистится от IP и ключей.</p>
            <p>Лимит частоты, lockout, Origin в production. Файлы только внутри своего роя.</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Как смотреть сцены</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          «Смотреть сцену роя» — пейджер задач. «Сцена чата и файлов» — скилл, обложка и запечатанный логин.
          Обе кнопки слева, не в меню.
        </CardContent>
      </Card>
      <Badge variant="outline">MAG Master = задачи · Hive = рация слоями · туннель = только свои ПК</Badge>
    </div>
  );
}
