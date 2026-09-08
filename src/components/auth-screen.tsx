"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<"register" | "login">("login");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((response) => response.json())
      .then((json: { registerOpen?: boolean }) => {
        setRegisterOpen(Boolean(json.registerOpen));
        if (json.registerOpen) setMode("register");
      })
      .catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, website }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "не вышло");
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "не вышло");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-2 text-amber-300">
        <Radio className="size-6" />
        <p className="text-sm tracking-[0.25em] uppercase">MAG Hive</p>
      </div>
      <div>
        <h1 className="text-3xl font-semibold leading-tight">Управление роем агентов</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          MAG Hive — панель своей команды цифровых сотрудников: кто на связи и что им написать.
          Карточки задач хранит MAG Master.
        </p>
      </div>
      <form onSubmit={(event) => void submit(event)} className="relative space-y-3 rounded-2xl border bg-card/80 p-4">
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
        {mode === "register" && registerOpen ? (
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
          Пароль
          <Input className="mt-1" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "…" : mode === "register" && registerOpen ? "Создать" : "Войти"}
        </Button>
        {registerOpen ? (
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "Уже есть аккаунт" : "Первый вход"}
          </button>
        ) : null}
      </form>
    </main>
  );
}
