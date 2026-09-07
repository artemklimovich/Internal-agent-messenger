# Архитектура MAG Hive

## Оценка идеи

Идея правильная. Рой OpenClaw уже почти собран в MAG Master: одна компания, один проект, MCP `magmaster_tasks` / `magmaster_sprints` / `magmaster_bugs` / `magmaster_team`, база знаний, у задачи отдельно человек-владелец и исполнитель Magbot. External Agent Gateway даёт политику, journal и `X-Agent-Key`.

Дыра в другом месте. Задача, записанная в CRM, не будит процесс OpenClaw на Ubuntu, Windows или телефоне. Cron — таймер. Человек, который «кинул задачу в агента», — ручной кабель. Между агентами нет presence и нет карты «где он в сети».

Hive — рация, не вторая Jira.

## Три плоскости

```
люди ─┐                    ┌─ Ubuntu OpenClaw
      │                    ├─ Windows OpenClaw
Hive ─┼─ сигнал / presence─┤
      │                    └─ Android (смотреть и писать)
      └─ будит исполнителя
           │
           ▼
     MAG Master = задачи + KB + политика
           │
           ▼
     Туннели: SSH reverse → иначе WireGuard overlay 10.42.0.0/24
```

### 1. Работа = MAG Master

Не дублировать канбан. Ставить и закрывать задачи только MCP/API MAG Master.

- Хостинг API: `https://app.magaicrm.ru/api`
- External Gateway: `https://app.magaicrm.ru/api/external-agents`
- Справка: https://magaicrm.ru/help/docs/mcp/external-agents
- С внешнего VPS не использовать Developer MCP (обходит allowlist и idempotency)

Чат проекта MAG Master — RAG по знаниям. Это не операционный канал роя.

### 2. Сигнал = Hive

Короткий контракт сообщений:

| kind | смысл |
| --- | --- |
| `task_assigned` | я поставил тебе задачу, жду |
| `progress` | взял, делаю |
| `blocked` | проблема, человеку видно |
| `done` | закрыл в MAG Master, свободен |
| `free` | нет работы |

Пробуждение: `hive-node` держит **исходящий** HTTPS/SSE к хабу. Как handshake WireGuard — сам пробивает NAT. Хаб пушит `task_assigned`, нода печатает JSON в stdout / зовёт OpenClaw Gateway, агент стартует.

Люди в том же канале. Могут ответить, снять блокер, переназначить.

### 3. Сеть = реестр, не новый VPN

Не изобретать «свой WireGuard». OpenClaw и так рекомендует SSH и Tailscale к Gateway `:18789`.

Порядок пути:

1. SSH reverse через хаб: `-R 2200x:127.0.0.1:18789` — MCP и Gateway без публичного bind.
2. Если SSH down (корп. Windows часто) — WireGuard peer из реестра, overlay `10.42.0.x`.
3. Android не обязан держать L3: PWA Hive достаточно, чтобы видеть рой.

Реестр экспортируется markdown-ом в KB MAG Master (`update_knowledge_base_content`, append). Агент спрашивает KB: «где @windows?» — и получает IP, pubkey, статус SSH.

## Платформы

| Где | Что ставится |
| --- | --- |
| Ubuntu | OpenClaw Gateway + hive-node + SSH (WG по желанию) |
| Windows | то же; WG часто основной |
| Android | PWA MAG Hive сейчас; Capacitor APK — когда нужен магазин |

## MCP Hive

Инструменты: `hive_roster`, `hive_send`, `hive_inbox`, `hive_presence`, `hive_tunnels`, `hive_register`, `hive_export_kb`.

OpenClaw skill: после успешного `magmaster_tasks` сразу `hive_send`. Иначе второй агент не узнает.

## Что сознательно не в этом срезе

- Ядро WireGuard и свой NAT traversal
- Подписанный Play Store APK
- Подмена MAG Master задач локальной базой
- Мультикомпанийный SaaS-биллинг Hive

Это можно нарастить, когда живой протокол рации и реестр уже в руках команды.
