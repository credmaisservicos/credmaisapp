import { describe, expect, it } from "vitest";
import { generatePixPayload } from "@/utils/pixGenerator";
import { interestOnlyAmount } from "@/lib/interestOnly";

describe("utilitários financeiros com dados legados", () => {
  it("gera payload PIX finito mesmo com valor e metadados inválidos", () => {
    const payload = generatePixPayload(null as never, Number.NaN, null as never, null as never, null as never);
    expect(payload).toContain("54040.00");
    expect(payload).not.toMatch(/NaN|undefined/);
  });

  it("não propaga valores não finitos no cálculo de juros-only", () => {
    const amount = interestOnlyAmount(
      { amount: Number.NaN },
      { capital: Number.POSITIVE_INFINITY, total_amount: Number.NaN, total_interest: Number.NaN, num_installments: 0 },
      Number.NaN,
    );
    expect(Number.isFinite(amount)).toBe(true);
    expect(amount).toBe(0);
  });
});
