import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Layers3, X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { INPUT, fmt } from "../constants";

type Props = {
  installments: any[];
  loading: boolean;
  onClose: () => void;
  onConfirm: (amount: number, method: string) => void | Promise<void>;
};

const METHODS = [
  ["pix", "PIX"], ["dinheiro", "Dinheiro"],
  ["transferencia", "Transferência"], ["outro", "Outro"],
];

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

export default function PagamentoDistribuidoModal({ installments, loading, onClose, onConfirm }: Props) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("pix");
  const value = Math.max(0, safeNumber(amount.replace(",", ".")));
  const open = useMemo(() => installments
    .filter((i) => i.status !== "paid" && i.status !== "cancelled")
    .slice()
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)) || Number(a.installment_number) - Number(b.installment_number)), [installments]);

  const preview = useMemo(() => {
    let available = value;
    return open.flatMap((i) => {
      if (available <= 0) return [];
      const due = Math.max(0, safeNumber(i.amount) + safeNumber(i.late_fee) - safeNumber(i.paid_amount));
      if (!due) return [];
      const applied = Math.min(available, due);
      available = Math.max(0, available - applied);
      return [{ ...i, due, applied, full: applied + 0.005 >= due }];
    });
  }, [open, value]);
  const balance = open.reduce((sum, i) => sum + Math.max(0, safeNumber(i.amount) + safeNumber(i.late_fee) - safeNumber(i.paid_amount)), 0);
  const unapplied = Math.max(0, value - balance);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[95] flex items-end justify-center bg-background/80 backdrop-blur-sm sm:items-center" onClick={() => !loading && onClose()}>
        <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-bold text-foreground">Distribuir pagamento</h2><p className="mt-1 text-xs text-muted-foreground">Quita as parcelas mais antigas e deixa o restante na próxima.</p></div>
            <button type="button" onClick={onClose} disabled={loading} aria-label="Fechar" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X size={18} /></button>
          </div>
          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Saldo em aberto</p>
            <p className="mt-1 text-xl font-black text-primary">R$ {fmt(balance)}</p>
          </div>
          <div className="mt-4 space-y-1.5"><label className="text-xs font-semibold text-muted-foreground">Valor recebido</label><input name="distributed_payment_amount" aria-label="Valor recebido" className={INPUT} type="number" min="0.01" step="0.01" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex.: 750,00" /></div>
          <div className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {METHODS.map(([v, label]) => <button key={v} type="button" onClick={() => setMethod(v)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${method === v ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent"}`}>{label}</button>)}
          </div>
          {preview.length > 0 && <div className="mt-4 space-y-2 rounded-xl border border-border/70 p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground"><Layers3 size={14} /> Como será distribuído</div>
            {preview.map((i) => <div key={i.id} className="flex items-center gap-2 text-xs">
              <span className="w-20 text-muted-foreground">Parcela {i.installment_number}</span><ArrowRight size={12} className="text-muted-foreground" />
              <span className="font-bold tabular-nums text-foreground">R$ {fmt(i.applied)}</span>
              <span className={`ml-auto inline-flex items-center gap-1 ${i.full ? "text-success" : "text-warning"}`}>{i.full && <CheckCircle2 size={12} />}{i.full ? "Quitada" : `Restará R$ ${fmt(i.due - i.applied)}`}</span>
            </div>)}
          </div>}
          {unapplied > 0 && <p className="mt-3 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">O valor ultrapassa o saldo do cliente em R$ {fmt(unapplied)}.</p>}
          <button type="button" onClick={() => onConfirm(value, method)} disabled={loading || value <= 0 || unapplied > 0} className="mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-50" style={{ background: "var(--gradient-button)" }}>{loading ? "Distribuindo..." : "Confirmar distribuição"}</button>
        </div>
      </div>
    </ModalPortal>
  );
}
