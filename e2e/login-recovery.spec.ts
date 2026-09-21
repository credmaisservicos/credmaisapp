import { expect, test, type Page } from "@playwright/test";

// A conta e todas as respostas de backend são simuladas no navegador.
// Não cria usuários, pagamentos nem registros no Supabase.
test.use({ serviceWorkers: "block" });
const user = { id: "11111111-1111-4111-8111-111111111111", email: "audit@example.test",
  aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const profile = { ...user, name: "Conta de teste", subscription_type: "lifetime", is_blocked: false,
  plan_tier: "essencial", onboarding_completed_at: "2026-01-01T00:00:00Z" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

// playwright.config.ts carrega VITE_SUPABASE_URL de .env.production. Mockar
// um domínio fixo (ex: "*.supabase.co") fica obsoleto assim que o projeto
// migra de host — como já aconteceu ao sair do Supabase Cloud para o
// self-hosted — e os testes passam a bater no backend real sem perceber.
const supabaseOrigin = new URL(process.env.VITE_SUPABASE_URL || "https://supabase-not-configured.invalid").origin;

async function mockBackend(page: Page, failFirstProfile = false) {
  let profileReads = 0;
  await page.routeWebSocket("**", socket => socket.close());
  await page.route(`${supabaseOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];
    if (path === "/auth/v1/token") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      body = { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.test`,
        refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
    } else if (path === "/auth/v1/user") body = user;
    else if (path === "/rest/v1/profiles") {
      const isAuthProfile = url.searchParams.get("select") === "*";
      if (isAuthProfile) profileReads++;
      if (failFirstProfile && isAuthProfile && profileReads === 1) {
        await route.fulfill({ status: 400, json: { message: "Falha simulada ao consultar perfil" } });
        return;
      }
      body = profile;
    } else if (path === "/rest/v1/rpc/is_admin") body = false;
    else if (path === "/rest/v1/platform_settings") body = { maintenance_mode: false, allow_new_registrations: true };
    await route.fulfill({ status: 200, json: body, headers: { "content-range": "0-0/0" } });
  });
  return () => profileReads;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
}

test("login chega ao dashboard e consulta o perfil uma única vez", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const reads = await mockBackend(page);
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  expect(reads()).toBe(1);
  expect(errors).toEqual([]);
});

test("perfil com falha permite tentar novamente e abrir o dashboard", async ({ page }) => {
  const reads = await mockBackend(page, true);
  await login(page);
  await expect(page.getByText("Não foi possível verificar seu acesso")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  expect(reads()).toBe(2);
});
