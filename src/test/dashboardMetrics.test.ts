import { describe, it, expect } from "vitest";
import {
  computeDashboardMetrics,
  isEmAtraso,
  isEmAberto,
  venceHoje,
  type MetricsInstallment,
} from "@/lib/dashboardMetrics";

// O painel é a tela onde o dono decide. Ela mostrava 9 parcelas / R$ 1.648 em
// atraso quando a base tinha 276 / R$ 75.392, porque o filtro exigia
// `status === "pending"` e o check-overdue troca o status para "overdue".
// Estes testes existem para essa conta nunca mais depender de um status só.

const AGORA = new Date("2026-08-04T15:00:00");
const dias = (n: number) => new Date(AGORA.getTime() + n * 86400000).toISOString();

const parcela = (over: Partial<MetricsInstallment> = {}): MetricsInstallment => ({
  id: crypto.randomUUID(),
  contract_id: "c1",
  amount: 100,
  pre_settlement_snapshot:{},
  due_date: dias(-1),
  status: "pending",
  ...over,
});

const contrato = (over: any = {}) => ({
  id: "c1", capital: 1000, total_interest: 200, num_installments: 10,
  status: "active", clients: { name: "Cliente" }, ...over,
});

const entrada = (installments: MetricsInstallment[], contracts: any[] = [contrato()]) => ({
  contracts, installments, clients: [], goals: [],
});

describe("classificação de parcela", () => {
  it("conta como atraso independente do status ser pending ou overdue", () => {
    expect(isEmAtraso(parcela({ status: "pending", due_date: dias(-5) }), AGORA)).toBe(true);
    expect(isEmAtraso(parcela({ status: "overdue", due_date: dias(-5) }), AGORA)).toBe(true);
  });

  it("não conta parcela paga nem cancelada", () => {
    expect(isEmAtraso(parcela({ status: "paid", due_date: dias(-5) }), AGORA)).toBe(false);
    expect(isEmAtraso(parcela({ status: "cancelled", due_date: dias(-5) }), AGORA)).toBe(false);
    expect(isEmAberto(parcela({ status: "paid" }))).toBe(false);
  });

  it("não conta como atraso o que vence hoje", () => {
    const hoje = parcela({ due_date: dias(0) });
    expect(isEmAtraso(hoje, AGORA)).toBe(false);
    expect(venceHoje(hoje, AGORA)).toBe(true);
  });

  it("a hora do vencimento não muda o resultado", () => {
    const cedo = parcela({ due_date: "2026-08-04T00:30:00" });
    const tarde = parcela({ due_date: "2026-08-04T23:30:00" });
    expect(venceHoje(cedo, AGORA)).toBe(true);
    expect(venceHoje(tarde, AGORA)).toBe(true);
    expect(isEmAtraso(cedo, AGORA)).toBe(false);
  });

  it("status desconhecido é tratado como em aberto, não sumido", () => {
    // Se amanhã surgir um status novo, ele precisa aparecer na conta,
    // não desaparecer silenciosamente como aconteceu com "overdue".
    expect(isEmAberto(parcela({ status: "renegotiated" }))).toBe(true);
    expect(isEmAtraso(parcela({ status: "renegotiated", due_date: dias(-3) }), AGORA)).toBe(true);
  });
});

describe("inadimplência no painel", () => {
  it("conta contrato ativo como em atraso quando uma parcela já venceu", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "overdue", due_date: dias(-10) }),
        parcela({ status: "pending", due_date: dias(10) }),
      ]),
      AGORA,
    );

    expect(m.overdueCount).toBe(1);
    expect(m.contratosAtraso).toBe(1);
  });

  it("soma pending e overdue vencidas — o bug que escondia 97% do atraso", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "pending", due_date: dias(-2), amount: 100 }),
        parcela({ status: "overdue", due_date: dias(-10), amount: 500 }),
        parcela({ status: "overdue", due_date: dias(-30), amount: 400 }),
        parcela({ status: "paid", due_date: dias(-40), amount: 999 }),
        parcela({ status: "pending", due_date: dias(5), amount: 300 }),
      ]),
      AGORA,
    );

    expect(m.overdueCount).toBe(3);
    expect(m.totalOverdueAmount).toBe(1000);
    // Antes da correção, esta mesma entrada devolveria 1 parcela e R$ 100.
  });

  it("reproduz a proporção real da base: quase tudo em atraso tem status overdue", () => {
    const parcelas = [
      ...Array.from({ length: 9 }, () => parcela({ status: "pending", due_date: dias(-3), amount: 183 })),
      ...Array.from({ length: 267 }, () => parcela({ status: "overdue", due_date: dias(-20), amount: 274 })),
      ...Array.from({ length: 441 }, () => parcela({ status: "pending", due_date: dias(10), amount: 200 })),
    ];
    const m = computeDashboardMetrics(entrada(parcelas), AGORA);

    expect(m.overdueCount).toBe(276);
    expect(Math.round(m.totalOverdueAmount)).toBe(9 * 183 + 267 * 274);
    // A taxa precisa refletir a carteira inteira, não só as 9 "pending"
    expect(m.taxaInadimplencia).toBeGreaterThan(35);
  });

  it("taxa é zero quando não há parcela em atraso", () => {
    const m = computeDashboardMetrics(
      entrada([parcela({ status: "paid", due_date: dias(-5) }), parcela({ due_date: dias(10) })]),
      AGORA,
    );
    expect(m.overdueCount).toBe(0);
    expect(m.taxaInadimplencia).toBe(0);
  });
});

