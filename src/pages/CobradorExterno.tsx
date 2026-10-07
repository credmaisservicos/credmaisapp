import { Credinho } from "@/components/brand/Credinho";
import { isEmAtraso, isEmAberto } from "@/lib/dashboardMetrics";
import { useEffect, useMemo, useState,useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Lock, Users, DollarSign, Phone, Mail, MapPin, Calendar,
  AlertTriangle, CheckCircle, Clock, ChevronDown, ChevronUp,
  LogOut, LogIn, User, FileText, TrendingUp, Shield, Search, X, Upload, Loader2, Copy
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { renderMessage } from "@/lib/messageTemplate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accumulatedPaymentTotal, portalInstallmentAmount } from "@/lib/portalAmounts";
import defaultLogo from "@/assets/credmais-mark.svg";
import { formatFrequency } from "@/components/cliente-detalhe/constants";
import {tabSessionStorage} from '@/lib/tabSessionStorage';
import {withAbortTimeout} from '@/lib/withTimeout';

const TOKEN_KEY = "cobrador-token";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const safeTime = (value: unknown) => {
  return parseLocalDate(typeof value === "string" || value instanceof Date ? value : null)?.getTime() ?? null;
};

type PayMethod = "pix" | "dinheiro" | "transferencia";

const CobradorExterno = () => {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [collectorData, setCollectorData] = useState<any>(null);
  /** Payload completo da RPC: cobrador, credor, marca e clientes com parcelas. */
  const [portal, setPortal] = useState<any>(null);
  const loginGeneration=useRef(0);
  const accessEpoch=useRef(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [tab, setTab] = useState<"pendentes" | "atrasadas" | "pagas">("pendentes");
  const [search, setSearch] = useState("");

  // Payment modal state
  const [payOpen, setPayOpen] = useState(false);
  const [payInstallment, setPayInstallment] = useState<any>(null);
  const [payMethod, setPayMethod] = useState<PayMethod>("pix");
  const [payAmount, setPayAmount] = useState<string>("");
  const [payFile, setPayFile] = useState<File | null>(null);
  const [paySaving, setPaySaving] = useState(false);

  // Mantém o token apenas durante a aba atual. Tokens de portal são credenciais:
  // persistir em localStorage os deixava disponíveis mesmo após fechar o navegador.
  useEffect(() => {
    const saved = tabSessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      setToken(saved);
      void loginWithToken(saved, true);
    }

    return ()=>{++loginGeneration.current;++accessEpoch.current;};
  }, []);

  // Tudo vem do payload da RPC: clientes atribuídos, parcelas de cada um e os
  // dados do credor. As consultas diretas que existiam aqui liam VAZIO, porque
  // esta tela não tem sessão — a RLS dessas tabelas só atende `authenticated`.
  const assignments = useMemo(
    () => (portal?.clients ?? []).map((c: any) => ({ client_id: c.id, clients: c })),
    [portal],
  );

  const installments = useMemo(
    () =>
      (portal?.clients ?? []).flatMap((c: any) =>
        (c.installments ?? []).map((i: any) => ({ ...i, client_id: c.id, clients: c })),
      ),
    [portal],
  );

  const ownerProfile = portal?.owner ?? null;

  // Realtime: refetch installments on changes
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`cobrador-${userId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "contract_installments", filter: `user_id=eq.${userId}` },
        () => {
          const saved = tabSessionStorage.getItem(TOKEN_KEY);
          if (saved) void loginWithToken(saved, true);
        },
      )
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "collector_assignments", filter: `user_id=eq.${userId}` },
        () => {
          const saved = tabSessionStorage.getItem(TOKEN_KEY);
          if (saved) void loginWithToken(saved, true);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const loginWithToken = async (tk: string, silent = false) => {
    const normalizedToken = tk.trim();
    if (!normalizedToken) {
      if (!silent) toast({ title: "Informe o token de acesso", variant: "destructive" });
      return;
    }
    setLoading(true);
    const generation=++loginGeneration.current;
    // Esta página roda SEM login. Ler `collector_tokens` direto não funcionava:
    // a RLS só atende `authenticated`, então o visitante anônimo recebia vazio e
    // todo acesso caía em "Token inválido" — o portal nunca abriu para ninguém.
    // Agora usa a função SECURITY DEFINER, mesmo padrão do portal do cliente.
    try{
      const {data,error,status}=await withAbortTimeout(signal=>supabase.rpc('collector_login_by_token',{_token:normalizedToken}).abortSignal(signal));
      if(generation!==loginGeneration.current)return;
      if(status===401||status===403){handleLogout();if(!silent)toast({title:'Acesso negado',description:'Entre novamente com um token válido.',variant:'destructive'});return;}
      if(error)throw error;
      const payload=data as any;
      if(!payload?.collector?.id||!payload?.owner_id){
        handleLogout();
        if(!silent)toast({title:'Acesso negado',description:'Token inválido ou desativado.',variant:'destructive'});
        return;
      }
      tabSessionStorage.setItem(TOKEN_KEY,normalizedToken);
      setPortal(payload);setCollectorData(payload.collector);setCollectorId(payload.collector.id);
      setUserId(payload.owner_id);setToken(normalizedToken);
    }catch{
      if(generation===loginGeneration.current&&!silent)toast({title:'Não foi possível carregar o portal',description:'Tente novamente em instantes.',variant:'destructive'});
    }finally{if(generation===loginGeneration.current)setLoading(false);}
  };

  const handleAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    ++accessEpoch.current;
    await loginWithToken(token);
  };

  const handleLogout = () => {
    ++loginGeneration.current;++accessEpoch.current;tabSessionStorage.removeItem(TOKEN_KEY);setLoading(false);
    setPayOpen(false);setPayInstallment(null);setPayFile(null);setPaySaving(false);
    setCollectorData(null);
    setPortal(null);
    setCollectorId(null);
    setUserId(null);
    setToken("");
  };

  const openPaymentModal = (inst: any) => {
    setPayInstallment(inst);
    setPayAmount(String(portalInstallmentAmount(inst).toFixed(2)));
    setPayMethod("pix");
    setPayFile(null);
    setPayOpen(true);
  };

  const handleConfirmPayment = async () => {
    if (!payInstallment) return;
    const amount = safeNumber(payAmount.replace(",", "."));
    if (!amount || amount <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    const remaining = portalInstallmentAmount(payInstallment);
    if (Math.abs(amount - remaining) > 0.005) {
      toast({
        title: "O valor deve quitar o saldo",
        description: `Saldo atualizado: R$ ${fmt(remaining)}. Pagamentos parciais devem ser registrados pelo gestor.`,
        variant: "destructive",
      });
      return;
    }
    setPaySaving(true);
    const epoch=accessEpoch.current;
    const accessToken=tabSessionStorage.getItem(TOKEN_KEY)||token;
    try {
      let receipt_url: string | null = null;
      if (payFile && userId) {
        const savedTok = accessToken;
        const fd = new FormData();
        fd.append("collector_token", savedTok);
        fd.append("installment_id", payInstallment.id);
        fd.append("file", payFile);

        const { data: up, error: upErr } = await supabase.functions.invoke(
          "portal-upload-comprovante",
          { body: fd },
        );
        if (upErr) throw upErr;
        if (!up?.signed_url) throw new Error("Falha ao gerar URL do comprovante");
        receipt_url = up.signed_url as string;
      }
      if(epoch!==accessEpoch.current)return;

      // A escrita direta não passava pela RLS (0 linhas afetadas) e ainda assim
      // exibia sucesso. A RPC valida o token, exige que o cliente esteja
      // atribuído a este cobrador e faz a contabilidade completa: parcela,
      // lucro, caixa, conclusão do contrato e registro de quem recebeu.
      const { error } = await supabase.rpc("collector_register_payment", {
        _token: accessToken,
        _installment_id: payInstallment.id,
        _paid_total: accumulatedPaymentTotal(payInstallment, amount),
        _method: payMethod,
        _receipt_url: receipt_url ?? null,
      });
      if(epoch!==accessEpoch.current)return;
      if (error) throw error;
      toast({ title: "✓ Pagamento registrado!", description: `${payMethod.toUpperCase()} • R$ ${amount.toFixed(2)}` });
      setPayOpen(false);
      await loginWithToken(accessToken, true);
    } catch (err: any) {
      if(epoch!==accessEpoch.current)return;
      toast({ title: "Erro", description: err?.message || "Falha ao registrar pagamento.", variant: "destructive" });
    } finally {
      if(epoch===accessEpoch.current)setPaySaving(false);
    }
  };

  const copyPix = async () => {
    if (!ownerProfile?.pix_key) return;
    try {
      await navigator.clipboard.writeText(ownerProfile.pix_key);
      toast({ title: "Chave PIX copiada!" });
    } catch {
      toast({ title: "Não foi possível copiar", description: "Selecione a chave PIX e copie manualmente.", variant: "destructive" });
    }
  };

  const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const now = new Date();
  const portalLogo = portal?.branding?.portal_logo_url || portal?.branding?.company_logo_url || defaultLogo;
  const inputCls = "w-full px-4 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all";

  // Filter assignments by search
  const filteredAssignments = useMemo(() => {
    if (!search.trim()) return assignments;
    const q = search.toLowerCase().trim();
    return assignments.filter((a: any) => {
      const name = (a.clients?.name || "").toLowerCase();
      const phone = (a.clients?.phone || a.clients?.whatsapp || "").replace(/\D/g, "");
      const cpf = (a.clients?.cpf_cnpj || "").replace(/\D/g, "");
      return name.includes(q) || phone.includes(q.replace(/\D/g, "")) || cpf.includes(q.replace(/\D/g, ""));
    });
  }, [assignments, search]);

  if (!collectorData) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center bg-[#101010] bg-cover bg-center p-4 relative overflow-hidden"
        style={{ backgroundImage: "radial-gradient(at 50% 25%,#e4a33d14,transparent 60%)" }}
      >
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[120px]" />
        </div>
        <form onSubmit={handleAccess} className="w-full max-w-sm space-y-5 rounded-3xl border border-border/60 bg-card/80 backdrop-blur-xl p-8 shadow-2xl relative animate-fade-in">
          <div className="text-center">
            <div className="relative w-20 h-20 mx-auto rounded-2xl border border-primary/25 flex items-center justify-center mb-5 shadow-lg overflow-hidden">
              <img src={defaultLogo} alt="CredMais App" width={80} height={80} className="h-full w-full object-cover" />
              <div className="absolute inset-0 rounded-2xl bg-primary/10 blur-xl -z-10" />
            </div>
            <Credinho pose="organize" className="mx-auto w-[100px]" />
            <h1 className="text-2xl font-display font-bold text-shimmer tracking-wide">Portal do Cobrador</h1>
            <p className="text-sm text-muted-foreground mt-2">Acesse com seu token de acesso</p>
          </div>
          <div className="h-px bg-border" />
          <label htmlFor="collector-token" className="sr-only">Token de acesso</label>
          <input id="collector-token" name="collector_token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Insira seu token…" required autoComplete="off" spellCheck={false} className={`${inputCls} text-center font-mono tracking-wider`} />
          <button type="submit" disabled={loading} className="btn-premium w-full py-3 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? "Verificando…" : (<><LogIn size={16} /> Acessar Portal</>)}
          </button>
          <p className="text-[10px] text-center text-muted-foreground">Acesso seguro · Token fornecido pelo gestor · Sessão mantida somente nesta aba</p>
        </form>
      </div>
    );
  }

  const allPending = installments.filter((i: any) => isEmAberto(i));
  const allOverdue = allPending.filter((i: any) => isEmAtraso(i, now));
  const allPaid = installments.filter((i: any) => i.status === "paid");
  const totalPending = allPending.reduce((s: number, i: any) => s + portalInstallmentAmount(i, now), 0);
  const totalOverdue = allOverdue.reduce((s: number, i: any) => s + portalInstallmentAmount(i, now), 0);
  const totalPaid = allPaid.reduce((s: number, i: any) => s + safeNumber(i.paid_amount ?? i.amount), 0);

  return (
    <div
      className="min-h-dvh bg-background bg-cover bg-center bg-fixed"
      style={{ backgroundImage: `linear-gradient(rgba(2,7,25,.94),rgba(2,7,25,.97)),url(${portalLogo})` }}
    >
      {/* Top Bar */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-md px-4 md:px-8 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={portalLogo} alt="Logotipo" width={40} height={40} className="h-10 w-10 rounded-xl object-cover border border-primary/25" />
            <div>
              <p className="font-semibold text-foreground text-sm">{collectorData.name}</p>
              <p className="text-[11px] text-muted-foreground">{collectorData.city}/{collectorData.state}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowProfile(!showProfile)} aria-label="Abrir perfil do cobrador"
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
              <User size={18} />
            </button>
            <button type="button" onClick={handleLogout} aria-label="Sair do portal"
              className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {/* Profile Card */}
        {showProfile && (
          <div className="rounded-2xl border border-primary/20 bg-card p-6 space-y-4 animate-fade-in shadow-lg">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center text-2xl font-bold text-primary border border-primary/10">
                {collectorData.name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{collectorData.name}</h2>
                <Badge variant="outline" className={`text-xs mt-1 ${collectorData.is_active !== false ? "bg-success/10 text-success border-success/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
                  {collectorData.is_active !== false ? "Ativo" : "Inativo"}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/20 border border-border/50">
                <Phone size={14} className="text-primary" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Telefone</p>
                  <p className="text-sm font-medium text-foreground">{collectorData.phone}</p>
                </div>
              </div>
              {collectorData.email && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/20 border border-border/50">
                  <Mail size={14} className="text-primary" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">E-mail</p>
                    <p className="text-sm font-medium text-foreground truncate">{collectorData.email}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/20 border border-border/50">
                <MapPin size={14} className="text-primary" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase">Localização</p>
                  <p className="text-sm font-medium text-foreground">{collectorData.city}/{collectorData.state}</p>
                </div>
              </div>
            </div>
            {ownerProfile?.pix_key && (
              <button type="button" onClick={copyPix} className="w-full p-3 rounded-xl bg-primary/5 border border-primary/10 hover:bg-primary/10 transition-colors text-left flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Chave PIX do Credor</p>
                  <p className="text-sm font-medium text-primary">{ownerProfile.pix_key}</p>
                  <p className="text-[10px] text-muted-foreground">Tipo: {ownerProfile.pix_key_type || "—"}</p>
                </div>
                <Copy size={16} className="text-primary" />
              </button>
            )}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users size={14} className="text-primary" />
              <p className="text-[10px] text-muted-foreground uppercase">Clientes</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{assignments.length}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 cursor-pointer hover:border-amber-500/30 transition-colors"
            onClick={() => setTab("pendentes")}>
            <div className="flex items-center gap-2 mb-2">
              <Clock size={14} className="text-amber-500" />
              <p className="text-[10px] text-muted-foreground uppercase">Pendentes</p>
            </div>
            <p className="text-2xl font-bold text-amber-500">{allPending.length}</p>
            <p className="text-[10px] text-muted-foreground">R$ {fmt(totalPending)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 cursor-pointer hover:border-destructive/30 transition-colors"
            onClick={() => setTab("atrasadas")}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-destructive" />
              <p className="text-[10px] text-muted-foreground uppercase">Atrasadas</p>
            </div>
            <p className="text-2xl font-bold text-destructive">{allOverdue.length}</p>
            <p className="text-[10px] text-muted-foreground">R$ {fmt(totalOverdue)}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 cursor-pointer hover:border-success/30 transition-colors"
            onClick={() => setTab("pagas")}>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={14} className="text-success" />
              <p className="text-[10px] text-muted-foreground uppercase">Recebidas</p>
            </div>
            <p className="text-2xl font-bold text-success">{allPaid.length}</p>
            <p className="text-[10px] text-muted-foreground">R$ {fmt(totalPaid)}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente por nome, telefone ou CPF..."
            className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-card border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Limpar busca" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tab buttons */}
        <div className="flex items-center gap-2 border-b border-border pb-1">
          {[
            { key: "pendentes" as const, label: "Pendentes", count: allPending.length, color: "text-amber-500" },
            { key: "atrasadas" as const, label: "Atrasadas", count: allOverdue.length, color: "text-destructive" },
            { key: "pagas" as const, label: "Recebidas", count: allPaid.length, color: "text-success" },
          ].map(t => (
              <button type="button" key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-t-xl text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-card border border-b-0 border-border text-foreground -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              }`}>
              {t.label}
              <span className={`text-xs font-bold ${tab === t.key ? t.color : ""}`}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* Client list */}
        {filteredAssignments.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-border bg-card/50">
            <Users size={32} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-foreground font-semibold">
              {assignments.length === 0 ? "Nenhum cliente atribuído" : "Nenhum cliente encontrado"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {assignments.length === 0 ? "Aguarde o administrador atribuir clientes a você." : "Ajuste sua busca."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAssignments.map((a: any) => {
              const clientAll = installments.filter((i: any) => i.client_id === a.client_id);
              let clientFiltered: any[] = [];
              if (tab === "pendentes") {
                clientFiltered = clientAll.filter((i: any) => isEmAberto(i));
              } else if (tab === "atrasadas") {
                clientFiltered = clientAll.filter((i: any) => isEmAtraso(i, now));
              } else {
                clientFiltered = clientAll.filter((i: any) => i.status === "paid");
              }

              if (clientFiltered.length === 0) return null;

              const isExpanded = expandedClient === a.client_id;
              const clientTotalPending = clientAll.filter((i: any) => isEmAberto(i));
              const clientTotalOverdue = clientTotalPending.filter((i: any) => {
                const due = parseLocalDate(i.due_date);
                return !!due && due < now;
              });
              const clientPendingAmount = clientTotalPending.reduce((s: number, i: any) => s + portalInstallmentAmount(i, now), 0);

              return (
                <div key={a.id} className="rounded-2xl border border-border bg-card overflow-hidden transition-all hover:shadow-md">
                  <button
                    onClick={() => setExpandedClient(isExpanded ? null : a.client_id)}
                    className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-accent/20 transition-colors"
                  >
                    <div className="w-11 h-11 rounded-xl bg-linear-to-br from-primary/20 to-primary/5 flex items-center justify-center text-sm font-bold text-primary border border-primary/10 shrink-0">
                      {a.clients?.name?.charAt(0)?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{a.clients?.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Phone size={10} /> {a.clients?.phone || a.clients?.whatsapp || "—"}
                        </span>
                        {a.clients?.cpf_cnpj && (
                          <span className="text-[11px] text-muted-foreground">· {a.clients.cpf_cnpj}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 mr-2">
                      <p className="text-sm font-bold text-foreground">R$ {fmt(clientPendingAmount)}</p>
                      <div className="flex items-center gap-1.5">
                        {clientTotalOverdue.length > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/20">
                            {clientTotalOverdue.length} atrasada(s)
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">{clientFiltered.length} itens</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="animate-fade-in">
                      <div className="px-5 py-3 border-t border-border/50 bg-accent/10 flex flex-wrap gap-4">
                        {a.clients?.phone && (
                          <a href={`tel:${a.clients.phone}`} className="flex items-center gap-1.5 text-xs text-primary hover:underline">
                            <Phone size={12} /> {a.clients.phone}
                          </a>
                        )}
                        {a.clients?.whatsapp && (
                          <a
                            href={`https://wa.me/55${a.clients.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
                              // Antes só [Nome do Cliente] era trocado: a mensagem
                              // chegava ao devedor com "[Nome da Empresa]" e
                              // "[Valor da Parcela]" literais no WhatsApp.
                              renderMessage(ownerProfile?.billing_message || "", {
                                nome: a.clients?.name || "",
                                empresa: ownerProfile?.name || "",
                                pix: ownerProfile?.pix_key || "",
                                portal: `${window.location.origin}/portal-cliente`,
                              })
                            )}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-success hover:underline">
                            <Phone size={12} /> WhatsApp
                          </a>
                        )}
                        {a.clients?.email && (
                          <a href={`mailto:${a.clients.email}`} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline">
                            <Mail size={12} /> {a.clients.email}
                          </a>
                        )}
                      </div>

                      <div className="divide-y divide-border/30">
                        {clientFiltered.map((inst: any) => {
                          const isOverdue = isEmAtraso(inst, now);
                              const dueTime = safeTime(inst.due_date);
                              const daysLate = isOverdue && dueTime !== null ? Math.floor((now.getTime() - dueTime) / 86400000) : 0;
                          const isPaid = inst.status === "paid";

                          return (
                            <div key={inst.id} className={`flex items-center gap-3 px-5 py-3 ${isOverdue ? "bg-destructive/5" : ""}`}>
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                isPaid ? "bg-success/10 text-success" : isOverdue ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-500"
                              }`}>
                                {inst.installment_number}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-foreground">
                                    R$ {fmt(isPaid ? Number(inst.paid_amount || inst.amount) : portalInstallmentAmount(inst, now))}
                                  </p>
                                  {inst.contracts?.frequency && (
                                    <span className="text-[10px] text-muted-foreground bg-accent/30 px-1.5 py-0.5 rounded">
                                      {formatFrequency(inst.contracts.frequency)}
                                    </span>
                                  )}
                                  {isPaid && inst.payment_method && (
                                    <span className="text-[10px] text-success bg-success/10 px-1.5 py-0.5 rounded uppercase">
                                      {inst.payment_method}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <Calendar size={10} />
                                  {isPaid ? "Pago em " : "Vence: "}
                                  {formatBR(isPaid ? inst.paid_at : inst.due_date)}
                                  {isOverdue && (
                                    <span className="text-destructive font-medium ml-1">
                                      · {daysLate} dia(s) de atraso
                                    </span>
                                  )}
                                </p>
                                {inst.contracts?.capital && (
                                  <p className="text-[10px] text-muted-foreground">
                                    Capital: R$ {fmt(Number(inst.contracts.capital))} · {inst.contracts.num_installments}x
                                  </p>
                                )}
                                {isPaid && inst.receipt_url && (
                                  <a href={inst.receipt_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary hover:underline">
                                    Ver comprovante →
                                  </a>
                                )}
                              </div>
                              {!isPaid ? (
                                <button
                                  onClick={() => openPaymentModal(inst)}
                                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-success/10 text-success hover:bg-success/20 transition-all shrink-0"
                                >
                                  <DollarSign size={12} /> Pagar
                                </button>
                              ) : (
                                <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/20 shrink-0">
                                  <CheckCircle size={10} className="mr-1" /> Pago
                                </Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredAssignments.every((a: any) => {
              const clientAll = installments.filter((i: any) => i.client_id === a.client_id);
              let filtered: any[];
              if (tab === "pendentes") filtered = clientAll.filter((i: any) => isEmAberto(i));
              else if (tab === "atrasadas") filtered = clientAll.filter((i: any) => isEmAtraso(i, now));
              else filtered = clientAll.filter((i: any) => i.status === "paid");
              return filtered.length === 0;
            }) && (
              <div className="text-center py-12 text-muted-foreground">
                {tab === "pendentes" && "Nenhuma cobrança pendente 🎉"}
                {tab === "atrasadas" && "Nenhuma cobrança atrasada 🎉"}
                {tab === "pagas" && "Nenhum pagamento registrado ainda"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Modal */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pagamento</DialogTitle>
            <DialogDescription>
              {payInstallment && `Parcela #${payInstallment.installment_number} • Vence ${formatBR(payInstallment.due_date)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Método de pagamento</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: "pix" as const, label: "PIX" },
                  { v: "dinheiro" as const, label: "Dinheiro" },
                  { v: "transferencia" as const, label: "Transferência" },
                ]).map(opt => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setPayMethod(opt.v)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                      payMethod === opt.v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Valor recebido (R$)</label>
              <Input
                type="text"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="text-lg font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">Comprovante (opcional)</label>
              <label className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-border cursor-pointer hover:border-primary/50 hover:bg-accent/20 transition-colors">
                <Upload size={16} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground flex-1 truncate">
                  {payFile ? payFile.name : "Anexar imagem ou PDF"}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => setPayFile(e.target.files?.[0] || null)}
                />
              </label>
              {payFile && (
                <button type="button" onClick={() => setPayFile(null)} className="text-[10px] text-destructive mt-1 hover:underline">
                  Remover
                </button>
              )}
            </div>

            {payMethod === "pix" && ownerProfile?.pix_key && (
              <button type="button" onClick={copyPix} className="w-full p-3 rounded-xl bg-primary/5 border border-primary/10 hover:bg-primary/10 text-left flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase">Chave PIX do credor</p>
                  <p className="text-sm font-medium text-primary truncate">{ownerProfile.pix_key}</p>
                </div>
                <Copy size={16} className="text-primary shrink-0" />
              </button>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paySaving}>Cancelar</Button>
            <Button onClick={handleConfirmPayment} disabled={paySaving}>
              {paySaving ? <><Loader2 size={16} className="mr-2 animate-spin" />Salvando...</> : <><CheckCircle size={16} className="mr-2" />Confirmar pagamento</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CobradorExterno;
