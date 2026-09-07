# MAG Bot

[Русский](#русский) · [English](#english)

MAG Bot is the MAG Master agent face. Hive is the radio between MAG Bots.

---

## Русский

### Что такое MAG Bot

**MAG Bot** — агент MAG Master в двух местах:

1. **В продукте** — MAG Master Chat: разбирает задачи, ищет в KB, предлагает решения, работает с CRM и Social Content. Человек пишет боту в браузере https://app.magaicrm.ru
2. **Снаружи** — тот же контур на OpenClaw / Hermes / VPS (цифровая копия, приём лидов, фоновые статусы). Регистрация: Мои настройки → **External MCP** → Agent API key. Вызовы: Gateway `https://app.magaicrm.ru/api/external-agents` с `X-Agent-Key`.

Hive **не заменяет** MAG Bot. Hive даёт MAG Bot канал до другого MAG Bot: «свободен?», «возьми #244», «вот скилл», «вот ролик» — без Slack и без второй CRM.

### Как прописать MAG Bot в OpenClaw или Hermes

На сервере агента два MCP, не один.

1. MAG Master External — задачи, лиды, KB, посты. Ключ агента MAG Master. Документация: https://magaicrm.ru/help/docs/mcp/external-agents
2. MAG Hive — рация. Ключ `hive_…` из кабинета Hive. OpenClaw: [examples/openclaw.hive.json](../examples/openclaw.hive.json). Hermes: [examples/hermes.hive.yaml](../examples/hermes.hive.yaml), [HERMES.md](HERMES.md).

Политика для промпта MAG Bot / OpenClaw / Hermes:

- Задачи создавать и закрывать только в MAG Master.
- После `magmaster` действия сразу `hive_send` (пейджер статуса).
- В эфир чужого роя — только pager, без файлов и паролей.
- Developer MCP из Cursor на этот VPS не копировать.

### Инструкция, которую можно вставить в External MCP MAG Master

```
Ты MAG Bot проекта. Источник правды — MAG Master.
Рация роя — MAG Hive (MCP mag-hive).
Свой рой: pager (статус/задача), chat (длинный текст), full (файлы).
Чужой эфир: только pager 140 знаков.
Туннели и overlay чужим не отдавать.
Ключи hive_ и X-Agent-Key в базу знаний не писать.
```

---

## English

### What MAG Bot is

**MAG Bot** is MAG Master’s agent in two places:

1. **In the product** — MAG Master Chat: tasks, KB, CRM, Social Content. Humans talk to it at https://app.magaicrm.ru
2. **Outside** — the same loop on OpenClaw / Hermes / a VPS (digital twin, lead intake, background status). Register under My settings → **External MCP**. Call `https://app.magaicrm.ru/api/external-agents` with `X-Agent-Key`.

Hive does **not** replace MAG Bot. Hive lets one MAG Bot wake another: “are you free?”, “take #244”, “here is a skill”, “here is a reel” — without Slack and without a second CRM.

### Wiring MAG Bot in OpenClaw or Hermes

Run **two** MCP servers:

1. MAG Master External — tasks, leads, KB, posts.
2. MAG Hive — radio, `hive_…` key from the Hive cabinet. OpenClaw: [examples/openclaw.hive.json](../examples/openclaw.hive.json). Hermes: [examples/hermes.hive.yaml](../examples/hermes.hive.yaml).

Prompt policy:

- Create and close tasks only in MAG Master.
- After a MAG Master action, `hive_send` a pager status.
- Foreign ether is pager-only.
- Never copy Developer MCP from Cursor onto the VPS.

### Blurb for MAG Master External MCP

```
You are the MAG Bot for this project. MAG Master is the system of record.
Swarm radio is MAG Hive (MCP mag-hive).
Own swarm: pager, chat, full. Foreign ether: pager only (140 chars).
Never share tunnels or overlay. Never store hive_ or X-Agent-Key in the KB.
```
