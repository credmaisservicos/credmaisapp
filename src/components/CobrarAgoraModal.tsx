import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  X, CheckCircle2, Loader2, ArrowRight, ArrowLeft,
  Banknote, Smartphone, CreditCard, Building2, FileText, AlertCircle, Clock
} from "lucide-react";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { accumulatedPaymentTotal, portalInstallmentAmount } from "@/lib/portalAmounts";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export type CobrarInstallment = {
  id: string;
  amount: number;
  paid_amount?: number | null;
  late_fee?: number | null;
  due_date: string;
  installment_number: number;
  client_id: string;
  contract_id?: string;
  daily_interest_percent?: number | null;
  max_interest_cap_percent?: number | null;
  contracts?: { daily_interest_percent?: number | null; max_interest_cap_percent?: number | null } | null;
  clients?: { name?: string; phone?: string | null; whatsapp?: string | null } | null;
};

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  installments: CobrarInstallment[];
}

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const fmtBRL = (v: unknown) =>
  safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const METHODS = [
  { id: "pix", label: "PIX", icon: Smartphone, hint: "Confirmação instantânea" },
  { id: "dinheiro", label: "Dinheiro", icon: Banknote, hint: "Recebido em mãos" },
  { id: "transferencia", label: "Transferência", icon: Building2, hint: "TED / DOC" },
  { id: "cartao", label: "Cartão", icon: CreditCard, hint: "Débito / crédito" },
  { id: "boleto", label: "Boleto", icon: FileText, hint: "Compensado" },
] as const;

type MethodId = typeof METHODS[number]["id"];

