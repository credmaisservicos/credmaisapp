import { useMemo, useState } from "react";
import {DailyInterestNotice} from '@/components/DailyInterestNotice';
import { X, Shield, CalendarCog, Plus, Trash2, UploadCloud, FileText, FileSignature } from "lucide-react";
import VoiceRecorder from "@/components/VoiceRecorder";
import { INPUT, FREQ, LOAN_MODES, DAILY_MODES, fmt } from "../constants";
import LoanPreviewPanel from "@/components/loan/LoanPreviewPanel";
import { generateInstallmentSchedule, type LoanMode, type DailyMode, type Frequency } from "@/lib/loanMath";

type Props = {
  clientName: string;
  loanMode: LoanMode;
  setLoanMode: (v: LoanMode) => void;
  loanGracePeriods: string;
  setLoanGracePeriods: (v: string) => void;
  loanCapital: string;
  setLoanCapital: (v: string) => void;
  loanInstallments: string;
  setLoanInstallments: (v: string) => void;
  loanInterestRate: string;
  setLoanInterestRate: (v: string) => void;
  loanFreq: string;
  setLoanFreq: (v: string) => void;
  loanStartDate: string;
  setLoanStartDate: (v: string) => void;
  loanStart: string;
  setLoanStart: (v: string) => void;
  loanDailyFee: string;
  setLoanDailyFee: (v: string) => void;
  loanLateFee: string;
  setLoanLateFee: (v: string) => void;
  loanNotes: string;
  setLoanNotes: (v: string | ((n: string) => string)) => void;
  loanGraceDays: string;
  setLoanGraceDays: (v: string) => void;
  loanPaymentMethod: string;
  setLoanPaymentMethod: (v: string) => void;
  loanEarlyDiscount: string;
  setLoanEarlyDiscount: (v: string) => void;
  loanMaxInterestCap: string;
  setLoanMaxInterestCap: (v: string) => void;
  loanValueMode: "rate" | "installment";
  setLoanValueMode: (v: "rate" | "installment") => void;
  loanInstallmentValue: string;
  setLoanInstallmentValue: (v: string) => void;
  loanDailyMode: DailyMode;
  setLoanDailyMode: (v: DailyMode) => void;
  loanFirstDueAuto: boolean;
  setLoanFirstDueAuto: (v: boolean) => void;
  loanCustomDates: string[];
  setLoanCustomDates: (v: string[]) => void;
  loanCalc: { totalInterest: number; total: number; installmentAmount: number; schedule: number[]; derivedRate?: number } | null;
  loanLoading: boolean;
  loanDocuments: File[];
  setLoanDocuments: (files: File[]) => void;
  onClose: () => void;
  onSubmit: (options: { signatureRequired: boolean }) => void;
};

