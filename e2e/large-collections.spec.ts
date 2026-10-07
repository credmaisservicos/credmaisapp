import { expect, test, type Page } from "@playwright/test";
import { mockLargeCollections } from "./helpers/large-collections";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
const user = { id: "11111111-1111-4111-8111-111111111111", email: "large@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
async function loginWithDataset(page: Page, clients: number, perClient: number) {
  await page.routeWebSocket("**", socket => socket.close());
  const origin = new URL(process.env.VITE_SUPABASE_URL || "https://supabase-not-configured.invalid").origin;
  let writes = 0;
  await page.route(`${origin}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    if (/\/rest\/v1\/(clients|contracts|contract_installments)$/.test(path) && !["GET", "HEAD"].includes(route.request().method())) writes++;
    let json: unknown = [];
    if (path === "/auth/v1/token") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      json = { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.test`, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
    } else if (path === "/auth/v1/user") json = user;
    else if (path === "/rest/v1/profiles") json = { ...user, name: "Conta fictícia", subscription_type: "lifetime", plan_tier: "essencial", onboarding_completed_at: "2026-01-01T00:00:00Z", is_blocked: false };
    else if (path === "/rest/v1/rpc/is_admin") json = false;
    else if (path === "/rest/v1/platform_settings") json = { maintenance_mode: false };
    await route.fulfill({ status: 200, json });
  });
  const dataset = await mockLargeCollections(page, clients, perClient);
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  await page.locator(".mobile-bottom-nav").getByRole("link", { name: "Cobranças", exact: true }).click();
  return { ...dataset, writes: () => writes };
}

test("carteira grande mantém totais, busca e seleção de todas as parcelas", async ({ page }) => {
  const dataset = await loginWithDataset(page, 120, 12); // 1.440 parcelas: também exercita fetchAll além de 1.000.
  const cards = page.locator(".collection-account-card");
  await expect(cards).toHaveCount(30);
  await expect(page.getByText("Mostrando 30 de 120 clientes", { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="Resumo das cobranças"]')).toContainText("144.000,00");
  await page.getByRole("button", { name: "Selecionar todas as parcelas filtradas", exact: true }).click();
  await expect(page.getByText("1440 selecionada(s)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Selecionar todas as parcelas filtradas", exact: true }).click();
  await page.getByRole("button", { name: "Carregar mais clientes", exact: true }).click();
  await expect(cards).toHaveCount(60);
  await page.getByRole("textbox", { name: "Buscar cobranças", exact: true }).fill("Cliente 0120");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Cliente 0120");
  await expect(page.getByText("12 resultados encontrados", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Selecionar todas as parcelas filtradas", exact: true }).click();
  await expect(page.getByText("12 selecionada(s)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Selecionar todas as parcelas filtradas", exact: true }).click();
  await page.getByRole("textbox", { name: "Buscar cobranças", exact: true }).fill("");
  await expect(cards).toHaveCount(30);
  for (const count of [60, 90, 120]) {
    await page.getByRole("button", { name: "Carregar mais clientes", exact: true }).click();
    await expect(cards).toHaveCount(count);
  }
  await expect(page.getByRole("button", { name: "Carregar mais clientes", exact: true })).toHaveCount(0);
  expect(dataset.writes()).toBe(0);
});

test("cliente com muitas parcelas mostra blocos sem limitar o valor ou a seleção", async ({ page }) => {
  const dataset = await loginWithDataset(page, 1, 75);
  const card = page.locator(".collection-account-card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("7.500,00");
  await card.getByText("Cliente 0001", { exact: true }).click();
  const rows = page.locator(".collection-installment-row");
  await expect(rows).toHaveCount(30);
  await card.getByRole("button", { name: "Selecionar todas as parcelas do cliente", exact: true }).click();
  await expect(page.getByText("75 selecionada(s)", { exact: true })).toBeVisible();
  const more = page.getByRole("button", { name: "Mostrar mais parcelas de Cliente 0001", exact: true });
  await more.click(); await expect(rows).toHaveCount(60);
  await more.click(); await expect(rows).toHaveCount(75);
  await expect(more).toHaveCount(0);
  expect(dataset.writes()).toBe(0);
});
