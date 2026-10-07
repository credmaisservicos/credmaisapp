import { expect, test } from "@playwright/test";

const publicPages = [
  { path: "/", name: "início" },
  { path: "/login", name: "login" },
  { path: "/baixar", name: "downloads" },
  { path: "/planos", name: "planos" },
  { path: "/inteligencia", name: "inteligência" },
  { path: "/sobre-credmais", name: "sobre o CredMais" },
  { path: "/missao", name: "missão" },
  { path: "/checkout?plan=essencial", name: "checkout" },
  { path: "/reset-password", name: "redefinição de senha" },
  { path: "/portal-cliente", name: "portal do cliente" },
  { path: "/privacidade", name: "privacidade" },
  { path: "/termos", name: "termos" },
  { path: "/cobrador-externo", name: "portal do cobrador" },
];

for (const viewport of [
  { label: "ultracompacto", width: 240, height: 480 },
  { label: "celular compacto", width: 280, height: 640 },
  { label: "celular estreito", width: 320, height: 720 },
  { label: "celular", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
  { label: "desktop intermediário", width: 1024, height: 768 },
  { label: "desktop amplo", width: 1920, height: 1080 },
]) {
  test.describe(`${viewport.label}: responsividade e acessibilidade básica`, () => {
    test.use({ viewport });

    for (const target of publicPages) {
      test(`${target.name} não cria rolagem horizontal`, async ({ page }) => {
        await page.goto(target.path);
        await page.waitForLoadState("domcontentloaded");
        const overflow = await page.evaluate(() =>
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
        expect(viewportMeta).toContain("width=device-width");
        await expect(page.locator("main, [role='main'], #root").first()).toBeVisible();
      });
    }
  });
}

test("login mantém nome acessível em todos os campos e ações", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
  await expect(page.getByLabel(/senha/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /entrar/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /esqueceu a senha/i })).toBeVisible();
});

test("checkout has accessible labels for registration fields", async ({ page }) => {
  await page.goto("/checkout?plan=essencial");
  await expect(page.getByLabel(/nome completo/i)).toBeVisible();
  await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
  await expect(page.getByLabel(/whatsapp/i)).toBeVisible();
  await expect(page.getByLabel(/documento/i)).toBeVisible();
});

test("reset password keeps the recovery field accessible", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /enviar link/i })).toBeVisible();
});

test("portal do investidor tolera payload RPC incompleto", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/rest/v1/rpc/investor_portal_login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        investor: { id: "investor-1", name: null, email: null, cpf_cnpj: null, whatsapp: null },
        loans: [{ id: "loan-incomplete", principal: "invalido", total_due: 0, paid_amount: "invalido", status: "active", payments: null }],
        owner: null,
        branding: null,
      }),
    });
  });

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/investidor/token-de-teste");
  await expect(page.getByText("R$ 0,00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/NaN/)).toHaveCount(0);
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
