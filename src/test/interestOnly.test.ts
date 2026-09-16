import { describe, expect, it, vi } from "vitest";
import { applyInterestOnlyRenewalFallback, isMissingRpcError } from "@/lib/interestOnly";

describe("isMissingRpcError", () => {
  it("detects the PostgREST missing-function error", () => {
    expect(isMissingRpcError({ code: "PGRST202", message: "..." })).toBe(true);
    expect(isMissingRpcError({ message: "Could not find the function public.renew_installment_interest in the schema cache" })).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingRpcError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
    expect(isMissingRpcError(undefined)).toBe(false);
  });
});

function makeSupabaseMock(opts: { updateError?: unknown; insertErrors?: Record<string, unknown> } = {}) {
  const { updateError = null, insertErrors = {} } = opts;
  const calls: { updates: Array<{ table: string; patch: any }>; inserts: Array<{ table: string; row: any }> } = {
    updates: [],
    inserts: [],
  };
  const supabase = {
    from(table: string) {
      return {
        update(patch: any) {
          calls.updates.push({ table, patch });
          return { eq: () => ({ eq: () => Promise.resolve({ error: updateError }) }) };
        },
        insert(row: any) {
          calls.inserts.push({ table, row });
          return Promise.resolve({ error: insertErrors[table] ?? null });
        },
      };
    },
  };
  return { supabase, calls };
}

const installment = {
  id: "inst-1",
  client_id: "client-1",
  contract_id: "contract-1",
  due_date: "2026-09-16",
  late_fee: 5,
  installment_number: 3,
};

describe("applyInterestOnlyRenewalFallback", () => {
  it("renews the installment and books the payment when the RPC is missing", async () => {
    const { supabase, calls } = makeSupabaseMock();
    await applyInterestOnlyRenewalFallback(supabase, {
      userId: "user-1",
      installment,
      nextDueDate: "2026-10-16",
      received: 105,
      origin: "cobrancas",
    });

    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toMatchObject({
      table: "contract_installments",
      patch: { due_date: "2026-10-16", late_fee: 0, paid_amount: 0, paid_at: null, status: "pending", payment_method: "pix" },
    });

    expect(calls.inserts).toHaveLength(2);
    expect(calls.inserts[0]).toMatchObject({
      table: "transactions",
      row: { amount: 105, interest_amount: 100, fee_amount: 5, principal_amount: 0, installment_id: "inst-1" },
    });
    expect(calls.inserts[1]).toMatchObject({ table: "profits", row: { amount: 105 } });
  });

  it("rejects a non-positive renewal amount before touching the database", async () => {
    const { supabase, calls } = makeSupabaseMock();
    await expect(
      applyInterestOnlyRenewalFallback(supabase, { userId: "user-1", installment, nextDueDate: "2026-10-16", received: 0 }),
    ).rejects.toThrow("invalid_renewal_amount");
    expect(calls.updates).toHaveLength(0);
  });

  it("throws without booking a payment when the due-date update fails", async () => {
    const updateError = new Error("update failed");
    const { supabase, calls } = makeSupabaseMock({ updateError });
    await expect(
      applyInterestOnlyRenewalFallback(supabase, { userId: "user-1", installment, nextDueDate: "2026-10-16", received: 105 }),
    ).rejects.toBe(updateError);
    expect(calls.inserts).toHaveLength(0);
  });

  it("restores the previous due date when the transaction insert fails", async () => {
    const transactionError = new Error("insert failed");
    const { supabase, calls } = makeSupabaseMock({ insertErrors: { transactions: transactionError } });
    await expect(
      applyInterestOnlyRenewalFallback(supabase, { userId: "user-1", installment, nextDueDate: "2026-10-16", received: 105 }),
    ).rejects.toBe(transactionError);

    expect(calls.inserts).toHaveLength(1);
    expect(calls.updates).toHaveLength(2);
    expect(calls.updates[1].patch).toEqual({ due_date: "2026-09-16" });
  });
});
