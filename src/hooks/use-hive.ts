"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HiveState, Member, Message, Tunnel } from "@/lib/types";

export interface HivePayload extends HiveState {
  ok: boolean;
  mag: {
    api: string;
    hasKey: boolean;
    projectId: string;
    externalGateway: string;
    docs: string;
  };
  tunnels: Array<Tunnel & { sshCommand?: string | null }>;
}

async function fetchState(): Promise<HivePayload> {
  const response = await fetch("/api/hive/state", { cache: "no-store" });
  if (!response.ok) throw new Error(`Hive ${response.status}`);
  return (await response.json()) as HivePayload;
}

export function useHive() {
  const [data, setData] = useState<HivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const json = await fetchState();
    setData(json);
    setError(null);
    return json;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const source = new EventSource("/api/hive/stream");

    void fetchState()
      .then((json) => {
        if (cancelled) return;
        setData(json);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const onChange = () => {
      void fetchState()
        .then((json) => {
          if (!cancelled) {
            setData(json);
            setError(null);
          }
        })
        .catch(() => undefined);
    };
    source.addEventListener("message", onChange);
    source.addEventListener("presence", onChange);
    source.addEventListener("tunnel", onChange);
    source.addEventListener("state", onChange);
    const poll = setInterval(onChange, 4000);
    return () => {
      cancelled = true;
      source.close();
      clearInterval(poll);
    };
  }, []);

  const send = useCallback(
    async (input: {
      roomId: string;
      fromId: string;
      toId?: string;
      kind?: Message["kind"];
      body: string;
      taskRef?: Message["taskRef"];
    }) => {
      const response = await fetch("/api/hive/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "send failed");
      }
      await refresh();
    },
    [refresh],
  );

  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const member of data?.members ?? []) map.set(member.id, member);
    return map;
  }, [data]);

  return { data, error, loading, refresh, send, membersById };
}
