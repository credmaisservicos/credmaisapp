import { X } from "lucide-react";
import { INPUT, FREQ } from "../constants";
import { ModalPortal } from "@/components/ui/modal-portal";

type Props = {
  form: any;
  setForm: (v: any) => void;
  regen: boolean;
  setRegen: (v: boolean) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
};

const DAILY_MODES: { v: "mon-fri" | "mon-sat" | "mon-sun"; label: string }[] = [
  { v: "mon-fri", label: "Seg → Sex" },
  { v: "mon-sat", label: "Seg → Sáb" },
  { v: "mon-sun", label: "Todos os dias" },
];

export default function EditContratoModal({ form, setForm, regen, setRegen, saving, onClose, onSave }: Props) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-90 flex items-center justify-center overflow-y-auto overscroll-contain bg-background/80 p-3 backdrop-blur-xs" onClick={onClose}>
        <div className="my-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-6 space-y-4" role="dialog" aria-modal="true" aria-labelledby="edit-contract-title" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 id="edit-contract-title" className="text-lg font-bold text-foreground">Editar Empréstimo</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Capital (R$)</label>
            <input type="number" name="contract_capital" aria-label="Capital" step="0.01" value={form.capital} onChange={e => setForm({ ...form, capital: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Taxa (%)</label>
            <input type="number" name="contract_interest_rate" aria-label="Taxa de juros" step="0.1" value={form.interest_rate} onChange={e => setForm({ ...form, interest_rate: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nº Parcelas</label>
            <input type="number" name="contract_installments_count" aria-label="Número de parcelas" value={form.num_installments} onChange={e => setForm({ ...form, num_installments: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor parcela (R$)</label>
            <input type="number" name="contract_installment_amount" aria-label="Valor da parcela" step="0.01" value={form.installment_amount} onChange={e => setForm({ ...form, installment_amount: e.target.value })} className={INPUT} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Frequência</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {Object.entries(FREQ).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setForm({ ...form, frequency: v })}
                  className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${form.frequency === v ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {form.frequency === "daily" && (
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Dias úteis do contrato</label>
              <div className="grid grid-cols-3 gap-1.5">
                {DAILY_MODES.map(d => {
                  const active = form.daily_mode === d.v;
                  return (
                    <button key={d.v} type="button" onClick={() => setForm({ ...form, daily_mode: d.v })}
                      className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}>
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">Define em quais dias da semana as parcelas vão cair ao regenerar.</p>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">1º Vencimento</label>
            <input type="date" name="contract_start_date" aria-label="Primeiro vencimento" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className={INPUT} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Juros de atraso (% ao dia)</label>
            <input type="number" name="contract_daily_interest" aria-label="Juros de atraso ao dia" step="0.01" value={form.daily_interest_percent} onChange={e => setForm({ ...form, daily_interest_percent: e.target.value })} className={INPUT} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <textarea name="contract_notes" aria-label="Observações do contrato" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={INPUT + " min-h-[60px]"} />
          </div>
        </div>
        <label className="flex items-start gap-2 p-3 rounded-xl border border-border bg-muted/20 cursor-pointer">
          <input type="checkbox" name="regenerate_installments" aria-label="Regenerar parcelas pendentes" checked={regen} onChange={e => setRegen(e.target.checked)} className="mt-0.5" />
          <span className="text-xs text-foreground">
            <strong>Regenerar parcelas pendentes</strong>
            <span className="block text-muted-foreground mt-0.5">Mantém as parcelas já pagas e recria as restantes com os novos valores e datas.</span>
          </span>
        </label>
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
