import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919090000_payment_installment_atomic.sql"),
  "utf8",
);
const partialPaymentFix = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260920090000_fix_partial_payment_remaining_fees.sql"),
  "utf8",
);
const percentageSettlementFix = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260921090000_fix_percentage_settlement_late_fee.sql"),
  "utf8",
);

describe("migração de baixa de parcelas", () => {
  it("cria a RPC transacional que o frontend chama", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.pay_installment\(\s*_installment_id uuid/i);
    expect(migration).toMatch(/UPDATE public\.contract_installments[\s\S]+paid_amount = new_paid/i);
    expect(migration).toMatch(/INSERT INTO public\.transactions[\s\S]+installment_id/i);
    expect(migration).toMatch(/INSERT INTO public\.profits[\s\S]+interest_delta \+ fee_delta/i);
    expect(migration).toMatch(/_source_key text DEFAULT NULL/i);
    expect(migration).toMatch(/source_key\)[\s\S]+NULLIF\(trim\(_source_key\)/i);
  });

  it("protege o estorno e recarrega o schema cache", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.reverse_installment_payment\(_installment_id uuid\)/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.pay_installment/i);
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema'/i);
  });

  it("recalcula encargos antes de decidir se um parcial quitou a parcela", () => {
    expect(partialPaymentFix).toMatch(/calculated_late_fee numeric/i);
    expect(partialPaymentFix).toMatch(/effective_late_fee := greatest\(stored_late_fee, calculated_late_fee\)/i);
    expect(partialPaymentFix).toMatch(/total_due := round\(base_amount \+ effective_late_fee/i);
    expect(partialPaymentFix).toMatch(/late_fee = effective_late_fee/i);
    expect(partialPaymentFix).toMatch(/remaining.*greatest\(0, round\(total_due - new_paid/i);
  });

  it("não recalcula juros de atraso sobre o amount inflado da quitação por porcentagem", () => {
    // settle_percentage_installment grava amount = capital + juros antes de
    // chamar pay_installment. Sem esta guarda, o juros composto diário passa
    // a incidir sobre o capital inteiro em contratos 'percentage'/'interest_only'
    // atrasados, e a quitação falha com payment_below_installment_balance.
    expect(percentageSettlementFix).toMatch(
      /base_amount > 0 AND days_late > 0\s*\n\s*AND coalesce\(contract_row\.loan_mode, ''\) NOT IN \('percentage', 'interest_only'\)/i,
    );
    expect(percentageSettlementFix).toMatch(/CREATE OR REPLACE FUNCTION public\.pay_installment\(/i);
  });
});
