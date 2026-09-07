import { getStore } from "./store";
import type { Message } from "./types";

const MAG_API =
  process.env.MAG_MASTER_API_URL ?? "https://app.magaicrm.ru/api";
const MAG_KEY =
  process.env.MAGMASTER_API_KEY ??
  process.env.MAGMASTER_USER_API_KEY ??
  process.env.MAG_MASTER_API_KEY ??
  "";
const MAG_PROJECT = process.env.MAGMASTER_PROJECT_ID ?? "mag-hive";

export interface MagSyncResult {
  attempted: boolean;
  ok: boolean;
  detail: string;
}

export function magConfig() {
  return {
    api: MAG_API,
    hasKey: Boolean(MAG_KEY),
    projectId: MAG_PROJECT,
    externalGateway: `${MAG_API.replace(/\/api$/, "")}/api/external-agents`,
    docs: "https://magaicrm.ru/help/docs/mcp/external-agents",
  };
}

export async function syncMessageToMag(message: Message): Promise<MagSyncResult> {
  if (!MAG_KEY) {
    return {
      attempted: false,
      ok: false,
      detail:
        "MAG Master ключ не задан. Задача остаётся в Hive; MCP/API MAG Master не вызывался.",
    };
  }
  if (!message.taskRef) {
    return { attempted: false, ok: false, detail: "Нет ссылки на задачу MAG Master." };
  }

  try {
    const response = await fetch(`${MAG_API.replace(/\/$/, "")}/tasks/${message.taskRef.magTaskId}/comments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": MAG_KEY,
      },
      body: JSON.stringify({
        projectId: MAG_PROJECT,
        body: `[MAG Hive / ${message.kind}] ${message.body}`,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        attempted: true,
        ok: false,
        detail: `MAG Master ответил ${response.status}: ${text.slice(0, 240)}`,
      };
    }
    return { attempted: true, ok: true, detail: "Комментарий записан в MAG Master." };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      detail: error instanceof Error ? error.message : "network error",
    };
  }
}

export async function exportRegistryToMag(): Promise<MagSyncResult> {
  if (!MAG_KEY) {
    return {
      attempted: false,
      ok: false,
      detail: "Нет API-ключа MAG Master. Реестр можно скопировать из Hive и вставить в KB вручную.",
    };
  }
  const markdown = getStore().exportKnowledgeBase();
  try {
    const response = await fetch(
      `${MAG_API.replace(/\/$/, "")}/knowledge-base`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": MAG_KEY,
        },
        body: JSON.stringify({
          projectId: MAG_PROJECT,
          action: "update_knowledge_base_content",
          title: "Реестр роя MAG Hive",
          content: markdown,
          mode: "append",
        }),
      },
    );
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
