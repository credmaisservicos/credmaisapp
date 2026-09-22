// CredMais App Service Worker — offline-aware
// - NetworkFirst para navegações HTML, com fallback para o shell do app
// - Precache de todos os chunks gerados pelo Vite (inclusive rotas lazy)
// - CacheFirst para assets com hash, que são imutáveis
// - Nunca cacheia Supabase, APIs ou rotas internas (~oauth)
const VERSION = "credmais-v22-web-push";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const HTML_CACHE = `${VERSION}-html`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  "/mascots/credinho-v2/loading.png",
  "/mascots/credinho-v2/thinking.png",
  "/mascots/credinho-v2/chat.png",
  OFFLINE_URL,
  "/",
  "/dashboard",
  "/favicon.png",
  "/credmais-cplus-logo.jpg",
  "/brand/credmais-logo.svg",
  "/favicon.svg",
  "/favicon.ico",
  "/manifest.json",
  "/pwa-192.png",
  "/pwa-512.png",
  "/pwa-maskable-512.png",
  "/apple-touch-icon.png",
];

async function precacheApplication() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));

  try {
    const response = await fetch("/vite-manifest.json", { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    const files = new Set(["/vite-manifest.json"]);

    for (const entry of Object.values(manifest)) {
      if (entry?.file) files.add(`/${entry.file}`);
      for (const key of ["css", "assets"]) {
        for (const file of entry?.[key] || []) files.add(`/${file}`);
      }
    }

    await Promise.allSettled([...files].map((url) => cache.add(url)));
  } catch {
    // Uma instalação parcial ainda mantém a página offline de contingência.
  }
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(precacheApplication());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const isAsset = (url) => /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|gif|ico)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin (Supabase, CDNs, external APIs)
  if (url.origin !== location.origin) return;

  // Denylist: oauth and api endpoints always go to network
  if (url.pathname.startsWith("/~oauth") || url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/manifest.json") return;

  // HTML navigations → NetworkFirst with offline fallback
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request, { cache: "no-store" });
          const cache = await caches.open(HTML_CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          return (await caches.match("/dashboard")) || (await caches.match("/")) || caches.match(OFFLINE_URL);
        }
      })()
    );
    return;
  }

  // Assets do build têm hash no nome e são imutáveis. O VERSION novo elimina
  // caches antigos a cada publicação.
  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request, { cache: "no-store" });
          if (fresh && fresh.status === 200 && fresh.type === "basic") cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return Response.error();
        }
      })()
    );
  }
});

// Web Push: chega mesmo com o app fechado (o navegador acorda o SW). O corpo
// vem de send-push/index.ts como JSON: { title, body, link, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* payload não-JSON, ignora */ }

  const title = data.title || "CredMais";
  const options = {
    body: data.body || "",
    icon: "/pwa-192.png",
    badge: "/favicon.png",
    tag: data.tag || undefined,
    data: { link: data.link || "/notificacoes" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificação: foca uma aba já aberta do app se existir, senão abre
// uma nova — sempre navegando para a rota que a notificação apontava.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/notificacoes";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(link).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(link);
    })()
  );
});
