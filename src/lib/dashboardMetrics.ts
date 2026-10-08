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
import {financialDay,addFinancialDays,financialDaysBetween,openFinancialInstallments,sumMoney,type FinancialAnalytics} from "./financialAnalytics";

export interface MetricsInstallment {
  id: string;
  contract_id: string;
  amount: number | string | null;
  paid_amount?: number | string | null;
  paid_principal?: number | string | null;
  paid_interest?:number|string|null;
  paid_fees?:number|string|null;
  late_fee?:number|string|null;
  pre_settlement_snapshot?:unknown;
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
  cash?: FinancialAnalytics;
}

const num = (v: unknown) => {
  const number = Number(v ?? 0);
  return Number.isFinite(number) ? number : 0;
};

export function computeOutstandingPrincipal(
  contracts: MetricsContract[],
  installments: MetricsInstallment[],
) {
  // Without a cash report, expose only explicitly recorded principal; no rateio.
  return contracts.filter(c=>c.status==="active"||c.status==="overdue").reduce((sum,c)=>sum+Math.max(0,num(c.capital)-installments.filter(i=>i.contract_id===c.id)
    .reduce((s,i)=>s+num(i.paid_principal),0)),0);
}

// As três definições vivem em `supabase/functions/_shared/installmentStatus.ts`
// e são reexportadas aqui. Compartilhar em vez de copiar é proposital: o mesmo
// conceito precisa valer no navegador e nos crons, e foi a divergência entre os
// dois que deixou 265 parcelas fora da cobrança automática.
export {isEncerrada,isEmAberto} from "../../supabase/functions/_shared/installmentStatus";
import {isEmAberto} from "../../supabase/functions/_shared/installmentStatus";
export function isEmAtraso(i:{status?:string|null;due_date?:string|null},now=new Date()){return isEmAberto(i)&&!!financialDay(i.due_date)&&financialDaysBetween(i.due_date,now)>0;}
export function venceHoje(i:{status?:string|null;due_date?:string|null},now=new Date()){return isEmAberto(i)&&!!financialDay(i.due_date)&&financialDaysBetween(i.due_date,now)===0;}
export function diasEmAtraso(i:{status?:string|null;due_date?:string|null},now=new Date()){return isEmAtraso(i,now)?financialDaysBetween(i.due_date,now):0;}

export function computeDashboardMetrics(data: DashboardInput, agora: Date = new Date()) {
  const { contracts, installments, clients, goals, cash } = data;

  // O painel fala do dinheiro que está NA RUA: contratos encerrados vivem no
  // histórico financeiro.
  const activeContracts = contracts.filter((c) => c.status === "active" || c.status === "overdue");
  const activeIds = new Set(activeContracts.map((c) => c.id));
  const activeInstallments = installments.filter((i) => activeIds.has(i.contract_id));
  const quotedOpen=openFinancialInstallments(contracts,installments,agora);

  const capitalNaRua = cash ? Math.max(0,cash.wallet.totals.disbursements-cash.wallet.totals.principal) : computeOutstandingPrincipal(activeContracts,activeInstallments);
  const lucroAReceber = activeContracts.reduce((s, c) => s + num(c.total_interest), 0);

  const totalInstallments = activeInstallments.length;
  const overdueInstallments = quotedOpen.filter((i) => isEmAtraso(i, agora));
  const overdueContractIds = new Set([
    ...activeContracts.filter((contract) => contract.status === "overdue").map((contract) => contract.id),
    ...overdueInstallments.map((installment) => installment.contract_id),
  ]);
  const paidInstallments = installments.filter((i) => i.status === "paid");
  const receipts=cash?.receipts||[];

  const taxaInadimplencia = totalInstallments > 0
    ? (overdueInstallments.length / totalInstallments) * 100
    : 0;

  const totalReceived = cash?.wallet.totals.receipts ?? sumMoney(installments,i=>i.paid_amount);
  const totalOverdueAmount = overdueInstallments.reduce((s, i) => s + num(i.amount), 0);

  const vencendoHoje = quotedOpen.filter((i) => venceHoje(i, agora));

  const todayStr=financialDay(agora)!;
  const proximos7=quotedOpen.filter(i=>{const day=financialDay(i.due_date);return day&&day>todayStr&&day<=addFinancialDays(todayStr,7);});
  const weeklyActivity=Array.from({length:7},(_,idx)=>{
    const dayStr=addFinancialDays(todayStr,idx-6);
    return {day:new Date(dayStr+'T12:00:00Z').toLocaleDateString('pt-BR',{weekday:'short',timeZone:'America/Sao_Paulo'}).slice(0,3),
      count:receipts.filter(r=>r.day===dayStr).length};
  });
  const maxActivity = Math.max(...weeklyActivity.map((w) => w.count), 1);

  const recentPayments = receipts.filter(r=>r.day).slice(0,6).map(r=>({...r,paid_at:r.date,paid_amount:r.amount}));
  const overdueList = overdueInstallments
    .map((i) => {
      const contract = contracts.find((c) => c.id === i.contract_id);
      const due = parseLocalDate(i.due_date);
      const daysOverdue = due ? Math.max(0,financialDaysBetween(i.due_date,agora)) : 0;
      return { ...i, clientName: contract?.clients?.name || "—", daysOverdue, contractId: i.contract_id };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const paidTodayAmount=sumMoney(receipts.filter(r=>r.day===todayStr),r=>r.amount);
  const totalProfitAmount=cash?.wallet.totals.profit ?? sumMoney(installments,i=>num((i as any).paid_interest)+num((i as any).paid_fees));
  const roi = capitalNaRua > 0 ? (totalProfitAmount / capitalNaRua) * 100 : 0;

  const pendingReceivable=sumMoney(quotedOpen,i=>i.amount);

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
