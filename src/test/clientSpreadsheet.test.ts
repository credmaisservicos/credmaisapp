import { describe, expect, it } from "vitest";
import { buildClientSpreadsheetRows } from "@/lib/clientSpreadsheet";

describe("buildClientSpreadsheetRows", () => {
  it("ignora valores financeiros legados que não são números", () => {
    const [row] = buildClientSpreadsheetRows(
      [{ id: "client-1", name: "Cliente" }],
      [{ client_id: "client-1", capital: "valor inválido", total_amount: "NaN" }],
      [{ client_id: "client-1", status: "paid", amount: "100", paid_amount: "sem valor", due_date: "2026-01-01" }],
    );

    expect(row.totalCapital).toBe(0);
    expect(row.totalAmount).toBe(0);
    expect(row.totalPaid).toBe(0);
    expect(Number.isFinite(row.totalCapital)).toBe(true);
  });
});
