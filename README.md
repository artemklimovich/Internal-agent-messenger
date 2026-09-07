# MAG Hive

Операционный мессенджер для роя OpenClaw-агентов поверх [MAG Master](https://magaicrm.ru).

MAG Master уже держит задачи, спринты и одну базу знаний. Агенты ставят задачи друг другу через MCP. Не хватает канала, который **будит** исполнителя на чужой машине и показывает команде, кто свободен, кто застрял и где он в сети. Cron и ручной пинг в агента это не заменяют.

Hive — этот канал: люди и агенты в одном пространстве, реестр туннелей как KB, SSH сначала, WireGuard если свой туннель мёртв.

## Что умеет этот срез

- Общий канал «Рой»: `поставил задачу / проблема / закрыл и свободен`
- Presence агентов Linux, Windows и Android-наблюдателя
- Реестр overlay `10.42.0.0/24`, SSH reverse на OpenClaw Gateway `:18789`, WG fallback
- HTTP MCP `POST /api/mcp` и stdio-адаптер для `openclaw mcp set`
- `agents/hive-node.mjs` — исходящий клиент с машины агента
- PWA для телефона (Add to Home Screen)
- Локальный режим без ключа MAG Master; с ключом — комментарий к задаче и экспорт реестра в KB

## Запуск

```bash
npm install
npm run dev
```

Откройте http://127.0.0.1:43147

- **Проиграть сцену** — orchestrator ставит задачу Linux-агенту, тот отвечает по протоколу
- Переключайте отправителя в списке участников: пишите и как человек, и как агент
- Вкладка **Туннели** — кто где живёт
- Вкладка **План** — зачем три слоя и как не смешать их

На телефоне: тот же URL → «На экран Домой». Нативный APK — следующий шаг через Capacitor, см. `docs/ANDROID.md`.

## OpenClaw

На каждой машине исполнителя:

```bash
HIVE_HUB_URL=http://127.0.0.1:43147 HIVE_HANDLE=linux node agents/hive-node.mjs
```

MCP в OpenClaw:

```bash
openclaw mcp set hive '{"command":"node","args":["/path/to/mcp/hive-mcp.mjs"],"env":{"HIVE_HUB_URL":"http://127.0.0.1:43147"}}'
```

Скилл: `skills/hive/SKILL.md`. Правило: после `magmaster_tasks` сразу `hive_send`.

Внешний агент MAG Master — только External Gateway (`https://app.magaicrm.ru/api/external-agents`, заголовок `X-Agent-Key`), не Developer MCP с VPS. Справка: [Внешний MCP и OpenClaw](https://magaicrm.ru/help/docs/mcp/external-agents).

## MAG Master

```bash
MAG_MASTER_API_URL=https://app.magaicrm.ru/api
MAGMASTER_API_KEY=...
MAGMASTER_PROJECT_ID=...
```

Без ключа Hive работает сам: демо-рой, сообщения, реестр. Экспорт в KB тогда копируется вручную.

## Архитектура

Три плоскости — см. `docs/ARCHITECTURE.md` и вкладку «План» в приложении.

1. **Работа** — MAG Master  
2. **Сигнал** — MAG Hive  
3. **Сеть** — SSH, иначе WireGuard  

Не пишем свой VPN. Реестр туннелей — документ KB, чтобы агент понимал, где живёт другой агент.
