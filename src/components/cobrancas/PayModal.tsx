import { useState, useMemo } from "react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { CheckCircle, CalendarDays, AlertTriangle, Loader2 } from "lucide-react";
import { formatBR, todayLocalISO } from "@/lib/dateUtils";
import { calculateFeeDiscount, type LateFeeBreakdown } from "@/lib/lateFee";
import { interestOnlyAmount, nextInterestDueDate, supportsInterestOnlyRenewal } from "@/lib/interestOnly";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  inst: any;
  fee: LateFeeBreakdown;
  alreadyPaid: number;
  remaining: number;
  daysLate: number;
  onCancel: () => void;
  onConfirm: (value: number, feeDiscount?: number, options?: { mode: "payment" | "interest_only" | "settle"; nextDueDate?: string }) => void | Promise<void>;
}

const PayModal = ({ inst, fee, alreadyPaid, remaining, daysLate, onCancel, onConfirm }: Props) => {
  const [mode, setMode] = useState<"full" | "partial" | "interest_only" | "settle" | "discount_fee" | "no_fee">("full");
  const safeRemaining = safeNumber(remaining);
  const [raw, setRaw] = useState<string>(safeRemaining.toFixed(2).replace(".", ","));
  const [discountPercent, setDiscountPercent] = useState(50);
  const [saving, setSaving] = useState(false);
  const automaticNextDue = nextInterestDueDate(inst.due_date, inst.contracts?.frequency);
  const [nextDueDate, setNextDueDate] = useState(automaticNextDue);
  const loanMode = String(inst.contracts?.loan_mode || "").toLowerCase();
  const renewableMode = ["percentage", "interest_only"].includes(loanMode);
  const canPayInterestOnly = supportsInterestOnlyRenewal(loanMode);
  const canSettleRenewable = renewableMode && ["daily", "weekly", "biweekly", "monthly"].includes(String(inst.contracts?.frequency || "").toLowerCase());
  const capitalSettlement = Math.max(0, safeNumber(inst.contracts?.capital)) + safeRemaining;

  const value = useMemo(() => {
    const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }, [raw]);

  // "Pagar só juros": quita apenas o rendimento do período (juros do contrato
  // + juros/multa de atraso, quando informados), mantendo o capital pendente.
  const totalInterestOnly = interestOnlyAmount(inst, inst.contracts, fee.juros > 0 ? fee.juros : 0);

  // "Sem multa": perdoa os juros/multa de atraso e quita apenas o valor original.
  const discountCalc = calculateFeeDiscount(remaining, fee.total, mode === "no_fee" ? 100 : mode === "discount_fee" ? discountPercent : 0);
  const discountableFee = discountCalc.discountable;
  const feeDiscount = discountCalc.discount;
  const remainingWithDiscount = discountCalc.amountToReceive;

  const finalValue =
    mode === "full" ? remaining :
    mode === "no_fee" ? remainingWithDiscount :
    mode === "discount_fee" ? remainingWithDiscount :
    mode === "interest_only" ? totalInterestOnly :
    mode === "settle" ? capitalSettlement :
    value;

  const isPartial = (mode === "partial" || mode === "interest_only") && finalValue > 0 && finalValue + 0.005 < remaining;
  const canSettleWithoutNewMoney = feeDiscount > 0 && alreadyPaid + 0.005 >= fee.base;


  const restAfter = Math.max(0, Math.round((remaining - finalValue) * 100) / 100);

  const confirm = async () => {
    if (saving || (finalValue <= 0 && !canSettleWithoutNewMoney)) return;
    setSaving(true);
    try {
      await onConfirm(finalValue, feeDiscount, mode === "interest_only"
        ? { mode: "interest_only", nextDueDate }
        : mode === "settle" ? { mode: "settle" }
        : { mode: "payment" });
    } finally {
      setSaving(false);
    }
  };


  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-90 flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-xs"
      onClick={onCancel}
    >
      <div
        className="w-full sm:max-w-md bg-card border border-border rounded-t-3xl sm:rounded-2xl p-6 space-y-5 shadow-2xl max-h-[92dvh] overflow-y-auto animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 pb-[max(2rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-dialog-title"
      >
        <div className="sm:hidden mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-3">
            <CheckCircle size={28} className="text-success" />
          </div>
          <h3 id="payment-dialog-title" className="text-lg font-bold text-foreground">Registrar Pagamento</h3>
          <p className="text-sm font-medium text-foreground mt-2">{inst.client_name}</p>
          <p className="text-xs text-muted-foreground">Parcela #{inst.installment_number}</p>
        </div>

        {/* Detalhes */}
        <div className="rounded-2xl border border-border bg-muted/30 p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-1.5"><CalendarDays size={14} /> Vencimento</span>
            <span className="text-foreground font-medium">{formatBR(inst.due_date)}</span>
          </div>
          {daysLate > 0 && (
            <div className="flex items-center justify-between text-destructive">
              <span className="flex items-center gap-1.5"><AlertTriangle size={14} /> Atraso</span>
              <span className="font-semibold">{daysLate} dia{daysLate === 1 ? "" : "s"}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Valor sem multa</span>
            <span className="text-foreground font-medium">R$ {fmt(fee.base)}</span>
          </div>
          {fee.multa > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Multa</span>
              <span className="text-destructive font-medium">+ R$ {fmt(fee.multa)}</span>
            </div>
          )}
          {fee.juros > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Juros{fee.jurosPct ? ` (${fee.jurosPct}%/dia × ${fee.daysLate}d)` : ""}</span>
              <span className="text-destructive font-medium">+ R$ {fmt(fee.juros)}</span>
            </div>
          )}
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between">
            <span className="text-foreground font-semibold">Total com multa</span>
            <span className="text-foreground font-bold">R$ {fmt(fee.withFees)}</span>
          </div>
          {alreadyPaid > 0 && (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Já pago</span>
                <span className="text-success font-medium">− R$ {fmt(alreadyPaid)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-primary font-semibold">Restante</span>
                <span className="text-primary font-bold">R$ {fmt(remaining)}</span>
              </div>
            </>
          )}
        </div>

        {/* Modo */}
        <div className="payment-mode-grid grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
          <button type="button"
            onClick={() => { setMode("full"); setRaw(safeRemaining.toFixed(2).replace(".", ",")); }}
            className={`min-w-0 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              mode === "full" ? "bg-success text-success-foreground" : "border border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            Quitar total
          </button>

          {canPayInterestOnly && <button type="button"
            onClick={() => setMode("interest_only")}
            className={`min-w-0 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-xs ${
              mode === "interest_only" ? "bg-amber-500 text-white border-amber-600" : "border border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            Pagar só juros
          </button>}

          {canSettleRenewable && <button type="button"
            onClick={() => setMode("settle")}
            className={`min-[420px]:col-span-2 min-w-0 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              mode === "settle" ? "bg-primary text-primary-foreground border-primary" : "border border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            Quitar capital + juros
          </button>}

          <button type="button"
            onClick={() => setMode("partial")}
            className={`min-w-0 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              mode === "partial" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            Parcial / Outro
          </button>

          {fee.total > 0 && (
            <>
              <button type="button"
                onClick={() => setMode("discount_fee")}
                className={`min-w-0 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  mode === "discount_fee" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                Dar desconto
              </button>
              <button type="button"
                onClick={() => setMode("no_fee")}
                className={`min-w-0 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  mode === "no_fee" ? "bg-success text-success-foreground" : "border border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                Remover multa
              </button>
            </>
          )}
        </div>

        {mode === "discount_fee" && (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="fee-discount" className="text-xs font-semibold text-foreground">Desconto nos encargos</label>
              <span className="text-sm font-bold text-primary">{discountPercent}%</span>
            </div>
            <input id="fee-discount" type="range" min="1" max="100" step="1" value={discountPercent}
              onChange={(e) => setDiscountPercent(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-muted-foreground">Desconto</p><p className="font-semibold text-success">− R$ {fmt(feeDiscount)}</p></div>
              <div className="text-right"><p className="text-muted-foreground">Cliente paga</p><p className="font-bold text-foreground">R$ {fmt(remainingWithDiscount)}</p></div>
            </div>
          </div>
        )}

        {canPayInterestOnly && mode === "interest_only" && (
          <div className="p-3 rounded-xl bg-warning/10 border border-warning/20 space-y-3">
            <p className="text-xs text-warning-foreground leading-relaxed">
              <strong>Renovação por juros:</strong> recebe <strong>R$ {fmt(totalInterestOnly)}</strong>, mantém o capital
              pendente e renova o vencimento. A data sugerida segue a frequência do contrato.
            </p>
            <div>
              <label htmlFor="interest-next-due" className="block text-xs font-semibold text-foreground mb-1.5">Novo vencimento</label>
              <input id="interest-next-due" type="date" value={nextDueDate} min={todayLocalISO()}
                onChange={(e) => setNextDueDate(e.target.value)}
                className="w-full rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-foreground focus:outline-hidden focus:border-primary/60 focus:ring-2 focus:ring-primary/25" />
              <button type="button" onClick={() => setNextDueDate(automaticNextDue)} className="mt-1.5 text-[11px] font-semibold text-primary hover:underline">
                Usar próxima data automática: {formatBR(automaticNextDue)}
              </button>
            </div>
          </div>
        )}

        {canSettleRenewable && mode === "settle" && (
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <p className="text-xs text-foreground leading-relaxed">Esta baixa encerra o contrato e recebe <strong>R$ {fmt(capitalSettlement)}</strong>, incluindo o capital de R$ {fmt(safeNumber(inst.contracts?.capital))} e os juros do ciclo.</p>
          </div>
        )}

        {mode === "no_fee" && (
          <div className="p-3 rounded-xl bg-success/10 border border-success/20">
            <p className="text-xs text-foreground leading-relaxed">
              <strong>Sem multa:</strong> os encargos pendentes de <strong>R$ {fmt(feeDiscount)}</strong> serão removidos
              e a parcela será quitada com recebimento de <strong>R$ {fmt(remainingWithDiscount)}</strong>.
            </p>
          </div>
        )}


        {mode === "partial" && (

          <div>
            <label className="text-xs text-muted-foreground font-medium">Valor recebido</label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2.5 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/25">
              <span className="text-muted-foreground text-sm">R$</span>
              <input
                autoFocus
                inputMode="decimal"
                value={raw}
                onChange={(e) => setRaw(e.target.value.replace(/[^\d,.]/g, ""))}
                className="flex-1 bg-transparent outline-hidden text-foreground text-base font-semibold"
                placeholder="0,00"
              />
            </div>
            {isPartial && (
              <p className="mt-1.5 text-xs text-warning">
                Ficarão pendentes R$ {fmt(restAfter)} — a parcela permanece em aberto.
              </p>
            )}
            {value > remaining && (
              <p className="mt-1.5 text-xs text-destructive">Valor maior que o restante — será quitada.</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={onCancel} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50">Cancelar</button>
          <button
            onClick={confirm}
            disabled={saving || (finalValue <= 0 && !canSettleWithoutNewMoney) || (mode === "interest_only" && !nextDueDate)}
            className="flex-1 px-4 py-3.5 rounded-xl text-sm font-bold bg-success text-success-foreground hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] inline-flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            {saving ? "Registrando..." : `Confirmar R$ ${fmt(finalValue)}`}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
};

export default PayModal;
