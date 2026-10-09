import { spawn } from "node:child_process";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { freemem, totalmem, cpus, platform, release } from "node:os";
import { chromium, webkit } from "@playwright/test";

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

function start(cli, args, stdio = "inherit", runEnv = env) {
  return spawn(process.execPath, [cli, ...args], { env: runEnv, stdio, windowsHide: true });
}

function browserRuntime() {
  const readLimit = (path) => { try { return readFileSync(path, 'utf8').trim(); } catch { return null; } };
  let sharedMemory = null;
  try { const stat = statfsSync('/dev/shm'); sharedMemory = {total: stat.blocks * stat.bsize, available: stat.bavail * stat.bsize}; } catch { /* Not available on Windows. */ }
  return {at: new Date().toISOString(), node: process.version, platform: platform(), release: release(), cpuCount: cpus().length,
    memory: {total: totalmem(), available: freemem(), process: process.memoryUsage(), cgroupLimit: readLimit('/sys/fs/cgroup/memory.max'), cgroupUsage: readLimit('/sys/fs/cgroup/memory.current')},
    sharedMemory, browsers: {chromium: chromium.executablePath(), webkit: webkit.executablePath()}};
}

async function run(cli, args) {
  const diagnostic = cli === playwright && args[0] === 'test';
  const before = diagnostic ? browserRuntime() : null;
  const child = start(cli, args, diagnostic ? ['ignore', 'pipe', 'pipe'] : 'inherit', diagnostic ? {...env, DEBUG: 'pw:browser'} : env);
  let tail = '';
  if (diagnostic) for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', data => {output.write(data); tail = (tail + data.toString()).slice(-1024 * 1024);});
  }
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({code, signal}));
    });
  } finally {
    if (diagnostic) {
      const directory = 'test-results/browser-diagnostics'; mkdirSync(directory, {recursive: true});
      const label = (args.find(arg => arg.startsWith('--output='))?.split('/').at(-1) || 'interface').replace(/[^a-z\d_-]/gi, '_');
      writeFileSync(`${directory}/${label}.json`, JSON.stringify({before, after: browserRuntime(), result: result || {spawnFailed: true}}, null, 2));
      writeFileSync(`${directory}/${label}.log`, tail);
    }
  }
  if (result.code !== 0) throw new Error(`Comando falhou com código ${result.code}, sinal ${result.signal}: ${args.join(" ")}`);
}

if (!existsSync(chromium.executablePath())) await run(playwright, ["install", "chromium"]);
if (!existsSync(webkit.executablePath())) await run(playwright, ["install", "webkit"]);
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

  // Separate outputs keep primary failures when the second invocation starts.
  await run(playwright, ["test", "--output=test-results/primary", "--workers=2", "--max-failures=1", "e2e/app-install.spec.ts", "e2e/login-recovery.spec.ts", "e2e/mobile-loading.spec.ts", "e2e/large-collections.spec.ts", "e2e/route-health.spec.ts", "e2e/public-routes.spec.ts", "e2e/responsive-accessibility.spec.ts", "e2e/tailwind-compat.spec.ts", "e2e/bot-module.spec.ts", "e2e/client-portal.spec.ts", "e2e/payment-allocation-review.spec.ts", "e2e/wallet-cash.spec.ts", "e2e/manual-cash.spec.ts", "e2e/financial-totals.spec.ts", "e2e/boot-resilience.spec.ts"]);
  await run(playwright, ["test", "--output=test-results/responsive", "--workers=2", "--max-failures=1", "e2e/authenticated-shell-responsive.spec.ts", "e2e/admin-shell-responsive.spec.ts",
    "--grep-invert", "(ultracompacto|celular compacto|mobile estreito|tablet|desktop amplo):"]);
  await run(playwright, ["test", "--output=test-results/upload-isolation", "--workers=1", "--retries=0", "e2e/upload-isolation.spec.ts"]);
  await run(playwright, ["test", "--output=test-results/payment-classification", "--workers=2", "--retries=0", "e2e/payment-classification.spec.ts"]);
} finally {
  server.kill();
}
