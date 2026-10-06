/**
 * Métricas do painel — extraídas da tela para poderem ser testadas.
 *
 * Estavam embutidas no componente, e por isso ninguém percebeu que a conta de
 * inadimplência filtrava por `status === "pending"`. Quando uma parcela vence, o
 * `check-overdue` muda o status para `overdue` — então esse filtro excluía
 * justamente as parcelas atrasadas. Com a base de 2026-08-04, o painel mostrava
 * 9 parcelas / R$ 1.648 em atraso quando o real era 276 / R$ 75.392.
 *
 * Regra que vale para o arquivo inteiro: atraso NÃO se define por um status
 * específico, e sim por "não está paga e já venceu".
 */

export type InstallmentStatus = "pending" | "overdue" | "paid" | "cancelled" | string;
import { parseLocalDate } from "./dateUtils";

export interface MetricsInstallment {
  id: string;
  contract_id: string;
  amount: number | string | null;
  paid_amount?: number | string | null;
  paid_principal?: number | string | null;
  due_date: string;
  paid_at?: string | null;
  status: InstallmentStatus;
}

export interface MetricsContract {
  id: string;
  capital: number | string;
  total_interest: number | string;
  num_installments: number | string;
  status: string;
  clients?: { name?: string | null } | null;
}

export interface DashboardInput {
  contracts: MetricsContract[];
  installments: MetricsInstallment[];
  clients: unknown[];
  goals: unknown[];
}

const num = (v: unknown) => {
  const number = Number(v ?? 0);
  return Number.isFinite(number) ? number : 0;
};

export function computeOutstandingPrincipal(
  contracts: MetricsContract[],
  installments: MetricsInstallment[],
) {
  const active = contracts.filter((c) => c.status === "active" || c.status === "overdue");
  const activeIds = new Set(active.map((c) => c.id));
  const returned = new Map<string, number>();
  for (const installment of installments) {
    if (installment.status !== "paid" || !activeIds.has(installment.contract_id)) continue;
    const contract = active.find((c) => c.id === installment.contract_id);
    const fallback = contract ? num(contract.capital) / (num(contract.num_installments) || 1) : 0;
    returned.set(installment.contract_id, (returned.get(installment.contract_id) || 0) +
      (installment.paid_principal == null ? fallback : num(installment.paid_principal)));
  }
  return active.reduce((sum, contract) =>
    sum + Math.max(0, num(contract.capital) - (returned.get(contract.id) || 0)), 0);
}

// As três definições vivem em `supabase/functions/_shared/installmentStatus.ts`
// e são reexportadas aqui. Compartilhar em vez de copiar é proposital: o mesmo
// conceito precisa valer no navegador e nos crons, e foi a divergência entre os
// dois que deixou 265 parcelas fora da cobrança automática.
export {
  isEncerrada,
  isEmAberto,
  isEmAtraso,
  venceHoje,
  diasEmAtraso,
} from "../../supabase/functions/_shared/installmentStatus";

import { isEmAberto, isEmAtraso, venceHoje } from "../../supabase/functions/_shared/installmentStatus";

