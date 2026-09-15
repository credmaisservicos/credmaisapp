import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const user = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "admin-audit@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const profile = {
  ...user,
  name: "Administrador de teste",
  subscription_type: "lifetime",
  plan_tier: "essencial",
  is_admin: true,
  is_blocked: false,
  onboarding_completed_at: "2026-01-01T00:00:00Z",
};

const routes = [
  "/admin", "/admin?secao=support", "/admin?secao=automations", "/admin?secao=logs",
  "/admin?secao=settings", "/admin/bot-audit", "/auditoria", "/historico",
];

const viewports = [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 900 },
];

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function mockBackend(page: Page) {
  await page.routeWebSocket("**", socket => socket.close());
  await page.route("https://*.supabase.co/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];
    if (path === "/auth/v1/token") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      body = {
        access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.test`,
        refresh_token: "admin-audit-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: exp,
        user,
      };
    } else if (path === "/auth/v1/user") body = user;
    else if (path === "/rest/v1/profiles") body = profile;
    else if (path === "/rest/v1/rpc/is_admin") body = true;
    else if (path === "/rest/v1/platform_settings") body = { maintenance_mode: false, allow_new_registrations: true };
    await route.fulfill({ status: 200, json: body, headers: { "content-range": "0-0/0" } });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function unnamedVisibleControls(page: Page) {
  return page.locator("button:visible, a:visible").evaluateAll((elements) => elements
    .filter((element) => {
      const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
      return !label.trim();
    })
    .map((element) => ({ tag: element.tagName.toLowerCase(), html: element.outerHTML.slice(0, 180) })));
}

test.describe("smoke responsivo administrativo com backend isolado", () => {
  for (const viewport of viewports) {
    test(`${viewport.name}: módulos administrativos permanecem utilizáveis`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await mockBackend(page);
      await login(page);

      for (const route of routes) {
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${route} devolveu HTTP invalido`).toBeLessThan(400);
        await expect(page.locator("#root"), `${route} nao renderizou`).not.toBeEmpty();
        await expect(page, `${route} saiu da area autenticada`).not.toHaveURL(/\/login(?:\?|$)/);
        await expect(page.getByText(/acesso restrito|algo deu errado|erro inesperado/i), `${route} mostrou bloqueio ou falha`).toHaveCount(0);
        expect(await unnamedVisibleControls(page), `${route} possui controles visíveis sem nome acessível`).toEqual([]);
        const overflow = await page.evaluate(() => Math.max(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.body.clientWidth,
        ));
        expect(overflow, `${route} criou rolagem horizontal`).toBeLessThanOrEqual(1);
      }

      expect(pageErrors, "Erros JavaScript durante a matriz administrativa").toEqual([]);
    });
  }
});
