import { useState } from "react";
import { X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { INPUT, fmt } from "../constants";
import { calculateFeeDiscount } from "@/lib/lateFee";
import { nextInterestDueDate, supportsInterestOnlyRenewal } from "@/lib/interestOnly";
import { formatBR, todayLocalISO } from "@/lib/dateUtils";

type Props = {
  inst: any;
  amount: string;
  setAmount: (v: string) => void;
  method: string;
  setMethod: (v: string) => void;
  receiptFile: File | null;
  setReceiptFile: (f: File | null) => void;
  uploading: boolean;
  interestOnly?: number;
  loanMode?: string | null;
  remainingDue: number;
  feeTotal?: number;
  onFeeDiscount?: (amount: number) => void;
  onClose: () => void;
  onSubmit: () => void;
  frequency?: string | null;
  onRenewInterest?: (nextDueDate: string) => void;
};

const METHODS = [
  { v: "pix", l: "PIX" },
  { v: "dinheiro", l: "Dinheiro" },
  { v: "transferencia", l: "Transf." },
  { v: "outro", l: "Outro" },
];

export default function PagamentoModal(p: Props) {
  const [discountPercent, setDiscountPercent] = useState(0);
  const automaticNextDue = nextInterestDueDate(p.inst.due_date, p.frequency);
  const canPayInterestOnly = supportsInterestOnlyRenewal(p.loanMode ?? p.inst.contracts?.loan_mode)
    && Number(p.interestOnly || 0) > 0;
  const [renewInterest, setRenewInterest] = useState(false);
  const [nextDueDate, setNextDueDate] = useState(automaticNextDue);
  const discountableFee = calculateFeeDiscount(p.remainingDue, Number(p.feeTotal || 0), 0).discountable;
  const applyDiscount = (percent: number) => {
    setDiscountPercent(percent);
    const { discount } = calculateFeeDiscount(p.remainingDue, discountableFee, percent);
    p.onFeeDiscount?.(discount);
    p.setAmount(String(Math.max(0, p.remainingDue - discount).toFixed(2)));
  };
  const close = () => { if (!p.uploading) { p.onClose(); } };
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-background/80 backdrop-blur-sm" onClick={close}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-border bg-card p-6 space-y-4 max-h-[92dvh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 pb-[max(1.5rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <div className="sm:hidden mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Pagamento</h2>
          <button type="button" onClick={close} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Parcela #{p.inst.installment_number}</p>
          <p className="text-xs text-muted-foreground mt-1">Saldo atualizado</p>
          <p className="text-lg font-bold text-foreground">R$ {fmt(p.remainingDue)}</p>
          {Number(p.inst.paid_amount || 0) > 0 && <p className="text-xs text-success">Já pago: R$ {fmt(Number(p.inst.paid_amount))}</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor (R$)</label>
          <input type="number" name="payment_amount" aria-label="Valor do pagamento" step="0.01" value={p.amount} onChange={e => p.setAmount(e.target.value)} placeholder={fmt(p.remainingDue)} className={INPUT} autoFocus readOnly={renewInterest} />
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={renewInterest} onClick={() => { applyDiscount(0); p.setAmount(String(p.remainingDue.toFixed(2))); }} className="flex-1 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Total</button>
          <button type="button" disabled={renewInterest} onClick={() => p.setAmount(String((p.remainingDue / 2).toFixed(2)))} className="flex-1 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent disabled:opacity-50">Metade</button>
        </div>
        {discountableFee > 0 && (
          <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-foreground">Desconto na multa/juros</p>
              <span className="text-xs font-bold text-primary">{discountPercent}%</span>
            </div>
            <input type="range" min="0" max="100" value={discountPercent} onChange={(e) => applyDiscount(Number(e.target.value))}
              aria-label="Percentual de desconto nos encargos" className="w-full accent-[hsl(var(--primary))]" />
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
              <button type="button" onClick={() => applyDiscount(50)} className="rounded-lg border border-border px-2 py-2 text-xs text-muted-foreground hover:bg-accent">Dar 50%</button>
              <button type="button" onClick={() => applyDiscount(100)} className="rounded-lg bg-success/15 px-2 py-2 text-xs font-semibold text-success hover:bg-success/20">Remover multa</button>
            </div>
          </div>
        )}
        {canPayInterestOnly && !!p.interestOnly && p.interestOnly > 0 && (
          <div className="space-y-1.5">
            <button type="button"
              onClick={() => {
                const next = !renewInterest;
                setRenewInterest(next);
                p.setAmount(String((next ? p.interestOnly! : p.remainingDue).toFixed(2)));
              }}
              aria-pressed={renewInterest}
              className={`w-full px-3 py-2.5 rounded-lg border text-xs font-semibold transition-colors ${renewInterest ? "border-warning/60 bg-warning/20 text-warning" : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"}`}
            >
              {renewInterest ? "Cancelar pagamento só de juros" : `Pagar só juros — R$ ${fmt(p.interestOnly)}`}
            </button>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Quita apenas os juros do período. O capital continua devido para o próximo vencimento.
            </p>
            {renewInterest && (
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 space-y-1.5">
                <label htmlFor="client-interest-next-date" className="block text-xs font-semibold text-foreground">Novo vencimento</label>
                <input id="client-interest-next-date" type="date" value={nextDueDate}
                  min={todayLocalISO()} onChange={(e) => setNextDueDate(e.target.value)} className={INPUT} />
                <p className="text-[10px] text-muted-foreground">Automático pela frequência: {formatBR(automaticNextDue)}</p>
              </div>
            )}
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Forma de pagamento</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {METHODS.map(opt => (
              <button key={opt.v} type="button" onClick={() => p.setMethod(opt.v)}
                className={`px-2 py-2 rounded-lg text-xs font-medium border transition-colors ${p.method === opt.v ? "bg-primary/15 border-primary text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Comprovante (opcional)</label>
          <input type="file" accept="image/*,application/pdf" onChange={e => p.setReceiptFile(e.target.files?.[0] || null)}
            aria-label="Comprovante de pagamento"
            className="w-full text-xs text-muted-foreground file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-card file:text-xs file:font-medium file:text-foreground file:cursor-pointer" />
          {p.receiptFile && <p className="text-[10px] text-muted-foreground mt-1 truncate">📎 {p.receiptFile.name}</p>}
        </div>
        <button type="button" onClick={() => renewInterest ? p.onRenewInterest?.(nextDueDate) : p.onSubmit()}
          disabled={!p.amount || parseFloat(p.amount) <= 0 || p.uploading || (renewInterest && !nextDueDate)}
          className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground disabled:opacity-50" style={{ background: "var(--gradient-button)" }}>
          {p.uploading ? "Enviando..." : "Confirmar"}
        </button>
      </div>
    </div>
    </ModalPortal>
  );
}