export function computeDashboardMetrics(data: DashboardInput, agora: Date = new Date()) {
  const { contracts, installments, clients, goals } = data;

  // O painel fala do dinheiro que está NA RUA: contratos encerrados vivem no
  // histórico financeiro.
  const activeContracts = contracts.filter((c) => c.status === "active" || c.status === "overdue");
  const activeIds = new Set(activeContracts.map((c) => c.id));
  const activeInstallments = installments.filter((i) => activeIds.has(i.contract_id));

  const capitalNaRua = computeOutstandingPrincipal(activeContracts, activeInstallments);
  const lucroAReceber = activeContracts.reduce((s, c) => s + num(c.total_interest), 0);

  const totalInstallments = activeInstallments.length;
  const overdueInstallments = activeInstallments.filter((i) => isEmAtraso(i, agora));
  const overdueContractIds = new Set([
    ...activeContracts.filter((contract) => contract.status === "overdue").map((contract) => contract.id),
    ...overdueInstallments.map((installment) => installment.contract_id),
  ]);
  const paidInstallments = activeInstallments.filter((i) => i.status === "paid");

  const taxaInadimplencia = totalInstallments > 0
    ? (overdueInstallments.length / totalInstallments) * 100
    : 0;

  const totalReceived = paidInstallments.reduce((s, i) => s + num(i.paid_amount ?? i.amount), 0);
  const totalOverdueAmount = overdueInstallments.reduce((s, i) => s + num(i.amount), 0);

  const vencendoHoje = activeInstallments.filter((i) => venceHoje(i, agora));

  const em7dias = new Date(agora.getTime() + 7 * 86400000);
  const proximos7 = activeInstallments.filter((i) => {
    if (!isEmAberto(i) || !i.due_date) return false;
    const d = parseLocalDate(i.due_date);
    return !!d && d > agora && d <= em7dias;
  });

  const todayStr = agora.toISOString().split("T")[0];

  const weeklyActivity = Array.from({ length: 7 }, (_, idx) => {
    const day = new Date(agora);
    day.setDate(day.getDate() - (6 - idx));
    const dayStr = day.toISOString().split("T")[0];
    const count = paidInstallments.filter((p) => p.paid_at?.startsWith(dayStr)).length;
    return { day: day.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3), count };
  });
  const maxActivity = Math.max(...weeklyActivity.map((w) => w.count), 1);

  const recentPayments = [...paidInstallments]
    .sort((a, b) => (parseLocalDate(b.paid_at)?.getTime() ?? 0) - (parseLocalDate(a.paid_at)?.getTime() ?? 0))
    .slice(0, 6);

  const overdueList = overdueInstallments
    .map((i) => {
      const contract = contracts.find((c) => c.id === i.contract_id);
      const due = parseLocalDate(i.due_date);
      const daysOverdue = due ? Math.max(0, Math.floor((agora.getTime() - due.getTime()) / 86400000)) : 0;
      return { ...i, clientName: contract?.clients?.name || "—", daysOverdue, contractId: i.contract_id };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const paidToday = paidInstallments.filter((p) => p.paid_at?.startsWith(todayStr));
  const paidTodayAmount = paidToday.reduce((s, p) => s + num(p.paid_amount ?? p.amount), 0);

  // Lucro: do que já entrou, quanto era juros e não devolução de capital.
  const totalCapitalReturned = paidInstallments.reduce((s, i) => {
    if (i.paid_principal != null) return s + num(i.paid_principal);
    const contract = activeContracts.find((c) => c.id === i.contract_id);
    return contract ? s + num(contract.capital) / (num(contract.num_installments) || 1) : s;
  }, 0);
  const totalProfitAmount = Math.max(0, totalReceived - totalCapitalReturned);

  const roi = capitalNaRua > 0 ? (totalProfitAmount / capitalNaRua) * 100 : 0;

  const pendingReceivable = activeInstallments
    .filter(isEmAberto)
    .reduce((s, i) => s + num(i.amount), 0);

  return {
    capitalNaRua,
    // Mantido por compatibilidade com os cartões: o lucro efetivamente
    // realizado dos contratos ativos é `totalProfitAmount`.
    lucroRecebido: totalProfitAmount,
    lucroAReceber,
    taxaInadimplencia,
    totalReceived,
    totalOverdueAmount,
    roi,
    totalLent: capitalNaRua,
    pendingReceivable,
    contratosAtivos: activeContracts.length,
    // Um contrato em atraso pode ainda ter status "active" no banco. Conte-o
    // também quando pelo menos uma parcela pendente já venceu.
    contratosAtraso: overdueContractIds.size,
    totalContratos: activeContracts.length,
    totalClientes: clients.length,
    overdueCount: overdueInstallments.length,
    vencendoHoje: vencendoHoje.length,
    proximos7: proximos7.length,
    overdueList,
    recentPayments,
    goals,
    contracts: activeContracts,
    weeklyActivity,
    maxActivity,
    paidTodayAmount,
    totalProfitAmount,
  };
}
