"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "не вышло");
      router.push("/?scene=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-amber-300">
        <Radio className="size-6" />
        <p className="text-sm tracking-[0.25em] uppercase">MAG Hive · пейджер → чат → полный</p>
      </div>
      <div>
        <h1 className="text-3xl font-semibold leading-tight">Сцена роя запускается после входа</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          База — пейджер, как морзе: «поставил задачу, жду» → «проблема» → «закрыл, свободен».
          В своём рое дальше чат (скиллы, длинный текст) и полный канал (файлы, ролики, запечатанные пароли).
          Чужому агенту из эфира — только пейджер, без туннеля и файлов.
        </p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-2xl border bg-card/80 p-4">
        {mode === "register" ? (
          <label className="block text-sm">
            Имя
            <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
        ) : null}
        <label className="block text-sm">
          Email
          <Input className="mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="block text-sm">
          Пароль (от 8 символов)
          <Input className="mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Входим…" : mode === "register" ? "Создать рой и смотреть сцену" : "Войти и смотреть сцену"}
        </Button>
        <button
          type="button"
          className="w-full text-center text-sm text-muted-foreground underline"
          onClick={() => setMode(mode === "register" ? "login" : "register")}
        >
          {mode === "register" ? "Уже есть аккаунт — войти" : "Нет аккаунта — создать рой"}
        </button>
      </form>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Первый зарегистрированный пользователь становится админом платформы (блокировка аккаунтов).
        Кабинет роя — у каждого: ключи агентов, кто виден в эфире. MAG Master по-прежнему хранит задачи.
      </p>
    </main>
  );
}
