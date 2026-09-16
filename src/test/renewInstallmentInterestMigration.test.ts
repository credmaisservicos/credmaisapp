import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260916120000_renew_installment_interest.sql"),
  "utf8",
);

describe("renew installment interest migration", () => {
  it("renews the due date only after validating ownership and status", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.renew_installment_interest");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("installment_not_found");
    expect(migration).toContain("installment_closed");
    expect(migration).toContain("next_due_date_required");
  });

  it("keeps the same interest rule as src/lib/interestOnly.ts per loan mode", () => {
    expect(migration).toContain("WHEN _contract.loan_mode = 'bullet' THEN _total_interest");
    expect(migration).toContain("WHEN _contract.loan_mode IN ('percentage', 'interest_only')");
  });

  it("records the payment and returns the previous due date for the caller", () => {
    expect(migration).toContain("INSERT INTO public.transactions");
    expect(migration).toContain("INSERT INTO public.profits");
    expect(migration).toContain("'previous_due_date', _previous_due");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.renew_installment_interest");
  });
});
