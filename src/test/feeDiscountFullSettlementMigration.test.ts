import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922110000_fee_discount_full_settlement_only.sql"),
  "utf8",
);

describe("migração: desconto de encargo só vale em quitação total", () => {
  it("zera o desconto aplicado quando _mark_paid é falso", () => {
    // Regressão: um desconto concedido num pagamento PARCIAL não sobrevive à
    // próxima recomputação de effective_late_fee (que ignora que um desconto
    // já foi dado) — o saldo do cliente voltava a subir sozinho depois.
    expect(migration).toMatch(
      /applied_fee_discount := CASE WHEN _mark_paid\s*\n\s*THEN least\(greatest\(0, coalesce\(_fee_discount, 0\)\), effective_late_fee\)\s*\n\s*ELSE 0\s*\n\s*END;/i,
    );
  });

  it("mantém o resto do fluxo de pay_installment intacto", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.pay_installment\(\s*_installment_id uuid/i);
    expect(migration).toMatch(/RAISE EXCEPTION 'payment_below_installment_balance'/i);
    expect(migration).toMatch(/'fee_discount', applied_fee_discount/i);
  });
});
