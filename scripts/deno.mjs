import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

/** Usa Deno instalado ou o npx via Node, sem executar arquivos .cmd no Windows. */
export function createDenoRunner() {
  const command = process.platform === "win32" ? "deno.exe" : "deno";
  if (spawnSync(command, ["--version"], { encoding: "utf8" }).status === 0) {
    return (args, options = {}) => spawnSync(command, args, { encoding: "utf8", ...options });
  }

  const npmCli = process.env.npm_execpath;
  const npxCli = npmCli && join(dirname(npmCli), "npx-cli.js");
  if (!npxCli || !existsSync(npxCli)) {
    throw new Error("Deno não encontrado. Instale Deno 2 ou execute a verificação com npm run.");
  }

  // Resolve o executável uma vez. Repetir npx em cada arquivo faz dezenas de
  // consultas ao registro npm, mesmo com Deno já disponível no cache.
  const resolved = spawnSync(process.execPath,
    [npxCli, "--yes", "--package=deno@2", "--", "deno", "eval", "--no-config", "console.log(Deno.execPath())"],
    { encoding: "utf8" });
  const denoPath = resolved.stdout?.trim();
  if (resolved.status !== 0 || !denoPath || !existsSync(denoPath)) {
    throw new Error(`Não foi possível iniciar Deno: ${resolved.error?.message || resolved.stderr || "executável ausente"}`);
  }
  return (args, options = {}) => spawnSync(denoPath, args, { encoding: "utf8", ...options });
}
