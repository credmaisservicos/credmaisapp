import { createDenoRunner } from "./deno.mjs";

// Sem --allow-net: nenhuma chamada pode atingir serviços ou usuários reais.
const result = createDenoRunner()([
  "test", "--allow-env", "--import-map=supabase/functions/_integration/import_map.json",
  "supabase/functions/_integration/delivery_test.ts",
  "supabase/functions/_integration/bot_webhook_test.ts",
], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
