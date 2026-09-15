import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "audit@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const profile = {
  ...user,
  name: "Conta de teste",
  subscription_type: "lifetime",
  is_blocked: false,
  plan_tier: "essencial",
  onboarding_completed_at: "2026-01-01T00:00:00Z",
};

const routes = [
  "/dashboard", "/hoje", "/analises", "/clientes", "/clientes/novo", "/clientes/buscar",
  "/cobrancas", "/carteira", "/comercial", "/comercial/estoque", "/comercial/vendas", "/comercial/locacoes",
  "/garantias", "/investidores", "/lucros", "/gastos", "/ferramentas",
  "/ferramentas/metas", "/ferramentas/simulador", "/ferramentas/tarefas", "/ferramentas/anotacoes",
  "/ferramentas/planilha", "/puxada-dados", "/sobre", "/perfil", "/relatorios", "/historico-financeiro",
  "/configuracoes", "/cobradores", "/qrcode", "/comunicacao", "/comunicacao/inbox", "/suporte",
  "/notificacoes", "/chat", "/tv",
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
        refresh_token: "test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: exp,
        user,
      };
    } else if (path === "/auth/v1/user") {
      body = user;
    } else if (path === "/rest/v1/profiles") {
      body = profile;
    } else if (path === "/rest/v1/rpc/is_admin") {
      body = false;
    } else if (path === "/rest/v1/platform_settings") {
      body = { maintenance_mode: false, allow_new_registrations: true };
    }

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

async function unnamedVisibleFields(page: Page) {
  return page.locator("input:visible, select:visible, textarea:visible").evaluateAll((elements) => elements
    .filter((element) => {
      const id = element.getAttribute("id");
      const labelledBy = element.getAttribute("aria-labelledby");
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      const wrappingLabel = element.closest("label")?.textContent;
      return !(element.getAttribute("aria-label") || labelledBy || label || wrappingLabel || element.getAttribute("name") || element.getAttribute("placeholder"))?.trim();
    })
    .map((element) => ({ tag: element.tagName.toLowerCase(), html: element.outerHTML.slice(0, 180) })));
}

test.describe("smoke responsivo autenticado com backend isolado", () => {
  for (const viewport of viewports) {
    test(`${viewport.name}: rotas internas renderizam sem overflow horizontal`, async ({ page }) => {
      test.setTimeout(180_000);
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
        await expect(page.getByText(/algo deu errado|erro inesperado/i), `${route} mostrou falha fatal`).toHaveCount(0);
        expect(await unnamedVisibleControls(page), `${route} possui controles visíveis sem nome acessível`).toEqual([]);
        expect(await unnamedVisibleFields(page), `${route} possui campos visíveis sem label/nome`).toEqual([]);

        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        expect(Math.max(overflow.document, overflow.body), `${route} criou rolagem horizontal`).toBeLessThanOrEqual(1);
      }

      expect(pageErrors, "Erros JavaScript durante a matriz autenticada").toEqual([]);
    });
  }
});

test("menu mobile abre, filtra e fecha por teclado sem perder a navegação", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);

  const more = page.getByRole("button", { name: "Mais", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  const dialog = page.getByRole("dialog", { name: "Menu completo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Análises", exact: true })).toHaveAttribute("href", "/analises");

  await dialog.getByRole("textbox", { name: "Buscar no menu" }).fill("metas");
  await expect(dialog.getByRole("link", { name: "Metas", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Clientes", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Sidebar desktop expõe links semânticos para as telas do menu", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockBackend(page);
  await login(page);
  await expect(page.getByRole("link", { name: "Clientes", exact: true })).toHaveAttribute("href", "/clientes");
  await expect(page.getByRole("link", { name: "Cobranças", exact: true })).toHaveAttribute("href", "/cobrancas");
});
