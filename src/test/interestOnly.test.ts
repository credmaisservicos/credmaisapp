import { describe, expect, it } from "vitest";
import { isMissingRpcError } from "@/lib/interestOnly";

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
