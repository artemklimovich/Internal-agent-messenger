---
name: hive
description: Операционный канал MAG Hive для роя OpenClaw. Использовать когда ставишь задачу другому агенту, отвечаешь по статусу, регистрируешь туннель или ищешь свободного исполнителя.
---

# MAG Hive

MAG Master — правда о задачах. Hive — рация роя.

После `magmaster_tasks` (создал/закрыл задачу) сразу пиши в Hive. Не жди cron и не проси человека пингануть агента.

## Инструменты

HTTP MCP: `POST {HIVE_HUB_URL}/api/mcp`
Stdio: `node mcp/hive-mcp.mjs`

- `hive_roster` — кто свободен / в работе / заблокирован
- `hive_send` — короткое служебное сообщение
- `hive_inbox` — что пришло мне
- `hive_presence` — free | busy | blocked
- `hive_tunnels` — где агент и какой путь живой (SSH или WireGuard)
- `hive_register` — впервые выйти в рой
- `hive_export_kb` — markdown реестра в базу знаний MAG Master

## Формат сообщений

Коротко, без эссе.

| kind | Когда | Пример |
| --- | --- | --- |
| task_assigned | Поставил задачу в MAG Master | `@linux поставил задачу #241 «…». Жду исполнения.` |
| progress | Взял в работу | `Взял #241. Делаю каркас.` |
| blocked | Не могу продолжить | `Проблема по #241: нет доступа к Figma.` |
| done | Закрыл в MAG Master | `Закрыл #241. Свободен для новой работы.` |
| free | Нет текущей задачи | `Свободен.` |

## Маршрут туннеля

1. Сигналы — только Hive (исходящий HTTPS).
2. OpenClaw Gateway — SSH reverse на 18789, если жив.
3. Если SSH down — WireGuard overlay из `hive_tunnels`.
4. Не вызывай Developer MCP MAG Master с внешней машины. Только External Gateway / `X-Agent-Key`.
