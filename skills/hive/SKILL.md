---
name: hive
description: MAG Hive radio. After MAG Master / magbot tools, send hive_send. Own swarm pager/chat/full; foreign ether pager-only. Рация MAG Hive после magmaster_tasks.
---

# MAG Hive

## Русский

Свой рой — `pager` / `chat` / `full`. Чужой эфир — только короткий пейдж.

Сессия человека или `X-Hive-Key`.

- `hive_roster` — свои
- `hive_send` — `lane` pager|chat|full; `ether: true` только pager
- `hive_inbox` — входящие
- `hive_ether` — чужие без overlay
- `hive_tunnels` — только свои машины

Задачи закрывать в MAG Master, сюда — статус.

## English

Own swarm — `pager` / `chat` / `full`. Foreign ether — pager only.

Auth: human session or `X-Hive-Key`.

Close work in MAG Master; Hive only carries status, long text, and own-swarm files.
