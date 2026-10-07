// CredMais App Service Worker — offline-aware
// - NetworkFirst para navegações HTML, com fallback para o shell do app
// - Shell offline primeiro; outras rotas são preparadas com baixa concorrência
// - CacheFirst para assets com hash, que são imutáveis
// - Nunca cacheia Supabase, APIs ou rotas internas (~oauth)
const VERSION = "credmais-v24-release-__BUILD_ID__";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const HTML_CACHE = `${VERSION}-html`;
const OFFLINE_URL = "/offline.html";
const CACHE_CONCURRENCY = 2;
let warming;

function validResponse(path, response) {
  if (!response?.ok) return false;
  const type = response.headers.get("content-type") || "";
  const pathname = new URL(path, location.origin).pathname;
  // Um CDN pode responder HTML para um chunk ausente; isso não é código cacheável.
  if (/\.(?:js|mjs)$/.test(pathname)) return type.includes("javascript");
  if (/\.css$/.test(pathname)) return type.includes("text/css");
  if (/\.(?:png|jpg|jpeg|webp|svg|gif|ico)$/.test(pathname)) return type.startsWith("image/");
  return true;
}

const PRECACHE = [
  "/mascots/credinho-v2/loading.webp",
  "/mascots/credinho-v2/thinking.webp",
  "/mascots/credinho-v2/chat.webp",
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

async function cacheFiles(cache, files) {
  const queue = [...files];
  await Promise.all(Array.from({ length: CACHE_CONCURRENCY }, async () => {
    while (queue.length) {
      const url = queue.shift();
      try {
        if (validResponse(url, await cache.match(url))) continue;
        // Chunks com hash não mudam. Reutilizá-los evita baixá-los a cada deploy.
        const previous = url.startsWith("/assets/") && await caches.match(url);
        if (validResponse(url, previous)) await cache.put(url, previous);
        else {
          const fresh = await fetch(url);
          if (validResponse(url, fresh)) await cache.put(url, fresh);
        }
      } catch { /* A rota será tentada novamente quando for aberta. */ }
    }
  }));
}

async function readManifest() {
  const response = await fetch("/vite-manifest.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Manifest indisponível");
  return response.json();
}

function manifestFiles(manifest, roots) {
  const files = new Set();
  const visited = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) return;
    if (entry.file) files.add(`/${entry.file}`);
    for (const type of ["css", "assets"]) {
      for (const file of entry[type] || []) files.add(`/${file}`);
    }
    for (const imported of entry.imports || []) visit(imported);
  }
  roots.forEach(visit);
  return files;
}

async function precacheApplication() {
  const cache = await caches.open(STATIC_CACHE);
  await cacheFiles(cache, PRECACHE);

  try {
    const manifest = await readManifest();
    // Não importa gráficos, PDF ou todas as telas durante a primeira abertura.
    const roots = Object.keys(manifest).filter(key => manifest[key].isEntry ||
      key === "src/App.tsx" || key === "src/pages/Dashboard.tsx");
    await cacheFiles(cache, manifestFiles(manifest, roots));
  } catch {
    // Uma instalação parcial ainda mantém a página offline de contingência.
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(precacheApplication());
});

async function warmOfflineRoutes() {
  try {
    const manifest = await readManifest();
    await cacheFiles(await caches.open(STATIC_CACHE), manifestFiles(manifest, Object.keys(manifest)));
  } catch { /* Conexões instáveis não impedem a utilização do app. */ }
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      // Mantém a publicação anterior enquanto uma aba termina um formulário.
      // Os nomes com hash permitem reutilizar seus chunks sem misturar versões.
      const previousVersions = [...new Set(keys.filter((key) => key.startsWith("credmais-") && !key.startsWith(VERSION)).map((key) => key.replace(/-(static|runtime|html)$/, "")))];
      const previous = previousVersions[previousVersions.length - 1];
      return Promise.all(keys.filter((key) => key.startsWith("credmais-") && !key.startsWith(VERSION) && !(previous && key.startsWith(previous + "-"))).map((key) => caches.delete(key)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "WARM_OFFLINE_ROUTES") {
    // O cliente só solicita isso depois de carregar, em conexões rápidas.
    warming ||= warmOfflineRoutes().finally(() => { warming = undefined; });
    e.waitUntil(warming);
    return;
  }
  if (e.data?.type !== "CHECK_UPDATE" && e.data?.type !== "SKIP_WAITING") return;
  e.waitUntil((async () => {
    if (self.navigator?.onLine === false) return;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const readiness = await Promise.all(clients.map((client) => new Promise((resolve) => {
      const channel = new MessageChannel();
      const finish = (ready) => { clearTimeout(timeout); channel.port1.close(); resolve(ready); };
      const timeout = setTimeout(() => finish(false), 2000);
      channel.port1.onmessage = (event) => finish(event.data?.ready === true);
      client.postMessage({ type: "APP_UPDATE_READY" }, [channel.port2]);
    })));
    if (readiness.every(Boolean)) await self.skipWaiting();
  })());
});

const isAsset = (url) => /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpg|jpeg|webp|svg|gif|ico)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin (Supabase, CDNs, external APIs)
  if (url.origin !== location.origin) return;

  // Downloads nativos precisam receber o arquivo original, sem cache HTML ou
  // fallback offline do PWA quando o link é aberto como uma navegação.
  if (/\.(?:apk|ipa)$/i.test(url.pathname) || url.pathname.startsWith("/downloads/")) return;

  // Denylist: oauth and api endpoints always go to network
  if (url.pathname.startsWith("/~oauth") || url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/manifest.json") return;

  // HTML navigations → NetworkFirst with offline fallback
  if (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const fallback = (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match("/dashboard")) || (await caches.match("/"));
          const network = fetch(request, { cache: "no-store" }).then(async fresh => {
            if (!fresh.ok) throw new Error("Navegação indisponível");
            const cache = await caches.open(HTML_CACHE);
            await cache.put(request, fresh.clone()).catch(() => {});
            return fresh;
          });
          // O shell já salvo abre mesmo quando a rede está conectada mas não responde.
          if (!fallback) return await network;
          event.waitUntil(network.catch(() => {}));
          let timer;
          try {
            return await Promise.race([network, new Promise(resolve => {
              timer = setTimeout(() => resolve(fallback), 3000);
            })]);
          } finally { clearTimeout(timer); }
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
  // caches de publicações anteriores, preservando a mais recente em uso.
  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = (await cache.match(request)) || (await caches.match(request));
        if (validResponse(request.url, cached)) return cached;
        try {
          const fresh = await fetch(request, { cache: "no-store" });
          if (!validResponse(request.url, fresh)) return Response.error();
          if (fresh.type === "basic") event.waitUntil(cache.put(request, fresh.clone()).catch(() => {}));
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
