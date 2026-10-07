import { Credinho, CredinhoLoader } from "@/components/brand/Credinho";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Landmark, Wallet, TrendingUp, CheckCircle2, Clock, Shield, HelpCircle,
  Copy, Calendar, ArrowRight, Download,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { generateInvestorStatementPdf } from "@/utils/investorPdf";
import defaultLogo from "@/assets/credmais-mark.svg";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const brl = (n: number) => safeNumber(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d?: string | null) => d ? formatBR(d) || "-" : "-";

type PortalPayload = {
  investor: { id: string; name: string; email: string | null; cpf_cnpj: string | null; whatsapp: string | null };
  loans: Array<{
    id: string; principal: number; interest_rate: number; total_due: number;
    paid_amount: number; start_date: string; due_date: string; frequency: string;
    status: string; notes: string | null; created_at: string;
    payments: Array<{ id: string; amount: number; paid_at: string; method: string | null }>;
  }>;
  owner: { name?: string; pix_key?: string; pix_key_type?: string };
  branding: {
    portal_title?: string; portal_primary_color?: string; company_name?: string;
    company_logo_url?: string; portal_logo_url?: string;
    portal_contact_phone?: string; portal_contact_email?: string;
  };
};

function normalizePortalPayload(payload: unknown): PortalPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, any>;
  if (!raw.investor || typeof raw.investor !== "object") return null;
  return {
    investor: {
      id: String(raw.investor.id || ""),
      name: String(raw.investor.name || "Investidor"),
      email: raw.investor.email ?? null,
      cpf_cnpj: raw.investor.cpf_cnpj ?? null,
      whatsapp: raw.investor.whatsapp ?? null,
    },
    loans: (Array.isArray(raw.loans) ? raw.loans : []).map((loan: any) => ({
      ...loan,
      id: String(loan?.id || ""),
      principal: safeNumber(loan?.principal),
      interest_rate: safeNumber(loan?.interest_rate),
      total_due: safeNumber(loan?.total_due),
      paid_amount: safeNumber(loan?.paid_amount),
      payments: (Array.isArray(loan?.payments) ? loan.payments : []).map((payment: any) => ({
        ...payment,
        id: String(payment?.id || ""),
        amount: safeNumber(payment?.amount),
      })),
    })),
    owner: raw.owner && typeof raw.owner === "object" ? raw.owner : {},
    branding: raw.branding && typeof raw.branding === "object" ? raw.branding : {},
  };
}

