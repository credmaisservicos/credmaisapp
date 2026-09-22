import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922090000_pay_installment_fee_discount.sql"),
  "utf8",
);

describe("migração de desconto na multa/juros de pay_installment", () => {
  it("aceita um desconto explícito de encargos, limitado ao próprio encargo calculado", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.pay_installment\(\s*_installment_id uuid/i);
    expect(migration).toMatch(/_fee_discount numeric DEFAULT 0/i);
    expect(migration).toMatch(
      /applied_fee_discount := least\(greatest\(0, coalesce\(_fee_discount, 0\)\), effective_late_fee\)/i,
    );
    expect(migration).toMatch(/effective_late_fee := round\(effective_late_fee - applied_fee_discount, 2\)/i);
  });

  it("calcula total_due sobre o encargo já descontado, não sobre o cheio", () => {
    // Regressão do bug: com o desconto aplicado no frontend mas ignorado pelo
    // RPC, `_paid_total` (já reduzido) ficava abaixo do `total_due` recalculado
    // do zero, e a baixa falhava com `payment_below_installment_balance`.
    expect(migration).toMatch(
      /applied_fee_discount := least[\s\S]+total_due := round\(base_amount \+ effective_late_fee, 2\)/i,
    );
  });

  it("devolve o desconto aplicado na resposta para auditoria", () => {
    expect(migration).toMatch(/'fee_discount', applied_fee_discount/i);
  });

  it("mantém a assinatura de 6 argumentos compatível para quem não manda desconto", () => {
    expect(migration).toMatch(/DROP FUNCTION IF EXISTS public\.pay_installment\(uuid, numeric, boolean, text, text, text\)/i);
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.pay_installment\(uuid, numeric, boolean, text, text, text, numeric\) TO authenticated/i,
    );
  });
});
