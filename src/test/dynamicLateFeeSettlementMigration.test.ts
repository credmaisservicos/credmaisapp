import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922130000_dynamic_late_fee_tracks_settlement.sql"),
  "utf8",
);

describe("migração: recálculo dinâmico de juros/multa segue o snapshot de quitação, não o loan_mode", () => {
  it("recalcula dinamicamente sempre que a parcela não está com amount inflado por quitação", () => {
    // Regressão: pular o recálculo para TODO contrato 'percentage'/'interest_only'
    // (em vez de só quando essa parcela específica foi inflada por
    // settle_percentage_installment) fazia o servidor confiar num late_fee
    // gravado que podia estar bem abaixo do que a tela mostra — um
    // pagamento parcial fechava a parcela como paga.
    expect(migration).toMatch(
      /AND inst\.pre_settlement_snapshot IS NULL THEN/i,
    );
    expect(migration).not.toMatch(/loan_mode, ''\) NOT IN \('percentage', 'interest_only'\)/i);
  });

  it("settle_percentage_installment ainda pula o recálculo (snapshot fica setado antes da chamada)", () => {
    expect(migration).toMatch(/base_amount > 0 AND days_late > 0\s*\n\s*AND inst\.pre_settlement_snapshot IS NULL/i);
  });

  it("mantém desconto só em quitação total e a resposta com fee_discount", () => {
    expect(migration).toMatch(/applied_fee_discount := CASE WHEN _mark_paid/i);
    expect(migration).toMatch(/'fee_discount', applied_fee_discount/i);
  });
});
