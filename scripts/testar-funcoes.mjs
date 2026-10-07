import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createDenoRunner } from "./deno.mjs";

const directory = "supabase/functions/_shared";
const tests = readdirSync(directory)
  .filter((name) => name.endsWith("_test.ts"))
  .sort()
  .map((name) => join(directory, name));

if (tests.length === 0) throw new Error("Nenhum teste de função encontrado.");
const result = createDenoRunner()(["test", "--allow-env", "--allow-net", ...tests], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
