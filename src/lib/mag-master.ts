import { getStore } from "./store";
import { hiveMagProjectFor, type MagInventory, type Message } from "./types";

const ENV_API = process.env.MAG_MASTER_API_URL ?? "https://app.magaicrm.ru/api";
const ENV_KEY =
  process.env.MAGMASTER_API_KEY ??
  process.env.MAGMASTER_USER_API_KEY ??
  process.env.MAG_MASTER_API_KEY ??
  "";
const ENV_PROJECT = process.env.MAGMASTER_PROJECT_ID ?? "mag-hive";

export interface MagSyncResult {
  attempted: boolean;
  ok: boolean;
  detail: string;
}

export function magConfig() {
  return {
    api: ENV_API,
    hasKey: Boolean(ENV_KEY),
    projectId: ENV_PROJECT,
    externalGateway: `${ENV_API.replace(/\/api$/, "")}/api/external-agents`,
    docs: "https://magaicrm.ru/help/docs/mcp/external-agents",
  };
}

export async function probeMagKey(input: {
  apiUrl: string;
  gatewayUrl: string;
  projectId: string;
  key: string;
}): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetch(`${input.gatewayUrl.replace(/\/$/, "")}/session/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Key": input.key,
      },
      body: JSON.stringify({ projectId: input.projectId }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: "MAG Master отклонил X-Agent-Key." };
    }
    if (response.ok) {
      return { ok: true, detail: "External MCP MAG Master принял ключ." };
    }
    return {
      ok: true,
      detail: `MAG Master ответил ${response.status}. Ключ сохранён — проверьте пейдж с #id.`,
    };
  } catch (error) {
    return {
      ok: true,
      detail:
        error instanceof Error
          ? `Ключ сохранён локально (${error.message}). Комментарий в карточку проверится на первом #id.`
          : "Ключ сохранён локально.",
    };
  }
}

function credentialsFor(swarmId: string) {
  const stored = getStore().magCredentials(swarmId);
  if (stored) return stored;
  if (!ENV_KEY) return null;
  return {
    apiUrl: ENV_API.replace(/\/$/, ""),
    gatewayUrl: `${ENV_API.replace(/\/api$/, "")}/api/external-agents`,
    projectId: ENV_PROJECT,
    key: ENV_KEY,
  };
}

