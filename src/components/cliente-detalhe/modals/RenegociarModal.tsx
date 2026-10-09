import { useMemo, useState } from "react";
import {DailyInterestNotice} from '@/components/DailyInterestNotice';
import { X, Repeat, AlertTriangle } from "lucide-react";
import { INPUT, FREQ, fmt } from "../constants";
import { calculateLoan, type Frequency } from "@/lib/loanMath";
import { computeLateFeeBreakdown } from "@/lib/lateFee";

type Props = {
  contract: any;
  installments: any[]; // parcelas do contrato
  clientName: string;
  onClose: () => void;
  onConfirm: (payload: RenegotiationPayload) => Promise<void> | void;
};

export type RenegotiationPayload = {
  baseMode: "principal" | "with_fees";
  baseAmount: number;
  addCapital: number;
  totalCapital: number;
  numInstallments: number;
  frequency: string;
  startDate: string;
  interestRate: number;
  lateFeePercent: number;
  dailyInterestPercent: number;
  notes: string;
  installmentAmount: number;
  totalAmount: number;
  totalInterest: number;
  schedule: number[];
};

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export default function RenegociarModal({ contract, installments, clientName, onClose, onConfirm }: Props) {
  const now = new Date();
  const pending = installments.filter((i: any) => i.status !== "paid" && i.status !== "cancelled");

  const principalOpen = useMemo(
    () => pending.reduce((s, i: any) => {
      if (i.scheduled_principal != null) return s + safeNumber(i.scheduled_principal);
      // Compatibilidade antes da migração: distribui somente o capital original,
      // sem transformar juros futuros em novo principal.
      return s + safeNumber(contract.capital) / (safeNumber(contract.num_installments) || 1);
    }, 0),
    [pending, contract.capital, contract.num_installments]
  );
  const feesTotal = useMemo(
    () => pending.reduce((s, i: any) => s + computeLateFeeBreakdown(i, now).total, 0),
    [pending]
  );
  const withFees = principalOpen + feesTotal;

  const [baseMode, setBaseMode] = useState<"principal" | "with_fees">(feesTotal > 0 ? "with_fees" : "principal");
  const [addCapital, setAddCapital] = useState("0");
  const [numInstallments, setNumInstallments] = useState(String(contract.num_installments || 6));
  const [frequency, setFrequency] = useState<string>(contract.frequency || "monthly");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [interestRate, setInterestRate] = useState(String(contract.interest_rate ?? 10));
  const [lateFee, setLateFee] = useState("0");
  const [dailyFee, setDailyFee] = useState(String(contract.daily_interest_percent || 4));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const baseAmount = baseMode === "principal" ? principalOpen : withFees;
  const totalCapital = Math.max(0, baseAmount + safeNumber(parseFloat(addCapital)));

  const calc = useMemo(() => {
    const n = parseInt(numInstallments) || 0;
    if (!totalCapital || !n) return null;
    try {
      return calculateLoan({
        capital: totalCapital,
        rate: parseFloat(interestRate) || 0,
        periods: n,
        frequency: frequency as Frequency,
        loanMode: "installments",
        valueMode: "rate",
      });
    } catch {
      return null;
    }
  }, [totalCapital, interestRate, numInstallments, frequency]);

  const canSubmit = totalCapital > 0 && parseInt(numInstallments) > 0 && calc && !saving;

  const submit = async () => {
    if (!canSubmit || !calc) return;
    setSaving(true);
    try {
      await onConfirm({
        baseMode,
        baseAmount,
        addCapital: parseFloat(addCapital) || 0,
        totalCapital,
        numInstallments: calc.numInstallments,
        frequency,
        startDate,
        interestRate: parseFloat(interestRate) || 0,
        lateFeePercent: parseFloat(lateFee) || 0,
        dailyInterestPercent: parseFloat(dailyFee) || 0,
        notes,
        installmentAmount: calc.installmentAmount,
        totalAmount: calc.totalAmount,
        totalInterest: calc.totalInterest,
        schedule: calc.schedule,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-90 flex items-start sm:items-center justify-center bg-background/80 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto overscroll-contain" onClick={onClose}>
      <div className="w-full max-w-lg sm:max-h-[88vh] sm:overflow-y-auto my-auto rounded-2xl border border-border bg-card p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400"><Repeat size={16} /></div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Renegociar contrato</h2>
              <p className="text-[11px] text-muted-foreground">{clientName} · R$ {fmt(Number(contract.capital))} · {contract.num_installments}x</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>

        {/* Aviso */}
        <div className="flex gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <p>O contrato atual será encerrado como <strong>Renegociado</strong>, as parcelas em aberto serão canceladas e um novo contrato será gerado.</p>
        </div>

        {/* Base a renegociar */}
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Valor base a renegociar</label>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            <button type="button" onClick={() => setBaseMode("principal")}
              className={`p-3 rounded-xl border-2 text-left transition-colors ${baseMode === "principal" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Só principal</p>
              <p className="text-sm font-bold text-foreground mt-0.5">R$ {fmt(principalOpen)}</p>
              <p className="text-[10px] text-muted-foreground">{pending.length} parcela(s) em aberto</p>
            </button>
            <button type="button" onClick={() => setBaseMode("with_fees")}
              className={`p-3 rounded-xl border-2 text-left transition-colors ${baseMode === "with_fees" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Com multa/juros</p>
              <p className="text-sm font-bold text-foreground mt-0.5">R$ {fmt(withFees)}</p>
              <p className="text-[10px] text-muted-foreground">+ R$ {fmt(feesTotal)} de encargos</p>
            </button>
          </div>
        </div>

        {/* Novo capital extra */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Adicionar novo capital (R$)</label>
          <input type="number" name="renegotiation_capital" aria-label="Novo capital" value={addCapital} onChange={e => setAddCapital(e.target.value)} placeholder="0" className={INPUT} min={0} step="0.01" />
          <p className="text-[10px] text-muted-foreground mt-1">Total do novo contrato: <strong className="text-foreground">R$ {fmt(totalCapital)}</strong></p>
        </div>

        {/* Termos */}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Nº parcelas</label>
            <input type="number" name="renegotiation_installments" aria-label="Número de parcelas" value={numInstallments} onChange={e => setNumInstallments(e.target.value)} className={INPUT} min={1} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Frequência</label>
            <select name="renegotiation_frequency" aria-label="Frequência" value={frequency} onChange={e => setFrequency(e.target.value)} className={INPUT}>
              {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Juros por período (%)</label>
            <input type="number" name="renegotiation_interest" aria-label="Juros por período" value={interestRate} onChange={e => setInterestRate(e.target.value)} className={INPUT} step="0.01" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data 1ª parcela</label>
            <input type="date" name="renegotiation_start_date" aria-label="Data da primeira parcela" value={startDate} onChange={e => setStartDate(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Juros de atraso (% ao dia)</label>
            <input type="number" name="renegotiation_daily_fee" aria-label="Juros de atraso ao dia" aria-describedby="renegotiation-daily-interest-note" value={dailyFee} onChange={e => setDailyFee(e.target.value)} className={INPUT} step="0.01" />
            <DailyInterestNotice id="renegotiation-daily-interest-note" value={dailyFee}/>
          </div>

        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
          <textarea name="renegotiation_notes" aria-label="Observações da renegociação" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Motivo, condições combinadas..." className={INPUT} />
        </div>

        {/* Preview */}
        {calc && (
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 space-y-1">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Parcela</span><strong className="text-foreground">R$ {fmt(calc.installmentAmount)}</strong></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Total a receber</span><strong className="text-foreground">R$ {fmt(calc.totalAmount)}</strong></div>
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Juros</span><strong className="text-primary">R$ {fmt(calc.totalInterest)}</strong></div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:bg-accent">Cancelar</button>
          <button type="button" onClick={submit} disabled={!canSubmit}
            className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "Renegociando..." : "Confirmar renegociação"}
          </button>
        </div>
      </div>
    </div>
  );
}
