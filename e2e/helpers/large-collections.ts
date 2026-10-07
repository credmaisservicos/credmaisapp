import type { Page } from "@playwright/test";

/** Dados fictícios para medir listas grandes sem acessar contas ou pagamentos reais. */
export async function mockLargeCollections(page: Page, clientCount = 120, perClient = 12) {
  const uid = "11111111-1111-4111-8111-111111111111";
  const id = (prefix: string, index: number) => `${prefix}-${String(index).padStart(12, "0")}`;
  const clients = Array.from({ length: clientCount }, (_, n) => ({
    id: id("33333333-3333-4333-8333", n + 1), user_id: uid,
    name: `Cliente ${String(n + 1).padStart(4, "0")}`, phone: "", whatsapp: "", email: "",
    status: "Ativo", credit_score: 80, created_at: "2026-01-01T00:00:00Z",
  }));
  const contracts = clients.map((client, n) => ({
    id: id("44444444-4444-4444-8444", n + 1), client_id: client.id, user_id: uid,
    capital: perClient * 90, total_interest: perClient * 10, total_amount: perClient * 100,
    num_installments: perClient, installment_amount: 100, interest_rate: 0,
    status: "active", frequency: "monthly", created_at: "2026-01-01T00:00:00Z",
    clients: client, loan_mode: "standard", daily_interest_percent: 0,
    daily_penalty_type: "none", daily_penalty_value: 0,
  }));
  const installments = clients.flatMap((client, n) => Array.from({ length: perClient }, (_, i) => ({
    id: id("55555555-5555-4555-8555", n * perClient + i + 1), user_id: uid,
    client_id: client.id, contract_id: contracts[n].id, installment_number: i + 1,
    amount: 100, paid_amount: 0, late_fee: 0, due_date: "2030-11-18", paid_at: null,
    status: "pending", created_at: "2026-01-01T00:00:00Z", clients: client, contracts: contracts[n],
  })));
  let reads = 0;
  await page.route(/https:\/\/(?:[^/]+\.supabase\.co|credmaisapp-supabase\.fcoipz\.easypanel\.host)\//, async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/").pop();
    const rows = table === "clients" ? clients : table === "contracts" ? contracts : table === "contract_installments" ? installments : null;
    if (!rows || route.request().method() !== "GET") { await route.fallback(); return; }
    reads++;
    const from = Number(url.searchParams.get("offset") || 0);
    const limit = Number(url.searchParams.get("limit") || rows.length);
    await route.fulfill({ status: 200, json: rows.slice(from, from + limit), headers: { "content-range": `${from}-${Math.min(rows.length, from + limit) - 1}/${rows.length}` } });
  });
  return { clientCount, installmentCount: installments.length, total: installments.length * 100, reads: () => reads };
}
