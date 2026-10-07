import { test, expect } from "@playwright/test";

test.describe("Public routes", () => {
  test("downloads oferecem instalação disponível sem links nativos fictícios", async ({ page }) => {
    test.skip(!process.env.E2E_BASE_URL?.startsWith("http://127.0.0.1"), "Configuração isolada de entrega");
    await page.goto("/login");
    await page.getByRole("link", { name: "Instalar aplicativo", exact: true }).click();
    await page.waitForURL(/\/baixar$/);
    await expect(page.getByRole("heading", { name: "Instalar aplicativo", exact: true })).toBeVisible();
    await expect(page.locator('a[href$=".apk"], a[href*="testflight.apple.com"], a[href*="apps.apple.com"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Instalar no computador", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Instalar no computador", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Instalar no computador" })).toBeVisible();
  });
  test("landing page loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
  });

  test("plans page is public", async ({ page }) => {
    const res = await page.goto("/planos");
    expect(res?.status()).toBeLessThan(400);
  });

  test("reset-password page is public", async ({ page }) => {
    const res = await page.goto("/reset-password");
    expect(res?.status()).toBeLessThan(400);
  });

  test("client portal is public", async ({ page }) => {
    const res = await page.goto("/portal-cliente");
    expect(res?.status()).toBeLessThan(400);
  });

  test("landing opens the full login app without a dead route", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /acessar minha conta/i }).click();
    await page.waitForURL(/\/login$/);
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /entrar no sistema/i })).toBeVisible();
  });

  test("public portal aliases and investor portal do not require app login", async ({ page }) => {
    for (const route of ["/portal", "/portal/token-invalido", "/investidor/token-invalido"]) {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      expect(page.url()).not.toContain("/login");
    }
  });

  test("checkout result pages render without claiming an unverified payment", async ({ page }) => {
    for (const route of ["/checkout/sucesso", "/checkout/pendente", "/checkout/erro"]) {
      const response = await page.goto(route);
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("body")).not.toContainText("Pagamento aprovado");
    }
  });
});