function gatewayHeaders(key: string) {
  return {
    "Content-Type": "application/json",
    "X-Agent-Key": key,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function actionAllowed(list: unknown, name: string) {
  return Array.isArray(list) && list.map(String).includes(name);
}

function stringList(value: unknown, cap = 80) {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter(Boolean).slice(0, cap);
}

function emptyInventory(partial: Partial<MagInventory> & Pick<MagInventory, "ok" | "detail" | "projectId">): MagInventory {
  return {
    webhookFiredByMag: false,
    projects: [],
    tasks: [],
    magPolicy: { allowedProjectIds: [], allowedActions: [], effectiveActions: [] },
    capabilities: { comments: false, kbRead: false, kbWrite: false, tasks: false, inbox: false },
    notes: [],
    ...partial,
  };
}

function mapInboxTask(row: unknown): MagInventory["tasks"][number] | null {
  const item = asRecord(row);
  if (!item) return null;
  const id = String(item.id ?? item.taskId ?? "");
  if (!id) return null;
  const due = item.dueDate ?? item.dueAt ?? item.deadline;
  return {
    id,
    title: String(item.title ?? item.name ?? `#${id}`),
    status: item.status != null ? String(item.status) : undefined,
    projectId: item.sourceProjectId != null ? String(item.sourceProjectId) : item.projectId != null ? String(item.projectId) : undefined,
    projectName: item.sourceProjectName != null ? String(item.sourceProjectName) : undefined,
    dueAt: due != null ? String(due) : undefined,
  };
}

const surveyCache = new Map<string, { at: number; inv: MagInventory }>();
const SURVEY_TTL_MS = 45_000;

export async function inspectMagAccess(swarmId: string, opts?: { fresh?: boolean }): Promise<MagInventory> {
  if (!opts?.fresh) {
    const hit = surveyCache.get(swarmId);
    if (hit && Date.now() - hit.at < SURVEY_TTL_MS) return hit.inv;
  }
  const inv = await loadMagInventory(swarmId);
  surveyCache.set(swarmId, { at: Date.now(), inv });
  return inv;
}

async function loadMagInventory(swarmId: string): Promise<MagInventory> {
  const creds = credentialsFor(swarmId);
  const notes: string[] = [];
  if (!creds) {
    return emptyInventory({
      ok: false,
      detail: "Нет X-Agent-Key. Подключите MAG в кабинете.",
      projectId: ENV_PROJECT,
      notes: ["Опрос читает Gateway по входу в кабинет или кнопке. Это не крон."],
    });
  }

  const base = creds.gatewayUrl.replace(/\/$/, "");
  const projectId = creds.projectId;
  notes.push("Hive здесь не планировщик: крон MAG и крон агента остаются где были.");
  notes.push("Политики MAG — в MAG; политики радио — в Hive. Душу агента отсюда не переписываем.");

  try {
    const meRes = await fetch(`${base}/me`, {
      headers: gatewayHeaders(creds.key),
      signal: AbortSignal.timeout(8000),
    });
    const meJson = asRecord(await meRes.json().catch(() => null));
    if (meRes.status === 401 || meRes.status === 403) {
      return emptyInventory({
        ok: false,
        detail: "MAG отклонил X-Agent-Key (GET /me).",
        projectId,
        notes,
      });
    }
    if (!meRes.ok) {
      return emptyInventory({
        ok: false,
        detail: `GET /me → ${meRes.status}. Gateway, возможно, недоступен.`,
        projectId,
        notes,
      });
    }

    const agent = asRecord(meJson?.agent);
    const ctxRes = await fetch(`${base}/context?projectId=${encodeURIComponent(projectId)}`, {
      headers: gatewayHeaders(creds.key),
      signal: AbortSignal.timeout(10000),
    });
    const ctxJson = asRecord(await ctxRes.json().catch(() => null));
    const context = asRecord(ctxJson?.context) ?? ctxJson;
    const policy = asRecord(context?.mcpActionPolicy);
    const effective = policy?.effectiveAllowed;
    const userProfile = asRecord(context?.userProfile);
    const projectsRaw = context?.accessibleProjects ?? context?.projects;
    const projects = Array.isArray(projectsRaw)
      ? projectsRaw
          .map((row) => {
            const item = asRecord(row);
            if (!item) return null;
            const id = String(item.id ?? item.projectId ?? "");
            if (!id) return null;
            return {
              id,
              name: String(item.name ?? item.projectName ?? id),
              companyId: item.companyId != null ? String(item.companyId) : null,
            };
          })
          .filter((row): row is { id: string; name: string; companyId: string | null } => Boolean(row))
      : [];

    const allowedFromAgent = agent?.allowedProjectIds;
    if (Array.isArray(allowedFromAgent) && allowedFromAgent.length && !projects.length) {
      for (const id of allowedFromAgent.map(String)) {
        projects.push({ id, name: id, companyId: null });
      }
    }
    if (!projects.some((row) => row.id === projectId)) {
      notes.push(`Кабинет Hive смотрит projectId «${projectId}». Если его нет в списке ключа — пейдж с # сюда не должен ходить.`);
    }

    const magPolicy = {
      allowedProjectIds: stringList(agent?.allowedProjectIds ?? userProfile?.allowedProjectIds, 40),
      allowedActions: stringList(agent?.allowedActions, 80),
      effectiveActions: stringList(effective, 80),
      mcpPolicy: policy?.externalMcpPolicy != null ? String(policy.externalMcpPolicy) : undefined,
    };

    const caps = {
      comments: actionAllowed(effective, "add_task_comment") || actionAllowed(agent?.allowedActions, "add_task_comment"),
      kbRead: actionAllowed(effective, "get_knowledge_base"),
      kbWrite: actionAllowed(effective, "append_knowledge_base"),
      tasks: actionAllowed(effective, "get_tasks") || actionAllowed(effective, "get_task"),
      inbox: true,
    };
    if (!caps.kbWrite) {
      notes.push("Запись в KB этим ключом обычно закрыта политикой External MCP.");
    }

    let inboxOpen: number | undefined;
    let mappedTasks: MagInventory["tasks"] = [];
    const inboxRes = await fetch(`${base}/tasks/inbox?openOnly=1&limit=20`, {
      headers: gatewayHeaders(creds.key),
      signal: AbortSignal.timeout(10000),
    });
    if (inboxRes.ok) {
      const inboxJson = asRecord(await inboxRes.json().catch(() => null));
      const meta = asRecord(inboxJson?.inboxMeta);
      const master = asRecord(inboxJson?.master);
      const rawTasks = Array.isArray(master?.tasks) ? master.tasks : Array.isArray(inboxJson?.tasks) ? inboxJson.tasks : [];
      mappedTasks = rawTasks.map(mapInboxTask).filter((row): row is NonNullable<typeof row> => row != null);
      inboxOpen = typeof meta?.total === "number" ? meta.total : mappedTasks.length;
      caps.inbox = true;
    } else {
      caps.inbox = false;
      notes.push(`Inbox ${inboxRes.status}: MAG не отдал опрос задач этому ключу.`);
    }

    return {
      ok: true,
      detail: `Gateway жив. Агент MAG «${String(agent?.displayName || agent?.label || agent?.id || "external")}».`,
      projectId,
      agentName: agent ? String(agent.displayName || agent.label || "") : undefined,
      agentMode: agent?.mode != null ? String(agent.mode) : undefined,
      agentEnabled: agent?.enabled !== false,
      webhookConfigured: Boolean(agent?.webhookUrl),
      webhookFiredByMag: false,
      projects,
      magPolicy,
      capabilities: caps,
      inboxOpen,
      tasks: mappedTasks,
      notes,
    };
  } catch (error) {
    return emptyInventory({
      ok: false,
      detail: error instanceof Error ? error.message : "network error",
      projectId,
      notes,
    });
  }
}

export async function syncMessageToMag(message: Message): Promise<MagSyncResult> {
  if ((message.lane ?? "pager") !== "pager" || message.kind === "secret" || message.secretId) {
    return {
      attempted: false,
      ok: false,
      detail: "В MAG Master комментарии только с пейджера задач. Чат, файлы и секреты остаются в Hive.",
    };
  }
  if (!message.taskRef) {
    return { attempted: false, ok: false, detail: "Нет ссылки на задачу MAG Master." };
  }
  const creds = credentialsFor(message.swarmId);
  if (!creds) {
    return {
      attempted: false,
      ok: false,
      detail: "Подключите MAG Master в кабинете (X-Agent-Key) или задайте MAGMASTER_API_KEY.",
    };
  }

  const survey = await inspectMagAccess(message.swarmId);
  const magId = String(message.taskRef.magTaskId);
  if (!survey.ok) {
    return { attempted: false, ok: false, detail: `В MAG не пишем: ${survey.detail}` };
  }
  if (!survey.capabilities.inbox) {
    return {
      attempted: false,
      ok: false,
      detail: "Inbox MAG недоступен этому ключу — комментарий наугад не отправляем.",
    };
  }
  const surveyed = survey.tasks.find((task) => String(task.id) === magId);
  if (!surveyed) {
    return {
      attempted: false,
      ok: false,
      detail: `MAG #${magId} нет в опросе inbox. Выберите задачу на пейджере, не из головы.`,
    };
  }
  const store = getStore();
  const swarm = store.swarmById(message.swarmId);
  const target = message.toId ? store.memberById(message.toId) : undefined;
  const related = [];
  if (target) {
    related.push(target);
    if (target.hostId) {
      const host = store.memberById(target.hostId);
      if (host) related.push(host);
    }
  }
  const hiveProject = swarm ? hiveMagProjectFor(target, swarm, related) : undefined;
  if (hiveProject && surveyed.projectId && surveyed.projectId !== hiveProject) {
    return {
      attempted: false,
      ok: false,
      detail: `Hive: @${target?.handle ?? "агент"} пишет только в MAG-проект ${hiveProject}, не ${surveyed.projectId}.`,
    };
  }
  const allowProjects = survey.magPolicy.allowedProjectIds;
  if (
    allowProjects.length &&
    surveyed.projectId &&
    !allowProjects.includes(surveyed.projectId) &&
    surveyed.projectId !== survey.projectId
  ) {
    return {
      attempted: false,
      ok: false,
      detail: `Проект ${surveyed.projectId} не в allowlist ключа — в MAG не пишем.`,
    };
  }

  const comment = `[MAG Hive / ${message.kind}] ${message.body}`;
  try {
    const comments = await fetch(
      `${creds.apiUrl.replace(/\/$/, "")}/tasks/${message.taskRef.magTaskId}/comments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": creds.key,
          "X-Agent-Key": creds.key,
        },
        body: JSON.stringify({ projectId: creds.projectId, body: comment }),
      },
    );
    if (comments.ok) {
      return { attempted: true, ok: true, detail: "Комментарий записан в MAG Master." };
    }
    const execute = await fetch(`${creds.gatewayUrl.replace(/\/$/, "")}/actions/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Key": creds.key,
      },
      body: JSON.stringify({
        action: "add_task_comment",
        projectId: creds.projectId,
        taskId: message.taskRef.magTaskId,
        body: comment,
      }),
    });
    if (execute.ok) {
      return { attempted: true, ok: true, detail: "Комментарий ушёл через External MCP MAG Master." };
    }
    const text = `${comments.status} / gateway ${execute.status}`;
    return {
      attempted: true,
      ok: false,
      detail: `MAG Master: ${text}. Проверьте ключ в кабинете.`,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      detail: error instanceof Error ? error.message : "network error",
    };
  }
}

