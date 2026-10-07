import { useEffect, useLayoutEffect, useMemo, useState,useRef } from "react";
import { formatBR, isOverdue as isDateOverdue, parseLocalDate } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, CalendarDays, Clock, CreditCard, FileText, Lock, Shield, User, Phone, Mail, TrendingUp, Wallet, AlertTriangle, CheckCircle2, Sparkles, ChevronRight, LogOut, BadgeCheck, HelpCircle, X, MessageCircle, RefreshCw, Download, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PaymentModal } from "@/components/ClientPortal/PaymentModal";
import "./PortalCliente.css";
import { NotificationsBell } from "@/components/ClientPortal/NotificationsBell";
import { computeLateFee } from "@/lib/lateFee";
import { portalInstallmentAmount } from "@/lib/portalAmounts";
import { generatePortalStatementPdf } from "@/utils/portalPdf";
import { isPortalLoginBlocked, recordPortalLoginAttempt, performFullPortalLogout,getPortalToken,savePortalToken,clearPortalSession,isPortalToken,endCreditorSessionForPortal } from "@/lib/portalSession";
import {withAbortTimeout} from '@/lib/withTimeout';
import defaultLogo from "@/assets/credmais-mark.svg";
import { isValidCPF, onlyDigits } from "@/lib/cpfCnpj";
import { formatFrequency } from "@/components/cliente-detalhe/constants";

type PortalInstallment = {
  id: string;
  installment_number: number;
  amount: number | string;
  due_date: string;
  paid_at?: string | null;
  paid_amount?: number | string | null;
  late_fee?: number | string | null;
  status: string;
  payment_method?: string | null;
  receipt_url?: string | null;
  late_fee_percent?: number | string | null;
  daily_interest_percent?: number | string | null;
  max_interest_cap_percent?: number | string | null;
};

type PortalContract = {
  id: string;
  capital: number | string;
  interest_rate: number | string;
  num_installments: number;
  installment_amount: number | string;
  frequency: string;
  start_date: string;
  status: string;
  total_amount: number | string;
  total_interest: number | string;
  payment_method?: string | null;
  late_fee_percent?: number | string | null;
  daily_interest_percent?: number | string | null;
  max_interest_cap_percent?: number | string | null;
  installments: PortalInstallment[];
};

type PortalData = {
  client: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    cpf_cnpj?: string | null;
    status?: string | null;
    birth_date?: string | null;
  };
  session_token?: string | null;
  contracts: PortalContract[];
  owner?: {
    name?: string | null;
    pix_key?: string | null;
    pix_key_type?: string | null;
  };
  branding?: {
    portal_title?: string | null;
    portal_subtitle?: string | null;
    portal_welcome_message?: string | null;
    portal_primary_color?: string | null;
    portal_contact_phone?: string | null;
    portal_contact_email?: string | null;
    portal_logo_url?: string | null;
    company_name?: string | null;
    company_logo_url?: string | null;
  };
};

function normalizePortalData(payload: unknown): PortalData | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, any>;
  if (!raw.client || typeof raw.client !== "object") return null;
  return {
    ...raw,
    client: { ...raw.client, id: String(raw.client.id || ""), name: String(raw.client.name || "Cliente") },
    contracts: (Array.isArray(raw.contracts) ? raw.contracts : []).map((contract: any) => ({
      ...contract,
      id: String(contract?.id || ""),
      installments: Array.isArray(contract?.installments) ? contract.installments : [],
    })),
    owner: raw.owner && typeof raw.owner === "object" ? raw.owner : {},
    branding: raw.branding && typeof raw.branding === "object" ? raw.branding : {},
  };
}

