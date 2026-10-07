import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const user = { id: "11111111-1111-4111-8111-111111111111", email: "mobile@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function mockBackend(page: Page) {
  await page.routeWebSocket("**", socket => socket.close());
  const origin = new URL(process.env.VITE_SUPABASE_URL || "https://supabase-not-configured.invalid").origin;
  await page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/auth/v1/token") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      json = { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.test`, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
    } else if (path === "/auth/v1/user") json = user;
    else if (path === "/rest/v1/profiles") json = { ...user, name: "Conta mobile", subscription_type: "lifetime", plan_tier: "essencial", onboarding_completed_at: "2026-01-01T00:00:00Z", is_blocked: false };
    else if (path === "/rest/v1/rpc/is_admin") json = false;
    else if (path === "/rest/v1/platform_settings") json = { maintenance_mode: false };
    await route.fulfill({ status: 200, json });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
}

test("sessão rejeitada na consulta de perfil é renovada sem prender o usuário na tela de erro", async ({ page }) => {
  await mockBackend(page);
  let rejected = false, refreshes = 0;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") refreshes++;
  });
  await page.route("**/rest/v1/profiles?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("select") === "*" && !rejected) {
      rejected = true;
      await route.fulfill({ status: 401, json: { code: "PGRST303", message: "JWT expired" } });
    } else await route.fallback();
  });
  await login(page);
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  expect(rejected).toBe(true);
  expect(refreshes).toBe(1);
  await expect(page.getByRole("heading", { name: "Não foi possível verificar seu acesso", exact: true })).toHaveCount(0);
});

test("novo login na mesma conta recupera uma consulta de perfil que falhou", async ({ page }) => {
  await mockBackend(page);
  let unavailable = true;
  await page.route("**/rest/v1/profiles?**", async route => {
    if (new URL(route.request().url()).searchParams.get("select") === "*" && unavailable) {
      await route.fulfill({ status: 503, json: { message: "Temporarily unavailable" } });
    } else await route.fallback();
  });
  await login(page);
  await expect(page.getByRole("heading", { name: "Não foi possível verificar seu acesso", exact: true })).toBeVisible();
  unavailable = false;
  // Navegação interna preserva o provider, como ao entrar novamente na mesma aba.
  await page.evaluate(() => {
    history.pushState({}, "", "/login"); window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
});

test("consulta de perfil retoma automaticamente quando a conexão volta", async ({ page }) => {
  await mockBackend(page);
  let unavailable = true;
  await page.route("**/rest/v1/profiles?**", async route => {
    if (new URL(route.request().url()).searchParams.get("select") === "*" && unavailable) {
      await route.fulfill({ status: 503, json: { message: "Temporarily unavailable" } });
    } else await route.fallback();
  });
  await login(page);
  await expect(page.getByRole("heading", { name: "Não foi possível verificar seu acesso", exact: true })).toBeVisible();
  unavailable = false;
  await page.evaluate(() => { window.dispatchEvent(new Event("online")); });
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
});

test("abertura lenta mantém a espera sem recarregar nem apagar o cache", async ({ page }) => {
  await mockBackend(page);
  await page.clock.install();
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/assets/App-*.js", async route => { started(); await pending; await route.continue(); });
  let navigations = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await requested;
  const initialNavigations = navigations;
  await page.clock.fastForward(16_000);
  await expect(page.locator("#app-splash")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  expect(navigations).toBe(initialNavigations);
  release();
  await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
  await page.clock.runFor(400);
  await expect(page.locator("#app-splash")).toHaveCount(0);
});

test("trocar de tela em rede lenta preserva o menu e não reinicia a sessão", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  await page.clock.install();
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/assets/Clientes-*.js", async route => { started(); await pending; await route.continue(); });
  await page.locator(".mobile-bottom-nav").getByRole("link", { name: "Clientes", exact: true }).click();
  await requested;
  await expect(page.getByRole("status", { name: "Carregando página", exact: true })).toBeVisible();
  await page.clock.fastForward(16_000);
  await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  await expect(page).toHaveURL(/\/clientes$/);
  release();
  await expect(page.locator(".app-content h1")).toContainText("Clientes");
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toHaveCount(0);
});

test("telas sem dados salvos avisam sobre a falta de conexão sem exibir totais vazios", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  // Mantém a entrega de código local disponível e pausa apenas as consultas,
  // como acontece com uma rota preparada pelo service worker antes de ter dados.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await page.locator(".mobile-bottom-nav").getByRole("link", { name: "Clientes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dados indisponíveis sem internet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo Cliente", exact: true })).toHaveCount(0);
  await page.locator(".mobile-bottom-nav").getByRole("link", { name: "Cobranças", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dados indisponíveis sem internet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Total a Receber" })).toHaveCount(0);
  await page.getByRole("link", { name: "Voltar ao painel" }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dados indisponíveis sem internet" })).toHaveCount(0);
});

test("abrir diretamente sem rede pausa as consultas desde a primeira montagem", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  let installmentReads = 0;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/rest/v1/contract_installments") installmentReads++;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
  });
  await page.goto("/cobrancas");
  await expect(page.getByRole("heading", { name: "Dados indisponíveis sem internet" })).toBeVisible();
  expect(installmentReads).toBe(0);
  await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
});
