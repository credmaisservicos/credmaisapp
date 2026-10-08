import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

/**
 * Configuração autossuficiente do Playwright.
 *
 * Antes isto importava `lovable-agent-playwright-config`, um pacote que não está
 * nas dependências e não existe em node_modules — ou seja, os testes E2E nunca
 * rodaram fora do ambiente do Lovable, nem localmente nem no CI. Agora rodam
 * onde quer que seja.
 *
 * Alvo padrão: o site publicado. Para apontar para o app local, rode
 * `npm run dev` e use E2E_BASE_URL=http://localhost:8080.
 */
// Make local/CI runs use the same public Supabase configuration as the app
// when the explicit E2E variables are not provided. This avoids silently
// probing the retired EasyPanel host with an empty API key.
const viteEnv = loadEnv("production", process.cwd(), "");
for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
  if (!process.env[key] && viteEnv[key]) process.env[key] = viteEnv[key];
}

// `www.credmaisapp.com.br` has no DNS record — only the bare domain resolves.
const baseURL = process.env.E2E_BASE_URL || "https://credmaisapp.com.br";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "line" : "list",
  timeout: 30_000,
  // Bound a stuck browser while leaving CI time to upload failed-attempt traces.
  globalTimeout: process.env.CI ? 8 * 60_000 : undefined,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    // Keep the failed attempt even if a retry succeeds. Local/synthetic only:
    // authenticated production checks must explicitly disable trace recording.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      // The separate headless shell crashed with SIGSEGV while creating CI
      // contexts. Exercise the full Chromium binary in its supported headless mode.
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
    {
      name: "webkit-login",
      testMatch: /(?:login-recovery|manual-cash|financial-totals|boot-resilience|payment-classification)\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
});