const money = (value: number | string | null | undefined) =>
  (Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const date = (value: string | null | undefined) => {
  if (!value) return "—";
  return formatBR(value);
};

const statusLabel = (status: string) => {
  if (status === "paid") return "Pago";
  if (status === "active") return "Ativo";
  if (status === "overdue") return "Vencido";
  if (status === "completed") return "Concluído";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
};

type Tab = "open" | "overdue" | "paid";

const PortalCliente = () => {
  const { toast } = useToast();
  const [cpf, setCpf] = useState("");
  const [cpfError, setCpfError] = useState<string | null>(null);
  const [cpfTouched, setCpfTouched] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const loginGeneration=useRef(0);
  const [tab, setTab] = useState<Tab>("open");
  const [selectedInstallment, setSelectedInstallment] = useState<PortalInstallment | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [signatureInfo, setSignatureInfo] = useState<any[]>([]);
  const [signingContract, setSigningContract] = useState<PortalContract | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerCpf, setSignerCpf] = useState("");
  const [signatureAccepted, setSignatureAccepted] = useState(false);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [helpContact, setHelpContact] = useState<{ company_name?: string | null; portal_contact_phone?: string | null; portal_contact_email?: string | null } | null>(null);
  const [helpContactLoading, setHelpContactLoading] = useState(false);

  // Load creditor contact info when help modal opens (pre-login)
  useEffect(() => {
    if (!helpOpen || portalData) return;
    const clean = onlyDigits(cpf);
    if (clean.length !== 11 || !isValidCPF(clean)) {
      setHelpContact(null);
      return;
    }
    let cancelled = false;
    setHelpContactLoading(true);
    (async () => {
      try {
        const { data } = await (supabase as any).rpc("portal_lookup_creditor_contact", { _cpf: clean, _birth_date: null });
        if (!cancelled) setHelpContact(data || null);
      } catch {
        if (!cancelled) setHelpContact(null);
      } finally {
        if (!cancelled) setHelpContactLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [helpOpen, cpf, portalData]);

  // Retoma apenas pelo token temporário; o CPF não fica armazenado.
  useEffect(() => {
    // Se houver uma sessão do credor no mesmo navegador, deslogar imediatamente.
    // Portal do cliente e app do credor NÃO podem coexistir na mesma sessão.
    void endCreditorSessionForPortal();
    const url=new URL(window.location.href);
    const linkedToken=url.searchParams.get('t');
    if(linkedToken!==null){url.searchParams.delete('t');window.history.replaceState({},'',url.toString());}
    const token=isPortalToken(linkedToken)?linkedToken:getPortalToken();
    const generation=++loginGeneration.current;
    if(token){
      setLoading(true);
      void (async()=>{
        try{
          const {data,error}=await withAbortTimeout(signal=>supabase.rpc('portal_login_by_token',{_token:token}).abortSignal(signal));
          if(generation!==loginGeneration.current)return;
          if(error)throw error;
          const normalized=normalizePortalData(data);
          if(!normalized||!isPortalToken(normalized.session_token)){
            clearPortalSession();
            toast({title:'Não foi possível acessar',description:'Solicite um novo link ao credor ou entre com seu CPF.',variant:'destructive'});
            return;
          }
          savePortalToken(normalized.session_token);setPortalData(normalized);
        }catch{
          if(generation===loginGeneration.current)toast({title:'Erro ao acessar o portal',description:'Não foi possível carregar seus dados. Tente novamente.',variant:'destructive'});
        }finally{if(generation===loginGeneration.current)setLoading(false);}
      })();
    }
    return ()=>{++loginGeneration.current;};
  }, []);


  // Realtime: when any installment of this client changes, refetch
  useEffect(() => {
    if (!portalData?.client?.id) return;
    const clientId = portalData.client.id;
    const token=portalData.session_token;
    let cancelled=false;
    const ch = supabase
      .channel(`portal-client-${clientId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "contract_installments", filter: `client_id=eq.${clientId}` },
          () => {
            if (token) void (async () => {
              const {data,error}=await withAbortTimeout(signal=>supabase.rpc('portal_login_by_token',{_token:token}).abortSignal(signal));
              if(cancelled||error||getPortalToken()!==token)return;
              const normalized=normalizePortalData(data);
              if(normalized&&isPortalToken(normalized.session_token)){savePortalToken(normalized.session_token);setPortalData(normalized);}
              else {clearPortalSession();setPortalData(null);}
            })().catch(()=>{/* A transient refresh failure does not discard the current view. */});
          },
      )
      .subscribe();
    return () => { cancelled=true;supabase.removeChannel(ch); };
  }, [portalData?.client?.id,portalData?.session_token]);

  useEffect(() => {
    const token = portalData?.session_token;
    if (!token) { setSignatureInfo([]); return; }
    let cancelled=false;
    void (async () => {
      const {data,error}=await withAbortTimeout(signal=>supabase.rpc('portal_contract_signatures',{_session_token:token}).abortSignal(signal));
      if (!cancelled&&!error&&getPortalToken()===token&&Array.isArray(data)) setSignatureInfo(data);
    })().catch(()=>{/* A failed optional read must not interrupt the portal. */});
    return ()=>{cancelled=true;};
  }, [portalData?.session_token]);

  const signContract = async () => {
    if (!signingContract || !portalData?.session_token || !signatureAccepted) return;
    setSignatureLoading(true);
    const generation=loginGeneration.current;
    try{
    const { data, error } = await (supabase as any).rpc("portal_sign_contract", {
      _session_token: portalData.session_token, _contract_id: signingContract.id,
      _signer_name: signerName, _cpf_confirmation: onlyDigits(signerCpf),
      _user_agent: navigator.userAgent,
    });
    if(generation!==loginGeneration.current)return;
    if (error) {
      toast({ title: "Não foi possível assinar", description: error.message.includes("cpf_mismatch") ? "O CPF informado não confere." : error.message, variant: "destructive" });
      return;
    }
    setSignatureInfo((current) => current.map((item) => item.id === signingContract.id ? { ...item, signature_status: "signed", signed_at: data?.signed_at, signer_name: signerName } : item));
    setSigningContract(null); setSignerName(""); setSignerCpf(""); setSignatureAccepted(false);
    toast({ title: "Contrato assinado com sucesso!", description: "O aceite foi registrado com data e identificação." });
    }catch{
      if(generation===loginGeneration.current)toast({title:'Não foi possível confirmar a assinatura',description:'Atualize o portal para conferir o resultado antes de tentar novamente.',variant:'destructive'});
    }finally{if(generation===loginGeneration.current)setSignatureLoading(false);}
  };

  const [portalTheme, setPortalTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('portal-cliente-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* The theme still works when storage is unavailable. */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-client-portal-theme');
    root.setAttribute('data-client-portal-theme', portalTheme);
    try { localStorage.setItem('portal-cliente-theme', portalTheme); } catch { /* Optional preference. */ }
    return () => {
      if (previous === null) root.removeAttribute('data-client-portal-theme');
      else root.setAttribute('data-client-portal-theme', previous);
    };
  }, [portalTheme]);

  const formatCpf = (value: string) => {
    const nums = value.replace(/\D/g, "").slice(0, 11);
    return nums.replace(/(\d{3})(\d{3})?(\d{3})?(\d{2})?/, (_, a, b, c, d) =>
      [a, b, c].filter(Boolean).join(".") + (d ? `-${d}` : "")
    );
  };

  const summary = useMemo(() => {
    const contracts = portalData?.contracts || [];
    const now = new Date();
    const rows = contracts.flatMap((contract) =>
      (contract.installments || []).map((i) => ({ contract, i }))
    );
    const paid = rows.filter(({ i }) => i.status === "paid");
    const open = rows.filter(({ i }) => i.status !== "paid");
    const overdue = open.filter(({ i }) => isDateOverdue(i.due_date, now));

    return {
      activeContracts: contracts.filter((contract) => contract.status === "active").length,
      openAmount: open.reduce((sum, { contract, i }) => {
        return sum + portalInstallmentAmount({
          amount: i.amount,
          due_date: i.due_date,
          status: i.status,
          late_fee: i.late_fee,
          daily_interest_percent: contract.daily_interest_percent,
          max_interest_cap_percent: contract.max_interest_cap_percent,
          paid_amount: i.paid_amount,
        }, now);
      }, 0),
      paidAmount: paid.reduce((sum, { i }) => sum + safeNumber(i.paid_amount ?? i.amount), 0),
      overdueCount: overdue.length,
      openCount: open.length,
      paidCount: paid.length,
    };
  }, [portalData]);

  const doLogin = async (cleanCpf: string, silent = false) => {
    if (!silent) {
      const block = isPortalLoginBlocked();
      if (block.blocked) {
        toast({
          title: "Muitas tentativas",
          description: `Aguarde ${Math.ceil(block.waitSec / 60)} min antes de tentar novamente.`,
          variant: "destructive",
        });
        return;
      }
    }
    setLoading(true);
    const generation=++loginGeneration.current;
    try {
      const ownerId = new URLSearchParams(window.location.search).get("o");
      const { data, error } = ownerId && /^[0-9a-f-]{36}$/i.test(ownerId)
        ? await withAbortTimeout(signal=>supabase.rpc("portal_client_login_for_owner", {
            _cpf: cleanCpf,
            _birth_date: null,
            _owner_id: ownerId,
          }).abortSignal(signal))
        : await withAbortTimeout(signal=>supabase.rpc("portal_client_login", {
            _cpf: cleanCpf,
            _birth_date: null,
          }).abortSignal(signal));
      if(generation!==loginGeneration.current)return;

      if (error) {
        if (!silent) {
          toast({ title: "Erro ao acessar o portal", description: "Tente novamente em instantes.", variant: "destructive" });
        }
        return;
      }

      if (!data) {
        if (!silent) {
          recordPortalLoginAttempt(false);
          // Mensagem única de propósito: se ela distinguisse "CPF não existe"
          // de "faltou a data", viraria um jeito de descobrir quem é cliente.
          toast({ title: "Não foi possível acessar", description: "Confira o CPF informado ou solicite ao credor o link correto do portal.", variant: "destructive" });
        }
        clearPortalSession();
        return;
      }

      const normalized=normalizePortalData(data);
      if(!normalized||!isPortalToken(normalized.session_token))throw new Error('Sessão do portal inválida.');
      savePortalToken(normalized.session_token);setPortalData(normalized);
      if (!silent) {
        recordPortalLoginAttempt(true);
        toast({ title: "Acesso autorizado!" });
      }
    } catch (err) {
      if(generation!==loginGeneration.current)return;
      if (!silent) {
        toast({ title: "Erro no acesso", description: "Não foi possível carregar seus dados.", variant: "destructive" });
      }
    } finally {
      if(generation===loginGeneration.current)setLoading(false);
    }
  };

  const handleAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setCpfTouched(true);
    const cleanCpf = onlyDigits(cpf);
    if (!cleanCpf) {
      setCpfError("Informe seu CPF para continuar.");
      toast({ title: "CPF obrigatório", description: "Digite seu CPF para acessar o portal.", variant: "destructive" });
      return;
    }
    if (cleanCpf.length !== 11) {
      setCpfError("O CPF deve conter 11 dígitos.");
      toast({ title: "CPF incompleto", description: "Digite os 11 dígitos do CPF.", variant: "destructive" });
      return;
    }
    if (!isValidCPF(cleanCpf)) {
      setCpfError("CPF inválido — verifique os dígitos.");
      toast({ title: "CPF inválido", description: "Os dígitos verificadores não conferem.", variant: "destructive" });
      return;
    }
    setCpfError(null);
    await doLogin(cleanCpf, false);

  };

  const handleLogout = async () => {
    ++loginGeneration.current;clearPortalSession();
    // Limpa estado local do React primeiro para UI responsiva
    setPortalData(null);
    setCpf("");
    setSelectedInstallment(null);
    setPaymentOpen(false);
    setSignatureInfo([]);setSigningContract(null);setSignerName('');setSignerCpf('');setSignatureAccepted(false);setSignatureLoading(false);
    // Limpeza completa: supabase signOut + storage + cookies + caches
    await performFullPortalLogout();
    // Hard reload garante que nenhum estado in-memory (queries, contexts) sobreviva
    window.location.replace("/portal-cliente?logout=1");
  };

  // Flag pós-logout: mostra tela de confirmação em vez do formulário de login
  const [justLoggedOut, setJustLoggedOut] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("logout") === "1";
  });

  const dismissLogoutScreen = () => {
    setJustLoggedOut(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("logout");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    } catch {}
  };



  const openPayment = (inst: PortalInstallment) => {
    setSelectedInstallment(inst);
    setPaymentOpen(true);
  };

  const firstName = portalData?.client?.name?.split(" ")?.[0] || "Cliente";
  const branding = portalData?.branding || {};
  const portalTitle = branding.portal_title || "Portal do cliente";
  const portalSubtitle = branding.portal_subtitle || "Acesse seus dados financeiros com segurança";
  const logoUrl = branding.portal_logo_url || branding.company_logo_url || defaultLogo;

  // Build filtered list of (contract + installment) tuples
  const filtered = useMemo(() => {
    const rows: Array<{ contract: PortalContract; installment: PortalInstallment; isOverdue: boolean }> = [];
    for (const c of portalData?.contracts || []) {
      for (const i of c.installments || []) {
        const isOverdue = i.status !== "paid" && isDateOverdue(i.due_date);
        if (tab === "paid" && i.status !== "paid") continue;
        if (tab === "open" && i.status === "paid") continue;
        if (tab === "overdue" && !isOverdue) continue;
        rows.push({ contract: c, installment: i, isOverdue });
      }
    }
    return rows.sort((a, b) => (parseLocalDate(a.installment.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseLocalDate(b.installment.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER));
  }, [portalData, tab]);

  // Próxima parcela em aberto para destaque no hero
  const nextInstallment = useMemo(() => {
    const now = new Date();
    const pending: Array<{ contract: PortalContract; installment: PortalInstallment; isOverdue: boolean; daysDiff: number }> = [];
    for (const c of portalData?.contracts || []) {
      for (const i of c.installments || []) {
        if (i.status === "paid") continue;
        const due = parseLocalDate(i.due_date);
        const daysDiff = due ? Math.floor((due.getTime() - now.getTime()) / 86400000) : 0;
        pending.push({ contract: c, installment: i, isOverdue: isDateOverdue(i.due_date, now), daysDiff });
      }
    }
    pending.sort((a, b) => (parseLocalDate(a.installment.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (parseLocalDate(b.installment.due_date)?.getTime() ?? Number.MAX_SAFE_INTEGER));
    return pending[0] || null;
  }, [portalData]);

  const progressPct = useMemo(() => {
    const rows = (portalData?.contracts || []).flatMap((c) => c.installments || []);
    if (!rows.length) return 0;
    return Math.round((rows.filter((i) => i.status === "paid").length / rows.length) * 100);
  }, [portalData]);

  return (
    <main className="portal-shell text-foreground">
      <div className="portal-appearance-bar">
        <span className="flex items-center gap-2 text-sm font-semibold"><Shield size={16} /> Área do cliente</span>
        <button type="button" className="portal-btn-secondary" onClick={() => setPortalTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={portalTheme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'}>
          {portalTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {portalTheme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
      </div>
      <div className="portal-content relative z-10 mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-center justify-center p-4 pt-10 pb-[calc(2.5rem+env(safe-area-inset-bottom))] md:p-8">
        {!portalData ? (
          justLoggedOut ? (
            /* ═══════════ TELA PÓS-LOGOUT ═══════════ */
            <section className="portal-card relative w-full max-w-md p-8 md:p-10">
              <div className="space-y-6 text-center">
                <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-muted ">
                  <BadgeCheck size={44} className="text-success" strokeWidth={2.4} />
                </div>
                <div>
                  <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">Sessão encerrada</h1>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Sua sessão foi finalizada com segurança. Todos os dados de acesso deste navegador foram apagados.
                  </p>
                </div>
                <div className="space-y-2 rounded-2xl border border-border bg-muted p-4 text-left text-xs text-muted-foreground">
                  <p className="flex items-start gap-2">
                    <Lock className="mt-0.5 shrink-0 text-primary" size={14} />
                    <span>Cookies e credenciais locais foram removidos.</span>
                  </p>
                  <p className="flex items-start gap-2">
                    <Shield className="mt-0.5 shrink-0 text-primary" size={14} />
                    <span>Para consultar seus contratos novamente, entre apenas com seu CPF.</span>
                  </p>
                </div>
                <button onClick={dismissLogoutScreen} className="portal-btn-primary flex w-full items-center justify-center gap-2 py-4 text-base">
                  <ArrowRight size={18} /> Entrar novamente
                </button>
              </div>
            </section>
          ) : (
            /* ═══════════ TELA DE LOGIN ═══════════ */
            <section className="portal-card w-full max-w-md p-8 md:p-10">
              <div className="space-y-6">
                <div className="flex flex-col items-center text-center">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logotipo" width={64} height={64} className="h-16 w-16 rounded-2xl object-cover shadow-lg ring-1 ring-primary/35" />
                  ) : (
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-muted ">
                      <Shield size={38} className="text-foreground" strokeWidth={2.2} />
                    </div>
                  )}
                  <span className="portal-chip mt-5">
                    <Sparkles size={11} /> Acesso seguro
                  </span>
                  <h1 className="font-heading mt-4 text-3xl font-bold tracking-tight text-foreground">
                    {portalTitle}
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">{portalSubtitle}</p>
                </div>

                <form onSubmit={handleAccess} className="space-y-5">
                  <div className="space-y-2">
                    <label htmlFor="portal-client-cpf" className="ml-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <User size={11} /> Seu CPF
                    </label>
                    <input
                      id="portal-client-cpf"
                      name="cpf"
                      value={cpf}
                      onChange={(e) => {
                        const masked = formatCpf(e.target.value);
                        setCpf(masked);
                        const digits = onlyDigits(masked);
                        if (!cpfTouched) return;
                        if (digits.length === 0) setCpfError("Informe seu CPF para continuar.");
                        else if (digits.length < 11) setCpfError("O CPF deve conter 11 dígitos.");
                        else if (!isValidCPF(digits)) setCpfError("CPF inválido — verifique os dígitos.");
                        else setCpfError(null);
                      }}
                      onBlur={() => {
                        setCpfTouched(true);
                        const digits = onlyDigits(cpf);
                        if (digits.length === 0) setCpfError("Informe seu CPF para continuar.");
                        else if (digits.length < 11) setCpfError("O CPF deve conter 11 dígitos.");
                        else if (!isValidCPF(digits)) setCpfError("CPF inválido — verifique os dígitos.");
                        else setCpfError(null);
                      }}
                      placeholder="000.000.000-00…"
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={14}
                      aria-invalid={!!cpfError}
                      aria-describedby={cpfError ? "cpf-error" : "cpf-hint"}
                      className={`portal-input w-full rounded-2xl px-5 py-5 text-center font-mono text-2xl tracking-wider ${cpfError ? "border-red-500/60 focus:border-red-500" : ""}`}
                    />
                    {!cpfError && <p id="cpf-hint" className="ml-1 text-xs text-muted-foreground">Digite os 11 números do CPF cadastrado com o credor.</p>}
                    {cpfError && (
                      <p id="cpf-error" className="ml-1 flex items-center gap-1.5 text-xs text-foreground">
                        <AlertTriangle size={12} /> {cpfError}
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading || onlyDigits(cpf).length !== 11 || !isValidCPF(onlyDigits(cpf))}
                    className="portal-btn-primary flex w-full items-center justify-center gap-2 py-5 text-base disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? <Clock className="animate-spin" size={18} /> : <ArrowRight size={18} />}
                    {loading ? "Verificando…" : "Acessar o portal"}
                  </button>

                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={() => setHelpOpen(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                    >
                      <HelpCircle size={13} /> Preciso de ajuda para entrar
                    </button>
                  </div>
                </form>

                <div className="grid grid-cols-3 gap-2 pt-2">
                  {[
                    { icon: Lock, label: "Criptografado" },
                    { icon: Shield, label: "Acesso protegido" },
                    { icon: BadgeCheck, label: "LGPD" },
                  ].map(({ icon: I, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-muted px-2 py-3 text-center">
                      <I size={14} className="text-primary" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>

                {(branding.portal_contact_phone || branding.portal_contact_email) && (
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs text-muted-foreground">
                    {branding.portal_contact_phone && (
                      <a href={`tel:${branding.portal_contact_phone}`} className="flex items-center gap-1.5 transition-colors hover:text-primary">
                        <Phone size={12} /> {branding.portal_contact_phone}
                      </a>
                    )}
                    {branding.portal_contact_email && (
                      <a href={`mailto:${branding.portal_contact_email}`} className="flex items-center gap-1.5 transition-colors hover:text-primary">
                        <Mail size={12} /> {branding.portal_contact_email}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        ) : (
          /* ═══════════ ÁREA LOGADA — BENTO GRID ═══════════ */
          <section className="w-full space-y-6">
            {/* Header */}
            <header className="portal-toolbar flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logotipo" width={56} height={56} className="h-14 w-14 shrink-0 rounded-2xl border border-primary/25 object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted border border-border">
                    <User className="text-foreground" size={26} />
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Bem-vindo(a)</p>
                  <h2 className="font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">{firstName}</h2>
                  {portalData.branding?.portal_welcome_message && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{portalData.branding.portal_welcome_message}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NotificationsBell token={portalData.session_token} />
                <button
                  onClick={async () => {
                    try {
                      // await: a biblioteca de PDF é carregada sob demanda agora.
                      await generatePortalStatementPdf(portalData.client, portalData.contracts || [], {
                        name: portalData.branding?.company_name || portalData.owner?.name || "CredMais",
                        pix_key: portalData.owner?.pix_key,
                      });
                      toast({ title: "Extrato baixado", description: "PDF gerado com sucesso." });
                    } catch (e: any) {
                      toast({ title: "Erro ao gerar extrato", description: e.message, variant: "destructive" });
                    }
                  }}
                  className="portal-chip"
                  title="Baixar extrato completo em PDF"
                >
                  <Download size={12} /> Extrato PDF
                </button>
                <button onClick={handleLogout} className="portal-chip warn">
                  <LogOut size={12} /> Sair com segurança
                </button>
              </div>
            </header>

            {/* Bento Grid */}
            <div className="portal-summary grid grid-cols-2 gap-3 md:grid-cols-6">
              {/* Hero — próxima parcela */}
              <div className="bento-tile bento-hero col-span-2 md:col-span-4 md:row-span-2 flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {nextInstallment?.isOverdue ? "Parcela em atraso" : nextInstallment ? "Próxima parcela" : "Tudo em dia"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {nextInstallment
                        ? nextInstallment.isOverdue
                          ? `Vencida há ${Math.abs(nextInstallment.daysDiff)} dia(s)`
                          : nextInstallment.daysDiff === 0
                            ? "Vence hoje"
                            : `Vence em ${nextInstallment.daysDiff} dia(s) — ${date(nextInstallment.installment.due_date)}`
                        : "Você não possui parcelas em aberto."}
                    </p>
                  </div>
                  <span className={`portal-chip ${nextInstallment?.isOverdue ? "warn" : "ok"}`}>
                    {nextInstallment?.isOverdue ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                    {nextInstallment ? `#${nextInstallment.installment.installment_number}` : "OK"}
                  </span>
                </div>

                {nextInstallment ? (() => {
                  const fee = computeLateFee({
                    amount: nextInstallment.installment.amount,
                    due_date: nextInstallment.installment.due_date,
                    status: nextInstallment.installment.status,
                    late_fee: nextInstallment.installment.late_fee,
                    late_fee_percent: nextInstallment.contract.late_fee_percent,
                    daily_interest_percent: nextInstallment.contract.daily_interest_percent,
                    max_interest_cap_percent: nextInstallment.contract.max_interest_cap_percent,
                    paid_amount: nextInstallment.installment.paid_amount,
                  });
                  const total = portalInstallmentAmount({
                    amount: nextInstallment.installment.amount,
                    due_date: nextInstallment.installment.due_date,
                    status: nextInstallment.installment.status,
                    late_fee: nextInstallment.installment.late_fee,
                    daily_interest_percent: nextInstallment.contract.daily_interest_percent,
                    max_interest_cap_percent: nextInstallment.contract.max_interest_cap_percent,
                    paid_amount: nextInstallment.installment.paid_amount,
                  });
                  return (
                    <div className="mt-6 space-y-4">
                      <div>
                        <p className="portal-next-amount font-bold tracking-tight text-foreground">{money(total)}</p>
                        {fee > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            <AlertTriangle className="inline" size={11} /> Inclui {money(fee)} de multa/juros
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => openPayment({
                          ...nextInstallment.installment,
                          late_fee_percent: nextInstallment.contract.late_fee_percent,
                          daily_interest_percent: nextInstallment.contract.daily_interest_percent,
                          max_interest_cap_percent: nextInstallment.contract.max_interest_cap_percent,
                        } as PortalInstallment)}
                        className="portal-btn-primary inline-flex items-center gap-2 px-6 py-3 text-sm"
                      >
                        <CreditCard size={16} /> Pagar agora <ChevronRight size={16} />
                      </button>
                    </div>
                  );
                })() : (
                  <div className="mt-6 flex items-center gap-3">
                    <CheckCircle2 size={40} className="text-success" />
                    <p className="text-lg text-muted-foreground">Nenhum pagamento pendente</p>
                  </div>
                )}
              </div>

              {/* Tile: contratos ativos */}
              <div className="bento-tile portal-summary-card md:col-span-2 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="portal-chip"><FileText size={11} /> Contratos</span>
                  <TrendingUp size={16} className="text-primary" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Ativos</p>
                  <p className="kpi-value mt-1 text-4xl font-black text-foreground">{summary.activeContracts}</p>
                </div>
              </div>

              {/* Tile: saldo em aberto */}
              <div className="bento-tile portal-summary-card md:col-span-2 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="portal-chip"><Wallet size={11} /> Saldo</span>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Em aberto</p>
                  <p className="kpi-value mt-1 text-3xl font-black text-foreground">{money(summary.openAmount)}</p>
                </div>
              </div>

              {/* Tile: progresso */}
              <div className="bento-tile portal-summary-card md:col-span-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="portal-chip ok"><CheckCircle2 size={11} /> Quitação</span>
                  <p className="text-2xl font-bold text-foreground">{progressPct}%</p>
                </div>
                <div className="mt-3">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{summary.paidCount} pagas</span>
                    <span>{summary.openCount} restantes</span>
                  </div>
                </div>
              </div>

              {/* Tile: total pago */}
              <div className="bento-tile portal-summary-card md:col-span-3 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="portal-chip ok"><CheckCircle2 size={11} /> Pago</span>
                  {summary.overdueCount > 0 && (
                    <span className="portal-chip warn">
                      <AlertTriangle size={11} /> {summary.overdueCount} vencida(s)
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">Total pago</p>
                  <p className="kpi-value mt-1 text-3xl font-black text-success">{money(summary.paidAmount)}</p>
                </div>
              </div>
            </div>

            {/* Filtro de parcelas */}
            <div className="portal-section-heading flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Acompanhe seus pagamentos</p>
                <p className="mt-1 text-sm text-muted-foreground">Selecione uma categoria para abrir os detalhes da parcela.</p>
              </div>
              <div className="portal-tabs" role="tablist" aria-label="Filtro de parcelas">
              {[
                { key: "open" as Tab, label: "Em aberto", count: summary.openCount, icon: Clock },
                { key: "overdue" as Tab, label: "Atrasadas", count: summary.overdueCount, icon: AlertTriangle },
                { key: "paid" as Tab, label: "Pagas", count: summary.paidCount, icon: CheckCircle2 },
              ].map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    role="tab"
                    aria-selected={active}
                    aria-controls="portal-installments"
                    title={`Mostrar parcelas: ${t.label.toLowerCase()}`}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                      active
                        ? "bg-foreground text-background"
                        : "border border-border bg-muted text-muted-foreground hover:text-foreground hover:border-border"
                    }`}
                  >
                    <t.icon size={14} />
                    {t.label}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${active ? "bg-background text-foreground" : "bg-muted text-foreground"}`}>{t.count}</span>
                  </button>
                );
              })}
              </div>
            </div>

            {/* Lista de parcelas */}
            <div id="portal-installments" className="space-y-3" role="tabpanel" aria-label={`Parcelas ${tab === "open" ? "em aberto" : tab === "overdue" ? "atrasadas" : "pagas"}`}>
              {filtered.length === 0 ? (
                <div className="bento-tile flex flex-col items-center gap-3 p-10 text-center text-muted-foreground">
                  <CheckCircle2 size={40} className="text-success" />
                  {tab === "paid" ? "Nenhum pagamento registrado ainda." : tab === "overdue" ? "Nenhuma parcela atrasada" : "Nenhuma parcela em aberto"}
                </div>
              ) : (
                filtered.map(({ contract, installment, isOverdue }) => {
                  const dueDate = parseLocalDate(installment.due_date);
                  const overdueDays = dueDate ? Math.max(0, Math.floor((Date.now() - dueDate.getTime()) / 86400000)) : 0;
                  const fee = computeLateFee({
                    amount: installment.amount,
                    due_date: installment.due_date,
                    status: installment.status,
                    late_fee: installment.late_fee,
                    late_fee_percent: contract.late_fee_percent,
                    daily_interest_percent: contract.daily_interest_percent,
                    max_interest_cap_percent: contract.max_interest_cap_percent,
                    paid_amount: installment.paid_amount,
                  });
                  const total = installment.status === "paid"
                    ? portalInstallmentAmount(installment)
                    : portalInstallmentAmount({
                        amount: installment.amount,
                        due_date: installment.due_date,
                        status: installment.status,
                        late_fee: installment.late_fee,
                        daily_interest_percent: contract.daily_interest_percent,
                        max_interest_cap_percent: contract.max_interest_cap_percent,
                        paid_amount: installment.paid_amount,
                      });
                  return (
                    <button
                      key={installment.id}
                      onClick={() => openPayment({
                        ...installment,
                        late_fee_percent: contract.late_fee_percent,
                        daily_interest_percent: contract.daily_interest_percent,
                        max_interest_cap_percent: contract.max_interest_cap_percent,
                      } as PortalInstallment)}
                      aria-label={`${installment.status === "paid" ? "Ver pagamento" : "Abrir detalhes e pagar"} a parcela ${installment.installment_number} do contrato ${String(contract.id || "").slice(0, 8).toUpperCase()}`}
                      className="bento-tile portal-installment group w-full text-left"
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm font-black ${
                        installment.status === "paid"
                          ? "bg-success/15 text-success"
                          : isOverdue
                            ? "bg-warning/15 text-warning"
                            : "bg-primary/15 text-primary"
                      }`}>
                        #{installment.installment_number}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            Contrato {String(contract.id || "").slice(0, 8).toUpperCase()}
                          </p>
                          <span className="portal-chip portal-frequency">
                            {formatFrequency(contract.frequency)}
                          </span>
                        </div>
                        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays size={12} />
                          {installment.status === "paid" ? `Pago em ${date(installment.paid_at)}` : `Vence em ${date(installment.due_date)}`}
                          {isOverdue && (
                            <span className="ml-1 font-semibold text-warning">
                              · {overdueDays} dia(s)
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-base font-bold text-foreground">{money(total)}</p>
                        {fee > 0 && installment.status !== "paid" && (
                          <p className="text-[10px] text-warning">+ {money(fee)} multa/juros</p>
                        )}
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                          installment.status === "paid" ? "text-success" : isOverdue ? "text-warning" : "text-primary"
                        }`}>
                          {installment.status === "paid" ? "Pago" : isOverdue ? "Vencido" : "Em aberto"}
                        </span>
                      </div>
                      <ChevronRight size={18} className="portal-installment-chevron shrink-0 text-muted-foreground" />
                    </button>
                  );
                })
              )}
            </div>

            {/* Contratos overview */}
            <div className="space-y-3 pt-4">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
                <FileText size={12} /> Seus contratos
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {portalData.contracts.map((contract) => {
                  const signature = signatureInfo.find((item) => item.id === contract.id);
                  return <article key={contract.id} className="bento-tile">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-sm font-bold text-foreground">{String(contract.id || "").slice(0, 8).toUpperCase()}</p>
                      <span className={`portal-chip ${contract.status === "completed" ? "ok" : contract.status === "cancelled" ? "warn" : ""}`}>
                        {statusLabel(contract.status)}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Capital</p>
                        <p className="mt-0.5 font-bold text-foreground">{money(contract.capital)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Parcela</p>
                        <p className="mt-0.5 font-bold text-foreground">{money(contract.installment_amount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Juros</p>
                        <p className="mt-0.5 font-bold text-foreground">{safeNumber(contract.interest_rate)}%</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Início {date(contract.start_date)} • {contract.num_installments} parcelas
                    </p>
                    {signature?.signature_status === "pending" && <button onClick={() => { setSigningContract(contract); setSignerName(portalData.client.name || ""); }} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground"><BadgeCheck size={15} /> Revisar e assinar contrato</button>}
                    {signature?.signature_status === "signed" && <p className="mt-3 flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-xs font-semibold text-success"><CheckCircle2 size={14} /> Assinado em {date(signature.signed_at)}</p>}
                  </article>
                })}
              </div>
            </div>

            <div className="portal-human-contact bento-tile">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted"><MessageCircle size={20} /></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">Fale com a equipe</h2>
                <p className="mt-1 text-sm text-muted-foreground">Para negociar valores ou prazos, converse com um atendente humano.</p>
              </div>
              <button type="button" onClick={() => setHelpOpen(true)} className="portal-btn-secondary">Ver contatos <ArrowRight size={16} /></button>
            </div>

            {(branding.portal_contact_phone || branding.portal_contact_email) && (
              <div className="bento-tile flex flex-wrap items-center justify-center gap-4 text-sm">
                <span className="text-muted-foreground">Precisa de ajuda?</span>
                {branding.portal_contact_phone && (
                  <a href={`tel:${branding.portal_contact_phone}`} className="flex items-center gap-1.5 font-semibold text-primary hover:underline">
                    <Phone size={14} /> {branding.portal_contact_phone}
                  </a>
                )}
                {branding.portal_contact_email && (
                  <a href={`mailto:${branding.portal_contact_email}`} className="flex items-center gap-1.5 font-semibold text-primary hover:underline">
                    <Mail size={14} /> {branding.portal_contact_email}
                  </a>
                )}
              </div>
            )}
          </section>
        )}
      </div>


      <PaymentModal
        isOpen={paymentOpen}
        onOpenChange={setPaymentOpen}
        installment={selectedInstallment}
        ownerProfile={portalData?.owner || {}}
        clientData={portalData?.client || {}}
        contactPhone={portalData?.branding?.portal_contact_phone || portalData?.client?.whatsapp || portalData?.client?.phone || null}
        sessionToken={portalData?.session_token || null}
      />

      {signingContract && (
        <div className="fixed inset-0 z-110 flex items-end justify-center bg-black/80 p-4  sm:items-center" role="dialog" aria-modal="true" onClick={() => !signatureLoading && setSigningContract(null)}>
          <div className="portal-card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-widest text-primary">Assinatura eletrônica</p><h3 className="mt-1 text-xl font-bold text-foreground">Contrato {String(signingContract.id || "").slice(0, 8).toUpperCase()}</h3></div>
              <button onClick={() => setSigningContract(null)} className="rounded-full p-2 text-muted-foreground hover:bg-muted" aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="mt-4 rounded-2xl border border-border bg-muted p-4 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Capital:</strong> {money(signingContract.capital)}</p>
              <p><strong className="text-foreground">Total:</strong> {money(signingContract.total_amount)}</p>
              <p><strong className="text-foreground">Condição:</strong> {safeNumber(signingContract.num_installments)}x de {money(signingContract.installment_amount)} · juros de {safeNumber(signingContract.interest_rate)}%</p>
              <p><strong className="text-foreground">Início:</strong> {date(signingContract.start_date)}</p>
            </div>
            <div className="mt-4 space-y-3">
              <div><label htmlFor="portal-signer-name" className="mb-1 block text-xs font-semibold text-muted-foreground">Nome completo</label><input id="portal-signer-name" name="signer_name" autoComplete="name" value={signerName} onChange={(e) => setSignerName(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground outline-hidden focus:border-primary" /></div>
              <div><label htmlFor="portal-signer-cpf" className="mb-1 block text-xs font-semibold text-muted-foreground">Confirme seu CPF</label><input id="portal-signer-cpf" name="signer_cpf" autoComplete="off" value={signerCpf} onChange={(e) => setSignerCpf(formatCpf(e.target.value))} inputMode="numeric" className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground outline-hidden focus:border-primary" placeholder="000.000.000-00" /></div>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 text-xs text-muted-foreground"><input type="checkbox" name="signature_accepted" aria-label="Aceitar os termos e assinar eletronicamente" checked={signatureAccepted} onChange={(e) => setSignatureAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 accent-(--portal-primary)" /><span>Li e concordo com os valores, vencimentos e condições deste contrato. Confirmo que este aceite representa minha assinatura eletrônica.</span></label>
            <button onClick={signContract} disabled={signatureLoading || !signatureAccepted || onlyDigits(signerCpf).length !== 11 || signerName.trim().length < 3} className="mt-4 w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-foreground disabled:opacity-40">{signatureLoading ? "Registrando assinatura..." : "Assinar contrato"}</button>
          </div>
        </div>
      )}

      {/* ═══════════ MODAL DE AJUDA ═══════════ */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-100 flex items-start sm:items-center justify-center bg-black/70 p-4  overflow-y-auto overscroll-contain"
          onClick={() => setHelpOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
        >
          <div
            className="portal-card relative w-full max-w-md my-auto overflow-hidden rounded-3xl p-6 md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Fechar ajuda"
            >
              <X size={18} />
            </button>

            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted border border-border">
                <HelpCircle className="text-primary" size={22} />
              </div>
              <div>
                <h3 id="help-title" className="font-heading text-xl font-bold text-foreground">Precisa de ajuda?</h3>
                <p className="text-xs text-muted-foreground">Vamos te ajudar a acessar seu portal</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted p-4">
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <RefreshCw size={11} /> Como entrar novamente
                </p>
                <ol className="ml-4 list-decimal space-y-1.5 text-sm text-muted-foreground">
                  <li>Digite seu <strong className="text-foreground">CPF completo</strong> (11 dígitos).</li>
                  <li>Use o mesmo CPF cadastrado com o credor.</li>
                  <li>Se não abrir, confirme o CPF cadastrado e peça o link correto ao credor.</li>
                  <li>Após muitas tentativas, aguarde alguns minutos e tente de novo.</li>
                </ol>
              </div>

              <div className="rounded-2xl border border-border bg-muted p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <MessageCircle size={11} /> Fale com o credor
                </p>
                {(() => {
                  const contact = {
                    phone: branding?.portal_contact_phone || helpContact?.portal_contact_phone || null,
                    email: branding?.portal_contact_email || helpContact?.portal_contact_email || null,
                    name: branding?.company_name || helpContact?.company_name || null,
                  };
                  if (helpContactLoading && !contact.phone && !contact.email) {
                    return (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw size={14} className="animate-spin" /> Buscando dados de contato…
                      </div>
                    );
                  }
                  if (contact.phone || contact.email) {
                    return (
                      <div className="space-y-2">
                        {contact.name && (
                          <p className="mb-1 text-xs text-muted-foreground">
                            Credor: <strong className="text-foreground">{contact.name}</strong>
                          </p>
                        )}
                        {contact.phone && (
                          <>
                            <a
                              href={`https://wa.me/${onlyDigits(contact.phone)}?text=${encodeURIComponent("Olá! Preciso de ajuda para acessar o portal do cliente.")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted"
                            >
                              <span className="flex items-center gap-2">
                                <MessageCircle size={15} className="text-foreground" /> WhatsApp
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">{contact.phone}</span>
                            </a>
                            <a
                              href={`tel:${contact.phone}`}
                              className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted"
                            >
                              <span className="flex items-center gap-2">
                                <Phone size={15} className="text-primary" /> Telefone
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">{contact.phone}</span>
                            </a>
                          </>
                        )}
                        {contact.email && (
                          <a
                            href={`mailto:${contact.email}?subject=${encodeURIComponent("Ajuda com acesso ao portal")}`}
                            className="flex items-center justify-between rounded-xl border border-border bg-muted px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted"
                          >
                            <span className="flex items-center gap-2">
                              <Mail size={15} className="text-primary" /> E-mail
                            </span>
                            <span className="text-xs text-muted-foreground">{contact.email}</span>
                          </a>
                        )}
                      </div>
                    );
                  }
                  const cpfClean = onlyDigits(cpf);
                  const cpfReady = cpfClean.length === 11 && isValidCPF(cpfClean);
                  return (
                    <div className="space-y-2">
                      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted p-3">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-foreground" />
                        <p className="text-sm text-muted-foreground">
                          {portalData
                            ? "O credor ainda não cadastrou canais de contato públicos."
                            : cpfReady
                              ? "Não localizamos os canais de contato do credor deste CPF."
                              : "Digite um CPF válido no campo de acesso para buscarmos automaticamente o contato do credor."}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Enquanto isso, entre em contato diretamente com <strong className="text-foreground">quem forneceu seu crédito</strong> pelo WhatsApp, telefone ou e-mail já conhecidos. Peça a confirmação do CPF cadastrado no sistema.
                      </p>
                    </div>
                  );
                })()}
              </div>

              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="portal-btn-primary flex w-full items-center justify-center gap-2 py-4 text-sm"
              >
                <ArrowRight size={16} /> Entendi, tentar novamente
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default PortalCliente;
