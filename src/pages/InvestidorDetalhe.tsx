import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import ErrorState from "@/components/feedback/ErrorState";
import { friendlyError } from "@/lib/friendlyError";
import { fetchAll } from "@/lib/fetchAll";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import {
  ArrowLeft, Landmark, Plus, RefreshCw, Wallet, TrendingUp, CheckCircle2,
  ExternalLink, Trash2, Copy, DollarSign, CalendarDays, Pencil, Undo2,
} from "lucide-react";
import {
  KpiCard, NewLoanDialog, PayLoanDialog, EditInvestorDialog, EditLoanDialog,
  type Investor, type Loan,
} from "./Investidores";

const brl = (n: number) => {
  const value = Number(n ?? 0);
  return (Number.isFinite(value) ? value : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};
const fmtDate = (d?: string | null) => d ? formatBR(d) || "-" : "-";

export default function InvestidorDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [investor, setInvestor] = useState<Investor | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLoanId, setEditLoanId] = useState<string | null>(null);

  const load = async () => {
    if (!user?.id || !id) return;
    setLoading(true);
    setLoadError(null);
    const [investorResult, loansResult, paymentsResult] = await Promise.all([
      supabase.from("investors" as never).select("*").eq("id", id).eq("user_id", user.id).maybeSingle(),
      fetchAll<Loan>((from, to) => (supabase.from("investor_loans" as never) as any).select("*").eq("investor_id", id).eq("user_id", user.id).order("due_date", { ascending: true }).range(from, to)),
      fetchAll<any>((from, to) => (supabase.from("investor_payments" as never) as any).select("*").eq("investor_id", id).eq("user_id", user.id).order("paid_at", { ascending: false }).range(from, to)),
    ]);
    const error = investorResult.error;
    if (error) {
      setLoadError(error);
      setInvestor(null);
      setLoans([]);
      setLoading(false);
      return;
    }
    setInvestor((investorResult.data as any) || null);
    setLoans(loansResult);
    setPayments(paymentsResult);
    setLoading(false);
  };

  useEffect(() => { void load();   }, [user?.id, id]);

  const s = useMemo(() => {
    const active = loans.filter((l) => l.status !== "paid");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const totalDue = active.reduce((a, l) => a + safeNumber(l.total_due), 0);
    const capital = active.reduce((a, l) => a + safeNumber(l.principal), 0);
    const paid = payments.reduce((a, p) => a + safeNumber(p.amount), 0);
    const paidActive = active.reduce((a, l) => a + safeNumber(l.paid_amount), 0);
    const overdue = active.filter((l) => {
      const due = parseLocalDate(l.due_date);
      return !!due && due < today;
    }).length;
    const prox = active
      .map((l) => l.due_date)
      .filter((value): value is string => !!parseLocalDate(value))
      .sort((a, b) => (parseLocalDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseLocalDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER))[0] || null;
    return { capital, totalDue, paid, saldo: Math.max(0, totalDue - paidActive), overdue, prox, count: active.length };
  }, [loans, payments]);

  const copyPortal = async () => {
    if (!investor) return;
    const url = `${window.location.origin}/investidor/${investor.access_token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copiado!", description: url });
    } catch {
      toast({ title: "Não foi possível copiar o link", description: "Copie o endereço diretamente pela barra do navegador.", variant: "destructive" });
    }
  };

  const regenerateToken = async () => {
    if (!investor) return;
    const { data, error } = await supabase.rpc("investor_regenerate_token" as never, { _investor_id: investor.id } as never);
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Novo link gerado" });
    void load();
    if (data) {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/investidor/${data as string}`);
      } catch {
        toast({ title: "Link renovado, mas não foi possível copiá-lo", variant: "destructive" });
      }
    }
  };

  const deleteInvestor = async () => {
    if (!investor) return;
    if (!confirm("Excluir este investidor e todos os empréstimos vinculados?")) return;
    if (!user?.id) return;
    const { error } = await supabase.from("investors" as never).delete().eq("id", investor.id).eq("user_id", user.id);
    if (error) { toast({ ...friendlyError(error, "Não foi possível excluir o investidor."), variant: "destructive" }); return; }
    toast({ title: "Investidor excluído" });
    navigate("/investidores");
  };

  /** Abre o pagamento do empréstimo aberto mais próximo do vencimento. */
  const darBaixa = () => {
    const aberto = loans
      .filter((l) => l.status !== "paid")
      .sort((a, b) => String(a.due_date || "9999-12-31").localeCompare(String(b.due_date || "9999-12-31")))[0];
    if (!aberto) { toast({ title: "Nenhum empréstimo em aberto", variant: "destructive" }); return; }
    setPayOpen(aberto.id);
  };

  const deleteLoan = async (loanId: string) => {
    if (!confirm("Excluir este empréstimo e os pagamentos registrados nele?")) return;
    if (!user?.id) return;
    const { error } = await supabase.from("investor_loans" as never).delete().eq("id", loanId).eq("user_id", user.id);
    if (error) { toast({ ...friendlyError(error, "Não foi possível excluir o empréstimo."), variant: "destructive" }); return; }
    toast({ title: "Empréstimo excluído" });
    void load();
  };

  const undoLastPayment = async (loanId: string) => {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan) return;
    if (Number(loan.paid_amount) <= 0) {
      toast({ title: "Nenhum pagamento para desfazer", variant: "destructive" }); return;
    }
    if (!confirm("Desfazer o último pagamento deste empréstimo?")) return;
    const { error } = await supabase.rpc("reverse_last_investor_payment", { _loan_id: loanId });
    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Pagamento desfeito" });
    void load();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando perfil do investidor…</div>;
  }

  if (loadError) {
    return (
      <div className="space-y-4 md:p-6">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/investidores")}>
          <ArrowLeft size={14} /> Voltar
        </Button>
        <ErrorState
          error={loadError}
          title="Não foi possível carregar o investidor"
          description="Confira sua conexão e tente novamente."
          onRetry={() => void load()}
        />
      </div>
    );
  }

  if (!investor) {
    return (
      <div className="space-y-4 md:p-6">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/investidores")}>
          <ArrowLeft size={14} /> Voltar
        </Button>
        <p className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
          Investidor não encontrado.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:p-6">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate("/investidores")}>
        <ArrowLeft size={14} /> Voltar para investidores
      </Button>

      {/* Identidade */}
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border/70 bg-card/70 p-5">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-primary/30">
            <Landmark className="h-6 w-6 text-primary" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">{investor.name}</h1>
            <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {investor.cpf_cnpj && <p>Documento: <span className="tabular-nums text-foreground">{investor.cpf_cnpj}</span></p>}
              {investor.email && <p>E-mail: <span className="text-foreground">{investor.email}</span></p>}
              {(investor.whatsapp || investor.phone) && (
                <p>Contato: <span className="tabular-nums text-foreground">{investor.whatsapp || investor.phone}</span></p>
              )}
              {investor.pix_key && <p>Pix: <span className="break-all text-foreground">{investor.pix_key}</span></p>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant={investor.status === "active" ? "outline" : "secondary"}>
                {investor.status === "active" ? "Ativo" : "Inativo"}
              </Badge>
              {s.overdue > 0 && <Badge variant="destructive">{s.overdue} em atraso</Badge>}
              <Badge variant="outline">{s.count} contrato{s.count === 1 ? "" : "s"} em aberto</Badge>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={darBaixa} className="gap-1.5"><DollarSign size={14} /> Dar baixa</Button>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} className="gap-1.5"><Pencil size={14} /> Editar perfil</Button>
          <Button size="sm" variant="outline" onClick={() => setNewLoanOpen(true)} className="gap-1.5"><Plus size={14} /> Novo empréstimo</Button>
          <Button size="sm" variant="outline" onClick={() => void copyPortal()} className="gap-1.5"><Copy size={14} /> Copiar link</Button>
          <Button size="sm" variant="outline" onClick={() => window.open(`/investidor/${investor.access_token}`, "_blank", "noopener,noreferrer")} className="gap-1.5">
            <ExternalLink size={14} /> Abrir portal
          </Button>
          <Button size="sm" variant="outline" onClick={regenerateToken} className="gap-1.5"><RefreshCw size={14} /> Novo link</Button>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Wallet} label="Capital" value={brl(s.capital)} tone="primary" />
        <KpiCard icon={TrendingUp} label="Saldo a pagar" value={brl(s.saldo)} tone="amber" />
        <KpiCard icon={CheckCircle2} label="Total pago" value={brl(s.paid)} tone="emerald" />
        <KpiCard icon={CalendarDays} label="Próx. venc." value={s.prox ? fmtDate(s.prox) : "—"} tone="violet" />
      </div>

      {/* Empréstimos */}
      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Empréstimos ({loans.length})
        </p>
        {loans.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            Nenhum empréstimo registrado para este investidor.
          </p>
        ) : (
          <ul className="space-y-2">
            {loans.map((l) => {
              const saldoLoan = Number(l.total_due) - Number(l.paid_amount);
              return (
                <li key={l.id} className="rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-lg font-bold text-foreground">{brl(Number(l.total_due))}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Capital {brl(Number(l.principal))} • Juros {l.interest_rate}% • Vence {fmtDate(l.due_date)}
                        {Number(l.paid_amount) > 0 && ` • Pago ${brl(Number(l.paid_amount))}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={l.status === "paid" ? "secondary" : "outline"}>
                        {l.status === "paid" ? "Quitado" : `Saldo ${brl(saldoLoan)}`}
                      </Badge>
                      {l.status !== "paid" && (
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPayOpen(l.id)}>
                          <DollarSign size={13} /> Pagar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Editar valores do empréstimo"
                        onClick={() => setEditLoanId(l.id)}>
                        <Pencil size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Desfazer último pagamento"
                        disabled={Number(l.paid_amount) <= 0} onClick={() => void undoLastPayment(l.id)}>
                        <Undo2 size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        title="Excluir empréstimo" onClick={() => void deleteLoan(l.id)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Histórico de pagamentos ({payments.length})</p>
        {payments.length === 0 ? <p className="rounded-xl border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">Nenhum pagamento registrado.</p> : (
          <div className="overflow-hidden rounded-xl border border-border/60">
            {payments.slice(0, 30).map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 border-b border-border/40 bg-background/30 px-3 py-2.5 last:border-0">
              <div><p className="text-xs font-semibold text-foreground">{payment.payment_type === "interest_only" ? "Somente juros" : "Baixa de saldo"}</p><p className="text-[10px] text-muted-foreground">{fmtDate(payment.paid_at || payment.created_at)} · {payment.method || "não informado"}{payment.notes ? ` · ${payment.notes}` : ""}</p></div>
              <span className="font-mono text-sm font-bold text-emerald-400">{brl(Number(payment.amount))}</span>
            </div>)}
          </div>
        )}
      </section>

      {investor.notes && (
        <p className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
          {investor.notes}
        </p>
      )}

      <div className="flex justify-end border-t border-border/50 pt-3">
        <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={deleteInvestor}>
          <Trash2 size={14} /> Excluir investidor
        </Button>
      </div>

      <NewLoanDialog open={newLoanOpen} onOpenChange={setNewLoanOpen} investor={investor} onCreated={() => void load()} />
      {editOpen && (
        <EditInvestorDialog investor={investor} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); void load(); }} />
      )}
      {payOpen && loans.some((l) => l.id === payOpen) && (
        <PayLoanDialog
          loanId={payOpen}
          loan={loans.find((l) => l.id === payOpen)!}
          onClose={() => setPayOpen(null)}
          onPaid={() => { setPayOpen(null); void load(); }}
        />
      )}
      {editLoanId && loans.some((l) => l.id === editLoanId) && (
        <EditLoanDialog
          loan={loans.find((l) => l.id === editLoanId)!}
          onClose={() => setEditLoanId(null)}
          onSaved={() => { setEditLoanId(null); void load(); }}
        />
      )}
    </div>
  );
}
