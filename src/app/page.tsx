import { HiveApp } from "@/components/hive-app";
import { Suspense } from "react";

export default function Home() {
  return (
    <main className="flex h-dvh min-h-0 flex-col">
      <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm">Загрузка роя…</div>}>
        <HiveApp />
      </Suspense>
    </main>
  );
}
