import { createDenoRunner } from "./deno.mjs";

const runDeno = createDenoRunner();
const importMap = "--import-map=supabase/functions/_integration/import_map.json";
const tests = [
  "supabase/functions/_integration/delivery_test.ts",
  "supabase/functions/_integration/bot_webhook_test.ts",
  "supabase/functions/_integration/collection_test.ts",
  "supabase/functions/_integration/retired_negotiation_test.ts",
  "supabase/functions/_integration/late_fees_test.ts",
  "supabase/functions/_integration/receipt_outbox_test.ts",
  "supabase/functions/_integration/welcome_email_test.ts",
  "supabase/functions/_integration/test_recipient_senders_test.ts",
  "supabase/functions/_integration/entitlement_quota_test.ts",
];

// Fetch the complete graph without executing any handler. Dynamic imports of
// legacy provider SDKs must be ready before a cold runner installs mock fetch.
// Retry preparation once; an assertion failure is never retried or ignored.
let prepared = runDeno(["cache", importMap, ...tests], { stdio: "inherit" });
if (prepared.status !== 0) {
  prepared = runDeno(["cache", "--reload=https://esm.sh/", importMap, ...tests], { stdio: "inherit" });
}
if (prepared.status !== 0) {
  if (prepared.error) console.error(prepared.error.message);
  process.exit(prepared.status ?? 1);
}

// Sem --allow-net: nenhuma chamada pode atingir serviços ou usuários reais.
const result = runDeno(["test", "--cached-only", "--allow-env", importMap, ...tests], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