export default function NovoEmprestimoModal(p: Props) {
  const [signatureRequired, setSignatureRequired] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const dueDates = useMemo(() => {
    if (!p.loanCalc) return [];
    return generateInstallmentSchedule({
      startDate: p.loanStartDate,
      firstDueDate: p.loanFirstDueAuto ? undefined : p.loanStart,
      frequency: p.loanFreq as Frequency,
      count: p.loanCalc.schedule.length,
      periodsAhead: p.loanMode === "bullet" ? Number(p.loanInstallments) || undefined : undefined,
      dailyMode: p.loanDailyMode,
      customDates: p.loanFreq === "custom" ? p.loanCustomDates : undefined,
    });
  }, [p.loanCalc, p.loanStartDate, p.loanFirstDueAuto, p.loanStart, p.loanFreq, p.loanMode, p.loanInstallments, p.loanDailyMode, p.loanCustomDates]);
  const previewInput = useMemo(() => ({
    capital: Number(p.loanCapital) || 0,
    rate: p.loanValueMode === "installment" ? p.loanCalc?.derivedRate ?? 0 : Number(p.loanInterestRate) || 0,
    periods: p.loanCalc?.schedule.length ?? 0,
    frequency: p.loanFreq as Frequency,
    loanMode: p.loanMode,
    valueMode: p.loanValueMode,
    installmentValue: Number(p.loanInstallmentValue) || 0,
    gracePeriods: Number(p.loanGracePeriods) || 0,
  }), [p.loanCapital, p.loanValueMode, p.loanCalc, p.loanInterestRate, p.loanFreq, p.loanMode, p.loanInstallmentValue, p.loanGracePeriods]);
  const previewResult = useMemo(() => p.loanCalc ? ({
    ...p.loanCalc,
    totalAmount: p.loanCalc.total,
    numInstallments: p.loanCalc.schedule.length,
    perPeriodLabel: p.loanFreq,
  }) : null, [p.loanCalc, p.loanFreq]);
  return (
    <div className="fixed inset-0 z-90 flex items-start sm:items-center justify-center bg-background/80 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto overscroll-contain" onClick={p.onClose}>
      <div className="w-full max-w-lg sm:max-h-[85vh] sm:overflow-y-auto my-auto rounded-2xl border border-border bg-card p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Novo Empréstimo</h2>
          <button type="button" onClick={p.onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted-foreground">Para: <strong className="text-foreground">{p.clientName}</strong></p>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tipo de Empréstimo</label>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {LOAN_MODES.map(m => (
              <button key={m.v} type="button" onClick={() => {
                p.setLoanMode(m.v);
                if (m.v === "bullet") p.setLoanInstallments("1");
                if (m.v === "installments" && (parseInt(p.loanInstallments) || 0) < 2) p.setLoanInstallments("2");
              }}
                className={`flex items-start gap-2 p-2.5 rounded-xl border-2 transition-colors text-left ${p.loanMode === m.v ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"}`}>
                <m.Icon size={16} className={`mt-0.5 shrink-0 ${p.loanMode === m.v ? "text-primary" : "text-muted-foreground"}`} />
                <div className="min-w-0">
                  <p className={`text-[11px] font-semibold leading-tight ${p.loanMode === m.v ? "text-primary" : "text-foreground"}`}>{m.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{m.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {p.loanMode === "grace" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Períodos de carência (sem pagar)</label>
            <input type="number" name="loan_grace_periods" aria-label="Períodos de carência" value={p.loanGracePeriods} onChange={e => p.setLoanGracePeriods(e.target.value)} placeholder="2" className={INPUT} min={1} />
          </div>
        )}

        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Capital (R$)</label>
            <input type="number" name="loan_capital" aria-label="Capital do empréstimo" value={p.loanCapital} onChange={e => p.setLoanCapital(e.target.value)} placeholder="1000" className={INPUT} />
          </div>
          {p.loanMode !== "bullet" && <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Nº Parcelas
            </label>
            <input type="number" name="loan_installments" aria-label="Número de parcelas" value={p.loanInstallments} onChange={e => p.setLoanInstallments(e.target.value)} placeholder="12" className={INPUT} />
          </div>}
          {p.loanMode === "installments" && (
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Definir por</label>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => p.setLoanValueMode("rate")}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${p.loanValueMode === "rate" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}>
                  Taxa (%)
                </button>
                <button type="button" onClick={() => p.setLoanValueMode("installment")}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${p.loanValueMode === "installment" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}>
                  Valor da Parcela
                </button>
              </div>
            </div>
          )}
          {p.loanMode === "installments" && p.loanValueMode === "installment" ? (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Valor da Parcela (R$)</label>
              <input type="number" name="loan_installment_value" aria-label="Valor da parcela" step="0.01" value={p.loanInstallmentValue} onChange={e => p.setLoanInstallmentValue(e.target.value)} placeholder="100" className={INPUT} />
              {p.loanCalc?.derivedRate !== undefined && (
                <p className="text-[10px] text-primary mt-1">Taxa derivada: {p.loanCalc.derivedRate.toFixed(2)}%</p>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Taxa (%)</label>
              <input type="number" name="loan_interest_rate" aria-label="Taxa de juros" step="0.1" value={p.loanInterestRate} onChange={e => p.setLoanInterestRate(e.target.value)} className={INPUT} />
            </div>
          )}
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Frequência</label>
            <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-5 gap-1.5">
              {Object.entries(FREQ).map(([v, l]) => (
                <button key={v} type="button" onClick={() => p.setLoanFreq(v)}
                  className={`min-w-0 px-2 py-2.5 rounded-xl text-xs font-semibold border transition-colors ${p.loanFreq === v ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {p.loanFreq === "daily" && (
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Dias úteis</label>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.entries(DAILY_MODES).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => p.setLoanDailyMode(v as DailyMode)}
                    className={`px-2 py-2 rounded-xl text-xs font-semibold border transition-colors ${p.loanDailyMode === v ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
          {p.loanMode !== "bullet" && <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Data Início</label>
            <input type="date" name="loan_start_date" aria-label="Data de início" value={p.loanStartDate} onChange={e => p.setLoanStartDate(e.target.value)} className={INPUT} />
          </div>}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center justify-between gap-1">
              <span>{p.loanMode === "bullet" ? "Data do pagamento total" : "1º vencimento"}</span>
              <button type="button" onClick={() => p.setLoanFirstDueAuto(!p.loanFirstDueAuto)}
                className={`text-[10px] px-2 py-0.5 rounded-md border ${p.loanFirstDueAuto ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border text-muted-foreground"}`}>
                {p.loanFirstDueAuto ? "Auto" : "Manual"}
              </button>
            </label>
            <input type="date" name="loan_first_due_date" aria-label="Primeiro vencimento" value={p.loanStart} onChange={e => p.setLoanStart(e.target.value)}
              disabled={p.loanFirstDueAuto} className={INPUT + (p.loanFirstDueAuto ? " opacity-50" : "")} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Juros de atraso (% ao dia)</label>
            <input type="number" name="loan_daily_fee" aria-label="Juros de atraso ao dia" aria-describedby="loan-daily-interest-note" min="0" step="0.01" value={p.loanDailyFee} onChange={e => p.setLoanDailyFee(e.target.value)} className={INPUT} />
            <DailyInterestNotice id="loan-daily-interest-note" value={p.loanDailyFee}/>
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Observações</label>
            <div className="flex gap-2 items-start">
              <textarea name="loan_notes" aria-label="Observações do empréstimo" value={p.loanNotes} onChange={e => p.setLoanNotes(e.target.value)} className={INPUT + " min-h-[60px] flex-1"} placeholder="Opcional (ou dite pelo microfone)" />
              <VoiceRecorder onTranscribed={(t) => p.setLoanNotes((n: string) => (n ? n + " " : "") + t)} title="Ditar observação" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-foreground">Documentos do empréstimo</p>
              <p className="text-[10px] text-muted-foreground">RG, CNH, comprovantes, extratos ou outros arquivos da análise.</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent">
              <UploadCloud size={14} /> Anexar
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(event) => {
                  const selected = Array.from(event.target.files || []).filter(file => file.size <= 15 * 1024 * 1024);
                  p.setLoanDocuments([...p.loanDocuments, ...selected].slice(0, 20));
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {p.loanDocuments.length > 0 ? (
            <div className="space-y-1.5">
              {p.loanDocuments.map((file, index) => (
                <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-2">
                  <FileText size={14} className="shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{file.name}</span>
                  <span className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button type="button" aria-label={`Remover ${file.name}`} onClick={() => p.setLoanDocuments(p.loanDocuments.filter((_, itemIndex) => itemIndex !== index))} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">Nenhum documento selecionado. Máximo de 20 arquivos, com até 15 MB cada.</p>
          )}
        </div>

        {/* ── Condições Avançadas ─────────────────────────────────────── */}
        <details className="rounded-xl border border-border bg-card/60 p-3 group">
          <summary className="cursor-pointer flex items-center justify-between list-none">
            <span className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Shield size={13} className="text-primary" /> Condições Avançadas
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground group-open:hidden">Abrir</span>
            <span className="text-[10px] uppercase tracking-wider text-primary hidden group-open:inline">Fechar</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Carência (dias)</label>
              <input type="number" value={p.loanGraceDays} onChange={e => p.setLoanGraceDays(e.target.value)} placeholder="0" className={INPUT} />
              <p className="text-[10px] text-muted-foreground mt-1">Dias sem multa após vencimento</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Forma de Pagamento</label>
              <select name="loan_payment_method" aria-label="Forma de pagamento" value={p.loanPaymentMethod} onChange={e => p.setLoanPaymentMethod(e.target.value)} className={INPUT}>
                <option value="pix">PIX</option>
                <option value="cash">Dinheiro</option>
                <option value="boleto">Boleto</option>
                <option value="transfer">Transferência</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Desconto Antecipação (%)</label>
              <input type="number" step="0.1" value={p.loanEarlyDiscount} onChange={e => p.setLoanEarlyDiscount(e.target.value)} placeholder="0" className={INPUT} />
              <p className="text-[10px] text-muted-foreground mt-1">% se pagar antes do vencimento</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Teto de Juros (%)</label>
              <input type="number" step="1" value={p.loanMaxInterestCap} onChange={e => p.setLoanMaxInterestCap(e.target.value)} placeholder="Sem limite" className={INPUT} />
              <p className="text-[10px] text-muted-foreground mt-1">Máx. % do capital em juros</p>
            </div>
          </div>
        </details>

        {p.loanFreq === "custom" && p.loanCalc && (
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <div className="flex items-center gap-2 mb-2">
              <CalendarCog size={13} className="text-primary" />
              <span className="text-xs font-semibold text-foreground">Datas Customizadas</span>
              <span className="text-[10px] text-muted-foreground ml-auto">{p.loanCalc.schedule.length} parcela(s)</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {p.loanCalc.schedule.map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-8">#{i + 1}</span>
                  <input type="date" value={p.loanCustomDates[i] || ""}
                    onChange={e => {
                      const next = [...p.loanCustomDates];
                      next[i] = e.target.value;
                      p.setLoanCustomDates(next);
                    }}
                    className={INPUT + " flex-1 py-1.5 text-xs"} />
                </div>
              ))}
            </div>
          </div>
        )}

        {p.loanCalc && (
          <div className="space-y-2">
            <div className="bg-muted/30 rounded-lg p-3 grid grid-cols-3 gap-3 text-sm">
              <div><p className="text-[10px] text-muted-foreground">Juros</p><p className="font-semibold text-foreground">R$ {fmt(p.loanCalc.totalInterest)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">Total</p><p className="font-semibold text-foreground">R$ {fmt(p.loanCalc.total)}</p></div>
              <div><p className="text-[10px] text-muted-foreground">{p.loanMode === "bullet" ? "Pagamento" : "Parcela"}</p><p className="font-semibold text-primary">R$ {fmt(p.loanCalc.installmentAmount)}</p></div>
            </div>
            {p.loanCalc.schedule.length > 1 && p.loanCalc.schedule.some(v => v !== p.loanCalc!.schedule[0]) && (
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border p-2 text-[11px] space-y-0.5">
                {p.loanCalc.schedule.map((v, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-muted-foreground">#{i + 1}</span>
                    <span className="font-medium text-foreground">R$ {fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {previewResult && <LoanPreviewPanel input={previewInput} result={previewResult as any} dueDates={dueDates} compact />}
        <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={signatureRequired} onChange={e => setSignatureRequired(e.target.checked)} className="mt-0.5 accent-primary" />
            <span className="text-xs text-foreground"><FileSignature size={13} className="inline mr-1 text-primary" />Exigir assinatura no Portal do Cliente antes de ativar a cobrança.</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 accent-primary" />
            <span className="text-xs text-muted-foreground">Conferi capital, taxa, vencimentos e valor total. Esta confirmação ficará registrada na auditoria do contrato.</span>
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={p.onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground">Cancelar</button>
          <button type="button" onClick={() => p.onSubmit({ signatureRequired })} disabled={p.loanLoading || !p.loanCalc || !confirmed}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground disabled:opacity-50" style={{ background: "var(--gradient-button)" }}>
            {p.loanLoading ? "Criando..." : "Criar Empréstimo"}
          </button>
        </div>
      </div>
    </div>
  );
}
