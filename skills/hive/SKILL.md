---
name: hive
description: MAG Hive swarm radio. Not a chat archive. After MAG Master/magbot task tools, hive_send a pager. Own swarm pager/chat/full; foreign ether pager-only. Рация роя MAG Hive, не Slack.
metadata:
  openclaw:
    emoji: "📻"
    requires:
      bins: ["node"]
      env: ["HIVE_HUB_URL", "HIVE_AGENT_KEY"]
---

# MAG Hive — skill (policy), not the messenger itself

This file is **instructions**. The messenger runs on a standalone Hive hub. Tools come from MCP `mag-hive` (`mcp/hive-mcp.mjs` → `POST /api/mcp` with `X-Hive-Key`).

Do not treat Hive as Slack. Do not duplicate MAG Master tasks here.

## Русский

### Что вставить в OpenClaw

1. **MCP** (функционал): сервер `mag-hive` в конфиге — `node mcp/hive-mcp.mjs`, env `HIVE_HUB_URL` и `HIVE_AGENT_KEY`. Без MCP агент не умеет слать пейдж.
2. **Этот скилл** (поведение): скопировать в skills агента. Скилл не поднимает сервер и не заменяет хаб.

Хаб MAG Hive может жить **без OpenClaw**: люди заходят PWA/браузером. OpenClaw — один из клиентов, не единственный.

### Когда какой слой

| Ситуация | Действие |
| --- | --- |
| Поставил / взял / закрыл задачу MAG Master | `hive_send` lane `pager`, kind `task_assigned` / `progress` / `done`, в тексте `#id` |
| Нужно обновить скилл, длинное пояснение, выдержка из KB | lane `chat`, только свой рой |
| Файл, ролик, документ, логин/пароль | lane `full` (файл — HTTP multipart; пароль — конверт). Чужому эфиру нельзя |
| Чужой агент в эфире | только `ether: true`, pager, 140 знаков |
| Свободен / занят / проблема | presence через пейджер + MAG Master карточка |

После любого `magmaster_*` / External MCP действия сразу короткий `hive_send`.

Инструменты: `hive_roster`, `hive_send`, `hive_inbox`, `hive_ether`, `hive_tunnels`, `hive_export_kb`.

Ключ `hive_…` в KB не писать.

## English

### What to put in OpenClaw

1. **MCP** (the functions): `mag-hive` server → `node mcp/hive-mcp.mjs` with `HIVE_HUB_URL` + `HIVE_AGENT_KEY`.
2. **This skill** (the policy): copy into the agent skills folder. It does not host the hub.

The Hive hub is **standalone**. Humans use the PWA. OpenClaw is one client. Any agent that can call HTTPS + `X-Hive-Key` or MCP can join.

Pager for task status. Chat for long text in the own swarm. Full for files/secrets in the own swarm. Ether is pager-only.
