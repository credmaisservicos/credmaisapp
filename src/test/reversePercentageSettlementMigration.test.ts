import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922100000_reverse_percentage_settlement.sql"),
  "utf8",
);

describe("migração de estorno de quitação por porcentagem/só-juros", () => {
  it("settle_percentage_installment guarda o estado anterior antes de inflar amount", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS pre_settlement_snapshot jsonb/i);
    expect(migration).toMatch(
      /pre_settlement_snapshot = COALESCE\(_inst\.pre_settlement_snapshot, jsonb_build_object\(/i,
    );
    expect(migration).toMatch(/'amount', _inst\.amount/i);
    expect(migration).toMatch(/'scheduled_principal', _inst\.scheduled_principal/i);
    expect(migration).toMatch(/'scheduled_interest', _inst\.scheduled_interest/i);
  });

  it("reverse_installment_payment restaura amount/scheduled_* do snapshot e o limpa", () => {
    // Regressão: sem isso, estornar uma quitação por porcentagem/só-juros
    // deixava `amount` permanentemente inflado em capital+juros, inflando o
    // juros de atraso composto diário calculado sobre essa base a partir daí.
    expect(migration).toMatch(
      /amount = CASE WHEN snap IS NOT NULL THEN \(snap->>'amount'\)::numeric ELSE amount END/i,
    );
    expect(migration).toMatch(
      /scheduled_principal = CASE WHEN snap IS NOT NULL THEN \(snap->>'scheduled_principal'\)::numeric ELSE scheduled_principal END/i,
    );
    expect(migration).toMatch(
      /scheduled_interest = CASE WHEN snap IS NOT NULL THEN \(snap->>'scheduled_interest'\)::numeric ELSE scheduled_interest END/i,
    );
    expect(migration).toMatch(/pre_settlement_snapshot = NULL/i);
  });
});
