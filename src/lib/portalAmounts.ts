import { outstandingDue, type LateFeeInput } from "@/lib/lateFee";

/** Valor exibido/cobrado no portal, sem duplicar encargos nem ignorar parciais. */
export function portalInstallmentAmount(installment: LateFeeInput, now?: Date): number {
  if (installment.status === "paid") {
    const paid = Number(installment.paid_amount);
    const amount = Number(installment.amount ?? 0);
    return Number.isFinite(paid) && paid > 0 ? paid : Number.isFinite(amount) ? amount : 0;
  }
  return outstandingDue(installment, now);
}

/** Total acumulado que os RPCs de baixa recebem após um novo pagamento. */
export function accumulatedPaymentTotal(installment: LateFeeInput, receivedNow: number): number {
  const paid = Number(installment.paid_amount ?? 0);
  const received = Number(receivedNow ?? 0);
  return Math.round(((Number.isFinite(paid) ? paid : 0) + (Number.isFinite(received) ? received : 0)) * 100) / 100;
}