const CobrarAgoraModal = ({ open, onClose, title = "Cobrar agora", installments }: Props) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<MethodId>("pix");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset on open: pre-select all installments
  useEffect(() => {
    if (open) {
      setStep(1);
      setMethod("pix");
      setSelected(new Set(installments.map((i) => i.id)));
      setTimeout(() => dialogRef.current?.querySelector<HTMLElement>("button")?.focus(), 30);
    }
  }, [open, installments]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const total = useMemo(
    () => installments.filter((i) => selected.has(i.id)).reduce((s, i) => s + portalInstallmentAmount(i), 0),
    [installments, selected]
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleAll = () => {
    if (selected.size === installments.length) setSelected(new Set());
    else setSelected(new Set(installments.map((i) => i.id)));
  };

  const confirm = async () => {
    if (!user || selected.size === 0) return;
    if (!online) {
      toast.error("Reconecte para confirmar os recebimentos com segurança");
      return;
    }
    setBusy(true);
    const list = installments.filter((i) => selected.has(i.id));
    const ids = list.map((i) => i.id);
    const methodLabel = METHODS.find((m) => m.id === method)?.label || method;
    try {
      // Baixa pelo RPC atômico. Antes esta tela fazia duas escritas separadas:
      // marcava a parcela paga e inseria a transação de caixa na mão — mas NUNCA
      // lançava o lucro, e a transação ficava sem `installment_id`, então o
      // estorno não tinha como removê-la. O RPC faz parcela + lucro + caixa +
      // conclusão do contrato de uma vez, tudo amarrado à parcela.
      const results = await Promise.all(
        list.map((i) =>
          supabase.rpc("pay_installment", {
            _installment_id: i.id,
            _paid_total: accumulatedPaymentTotal(i, portalInstallmentAmount(i)),
            _mark_paid: true,
            _method: method,
            _receipt_url: null,
            _source_key: null,
          })
        )
      );
      const failed = results.filter((r) => r.error);
      if (failed.length) throw failed[0].error;

      toast.success(`${list.length} cobrança${list.length !== 1 ? "s" : ""} recebida${list.length !== 1 ? "s" : ""} via ${methodLabel}`, {
        description: `Total R$ ${fmtBRL(total)}`,
        action: {
          label: "Desfazer",
          onClick: async () => {
            // Estorno pelo RPC: reabre a parcela E remove o lucro e o caixa que
            // ela gerou. Antes só voltava o status, deixando dinheiro no razão
            // sem parcela paga correspondente.
            await Promise.all(
              list.map((i) => supabase.rpc("reverse_installment_payment", { _installment_id: i.id }))
            );
            qc.invalidateQueries({ queryKey: ["hoje"] });
            qc.invalidateQueries({ queryKey: ["cobrancas"] });
            qc.invalidateQueries({ queryKey: ["dashboard-data"] });
            toast.success("Desfeito");
          },
        },
      });

      qc.invalidateQueries({ queryKey: ["hoje"] });
      qc.invalidateQueries({ queryKey: ["cobrancas"] });
      qc.invalidateQueries({ queryKey: ["quick-pay-installments"] });
      onClose();
    } catch (e: any) {
      toast.error("Erro ao registrar pagamentos", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs z-60 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cobrar-agora-title"
        className="fixed inset-x-0 top-[5vh] mx-auto w-[calc(100vw-1rem)] sm:w-full max-w-2xl z-61 px-0 sm:px-4 animate-scale-in"
      >
        <div className="rounded-2xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border sticky top-0 bg-card/95 backdrop-blur-sm z-10 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <CheckCircle2 size={15} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="cobrar-agora-title" className="text-sm font-bold text-foreground truncate">{title}</h2>
              <p className="text-[10px] text-muted-foreground">
                Passo {step} de 2 · {step === 1 ? "Selecione as parcelas" : "Escolha a forma de pagamento"}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X size={14} />
            </button>
          </div>

          {/* Step indicator bar */}
          <div className="flex h-1 bg-muted/40">
            <div className={`flex-1 transition-colors ${step >= 1 ? "bg-primary" : ""}`} />
            <div className={`flex-1 transition-colors ${step >= 2 ? "bg-primary" : ""}`} />
          </div>

          {/* STEP 1: select installments */}
          {step === 1 && (
            <>
              <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.size === installments.length && installments.length > 0}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-border accent-primary"
                  />
                  Selecionar todas ({installments.length})
                </label>
                <span className="text-[11px] text-muted-foreground" aria-live="polite">
                  {selected.size} selecionada{selected.size !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 divide-y divide-border/20" role="list">
                {installments.length === 0 && (
                  <div className="py-10 text-center text-xs text-muted-foreground">
                    Nenhuma cobrança pendente neste grupo
                  </div>
                )}
                {installments.map((inst) => {
                  const due = parseLocalDate(inst.due_date);
                  const isOverdue = !!due && due < today;
                  const t0 = new Date(); t0.setHours(0,0,0,0);
                  const isToday = !!due && new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() === t0.getTime();
                  const checked = selected.has(inst.id);
                  return (
                    <label
                      key={inst.id}
                      className={`px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors ${
                        checked ? "bg-primary/5" : "hover:bg-accent/20"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(inst.id)}
                        className="w-4 h-4 rounded border-border accent-primary shrink-0"
                        aria-label={`Selecionar parcela ${inst.installment_number} de ${inst.clients?.name || "cliente"}`}
                      />
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isOverdue ? "bg-destructive/10 text-destructive" :
                        isToday ? "bg-primary/10 text-primary" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {isOverdue ? <AlertCircle size={14} /> : <Clock size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{inst.clients?.name || "Cliente"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Parcela {inst.installment_number} · {formatBR(inst.due_date)}
                          {isOverdue && <span className="text-destructive font-bold ml-1">· ATRASADO</span>}
                          {isToday && <span className="text-primary font-bold ml-1">· HOJE</span>}
                        </p>
                      </div>
                      <p className="text-sm font-bold text-foreground shrink-0">
                        R$ {fmtBRL(portalInstallmentAmount(inst))}
                      </p>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* STEP 2: method */}
          {step === 2 && (
            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-3">
              <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {METHODS.map((m) => {
                  const Icon = m.icon;
                  const active = method === m.id;
                  return (
                    <button
                      key={m.id}
                      role="radio"
                      aria-checked={active}
                      onClick={() => setMethod(m.id)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${
                        active
                          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                          : "border-border/40 bg-muted/20 hover:bg-accent/20"
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}>
                        <Icon size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground">{m.label}</p>
                        <p className="text-[10px] text-muted-foreground">{m.hint}</p>
                      </div>
                      {active && <CheckCircle2 size={14} className="text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border bg-muted/10 flex items-center justify-between gap-3 sticky bottom-0 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</p>
              <p className="text-base font-bold text-foreground">R$ {fmtBRL(total)}</p>
            </div>
            <div className="flex items-center gap-2">
              {step === 2 && (
                <button
                  onClick={() => setStep(1)}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg border border-border/50 text-xs font-semibold text-foreground hover:bg-accent/30 transition-colors flex items-center gap-1.5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <ArrowLeft size={12} /> Voltar
                </button>
              )}
              {step === 1 ? (
                <button
                  onClick={() => setStep(2)}
                  disabled={selected.size === 0}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  Continuar <ArrowRight size={12} />
                </button>
              ) : (
                <button
                  onClick={confirm}
                  disabled={busy || selected.size === 0}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Confirmar recebimento
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CobrarAgoraModal;
