"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EtherAgent, Member, Message, SessionUser, Tunnel } from "@/lib/types";

export interface HivePayload {
  ok: boolean;
  me: SessionUser;
  swarm: { id: string; name: string };
  members: Member[];
  rooms: { id: string; title: string; subtitle?: string }[];
  messages: Message[];
  tunnels: Array<Tunnel & { sshCommand?: string | null }>;
  ether: EtherAgent[];
  pager: { mode: "pager"; swarmTtlHours: number; etherTtlHours: number; swarmMax: number; etherMax: number };
  mag: { hasKey: boolean; api: string; docs: string };
}

async function fetchState(onUnauth: () => void): Promise<HivePayload> {
  const response = await fetch("/api/hive/state", { cache: "no-store" });
  if (response.status === 401) {
    onUnauth();
    throw new Error("unauthorized");
  }
  if (!response.ok) throw new Error(`Hive ${response.status}`);
  return (await response.json()) as HivePayload;
}

export function useHive() {
  const router = useRouter();
  const [data, setData] = useState<HivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const goLogin = useCallback(() => router.replace("/login"), [router]);

  const refresh = useCallback(async () => {
    const json = await fetchState(goLogin);
    setData(json);
    setError(null);
    return json;
  }, [goLogin]);

  useEffect(() => {
    let cancelled = false;
    const source = new EventSource("/api/hive/stream");
    void fetchState(goLogin)
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
      void fetchState(goLogin)
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
    source.addEventListener("state", onChange);
    const poll = setInterval(onChange, 3000);
    return () => {
      cancelled = true;
      source.close();
      clearInterval(poll);
    };
  }, [goLogin]);

  const send = useCallback(
    async (input: { body: string; toId?: string; kind?: Message["kind"]; scope?: Message["scope"] }) => {
      const response = await fetch("/api/hive/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error || "не отправилось");
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
