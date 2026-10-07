/**
 * Roda o type check do Deno em todas as funções de servidor.
 *
 * Existe porque o type check delas estava quebrado em 7 arquivos e ninguém via.
 * Enquanto ele falha, não serve para pegar erro nenhum — e foi assim que passou
 * despercebido o `auto-late-fees` descartando `max_interest_cap_percent` do mapa
 * de configuração: o TypeScript apontava exatamente essa linha, no meio de seis
 * outros arquivos que falhavam por motivos banais. O teto de juros que o
 * operador definia não limitava nada.
 *
 * Cada função importa dependências remotas (esm.sh, deno.land). Num runner de
 * cache frio, 41 downloads seguidos às vezes esbarram em instabilidade da rede —
 * e teste que falha à toa é pior que teste nenhum, porque ensina a ignorar o CI.
 * Por isso cada arquivo tem uma segunda tentativa antes de virar falha.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createDenoRunner } from "./deno.mjs";

const raiz = "supabase/functions";
const alvos = readdirSync(raiz, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => join(raiz, e.name, "index.ts"))
  .filter((p) => existsSync(p));

const runDeno = createDenoRunner();
const executar = (arquivo) => runDeno(["check", arquivo]);

const ehErroDeTipo = (saida) => /\bTS\d{4}\b/.test(saida);

const falhas = [];
for (const arquivo of alvos) {
  let r = executar(arquivo);
  let saida = `${r.error?.message || ""}${r.stderr || ""}${r.stdout || ""}`;

  // Falhou sem apontar erro de tipo? Provavelmente foi download. Tenta de novo.
  if (r.status !== 0 && !ehErroDeTipo(saida)) {
    r = executar(arquivo);
    saida = `${r.error?.message || ""}${r.stderr || ""}${r.stdout || ""}`;
  }

  if (r.status !== 0) {
    const detalhe = saida
      .split("\n")
      .filter((l) => l.trim() && !/^\s*(Download|Check)\b/.test(l.replace(/\[[0-9;]*m/g, "")))
      .slice(0, 6)
      .join("\n      ");
    falhas.push(`  ${arquivo}\n      ${detalhe || "(sem saída — verifique a conexão do runner)"}`);
  }
}

if (falhas.length) {
  console.error(`\n${falhas.length} de ${alvos.length} função(ões) de servidor com erro de tipo:\n`);
  console.error(falhas.join("\n\n"));
  console.error("");
  process.exit(1);
}

console.log(`Funções de servidor: ${alvos.length} verificadas, nenhum erro de tipo.`);
