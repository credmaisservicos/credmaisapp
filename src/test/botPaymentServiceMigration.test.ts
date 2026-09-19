import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919100000_bot_payment_service_wrappers.sql"),
  "utf8",
);

describe("wrappers financeiros do bot", () => {
  it("restringe as operações de serviço à service_role", () => {
    expect(migration).toMatch(/auth\.role\(\)[\s\S]+service_role_required/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.system_register_payment[\s\S]+TO service_role/i);
  });

  it("usa as mesmas RPCs transacionais do app e distribui por parcelas", () => {
    expect(migration).toMatch(/RETURN public\.pay_installment\(/i);
    expect(migration).toMatch(/coalesce\(_paid_total, 0\) \+ 0\.005 >= total_due/i);
    expect(migration).toMatch(/_installment_id, _paid_total, coalesce\(_paid_total/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.system_pay_client_balance/i);
    expect(migration).toMatch(/ORDER BY ci\.due_date/i);
    expect(migration).toMatch(/NULLIF\(trim\(_source_key\), ''\) IS NULL/i);
  });

  it("não permite confirmar retry do mesmo comprovante duas vezes", () => {
    expect(migration).toMatch(/transactions[\s\S]+source_key = trim\(_source_key\)/i);
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema'/i);
  });
});
