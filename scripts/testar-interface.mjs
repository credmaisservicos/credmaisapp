import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

// Artefato e backend exclusivos de teste: nunca usa a configuração de produção.
const env = {
  ...process.env,
  VITE_SUPABASE_URL: "https://credmais-e2e.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "chave-anon-de-teste",
  VITE_VAPID_PUBLIC_KEY: "",
  VITE_ANDROID_APK_URL: "",
  E2E_BASE_URL: "http://127.0.0.1:4173",
};
const vite = join(process.cwd(), "node_modules/vite/bin/vite.js");
const playwright = join(process.cwd(), "node_modules/@playwright/test/cli.js");

function start(cli, args, stdio = "inherit") {
  return spawn(process.execPath, [cli, ...args], { env, stdio, windowsHide: true });
}

async function run(cli, args) {
  const child = start(cli, args);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`Comando falhou com código ${code}: ${args.join(" ")}`);
}

if (!existsSync(chromium.executablePath())) await run(playwright, ["install", "chromium"]);
await run(vite, ["build", "--mode", "test", "--outDir", "dist-e2e"]);
const server = start(vite, ["preview", "--outDir", "dist-e2e", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], ["ignore", "pipe", "pipe"]);
let serverError;
server.once("error", (error) => { serverError = error; });
server.stdout.on("data", () => {});
server.stderr.on("data", (data) => process.stderr.write(data));

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error("O preview local não pôde iniciar.");
    try {
      const response = await fetch(env.E2E_BASE_URL, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Aguarda o servidor iniciar. */ }
    await setTimeout(500);
  }
  if (!ready) throw new Error("O preview local não respondeu.");

  await run(playwright, ["test", "--workers=2", "--max-failures=1", "e2e/app-install.spec.ts", "e2e/login-recovery.spec.ts", "e2e/route-health.spec.ts", "e2e/public-routes.spec.ts", "e2e/responsive-accessibility.spec.ts", "e2e/tailwind-compat.spec.ts"]);
  await run(playwright, ["test", "--workers=2", "--max-failures=1", "e2e/authenticated-shell-responsive.spec.ts", "e2e/admin-shell-responsive.spec.ts",
    "--grep-invert", "(ultracompacto|celular compacto|mobile estreito|tablet|desktop amplo):"]);
} finally {
  server.kill();
}