export default function PortalInvestidor() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) { setLoading(false); return; }
      setLoading(true);
      setLoadError(false);
      const { data: payload, error } = await supabase.rpc("investor_portal_login" as never, { _token: token } as never);
      if (error) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      setData(normalizePortalPayload(payload));
      setLoading(false);
    })();
  }, [attempt, token]);

  const totals = useMemo(() => {
    if (!data) return { capital: 0, receber: 0, recebido: 0, prox: null as string | null };
    const active = data.loans.filter((l) => l.status !== "paid");
    return {
      capital: active.reduce((s, l) => s + safeNumber(l.principal), 0),
      receber: active.reduce((s, l) => s + (safeNumber(l.total_due) - safeNumber(l.paid_amount)), 0),
      recebido: data.loans.reduce((s, l) => s + safeNumber(l.paid_amount), 0),
      prox: active.map((l) => l.due_date).sort()[0] || null,
    };
  }, [data]);

  if (loading) return <CredinhoLoader fullScreen label="Carregando portal" />;

  if (!data) {
    return (
      <div className="min-h-dvh bg-[#101010] bg-cover bg-center text-white grid place-items-center p-6" style={{ backgroundImage: "radial-gradient(at 50% 25%,#e4a33d14,transparent 60%)" }}>
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-sm">
          <Credinho pose="thinking" className="mx-auto w-[110px]" />
          <Shield className="mx-auto h-10 w-10 text-red-400" />
          {loadError ? (
            <>
              <h1 className="mt-4 text-xl font-bold">Não foi possível abrir o portal</h1>
              <p className="mt-2 text-sm text-white/60">Verifique sua conexão e tente novamente.</p>
              <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950">Tentar novamente</button>
            </>
          ) : (
          <>
          <h1 className="mt-3 font-heading text-2xl font-bold">Link inválido</h1>
          <p className="mt-2 text-sm text-white/60">
            Este link do portal do investidor não é válido ou foi revogado. Solicite um novo link ao credor.
          </p>
          </>
          )}
        </div>
      </div>
    );
  }

  const brand = data.branding || {};
  const company = brand.company_name || brand.portal_title || "CredMais";
  const logo = brand.portal_logo_url || brand.company_logo_url || defaultLogo;

  return (
    <div
      className="min-h-dvh bg-[#101010] bg-cover bg-center bg-fixed text-white"
      style={{ backgroundImage: `linear-gradient(135deg,rgba(16,16,16,.95),rgba(35,29,19,.82),rgba(16,16,16,.96)),url(${logo})` }}
    >
      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {logo ? (
              <img src={logo} alt={company} width={40} height={40} className="h-10 w-10 rounded-xl object-cover ring-1 ring-primary/35" />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/20 text-primary">
                <Landmark className="h-5 w-5" />
              </div>
            )}
            <div>
              <p className="text-xs uppercase tracking-widest text-white/50">Portal do investidor</p>
              <h1 className="font-heading text-lg font-bold">{company}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => data && generateInvestorStatementPdf(data as any)}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20"
            >
              <Download className="h-3.5 w-3.5" /> Extrato PDF
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
            >
              <HelpCircle className="h-3.5 w-3.5" /> Ajuda
            </button>
          </div>
        </header>

        {/* Boas-vindas */}
        <section className="rounded-3xl border border-white/10 bg-white/4 p-6 backdrop-blur-sm">
          <p className="text-xs uppercase tracking-widest text-primary">Olá, investidor</p>
          <h2 className="mt-1 font-heading text-3xl font-bold">{data.investor.name}</h2>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Este é o seu portal exclusivo para acompanhar em tempo real todo o capital investido, pagamentos recebidos
            e vencimentos futuros junto ao credor <b>{data.owner?.name || company}</b>.
          </p>
        </section>

        {/* KPIs */}
        <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi icon={Wallet} label="Capital investido" value={brl(totals.capital)} tone="primary" />
          <Kpi icon={TrendingUp} label="A receber" value={brl(totals.receber)} tone="amber" />
          <Kpi icon={CheckCircle2} label="Já recebido" value={brl(totals.recebido)} tone="emerald" />
          <Kpi icon={Calendar} label="Próximo venc." value={totals.prox ? fmtDate(totals.prox) : "—"} tone="violet" />
        </section>

        {/* Empréstimos */}
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/4 p-5 backdrop-blur-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">Seus contratos</h3>
          {data.loans.length === 0 ? (
            <p className="py-10 text-center text-sm text-white/50">Nenhum contrato registrado ainda.</p>
          ) : (
            <ul className="space-y-3">
              {data.loans.map((l) => {
                const saldo = safeNumber(l.total_due) - safeNumber(l.paid_amount);
                const pct = safeNumber(l.total_due) > 0
                  ? Math.min(100, Math.max(0, (safeNumber(l.paid_amount) / safeNumber(l.total_due)) * 100))
                  : 0;
                const dueDate = parseLocalDate(l.due_date);
                const overdue = l.status !== "paid" && !!dueDate && dueDate < new Date();
                return (
                  <li key={l.id} className="rounded-2xl border border-white/5 bg-white/3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-2xl font-bold">{brl(Number(l.total_due))}</p>
                        <p className="mt-1 text-xs text-white/60">
                          Capital {brl(safeNumber(l.principal))} • Juros {safeNumber(l.interest_rate)}% • Iniciado em {fmtDate(l.start_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        {l.status === "paid" ? (
                          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">Quitado</span>
                        ) : overdue ? (
                          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-300">Atrasado</span>
                        ) : (
                          <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">Ativo</span>
                        )}
                        <p className="mt-1 text-[11px] text-white/50">Vence {fmtDate(l.due_date)}</p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full bg-linear-to-r from-primary to-violet-400" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-white/50">
                      <span>Já recebido: {brl(safeNumber(l.paid_amount))}</span>
                      <span>Saldo: {brl(saldo)}</span>
                    </div>
                    {l.payments.length > 0 && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-primary/80 hover:text-primary">
                          Ver histórico de pagamentos ({l.payments.length})
                        </summary>
                        <ul className="mt-2 space-y-1 border-t border-white/5 pt-2 text-xs">
                          {l.payments.map((p) => (
                            <li key={p.id} className="flex justify-between text-white/70">
                              <span>{fmtDate(p.paid_at)} • {p.method || "—"}</span>
                              <span className="font-mono font-semibold text-emerald-300">{brl(safeNumber(p.amount))}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* PIX do credor */}
        {data.owner?.pix_key && (
          <section className="mt-6 rounded-3xl border border-primary/20 bg-primary/5 p-5 backdrop-blur-sm">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-primary/80">Chave PIX do credor</h3>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-white/50">{data.owner.pix_key_type || "chave"}</p>
                <p className="mt-0.5 break-all font-mono text-sm">{data.owner.pix_key}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(String(data.owner?.pix_key || ""));
                    toast({ title: "Chave copiada!" });
                  } catch {
                    toast({ title: "Não foi possível copiar a chave", variant: "destructive" });
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
              >
                <Copy className="h-3.5 w-3.5" /> Copiar
              </button>
            </div>
          </section>
        )}

        <footer className="mt-8 text-center text-[11px] text-white/40">
          Portal seguro • Dados atualizados em tempo real • {company}
        </footer>
      </div>

      {/* Modal ajuda */}
      {helpOpen && (
        <div className="fixed inset-0 z-90 grid place-items-center bg-black/70 p-4" onClick={() => setHelpOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-heading text-lg font-bold">Precisa de ajuda?</h4>
            <p className="mt-1 text-xs text-white/60">Fale diretamente com o credor:</p>
            <div className="mt-4 space-y-2 text-sm">
              {brand.portal_contact_phone && (
                <a href={`https://wa.me/${brand.portal_contact_phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
                   className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2 hover:bg-emerald-500/15">
                  <span>WhatsApp</span><ArrowRight className="h-4 w-4" />
                </a>
              )}
              {brand.portal_contact_email && (
                <a href={`mailto:${brand.portal_contact_email}`}
                   className="flex items-center justify-between rounded-xl bg-primary/10 px-3 py-2 hover:bg-primary/15">
                  <span>E-mail</span><ArrowRight className="h-4 w-4" />
                </a>
              )}
              {!brand.portal_contact_phone && !brand.portal_contact_email && (
                <p className="text-xs text-white/50">Contato não configurado.</p>
              )}
            </div>
            <button onClick={() => setHelpOpen(false)} className="mt-4 w-full rounded-xl border border-white/10 py-2 text-sm hover:bg-white/5">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const tones: Record<string, string> = {
    primary: "from-primary/20 to-primary/5 text-primary",
    emerald: "from-emerald-500/20 to-emerald-500/5 text-emerald-300",
    amber: "from-amber-500/20 to-amber-500/5 text-amber-300",
    violet: "from-violet-500/20 to-violet-500/5 text-violet-300",
  };
  return (
    <div className={`rounded-2xl border border-white/5 bg-linear-to-br ${tones[tone]} p-4 backdrop-blur-sm`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest opacity-80">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-2 font-mono text-xl font-bold text-white">{value}</p>
    </div>
  );
}
