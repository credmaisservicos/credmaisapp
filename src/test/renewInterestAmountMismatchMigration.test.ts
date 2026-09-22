import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922120000_renew_interest_amount_mismatch_guard.sql"),
  "utf8",
);

describe("migração: guarda de divergência no valor da renovação de juros do bot", () => {
  it("falha alto quando o comprovante diverge do juros calculado pelo contrato", () => {
    // Regressão: system_renew_installment_interest declarava `_amount` (o
    // comprovante verificado pelo bot) mas nunca o usava — a renovação
    // sempre gravava o valor recalculado do contrato, mascarando qualquer
    // divergência com o que foi de fato recebido.
    expect(migration).toMatch(/computed_amount := \(result->>'amount'\)::numeric/i);
    expect(migration).toMatch(
      /IF _amount IS NOT NULL AND _amount > 0\s*\n\s*AND abs\(computed_amount - _amount\) > 0\.01 THEN/i,
    );
    expect(migration).toMatch(/RAISE EXCEPTION 'renewal_amount_mismatch/i);
  });

  it("mantém a checagem de service_role e a idempotência por source_key", () => {
    expect(migration).toMatch(/RAISE EXCEPTION 'service_role_required'/i);
    expect(migration).toMatch(/idempotent.*true/i);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.system_renew_installment_interest\([\s\S]*\) TO service_role/i,
    );
  });
});
