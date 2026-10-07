import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_BASE_URL?.startsWith("http://127.0.0.1"), "Instalação com configuração isolada.");

test.describe("instalação Android", () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" });
  test("um toque chama o prompt do navegador e usa o evento capturado antes de navegar", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Instalar aplicativo", exact: true }).waitFor();
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, {
        prompt: async () => { document.documentElement.dataset.installPromptCalls = String(Number(document.documentElement.dataset.installPromptCalls || 0) + 1); },
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(event);
    });
    await page.getByRole("link", { name: "Instalar aplicativo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Instalar no Android" })).toBeVisible();
    await page.getByRole("button", { name: "Instalar no Android" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-install-prompt-calls", "1");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(page.getByText("App instalado", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir aplicativo" })).toBeVisible();
  });
  test("sem prompt, oferece um guia acessível de instalação", async ({ page }) => {
    await page.goto("/baixar");
    await page.getByRole("button", { name: "Instalar no Android" }).click();
    const dialog = page.getByRole("dialog", { name: "Instalar no Android" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    await dialog.getByRole("button", { name: "Entendi" }).click();
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("instalação web no iPhone", () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  test("oferece somente instalação web, com três passos e fechamento por teclado", async ({ page }) => {
    await page.goto("/baixar");
    await expect(page.getByRole("button", { name: "Instalar no iPhone" })).toBeVisible();
    await expect(page.locator('a[href$=".apk"], a[href*="testflight.apple.com"], a[href*="apps.apple.com"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Instalar no iPhone" }).click();
    const dialog = page.getByRole("dialog", { name: "Instalar no iPhone" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    await expect(dialog).toContainText("Compartilhar");
    await expect(dialog).toContainText("Adicionar à Tela de Início");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
});

test.describe("instalação em computadores e notebooks", () => {
  test("reconhece a janela instalada com controles integrados à barra do app", async ({ page }) => {
    await page.addInitScript(() => {
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = matchMedia(query);
        if (query === "(display-mode: window-controls-overlay)") Object.defineProperty(result, "matches", { value: true });
        return result;
      };
    });
    await page.goto("/baixar");
    await expect(page.getByText("App instalado", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir aplicativo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Instalar no computador" })).toHaveCount(0);
  });
  for (const [system, userAgent] of [
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"],
    ["Linux", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"],
    ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"],
  ]) {
    test(`${system}: instala pelo prompt e reconhece o app instalado`, async ({ browser }) => {
      const context = await browser.newContext({ userAgent });
      try {
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByRole("link", { name: "Instalar aplicativo", exact: true }).waitFor();
        await page.evaluate(() => {
          const event = new Event("beforeinstallprompt", { cancelable: true });
          Object.assign(event, {
            prompt: async () => { document.documentElement.dataset.installPromptCalls = "1"; },
            userChoice: Promise.resolve({ outcome: "accepted" }),
          });
          window.dispatchEvent(event);
        });
        await page.getByRole("link", { name: "Instalar aplicativo", exact: true }).click();
        await expect(page.locator('a[href$=".apk"]')).toHaveCount(0);
        await page.getByRole("button", { name: "Instalar no computador", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-install-prompt-calls", "1");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
        await expect(page.getByText("App instalado", { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: "Abrir aplicativo" })).toBeVisible();
      } finally { await context.close(); }
    });
  }

  for (const [name, userAgent, instruction] of [
    ["Edge Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Instalar este site como aplicativo"],
    ["Safari macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "Adicionar ao Dock"],
    ["Firefox Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Abra esta página no Google Chrome ou Microsoft Edge"],
  ]) {
    test(`${name}: oferece o guia adequado quando não há prompt`, async ({ browser }) => {
      const context = await browser.newContext({ userAgent });
      try {
        const page = await context.newPage();
        await page.goto("/baixar");
        await page.getByRole("button", { name: "Instalar no computador", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Instalar no computador" });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("listitem")).toHaveCount(3);
        await expect(dialog).toContainText(instruction);
        await expect(dialog).not.toContainText("Adicionar à tela inicial");
        await expect(page.locator('a[href$=".apk"]')).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
      } finally { await context.close(); }
    });
  }
});
