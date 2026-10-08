import {portalOutstandingAmount,type PortalAmountInput} from "./portalAmounts";
import { isEmAberto, isEmAtraso } from "@/lib/dashboardMetrics";

export type ReportInstallment = {
  contract_id?: string | null;
  status?: string | null;
  amount?: number | string | null;
  paid_amount?: number | string | null;
  late_fee?: number | string | null;
  due_date?: string | null;
  pre_settlement_snapshot?:unknown;
  contracts?:PortalAmountInput["contracts"];
};

export type ReportContract = { id: string; status?: string | null };

const money = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Saldo efetivamente aberto, incluindo encargos já materializados. */
export const installmentOutstanding = (installment: ReportInstallment,reference=new Date()): number =>
  portalOutstandingAmount(installment as PortalAmountInput,reference);

/**
 * Contratos quitados continuam no mês em que venceram. Se fossem removidos, o
 * último pagamento desapareceria do relatório assim que a quitação terminasse.
 */
export const reportableInstallments = (
  installments: ReportInstallment[],
  contracts: ReportContract[],
): ReportInstallment[] => {
  const cancelledContractIds = new Set(
    contracts.filter((contract) => contract.status === "cancelled").map((contract) => contract.id),
  );
  return installments.filter((installment) =>
    installment.status !== "cancelled" &&
    (!installment.contract_id || !cancelledContractIds.has(installment.contract_id)),
  );
};

export const summarizeReportInstallments = (
  installments: ReportInstallment[],
  reference = new Date(),
) => {
  const paid = installments.filter((installment) => installment.status === "paid");
  const overdue = installments.filter((installment) => isEmAtraso(installment, reference));
  const pending = installments.filter((installment) =>
    isEmAberto(installment) && !isEmAtraso(installment, reference),
  );
  return {
    paidCount: paid.length,
    overdueCount: overdue.length,
    pendingCount: pending.length,
    totalOverdue: overdue.reduce((total, installment) => total + installmentOutstanding(installment,reference), 0),
  };
};
