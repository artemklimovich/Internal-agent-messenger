import { getStore } from "./store";
import type { Message } from "./types";

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
        action: "comment_task",
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

export async function exportRegistryToMag(swarmId: string): Promise<MagSyncResult> {
  const creds = credentialsFor(swarmId);
  if (!creds) {
    return {
      attempted: false,
      ok: false,
      detail: "Нет ключа MAG Master в кабинете. Реестр скопируйте в KB вручную.",
    };
  }
  const markdown = getStore().exportKnowledgeBase(swarmId);
  try {
    const response = await fetch(`${creds.apiUrl.replace(/\/$/, "")}/knowledge-base`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": creds.key,
        "X-Agent-Key": creds.key,
      },
      body: JSON.stringify({
        projectId: creds.projectId,
        action: "update_knowledge_base_content",
        title: "Реестр роя MAG Hive",
        content: markdown,
        mode: "append",
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        attempted: true,
        ok: false,
        detail: `MAG Master KB ${response.status}: ${text.slice(0, 240)}`,
      };
    }
    return { attempted: true, ok: true, detail: "Реестр дописан в базу знаний MAG Master." };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      detail: error instanceof Error ? error.message : "network error",
    };
  }
}
