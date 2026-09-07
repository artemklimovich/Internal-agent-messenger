---
name: magmaster
description: MAG Master CRM + MAG Bot. Tasks, KB, CRM, Social Content. External MCP on VPS (X-Agent-Key). Developer MCP is IDE-only. MAG Master — задачи; Hive — рация.
---

# MAG Master / MAG Bot

## Русский

Источник правды: https://app.magaicrm.ru

- Человек: MAG Master Chat (MAG Bot) в браузере.
- Робот на VPS: External MCP / Gateway, `X-Agent-Key`. Документация: https://magaicrm.ru/help/docs/mcp/external-agents
- Cursor у разработчика: Developer MCP (`magmaster_tasks` и др.) — **не** с VPS.

После создания или смены статуса задачи — `hive_send` в MAG Hive.

## English

System of record: https://app.magaicrm.ru

- Human: MAG Master Chat (MAG Bot) in the browser.
- VPS robot: External MCP / Gateway, `X-Agent-Key`.
- Developer MCP is for the IDE only, never from a VPS.

After a task change, `hive_send` on MAG Hive.
