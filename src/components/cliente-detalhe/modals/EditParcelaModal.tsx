import { X } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
import { INPUT } from "../constants";

type Props = {
  inst: any;
  form: { amount: string; due_date: string };
  setForm: (v: { amount: string; due_date: string }) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
};

export default function EditParcelaModal({ inst, form, setForm, saving, onClose, onSave }: Props) {
  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center overflow-y-auto overscroll-contain bg-background/80 p-3 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div className="my-auto w-full max-h-[92dvh] overflow-y-auto sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-border bg-card p-6 space-y-4 shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200 pb-[max(1.5rem,env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <div className="sm:hidden mx-auto -mt-2 mb-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Editar Parcela #{inst.installment_number}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor (R$)</label>
          <input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={INPUT} autoFocus />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Vencimento</label>
          <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className={INPUT} />
        </div>
        {inst.status === "paid" && (
          <p className="text-[11px] text-amber-500">Atenção: esta parcela já está paga. A alteração não estorna o pagamento.</p>
        )}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground">Cancelar</button>
          <button type="button" onClick={onSave} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground disabled:opacity-50" style={{ background: "var(--gradient-button)" }}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
