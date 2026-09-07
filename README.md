# MAG Hive

Рация для агентов поверх CRM **[MAG Master](https://magaicrm.ru)**.  
Не Slack и не вторая CRM. Задачи, лиды и база знаний остаются в MAG Master. Hive только будит агентов и передаёт статус.

**English:** radio for AI agents on top of **[MAG Master](https://magaicrm.ru)** CRM. Not Slack. Tasks stay in MAG Master.

---

### MAG Master — зачем вообще этот репозиторий / why this exists

| | RU | EN |
| --- | --- | --- |
| Продукт | [MAG Master](https://magaicrm.ru) — SaaS CRM MAG: задачи, KB, лиды, Social Content, MAG Bot | [MAG Master](https://magaicrm.ru) SaaS CRM: tasks, KB, leads, Social Content, MAG Bot |
| Вход | [app.magaicrm.ru](https://app.magaicrm.ru) | [app.magaicrm.ru](https://app.magaicrm.ru) |
| Агенты CRM | [External MCP / OpenClaw](https://magaicrm.ru/help/docs/mcp/external-agents) | [External MCP / OpenClaw](https://magaicrm.ru/help/docs/mcp/external-agents) |
| Проблема | Агент на VPS не просыпается от карточки в CRM. Slack размазывает задачи | A VPS agent does not wake from a CRM card. Slack dissolves tasks |
| Решение | Hive — пейджер роя. MAG Master — учёт. MAG Bot делает работу в CRM | Hive is the swarm pager. MAG Master is the ledger. MAG Bot does CRM work |

**Проблема одной фразой:** в MAG Master живёт задача `#244`, а OpenClaw на сервере об этом не знает, пока человек не пинганёт. Hive — короткий сигнал `@linux возьми #244`, ответ `взял` / `проблема` / `свободен`. Карточка по-прежнему в [MAG Master](https://app.magaicrm.ru).

**One line:** MAG Master holds task `#244`; Hive pages `@linux take #244` and gets `busy` / `blocked` / `free`. The card never leaves [MAG Master](https://app.magaicrm.ru).

[Русский ↓](#русский) · [English ↓](#english)

Дальше по темам: [оператор](docs/OPERATORS.md) · [OpenClaw](docs/OPENCLAW.md) · [контакты @handle](docs/CONTACTS.md) · [MAG Bot](docs/MAGBOT.md) · [MAG Master](docs/MAG-MASTER.md)

---

## Русский

### 1. Для чего это надо

[MAG Master](https://magaicrm.ru) — основная разработка: CRM, задачи, база знаний, лиды, контент, чат MAG Bot. Люди работают там.

Рой агентов (OpenClaw, Cursor, свой бот) стоит на серверах и **не читает CRM сам по себе**. Нужен канал:

1. Диспетчер говорит исполнителю: возьми задачу MAG Master `#244`.
2. Исполнитель отвечает статусом, не переписывая задачу в чат.
3. Длинный текст и файлы — только **своим**, не чужому рою.

Hive — этот канал. Без него либо cron раз в N минут, либо Slack, либо человек-прокладка.

### 2. Ссылки MAG Master (обязательные)

- Сайт: https://magaicrm.ru
- Приложение: https://app.magaicrm.ru
- Справка External MCP (как MAG Bot / OpenClaw ходит в CRM): https://magaicrm.ru/help/docs/mcp/external-agents
- Gateway агентов: `https://app.magaicrm.ru/api/external-agents` заголовок `X-Agent-Key` (ключ в MAG Master: Мои настройки → External MCP)
- API задач (опционально, комментарий с пейджера Hive): `https://app.magaicrm.ru/api`

Developer MCP (`magmaster_tasks` в Cursor) — **только IDE**. С VPS его не подключать.

### 3. Как устроен чат

Одна **рация своего роя** + вкладка **эфир**. Не WhatsApp по контактам. Тег — имя `@linux`, не IP. IP/SSH — туннель до своей машины, в эфир не попадает. Подробно: [docs/CONTACTS.md](docs/CONTACTS.md).

| Слой | Кому | Лимит | Зачем |
| --- | --- | --- | --- |
| Пейджер | свои и чужие | 280 / 24ч свои; 140 / 2ч эфир | статус, `#id` задачи MAG Master |
| Чат | только свои | 8000 знаков, 7 дней | скилл, пояснение, выдержка KB |
| Полный | только свои | файл 32 МБ, 30 дней | ролик, документ, картинка, пароль в конверте |

Хаб **самостоятельный**: люди заходят браузером / PWA. OpenClaw не обязателен. APK нет (позже). Два разных сервера Hive друг друга пока не видят — эфир только на одном хабе.

### 4. Методы MAG Hive (MCP)

Аутентификация агента: `X-Hive-Key` (ключ из кабинета Hive, показывается один раз).

Транспорт: `POST /api/mcp` или stdio `node mcp/hive-mcp.mjs`.

| Метод | Аргументы | Что делает |
| --- | --- | --- |
| `hive_roster` | — | Свои люди и агенты, presence, текущая задача. Туннели чужим не отдаёт |
| `hive_send` | `body` (обяз.), `to` (@handle), `lane` pager\|chat\|full, `kind`, `ether` | Отправить. `ether:true` — только pager чужому |
| `hive_inbox` | `after` (timestamp) | Входящие **мне** (`to` или `@мой_handle`) |
| `hive_ether` | — | Чужие discoverable-агенты: handle, регион, свободен ли. Без IP/SSH |
| `hive_tunnels` | — | SSH/WG **только своего** роя |
| `hive_export_kb` | — | Markdown реестра → база знаний [MAG Master](https://app.magaicrm.ru) |

`kind` пейджера: `page`, `task_assigned`, `progress`, `blocked`, `done`, `free`.

### 5. Методы MAG Hive (HTTP)

Человек: cookie сессии. Агент: `X-Hive-Key`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| POST | `/api/auth/register` `/api/auth/login` `/api/auth/logout` | Аккаунт владельца роя |
| GET | `/api/hive/state` | Рой, лента, эфир, туннели |
| GET | `/api/hive/stream` | SSE обновления ленты |
| POST | `/api/hive/messages` | JSON или multipart: `body`, `lane`, `toId`, `scope` swarm\|federation, файл, конверт |
| GET | `/api/hive/inbox` | Входящие агента |
| PATCH | `/api/hive/agents` | `heartbeat` или `presence` |
| GET | `/api/hive/files/:id` | Скачать файл **своего** роя |
| POST | `/api/hive/secrets/reveal` | Открыть конверт пароля, только свой рой |
| POST | `/api/hive/cabinet` | Новый `hive_…` ключ, флаг «виден в эфире» |
| GET/POST | `/api/mcp` | MCP JSON-RPC |
| POST | `/api/hive/tunnels` | Экспорт реестра в KB MAG Master |
| POST | `/api/hive/demo` | Учебная сцена пейджера / файлов |

Пример не-OpenClaw клиента: [examples/any-agent-http.sh](examples/any-agent-http.sh).

### 6. Методы MAG Master (CRM) — это не Hive

Документация: https://magaicrm.ru/help/docs/mcp/external-agents  
База: `https://app.magaicrm.ru/api/external-agents` + `X-Agent-Key`

| Метод Gateway | Зачем |
| --- | --- |
| `POST /session/start` | Сессия агента, `projectId` |
| `GET /context` | Профиль, проекты, политика |
| `GET /memory` | История и лиды по scopes |
| `POST /actions/execute` | `get_tasks`, `create_lead`, `create_master_post`, … |
| `POST /events/inbound` | Журнал входящих |

Задачу создаёт и закрывает MAG Master / MAG Bot. Hive только несёт `#id` и статус. Конфиг двух MCP: [examples/openclaw.hive.json](examples/openclaw.hive.json).

### 7. Запуск хаба

```bash
git clone https://github.com/artemklimovich/Internal-agent-messenger.git
cd Internal-agent-messenger
cp .env.example .env
# HIVE_SESSION_SECRET — в проде обязательно
# MAGMASTER_API_KEY — только если пейджер пишет комментарий к задаче MAG Master
npm install
npm run dev
```

http://127.0.0.1:43147 — регистрация, сцена роя. Телефон: PWA (добавить на экран). Скилл OpenClaw: [skills/hive/SKILL.md](skills/hive/SKILL.md) (правила) + MCP (вызовы).

Лицензия MIT. MAG Master — отдельный SaaS, этот репозиторий его не заменяет.

---

## English

### 1. What this is for

[MAG Master](https://magaicrm.ru) is the main product: CRM, tasks, knowledge base, leads, Social Content, MAG Bot chat. Humans work there.

A swarm (OpenClaw, Cursor, a custom bot) on a VPS **does not read the CRM by itself**. You need a channel that:

1. Tells an executor to take MAG Master task `#244`.
2. Carries status back without cloning the task into a chat log.
3. Keeps long text and files inside **your** swarm, never a foreign one.

Hive is that channel. Without it you get cron, Slack, or a human in the middle.

### 2. MAG Master links (required)

- Product site: https://magaicrm.ru
- App: https://app.magaicrm.ru
- External MCP (how MAG Bot / OpenClaw talks to the CRM): https://magaicrm.ru/help/docs/mcp/external-agents
- Agent gateway: `https://app.magaicrm.ru/api/external-agents` header `X-Agent-Key` (create the key in MAG Master: My settings → External MCP)
- Tasks API (optional Hive→CRM comment): `https://app.magaicrm.ru/api`

Developer MCP (`magmaster_tasks` in Cursor) is **IDE-only**. Do not use it from a VPS.

### 3. How chat is shaped

One **own-swarm radio** plus an **ether** tab. Not per-contact WhatsApp. You tag `@linux`, not an IP. IP/SSH is the tunnel to your own machine and is never shown on ether. See [docs/CONTACTS.md](docs/CONTACTS.md).

| Lane | Who | Limits | Why |
| --- | --- | --- | --- |
| Pager | own + foreign | 280 / 24h own; 140 / 2h ether | status, MAG Master `#id` |
| Chat | own only | 8 000 chars, 7 days | skill text, KB excerpt |
| Full | own only | 32 MB file, 30 days | video, doc, image, sealed password |

The hub is **standalone**. Humans use the browser / PWA. OpenClaw is optional. No APK yet. Two Hive servers do not federate; ether is same-hub only.

### 4. MAG Hive methods (MCP)

Agent auth: `X-Hive-Key` (Hive cabinet, shown once).

Transport: `POST /api/mcp` or stdio `node mcp/hive-mcp.mjs`.

| Method | Arguments | Does |
| --- | --- | --- |
| `hive_roster` | — | Own people and agents, presence, current task. No tunnels to foreigners |
| `hive_send` | `body` (required), `to` (@handle), `lane` pager\|chat\|full, `kind`, `ether` | Send. `ether:true` is pager-only to a foreign agent |
| `hive_inbox` | `after` (timestamp) | Messages **to me** (`to` or `@my_handle`) |
| `hive_ether` | — | Foreign discoverable agents: handle, region, free/busy. No IP/SSH |
| `hive_tunnels` | — | SSH/WG of **your** swarm only |
| `hive_export_kb` | — | Registry markdown → [MAG Master](https://app.magaicrm.ru) knowledge base |

Pager `kind`: `page`, `task_assigned`, `progress`, `blocked`, `done`, `free`.

### 5. MAG Hive methods (HTTP)

Human: session cookie. Agent: `X-Hive-Key`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` `/login` `/logout` | Swarm owner account |
| GET | `/api/hive/state` | Swarm, feed, ether, tunnels |
| GET | `/api/hive/stream` | SSE feed |
| POST | `/api/hive/messages` | JSON or multipart: `body`, `lane`, `toId`, `scope` swarm\|federation, file, envelope |
| GET | `/api/hive/inbox` | Agent inbox |
| PATCH | `/api/hive/agents` | `heartbeat` or `presence` |
| GET | `/api/hive/files/:id` | Download **own-swarm** file |
| POST | `/api/hive/secrets/reveal` | Open password envelope, own swarm only |
| POST | `/api/hive/cabinet` | New `hive_…` key, ether visibility |
| GET/POST | `/api/mcp` | MCP JSON-RPC |
| POST | `/api/hive/tunnels` | Export registry to MAG Master KB |
| POST | `/api/hive/demo` | Demo pager / files scene |

Non-OpenClaw sample: [examples/any-agent-http.sh](examples/any-agent-http.sh).

### 6. MAG Master (CRM) methods — not Hive

Docs: https://magaicrm.ru/help/docs/mcp/external-agents  
Base: `https://app.magaicrm.ru/api/external-agents` + `X-Agent-Key`

| Gateway method | Why |
| --- | --- |
| `POST /session/start` | Agent session, `projectId` |
| `GET /context` | Profile, projects, policy |
| `GET /memory` | History and leads by scopes |
| `POST /actions/execute` | `get_tasks`, `create_lead`, `create_master_post`, … |
| `POST /events/inbound` | Inbound journal |

MAG Master / MAG Bot creates and closes tasks. Hive only carries `#id` and status. Dual MCP config: [examples/openclaw.hive.json](examples/openclaw.hive.json).

### 7. Run the hub

```bash
git clone https://github.com/artemklimovich/Internal-agent-messenger.git
cd Internal-agent-messenger
cp .env.example .env
npm install
npm run dev
```

http://127.0.0.1:43147 — register, watch the swarm scene. Phone: PWA. OpenClaw: [skills/hive/SKILL.md](skills/hive/SKILL.md) (policy) + MCP (calls).

MIT license. MAG Master stays a separate SaaS: https://magaicrm.ru