describe("vencimentos próximos", () => {
  it("vencendo hoje inclui parcela já marcada como overdue no mesmo dia", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "pending", due_date: dias(0) }),
        parcela({ status: "overdue", due_date: dias(0) }),
        parcela({ status: "paid", due_date: dias(0) }),
      ]),
      AGORA,
    );
    expect(m.vencendoHoje).toBe(2);
  });

  it("próximos 7 dias ignora pagas e não conta as já vencidas", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ due_date: dias(3) }),
        parcela({ status: "overdue", due_date: dias(5) }),
        parcela({ status: "paid", due_date: dias(4) }),
        parcela({ due_date: dias(20) }),
        parcela({ due_date: dias(-2) }),
      ]),
      AGORA,
    );
    expect(m.proximos7).toBe(2);
  });
});

describe("carteira e capital", () => {
  it("só conta contrato ativo — quitado não é capital na rua", () => {
    const m = computeDashboardMetrics(
      entrada(
        [parcela({ contract_id: "c1" }), parcela({ contract_id: "c2" })],
        [
          contrato({ id: "c1", capital: 1000, status: "active" }),
          contrato({ id: "c2", capital: 5000, status: "completed" }),
        ],
      ),
      AGORA,
    );
    expect(m.capitalNaRua).toBe(1000);
    expect(m.contratosAtivos).toBe(1);
    // parcela de contrato encerrado não entra em nenhuma conta
    expect(m.overdueCount).toBe(1);
  });

  it("a receber soma tudo que está em aberto, pending ou overdue", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "pending", amount: 100, due_date: dias(5) }),
        parcela({ status: "overdue", amount: 200, due_date: dias(-5) }),
        parcela({ status: "paid", amount: 900, due_date: dias(-5) }),
      ]),
      AGORA,
    );
    expect(m.pendingReceivable).toBe(300);
  });

  it("lucro realizado desconta a devolução de capital", () => {
    // contrato de 1000 em 10 parcelas: cada parcela devolve 100 de capital
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "paid", amount: 120, paid_amount: 120, paid_principal:100,paid_interest:20, paid_at: dias(-1) }),
        parcela({ status: "paid", amount: 120, paid_amount: 120, paid_principal:100,paid_interest:20, paid_at: dias(-2) }),
      ]),
      AGORA,
    );
    expect(m.totalReceived).toBe(240);
    expect(m.totalProfitAmount).toBe(40); // 240 recebidos - 200 de capital
    expect(m.lucroRecebido).toBe(40);     // antes era zero fixo no código
  });

  it("reduz capital na rua pelo principal efetivamente devolvido", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "paid", paid_amount: 300, paid_principal: 180, paid_interest:120, paid_at: dias(-1) }),
        parcela({ status: "pending", due_date: dias(10) }),
      ]),
      AGORA,
    );
    expect(m.capitalNaRua).toBe(820);
    expect(m.totalProfitAmount).toBe(120);
  });

  it("não inventa lucro negativo", () => {
    const m = computeDashboardMetrics(
      entrada([parcela({ status: "paid", amount: 10, paid_amount: 10, paid_at: dias(-1) })]),
      AGORA,
    );
    expect(m.totalProfitAmount).toBe(0);
  });
});

describe("robustez", () => {
  it("carteira vazia não quebra nem divide por zero", () => {
    const m = computeDashboardMetrics({ contracts: [], installments: [], clients: [], goals: [] }, AGORA);
    expect(m.taxaInadimplencia).toBe(0);
    expect(m.roi).toBe(0);
    expect(m.overdueList).toEqual([]);
  });

  it("valores em texto vindos do banco são somados como número", () => {
    const m = computeDashboardMetrics(
      entrada([parcela({ status: "overdue", amount: "150.50" as any, due_date: dias(-2) })]),
      AGORA,
    );
    expect(m.totalOverdueAmount).toBeCloseTo(150.5, 2);
  });

  it("lista de atraso vem ordenada do mais antigo para o mais recente", () => {
    const m = computeDashboardMetrics(
      entrada([
        parcela({ status: "overdue", due_date: dias(-2) }),
        parcela({ status: "overdue", due_date: dias(-40) }),
        parcela({ status: "overdue", due_date: dias(-10) }),
      ]),
      AGORA,
    );
    expect(m.overdueList.map((i: any) => i.daysOverdue)).toEqual([40, 10, 2]);
  });
});
