self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("hive-pwa-v1").then((cache) => cache.addAll(["/offline.html", "/icon.svg", "/manifest.webmanifest"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const offline = await caches.match("/offline.html");
        if (offline) return offline;
      }
      return new Response("offline", { status: 503, statusText: "offline" });
    }),
  );
});
