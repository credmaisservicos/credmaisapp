import { outstandingDue, type LateFeeInput } from "@/lib/lateFee";
import { isOverdue } from './dateUtils';

export type PortalAmountInput = LateFeeInput & { contract_status?: string | null; contracts?: LateFeeInput['contracts'] & { status?: string | null } };
const nonNegative = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? Math.max(0, number) : 0; };

/** Recebimentos parciais também são históricos; zero explícito não é ausência. */
export function portalReceivedAmount(installment: LateFeeInput): number {
  if (installment.paid_amount != null && installment.paid_amount !== '') return nonNegative(installment.paid_amount);
  return installment.status === 'paid' ? nonNegative(installment.amount) : 0;
}

export function isPortalInstallmentOpen(installment: PortalAmountInput): boolean {
  return installment.status !== 'paid' && installment.status !== 'cancelled' &&
    (installment.contract_status ?? installment.contracts?.status) !== 'cancelled';
}

export function isPortalInstallmentOverdue(installment: PortalAmountInput, now?: Date): boolean {
  return isPortalInstallmentOpen(installment) && isOverdue(installment.due_date, now);
}

export function portalOutstandingAmount(installment: PortalAmountInput, now?: Date): number {
  return isPortalInstallmentOpen(installment) ? outstandingDue(installment, now) : 0;
}

export function withPortalContract<T extends LateFeeInput>(installment: T, contract: NonNullable<PortalAmountInput['contracts']>): T & PortalAmountInput {
  return { ...installment, contracts: contract, contract_status: contract.status };
}

export function portalFinancialSummary(contracts: Array<NonNullable<PortalAmountInput['contracts']> & { installments?: LateFeeInput[] }>, now = new Date()) {
  const rows = contracts.flatMap(contract => (contract.installments || []).map(i => withPortalContract(i, contract)));
  const open = rows.filter(isPortalInstallmentOpen);
  const overdue = open.filter(i => isPortalInstallmentOverdue(i, now));
  const paidCount = rows.filter(i => i.status === 'paid').length;
  const sum = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
  return {
    activeContracts: contracts.filter(c => c.status === 'active' || c.status === 'overdue').length,
    openAmount: sum(open.map(i => portalOutstandingAmount(i, now))),
    paidAmount: sum(rows.map(portalReceivedAmount)),
    overdueAmount: sum(overdue.map(i => portalOutstandingAmount(i, now))),
    openCount: open.length, overdueCount: overdue.length, paidCount,
    progressPct: paidCount + open.length ? Math.round(paidCount * 100 / (paidCount + open.length)) : 0,
  };
}

/** Valor exibido/cobrado no portal, sem duplicar encargos nem ignorar parciais. */
export function portalInstallmentAmount(installment: PortalAmountInput, now?: Date): number {
  if (installment.status === "paid") {
    return portalReceivedAmount(installment);
  }
  return portalOutstandingAmount(installment, now);
}

/** Total acumulado que os RPCs de baixa recebem após um novo pagamento. */
export function accumulatedPaymentTotal(installment: LateFeeInput, receivedNow: number): number {
  const paid = Number(installment.paid_amount ?? 0);
  const received = Number(receivedNow ?? 0);
  return Math.round(((Number.isFinite(paid) ? paid : 0) + (Number.isFinite(received) ? received : 0)) * 100) / 100;
}
