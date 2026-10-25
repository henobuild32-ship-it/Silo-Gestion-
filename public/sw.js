const VERSION = "silo-pwa-v2";
const SAFE_PAGES = new Set([
  "/", "/connexion", "/offline", "/dashboard", "/admin/activities",
  "/admin/attendance", "/admin/audit", "/admin/departments", "/admin/finances",
  "/admin/members", "/admin/registration-links", "/admin/reports",
  "/admin/settings", "/admin/submissions",
]);
const CORE = ["/", "/connexion", "/offline", "/admin/attendance", "/silo-logo.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(CORE.map((url) => cache.add(url).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("silo-pwa-") && name !== VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && SAFE_PAGES.has(url.pathname)) {
          const cache = await caches.open(VERSION);
          await cache.put(url.pathname, response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(VERSION);
        return (SAFE_PAGES.has(url.pathname) && await cache.match(url.pathname)) || await cache.match("/offline");
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || /\.(?:svg|png|webp|woff2?)$/i.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});

self.addEventListener("push", (event) => {
  let message = { title: "SILO Gestion Église", body: "Vous avez une nouvelle notification.", url: "/dashboard" };
  try { if (event.data) message = { ...message, ...event.data.json() }; } catch { /* display a safe default */ }
  const target = typeof message.url === "string" && message.url.startsWith("/") && !message.url.startsWith("//") ? message.url : "/dashboard";
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: "/silo-logo.png",
    badge: "/silo-logo.png",
    tag: message.tag || "silo-notification",
    data: { url: target },
    renotify: false,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const relative = event.notification.data?.url || "/dashboard";
  const destination = new URL(relative, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(destination); return existing.focus(); }
    return self.clients.openWindow(destination);
  })());
});
