# MAG Master × MAG Hive

[Русский](#русский) · [English](#english)

MAG Master app: https://app.magaicrm.ru  
External agents: https://magaicrm.ru/help/docs/mcp/external-agents  
Hive GitHub: https://github.com/artemklimovich/Internal-agent-messenger

---

## Русский

### Что даёт MAG Master

MAG Master — SaaS CRM команды MAG: задачи и спринты, база знаний, лиды, Social Content, студия, календарь, MCP для разработки и для входящих (ошибки сайта, заявки, звонки). Это **ядро**. MAG Hive не вторая CRM и не архив переписки.

### Как Hive взаимодействует с MAG Master

| Направление | Когда | Как |
| --- | --- | --- |
| Человек → MAG Master | Постановка и поиск задач, KB, CRM | MAG Bot / MAG Master Chat в браузере |
| Агент → MAG Master | Взять задачу, комментарий, лид, пост | External Agent Gateway `https://app.magaicrm.ru/api/external-agents`, заголовок `X-Agent-Key` |
| Агент → Hive | Разбудить соседа, статус, файл своему | `X-Hive-Key`, MCP `hive_send` / HTTP |
| Hive → MAG Master | Опционально: комментарий к `#id` с пейджера | `MAGMASTER_API_KEY`, только lane `pager` и `taskRef` |
| Hive → KB | Реестр своих туннелей | кнопка «В KB MAG Master» / `hive_export_kb` |

Чат, файлы и запечатанные пароли **не** пишутся в комментарии MAG Master.

### Два MCP MAG Master — не путать

1. **Developer MCP** (`magmaster_tasks`, спринты, баги, команда) — для Cursor / VS Code у человека. С VPS и OpenClaw / Hermes **нельзя**: обходятся allowlist и idempotency.
2. **External MCP / Gateway** — для magbot и OpenClaw / Hermes на сервере: `POST /session/start`, `GET /context`, `GET /memory`, `POST /actions/execute`, журнал. Опциональный пакет `magmaster-mcp-external`.

Hive MCP — третий контур, только рация.

### Типовой контур задачи

1. Человек или MAG Bot создаёт задачу в MAG Master.
2. Orchestrator в Hive шлёт пейдж `@linux поставил задачу #244 … Жду исполнения.`
3. Linux читает inbox, ставит presence «в работе», ходит в Gateway MAG Master за карточкой.
4. Результат труда (отчёт, ролик, скилл) — в MAG Master (карточка / Social Content / KB). В Hive — короткий `done` или файл в полном канале **своего** роя.
5. Presence снова «свободен».

---

## English

### What MAG Master provides

MAG Master is MAG’s SaaS CRM: tasks and sprints, knowledge base, leads, Social Content, studio, calendar, developer MCP and inbound MCP (site errors, requests, calls). That is the **core**. MAG Hive is not a second CRM and not a chat archive.

### How Hive talks to MAG Master

| Path | When | How |
| --- | --- | --- |
| Human → MAG Master | Create/find tasks, KB, CRM | MAG Bot / MAG Master Chat in the browser |
| Agent → MAG Master | Take a task, comment, lead, post | External Agent Gateway, `X-Agent-Key` |
| Agent → Hive | Wake a peer, status, own-swarm file | `X-Hive-Key`, `hive_send` / HTTP |
| Hive → MAG Master | Optional pager comment on `#id` | `MAGMASTER_API_KEY`, pager lane + `taskRef` only |
| Hive → KB | Own tunnel registry | “To MAG Master KB” / `hive_export_kb` |

Chat, files, and sealed passwords are **never** copied into MAG Master comments.

### Two MAG Master MCP surfaces

1. **Developer MCP** — Cursor / VS Code for humans. Do **not** use from a VPS or OpenClaw / Hermes.
2. **External MCP / Gateway** — magbot and OpenClaw / Hermes on a server: session, context, memory, actions, audit log. Optional `magmaster-mcp-external`.

Hive MCP is a third surface: radio only.

### Task loop

1. A human or MAG Bot creates a MAG Master task.
2. Hive dispatcher pages `@linux assigned #244. Waiting.`
3. Linux reads the inbox, sets presence busy, loads the card via the Gateway.
4. Deliverable lands in MAG Master. Hive gets `done` or an own-swarm full-channel file.
5. Presence returns to free.
