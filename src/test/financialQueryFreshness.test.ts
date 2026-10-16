import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { FINANCIAL_QUERY_STALE_TIME } from "@/lib/financialAnalytics";

const analyses = readFileSync(resolve(process.cwd(), "src/pages/Analises.tsx"), "utf8");
const wallet = readFileSync(resolve(process.cwd(), "src/pages/Carteira.tsx"), "utf8");

describe("cache dos relatórios financeiros", () => {
  it("reusa dados recentes e atualiza quando invalidado", async () => {
    const staleTime = FINANCIAL_QUERY_STALE_TIME;
    expect(staleTime).toBe(30_000);

    const client = new QueryClient();
    const queryKey = ["financial-report"];
    client.setQueryData(queryKey, { total: 10 });
    const queryFn = vi.fn().mockResolvedValue({ total: 20 });
    const observer = new QueryObserver(client, { queryKey, queryFn, staleTime });
    const unsubscribe = observer.subscribe(() => {});

    expect(queryFn).not.toHaveBeenCalled();
    await client.invalidateQueries({ queryKey });
    expect(queryFn).toHaveBeenCalledOnce();
    unsubscribe();
    client.clear();
  });

  it("usa a mesma validade curta sem forçar recarga em cada abertura", () => {
    for (const page of [analyses, wallet]) {
      expect(/staleTime\s*:\s*FINANCIAL_QUERY_STALE_TIME/.test(page)).toBe(true);
      expect(/refetchOnMount\s*:\s*["']always["']/.test(page)).toBe(false);
      expect(/refetchOnWindowFocus\s*:\s*true/.test(page)).toBe(false);
    }
  });
});
