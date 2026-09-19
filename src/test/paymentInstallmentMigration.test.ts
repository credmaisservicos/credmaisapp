import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260919090000_payment_installment_atomic.sql"),
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
});
