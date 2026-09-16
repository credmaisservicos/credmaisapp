import { describe, expect, it } from "vitest";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";

describe("dateUtils", () => {
  it("returns null/empty output for invalid external dates", () => {
    expect(parseLocalDate("data inválida")).toBeNull();
    expect(formatBR("data inválida")).toBe("");
  });

  it("keeps a bare date on the intended calendar day", () => {
    expect(formatBR("2026-02-28")).toMatch(/28\/02\/2026/);
  });
});
