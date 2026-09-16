import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Camera, Search, ArrowLeft, ArrowRight, User, Phone, Mail, MapPin, Check, Loader2,
  Copy, AlertCircle, Hash, Percent, Calendar, Clock, Repeat, DollarSign, FileText, Printer, Shield,
  Coins, TrendingDown, Target, PauseCircle, Send, MessageCircle, Sparkles, History, Save, RotateCcw, X, ChevronDown
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import ContractTemplate from "@/components/ContractTemplate";

import LoanPreviewPanel from "@/components/loan/LoanPreviewPanel";
import { buildAmortization, calculateLoan, generateInstallmentSchedule, type LoanMode } from "@/lib/loanMath";
import { getSignedUploadUrl } from "@/lib/storage";
import { todayLocalISO, toDateInputValue, formatBR, localNoonISO, parseLocalDate } from "@/lib/dateUtils";
import InvestorAllocationSelect from "@/components/InvestorAllocationSelect";
import { DEFAULT_DAILY_LATE_RATE } from "@/lib/lateFee";
import { resolveClientPhones } from "@/lib/phone";



// ── Validation ──
const validateCPF = (cpf: string): boolean => {
  const nums = cpf.replace(/\D/g, "");
  if (nums.length !== 11 || /^(\d)\1+$/.test(nums)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(nums[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== parseInt(nums[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(nums[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === parseInt(nums[10]);
};

const validateCNPJ = (cnpj: string): boolean => {
  const nums = cnpj.replace(/\D/g, "");
  if (nums.length !== 14 || /^(\d)\1+$/.test(nums)) return false;
  const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(nums[i]) * w1[i];
  let r = s % 11; r = r < 2 ? 0 : 11 - r;
  if (r !== parseInt(nums[12])) return false;
  s = 0;
  for (let i = 0; i < 13; i++) s += parseInt(nums[i]) * w2[i];
  r = s % 11; r = r < 2 ? 0 : 11 - r;
  return r === parseInt(nums[13]);
};

const validateEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ── Format helpers ──
const formatPhone = (v: string) => {
  const n = v.replace(/\D/g, "").slice(0, 11);
  if (n.length <= 2) return n;
  if (n.length <= 7) return `(${n.slice(0,2)}) ${n.slice(2)}`;
  return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
};

const formatCpfCnpj = (v: string) => {
  const n = v.replace(/\D/g, "").slice(0, 14);
  if (n.length <= 11) return n.replace(/(\d{3})(\d{3})?(\d{3})?(\d{2})?/, (_, a, b, c, d) => [a, b, c].filter(Boolean).join(".") + (d ? `-${d}` : ""));
  return n.replace(/(\d{2})(\d{3})?(\d{3})?(\d{4})?(\d{2})?/, (_, a, b, c, d, e) => a + (b ? `.${b}` : "") + (c ? `.${c}` : "") + (d ? `/${d}` : "") + (e ? `-${e}` : ""));
};

const formatCep = (v: string) => {
  const n = v.replace(/\D/g, "").slice(0, 8);
  return n.length > 5 ? `${n.slice(0,5)}-${n.slice(5)}` : n;
};

const formatCurrency = (v: string) => {
  const n = v.replace(/\D/g, "");
  if (!n) return "";
  return (parseInt(n) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const parseCurrency = (v: string) => {
  const n = v.replace(/\D/g, "");
  return n ? (parseInt(n) / 100).toString() : "";
};

const safeNumber = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const fmt = (v: unknown) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Frequency = "monthly" | "weekly" | "daily" | "biweekly" | "custom";
type DailyMode = "mon-fri" | "mon-sat" | "mon-sun";


const INPUT = "w-full px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-ring transition-all duration-150";
const SELECT = `${INPUT} appearance-none cursor-pointer pr-10 hover:border-primary/50 focus:ring-2 focus:ring-primary/15`;

const NovoCliente = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const existingClientId = searchParams.get("clientId");
  const isNewContractOnly = !!existingClientId;
  const [step, setStep] = useState(isNewContractOnly ? 2 : 1);
  
  const [saving, setSaving] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [createdContractId, setCreatedContractId] = useState<string | null>(null);
  const [expressMode, setExpressMode] = useState<boolean>(() => {
    try { return localStorage.getItem("novo_cliente_express") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("novo_cliente_express", expressMode ? "1" : "0"); } catch {}
  }, [expressMode]);
  const [showMoreModes, setShowMoreModes] = useState(false);
  const [loanJourneyStep, setLoanJourneyStep] = useState<1 | 2 | 3 | 4>(1);
  // O formulário de empréstimo é deliberadamente apresentado inteiro. As
  // etapas continuam apenas como referência visual para quem já o conhece.
  const showFullLoanForm = true;

  // ── Step 1: Client data ──
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [nascimento, setNascimento] = useState("");
  // No celular o foco automático abria o teclado por cima do formulário e ainda
  // rolava a página até o meio: quem entrava em "novo cliente" caía no bloco de
  // Endereço, sem nunca ver o campo de nome.
  //
  // A medida é feita aqui, de forma síncrona: `useIsMobile` devolve `false` no
  // primeiro render (o valor real só chega no efeito) e `autoFocus` só vale na
  // montagem — usá-lo daria foco automático no celular do mesmo jeito.
  const [focarNoNome] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // ── Step 2: Loan ──
  const [capital, setCapital] = useState("");
  const [capitalDisplay, setCapitalDisplay] = useState("");
  const [loanMode, setLoanMode] = useState<LoanMode>("installments");
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [dailyMode, setDailyMode] = useState<DailyMode>("mon-fri");
  const [taxaJuros, setTaxaJuros] = useState("10");
  const [numInstallments, setNumInstallments] = useState("");
  const [valueMode, setValueMode] = useState<"rate" | "installment">("installment");
  const [installmentValue, setInstallmentValue] = useState("");
  const [installmentValueDisplay, setInstallmentValueDisplay] = useState("");
  const [startDate, setStartDate] = useState(todayLocalISO());
  const [firstDueDate, setFirstDueDate] = useState("");
  const [autoFirstDue, setAutoFirstDue] = useState(true);
  const [lateFeePercent, setLateFeePercent] = useState("0");
  const [dailyPenaltyType, setDailyPenaltyType] = useState<"percentage" | "fixed">("percentage");
  const [dailyInterestPercent, setDailyInterestPercent] = useState(String(DEFAULT_DAILY_LATE_RATE));
  const [notes, setNotes] = useState("");
  const [gracePeriods, setGracePeriods] = useState("2");

  const [customDates, setCustomDates] = useState<string[]>([]);

  // ── Step 2: Advanced contract fields ──
  const [graceDays, setGraceDays] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "cash" | "boleto" | "transfer">("pix");
  const [autoRenew, setAutoRenew] = useState(false);
  const [earlyDiscount, setEarlyDiscount] = useState("0");
  const [guaranteeType, setGuaranteeType] = useState<"none" | "aval" | "vehicle" | "property" | "other">("none");
  const [guaranteeDescription, setGuaranteeDescription] = useState("");
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorCpf, setGuarantorCpf] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; url: string; type: string }[]>([]);
  const [investorLoanId, setInvestorLoanId] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [requireSignature, setRequireSignature] = useState(false);
  const location = useLocation();
  const simulatorPresetApplied = useRef(false);

  useEffect(() => {
    if (simulatorPresetApplied.current) return;
    const preset = (location.state as any)?.loanPreset;
    if (!preset) return;
    simulatorPresetApplied.current = true;
    const presetCapital = Number(preset.capital) || 0;
    const presetInstallment = Number(preset.installmentValue) || 0;
    setCapital(presetCapital > 0 ? String(presetCapital) : "");
    setCapitalDisplay(presetCapital > 0 ? presetCapital.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "");
    setTaxaJuros(String(Number(preset.rate) || 0));
    setNumInstallments(String(Number(preset.periods) || ""));
    if (preset.loanMode) setLoanMode(preset.loanMode);
    if (preset.frequency) setFrequency(preset.frequency);
    if (preset.dailyMode) setDailyMode(preset.dailyMode);
    if (preset.valueMode) setValueMode(preset.valueMode);
    setInstallmentValue(presetInstallment > 0 ? String(presetInstallment) : "");
    setInstallmentValueDisplay(presetInstallment > 0 ? presetInstallment.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "");
    setGracePeriods(String(Number(preset.gracePeriods) || 0));
    toast({ title: "Simulação carregada", description: "Preencha o cliente e avance para revisar o empréstimo." });
  }, [location.state, toast]);

  // ── Settings defaults ──
  const { data: settings } = useQuery({
    queryKey: ["settings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Load existing client when adding a new contract to an existing client (?clientId=…)
  const { data: existingClient } = useQuery({
    queryKey: ["existing-client-for-new-contract", existingClientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*")
        .eq("id", existingClientId!).eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!existingClientId && !!user,
    staleTime: 60_000,
  });

  const { data: existingRisk = [] } = useQuery({
    queryKey: ["existing-client-credit-risk", existingClientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("contract_installments").select("id,amount,paid_amount,due_date,status")
        .eq("client_id", existingClientId!).eq("user_id", user!.id).neq("status", "paid").neq("status", "cancelled")
        .lt("due_date", new Date().toISOString());
      if (error) throw error;
      return data || [];
    },
    enabled: !!existingClientId && !!user,
  });

  // Prefill client fields from existing client (read-only display in step 1, but step is skipped)
  useEffect(() => {
    if (!existingClient) return;
    setNome(existingClient.name || "");
    setEmail(existingClient.email || "");
    setTelefone(existingClient.phone || "");
    setWhatsapp(existingClient.whatsapp || "");
    setCpfCnpj(existingClient.cpf_cnpj || "");
    const a: any = existingClient.address || {};
    if (a) {
      setCep(a.cep || ""); setRua(a.street || ""); setNumero(a.number || "");
      setComplemento(a.complement || ""); setBairro(a.neighborhood || "");
      setCidade(a.city || ""); setEstado(a.state || "");
    }
  }, [existingClient]);

  // Apply defaults from settings when they load (only once, before user touches the form)
  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (!settings || defaultsAppliedRef.current) return;
    if (settings.default_interest_rate) setTaxaJuros(settings.default_interest_rate.toString());
    if (settings.default_late_fee) setLateFeePercent(settings.default_late_fee.toString());
    if (settings.default_daily_interest) setDailyInterestPercent(settings.default_daily_interest.toString());
    if (settings.default_frequency) setFrequency(settings.default_frequency as Frequency);
    if (settings.default_num_installments) setNumInstallments(String(settings.default_num_installments));
    if (settings.default_payment_method) setPaymentMethod(settings.default_payment_method as typeof paymentMethod);
    defaultsAppliedRef.current = true;
  }, [settings]);

  // ── Draft autosave (localStorage) ──
  const DRAFT_KEY = `novo_cliente_draft_${user?.id || "anon"}`;
  const [hasDraft, setHasDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftLoadedRef = useRef(false);

  useEffect(() => {
    if (!user || draftLoadedRef.current) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) setHasDraft(true);
    } catch {}
    draftLoadedRef.current = true;
  }, [user, DRAFT_KEY]);

  // Autosave draft (debounced)
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(() => {
      try {
        if (!nome && !capital && !cpfCnpj) return;
        const draft = {
          nome, email, telefone, whatsapp, cpfCnpj, nascimento, cep, rua, numero, complemento, bairro, cidade, estado,
          capital, capitalDisplay, loanMode, frequency, dailyMode, taxaJuros, numInstallments,
          valueMode, installmentValue, installmentValueDisplay, startDate, firstDueDate, autoFirstDue,
          lateFeePercent, dailyInterestPercent, notes, gracePeriods, graceDays, paymentMethod, step,
          ts: Date.now(),
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        setDraftSavedAt(Date.now());
      } catch {}
    }, 900);
    return () => clearTimeout(t);
  }, [user, DRAFT_KEY, nome, email, telefone, whatsapp, cpfCnpj, nascimento, cep, rua, numero, complemento,
      bairro, cidade, estado, capital, capitalDisplay, loanMode, frequency, dailyMode, taxaJuros,
      numInstallments, valueMode, installmentValue, installmentValueDisplay, startDate, firstDueDate,
      autoFirstDue, lateFeePercent, dailyInterestPercent, notes, gracePeriods, graceDays, paymentMethod, step]);


  const markTouched = (f: string) => setTouched(prev => ({ ...prev, [f]: true }));

  // ── Past contracts (for "Duplicar termos do anterior") ──
  const { data: pastContracts = [] } = useQuery({
    queryKey: ["novo-emprestimo-past", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("id, capital, interest_rate, num_installments, frequency, loan_mode, late_fee_percent, daily_interest_percent, created_at, clients(name)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const duplicateFrom = (c: any) => {
    setCapital(String(c.capital || ""));
    setCapitalDisplay(safeNumber(c.capital).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    setTaxaJuros(String(c.interest_rate || ""));
    setNumInstallments(String(c.num_installments || ""));
    if (c.frequency) setFrequency((c.frequency.startsWith("daily") ? "daily" : c.frequency) as Frequency);
    if (c.loan_mode) setLoanMode(c.loan_mode);
    setLateFeePercent("0");
    setDailyInterestPercent(String(c.daily_interest_percent || DEFAULT_DAILY_LATE_RATE));
    setValueMode("rate");
    setLoanJourneyStep(3);
    toast({ title: "✓ Termos copiados", description: `Baseado em ${(c.clients as any)?.name || "contrato anterior"}` });
  };

  // ── Draft restore/discard ──
  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      setNome(d.nome || ""); setEmail(d.email || ""); setTelefone(d.telefone || ""); setWhatsapp(d.whatsapp || "");
      setCpfCnpj(d.cpfCnpj || ""); setNascimento(d.nascimento || ""); setCep(d.cep || ""); setRua(d.rua || ""); setNumero(d.numero || "");
      setComplemento(d.complemento || ""); setBairro(d.bairro || ""); setCidade(d.cidade || ""); setEstado(d.estado || "");
      setCapital(d.capital || ""); setCapitalDisplay(d.capitalDisplay || "");
      if (d.loanMode) setLoanMode(d.loanMode);
      if (d.frequency) setFrequency(d.frequency);
      if (d.dailyMode) setDailyMode(d.dailyMode);
      setTaxaJuros(d.taxaJuros || "10"); setNumInstallments(d.numInstallments || "");
      if (d.valueMode) setValueMode(d.valueMode);
      setInstallmentValue(d.installmentValue || ""); setInstallmentValueDisplay(d.installmentValueDisplay || "");
      if (d.startDate) setStartDate(d.startDate);
      setFirstDueDate(d.firstDueDate || ""); setAutoFirstDue(d.autoFirstDue !== false);
      setLateFeePercent("0"); setDailyInterestPercent(d.dailyInterestPercent || String(DEFAULT_DAILY_LATE_RATE));
      setNotes(d.notes || ""); setGracePeriods(d.gracePeriods || "2"); setGraceDays(d.graceDays || "0");
      if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
      if (d.step) setStep(d.step);
      if (d.capital || d.installmentValue) setLoanJourneyStep(3);
      setHasDraft(false);
      toast({ title: "✓ Rascunho restaurado" });
    } catch { toast({ title: "Erro ao restaurar rascunho", variant: "destructive" }); }
  };
  const discardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setHasDraft(false);
    setDraftSavedAt(null);
  };





  const errors: Record<string, string | null> = {
    nome: touched.nome && !nome.trim() ? "Nome é obrigatório" : null,
    email: touched.email && email.trim() && !validateEmail(email) ? "E-mail inválido" : null,
    cpfCnpj: touched.cpfCnpj && cpfCnpj.trim() ? (() => {
      const nums = cpfCnpj.replace(/\D/g, "");
      if (nums.length === 11 && !validateCPF(cpfCnpj)) return "CPF inválido";
      if (nums.length === 14 && !validateCNPJ(cpfCnpj)) return "CNPJ inválido";
      if (nums.length > 0 && nums.length < 11) return "CPF/CNPJ incompleto";
      return null;
    })() : null,
    telefone: touched.telefone && telefone.trim() && telefone.replace(/\D/g, "").length < 10 ? "Telefone incompleto" : null,
  };

  // ── CEP ──
  const buscarCep = async (value?: string) => {
    const raw = (value || cep).replace(/\D/g, "");
    if (raw.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setRua(data.logradouro || "");
        setBairro(data.bairro || "");
        setCidade(data.localidade || "");
        setEstado(data.uf || "");
        toast({ title: "✓ CEP encontrado!" });
      } else {
        toast({ title: "CEP não encontrado", variant: "destructive" });
      }
    } catch {} finally { setCepLoading(false); }
  };

  const handleCepChange = (v: string) => {
    const formatted = formatCep(v);
    setCep(formatted);
    if (formatted.replace(/\D/g, "").length === 8) buscarCep(formatted);
  };

  const copyPhoneToWhatsapp = useCallback(() => {
    if (telefone.trim()) {
      setWhatsapp(telefone);
      toast({ title: "Telefone copiado para WhatsApp" });
    }
  }, [telefone, toast]);

  // ── Loan calc ──
  const calc = useMemo(() => {
    const cap = parseFloat(capital) || 0;
    const n = parseInt(numInstallments) || 0;
    const taxa = parseFloat(taxaJuros) || 0;
    const parcela = parseFloat(installmentValue) || 0;
    const grace = parseInt(gracePeriods) || 0;
    const r = calculateLoan({
      capital: cap,
      rate: taxa,
      periods: n,
      frequency,
      loanMode,
      valueMode,
      installmentValue: parcela,
      gracePeriods: grace,
    });
    if (!r) return null;
    const amortization = buildAmortization(r, {
      capital: cap,
      rate: taxa,
      periods: n,
      frequency,
      loanMode,
      valueMode,
      installmentValue: parcela,
      gracePeriods: grace,
    });
    return {
      totalInterest: r.totalInterest,
      totalAmount: r.totalAmount,
      installmentAmount: r.installmentAmount,
      numParcelas: r.numInstallments,
      schedule: r.schedule,
      amortization,
      ...(r.derivedRate !== undefined ? { derivedRate: r.derivedRate } : {}),
    };
  }, [capital, taxaJuros, numInstallments, loanMode, frequency, valueMode, installmentValue, gracePeriods]);



  const handleCapitalChange = (v: string) => {
    setCapitalDisplay(formatCurrency(v));
    setCapital(parseCurrency(v));
  };

  const generateDueDates = (start: string, freq: Frequency, count: number, dMode: DailyMode, firstDue?: string) => {
    return generateInstallmentSchedule({
      startDate: start,
      firstDueDate: firstDue,
      count,
      frequency: freq,
      dailyMode: dMode,
      customDates: freq === "custom" ? customDates : undefined,
    });
  };


  const periodLabel = frequency === "daily" ? "dia" : frequency === "weekly" ? "semana" : frequency === "biweekly" ? "quinzena" : frequency === "custom" ? "parcela" : "mês";
  const freqLabel = frequency === "daily" ? "Diário" : frequency === "weekly" ? "Semanal" : frequency === "biweekly" ? "Quinzenal" : frequency === "custom" ? "Programado" : "Mensal";

  // ── Loan field validations (modo Taxa e modo Valor da Parcela) ──
  const loanErrors = useMemo(() => {
    const errs: { capital?: string; taxa?: string; parcela?: string; n?: string; geral?: string } = {};
    const cap = parseFloat(capital);
    const n = parseInt(numInstallments);

    if (!capital || isNaN(cap) || cap <= 0) errs.capital = "Informe um capital maior que zero";
    else if (cap > 1_000_000_000) errs.capital = "Capital acima do limite permitido";

    const requiresN = !(loanMode === "percentage" && valueMode === "rate");
    if (requiresN) {
      if (!numInstallments || isNaN(n) || n <= 0) errs.n = "Informe o número de parcelas";
      else if (!Number.isInteger(n)) errs.n = "Use um número inteiro";
      else if (n > 360) errs.n = "Máximo de 360 parcelas";
    } else if (numInstallments && (isNaN(n) || n <= 0 || !Number.isInteger(n) || n > 360)) {
      errs.n = "Valor inválido (1 a 360)";
    }

    if (valueMode === "rate") {
      const taxa = parseFloat(taxaJuros);
      if (!taxaJuros || isNaN(taxa) || taxa <= 0) errs.taxa = "Informe uma taxa maior que zero";
      else if (taxa > 1000) errs.taxa = `Taxa fora do limite (máx. 1000% por ${periodLabel})`;
    } else {
      const parcela = parseFloat(installmentValue);
      if (!installmentValue || isNaN(parcela) || parcela <= 0) {
        errs.parcela = "Informe o valor da parcela";
      } else if (!isNaN(cap) && !isNaN(n) && n > 0) {
        const total = parcela * n;
        if (total < cap) {
          errs.parcela = "Parcela × nº de parcelas é menor que o capital";
        } else if (total === cap) {
          errs.geral = "Sem juros: parcela × nº de parcelas é igual ao capital";
        }
      }
    }
    return errs;
  }, [capital, taxaJuros, numInstallments, installmentValue, valueMode, loanMode, periodLabel]);

  const hasLoanErrors = Object.keys(loanErrors).length > 0;

  // ── Step validation ──
  const canGoStep2 = nome.trim().length > 0;
  const canGoStep3 = !!calc && !hasLoanErrors;

  // ── Step navigation ──
  const goNext = () => {
    if (step === 1) {
      setTouched((current) => ({
        ...current,
        nome: true,
        email: true,
        cpfCnpj: true,
        telefone: true,
      }));
      if (!canGoStep2) {
        toast({ title: "Nome obrigatório", variant: "destructive" });
        return;
      }
      if (email.trim() && !validateEmail(email)) {
        toast({ title: "E-mail inválido", variant: "destructive" });
        return;
      }
      if (cpfCnpj.trim()) {
        const digits = cpfCnpj.replace(/\D/g, "");
        const validDocument =
          (digits.length === 11 && validateCPF(cpfCnpj)) ||
          (digits.length === 14 && validateCNPJ(cpfCnpj));

        if (!validDocument) {
          toast({
            title: "CPF/CNPJ inválido",
            description: "Confira os dígitos antes de continuar.",
            variant: "destructive",
          });
          return;
        }
      }
      if (telefone.trim() && telefone.replace(/\D/g, "").length < 10) {
        toast({
          title: "Telefone incompleto",
          description: "Informe DDD e número ou deixe o campo vazio.",
          variant: "destructive",
        });
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (lateFeePercent.trim() === "" || !Number.isFinite(Number(lateFeePercent)) || Number(lateFeePercent) < 0) {
        toast({ title: "Informe a multa por atraso", description: "Digite o valor na modalidade escolhida. Use 0 para não cobrar multa.", variant: "destructive" });
        document.getElementById("daily-penalty-value")?.focus();
        return;
      }
      if (!canGoStep3) {
        const firstErr = loanErrors.capital || loanErrors.taxa || loanErrors.parcela || loanErrors.n || loanErrors.geral;
        toast({ title: firstErr || "Preencha capital, taxa e parcelas", variant: "destructive" });
        return;
      }
      setStep(3);
      return;
    }
    setStep(step + 1);
  };

  // ── Save all ──
  const handleSave = async () => {
    if (!user || !calc || saving) return;
    if (lateFeePercent.trim() === "" || !Number.isFinite(Number(lateFeePercent)) || Number(lateFeePercent) < 0) {
      setStep(2);
      toast({ title: "Informe a multa por atraso", description: "Use 0 para não cobrar multa.", variant: "destructive" });
      return;
    }
    if (hasLoanErrors) {
      const firstErr = loanErrors.capital || loanErrors.taxa || loanErrors.parcela || loanErrors.n || loanErrors.geral;
      toast({ title: firstErr || "Corrija os campos do empréstimo", variant: "destructive" });
      return;
    }
    if (existingRisk.length > 0 && !riskAccepted) {
      toast({ title: "Confirme o risco antes de liberar", description: "Este cliente possui parcelas vencidas.", variant: "destructive" });
      return;
    }
    setSaving(true);
    let uploadedAvatarPath: string | null = null;

    try {
      const clientId = existingClientId || crypto.randomUUID();
      let avatar_url: string | null = null;

      if (avatarFile && !existingClientId) {
        const ext = avatarFile.name.split(".").pop();
        const path = `${user!.id}/client-avatars/${clientId}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("uploads").upload(path, avatarFile, { upsert: true });
        if (!uploadError) {
          uploadedAvatarPath = path;
          const signed = await getSignedUploadUrl(path);
          if (signed) avatar_url = signed;
        }
      }

      const clientPhones = resolveClientPhones(telefone, whatsapp);
      const clientPayload = existingClientId ? {} : {
          name: nome.trim(),
          email: email.trim() || null,
          phone: clientPhones.phone,
          whatsapp: clientPhones.whatsapp,
          cpf_cnpj: cpfCnpj.trim() || null,
          // Coluna date: em branco tem que virar NULL, senão o Postgres recusa.
          birth_date: nascimento || null,
          client_type: "loan",
          status: "Ativo",
          avatar_url,
          address: rua ? { cep, street: rua, number: numero, complement: complemento, neighborhood: bairro, city: cidade, state: estado } : null,
      };

      const n = calc.numParcelas;
      const freqValue = frequency === "daily" ? `daily_${dailyMode}` : frequency;
      const signatureToken = requireSignature ? crypto.randomUUID() : null;
      const contractPayload = {
        capital: parseFloat(capital),
        interest_rate: valueMode === "installment" ? Number((calc as any).derivedRate?.toFixed(4) ?? 0) : parseFloat(taxaJuros),
        num_installments: n,
        installment_amount: calc.installmentAmount,
        frequency: freqValue,
        start_date: localNoonISO(startDate),
        late_fee_percent: parseFloat(lateFeePercent),
        daily_penalty_type: dailyPenaltyType,
        daily_penalty_value: Math.max(0, parseFloat(lateFeePercent) || 0),
        // A multa diária é a única cobrança por atraso escolhida neste formulário.
        // Não combinamos percentual/fixo com juros diários automaticamente.
        daily_interest_percent: 0,
        total_amount: calc.totalAmount,
        total_interest: calc.totalInterest,
        status: "active",
        notes: notes || `Modo: ${loanMode}`,
        loan_mode: loanMode,
        grace_periods: loanMode === "grace" ? (parseInt(gracePeriods) || 0) : 0,
        grace_days: parseInt(graceDays) || 0,
        payment_method: paymentMethod,
        auto_renew: autoRenew,
        early_payment_discount_percent: parseFloat(earlyDiscount) || 0,
        max_interest_cap_percent: null,
        guarantee_type: guaranteeType === "none" ? null : guaranteeType,
        guarantee_description: guaranteeDescription || null,
        guarantor_name: guarantorName || null,
        guarantor_cpf: guarantorCpf.replace(/\D/g, "") || null,
        guarantor_phone: guarantorPhone.replace(/\D/g, "") || null,
        attachments: attachments,
        investor_loan_id: investorLoanId,
        signature_status: requireSignature ? "pending" : "not_required",
        signature_token: signatureToken,
      };

      // O cronograma é calculado no cliente, mas cliente + contrato + parcelas
      // são persistidos por uma única transação no banco.
      let dueDates: string[];
      if (loanMode === "bullet") {
        // Pagamento único N períodos no futuro
        const inputPeriods = parseInt(numInstallments) || 1;
        dueDates = firstDueDate ? [localNoonISO(firstDueDate)] : generateInstallmentSchedule({
          startDate, count: 1, frequency: frequency === "custom" ? "monthly" : frequency,
          dailyMode, periodsAhead: inputPeriods,
        });
      } else {
        dueDates = generateDueDates(
          startDate, frequency, calc.numParcelas, dailyMode,
          autoFirstDue ? undefined : (firstDueDate || undefined),
        );
      }
      const installments = dueDates.map((dd, i) => ({
        installment_number: i + 1,
        amount: calc.schedule[i] ?? calc.installmentAmount,
        scheduled_principal: calc.amortization[i]?.principal ?? 0,
        scheduled_interest: calc.amortization[i]?.interest ?? 0,
        due_date: dd,
      }));
      const { data: created, error: createError } = await (supabase as any).rpc("create_client_contract", {
        _client_id: existingClientId || null,
        _client: clientPayload,
        _contract: contractPayload,
        _installments: installments,
      });
      if (createError) throw createError;

      const { error: penaltyError } = await (supabase as any)
        .from("contracts")
        .update({
          daily_penalty_type: dailyPenaltyType,
          daily_penalty_value: Math.max(0, parseFloat(lateFeePercent) || 0),
        })
        .eq("id", created.contract_id)
        .eq("user_id", user.id);
      if (penaltyError) throw penaltyError;

      setCreatedContractId(created.contract_id);
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setHasDraft(false);
      toast({
        title: existingClientId ? "✓ Novo contrato criado!" : "✓ Cliente e contrato criados!",
        description: `${n} parcelas geradas com sucesso.`,
      });
      setShowContract(true);
    } catch (err: any) {
      if (uploadedAvatarPath && !existingClientId) {
        await supabase.storage.from("uploads").remove([uploadedAvatarPath]);
      }
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const cpfCnpjLabel = cpfCnpj.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF / CNPJ";
  const stepLabels = ["Dados do Cliente", "Empréstimo", "Revisão"];

  // ── Contract template modal ──
  if (showContract && calc) {
    const effectiveRate = valueMode === "installment" && (calc as any).derivedRate !== undefined
      ? Number((calc as any).derivedRate)
      : parseFloat(taxaJuros);

    // Pré-gera o cronograma p/ exibir no contrato (seção 4)
    const previewInstallments = (() => {
      try {
        const dueDates = generateDueDates(startDate, frequency, calc.numParcelas, dailyMode, firstDueDate || undefined);
        return dueDates.map((dd, i) => ({
          installment_number: i + 1,
          amount: calc.schedule?.[i] ?? calc.installmentAmount,
          due_date: dd,
        }));
      } catch { return []; }
    })();

    const contractData = {
      clientName: nome,
      cpfCnpj,
      phone: telefone,
      whatsapp,
      email,
      address: (rua || cidade) ? `${rua}${numero ? `, ${numero}` : ""}${complemento ? `, ${complemento}` : ""}${bairro ? ` - ${bairro}` : ""}${cidade ? `, ${cidade}` : ""}${estado ? `/${estado}` : ""}${cep ? ` - CEP: ${cep}` : ""}` : "",
      capital: parseFloat(capital),
      interestRate: effectiveRate,
      totalAmount: calc.totalAmount,
      totalInterest: calc.totalInterest,
      installmentAmount: calc.installmentAmount,
      numInstallments: calc.numParcelas,
      frequency: freqLabel,
      startDate,
      lateFeePercent: parseFloat(lateFeePercent),
      dailyInterestPercent: 0,
      dailyPenaltyType,
      companyName: settings?.company_name || "CREDMAIS APP",
      companyCnpj: settings?.company_cnpj || "",
      companyLogoUrl: settings?.company_logo_url || undefined,
      companyAddress: settings?.company_address || "",
      companyPhone: settings?.company_phone || "",
      // Estes campos o formulário já coletava e gravava no contrato, mas nunca
      // chegavam ao documento: quem pedia avalista gerava contrato sem citá-lo.
      paymentMethod,
      guaranteeType: guaranteeType === "none" ? null : guaranteeType,
      guaranteeDescription,
      guarantorName,
      guarantorCpf,
      guarantorPhone,
      gracePeriods: Number(gracePeriods) || 0,
      graceDays: Number(graceDays) || 0,
      earlyPaymentDiscountPercent: Number(earlyDiscount) || 0,
      maxInterestCapPercent: null,
      customTemplate: (settings as any)?.custom_contract_template || null,
      installments: previewInstallments,
    };

    const phoneDigits = (whatsapp || telefone).replace(/\D/g, "");
    const portalUrl = `${window.location.origin}/portal-cliente`;
    const shareMessage =
      `Olá ${nome}, seu contrato foi gerado! 📄\n\n` +
      `• Valor: R$ ${calc.totalAmount.toFixed(2)}\n` +
      `• ${calc.numParcelas}x de R$ ${calc.installmentAmount.toFixed(2)} (${freqLabel})\n` +
      `• Início: ${formatBR(startDate)}\n\n` +
      `Acesse seu portal para ver parcelas e pagar via PIX:\n${portalUrl}\n\n` +
      `Login: apenas o seu CPF.`;

    const sendWhatsApp = () => {
      if (!phoneDigits) {
        toast({ title: "Sem WhatsApp/telefone", description: "Cadastre um número para enviar.", variant: "destructive" });
        return;
      }
      window.open(`https://wa.me/55${phoneDigits}?text=${encodeURIComponent(shareMessage)}`, "_blank", "noopener,noreferrer");
    };

    const sendEmail = () => {
      if (!email.trim()) {
        toast({ title: "Sem e-mail", description: "Cadastre um e-mail para enviar.", variant: "destructive" });
        return;
      }
      window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Contrato — ${settings?.company_name || "CREDMAIS APP"}`)}&body=${encodeURIComponent(shareMessage)}`;
    };

    return (
      <div className="max-w-4xl mx-auto space-y-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-foreground">Contrato Gerado</h1>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={sendWhatsApp}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              title={phoneDigits ? `Enviar para ${phoneDigits}` : "Sem número cadastrado"}
            >
              <MessageCircle size={16} /> Enviar WhatsApp
            </button>
            <button
              type="button"
              onClick={sendEmail}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-border hover:bg-accent transition-colors"
              title={email ? `Enviar para ${email}` : "Sem e-mail cadastrado"}
            >
              <Send size={16} /> E-mail
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-border hover:bg-accent transition-colors"
            >
              <Printer size={16} /> Imprimir
            </button>
            <button
              type="button"
              onClick={() => navigate(existingClientId ? `/clientes/${existingClientId}` : "/clientes")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground transition-opacity"
              style={{ background: "var(--gradient-button)" }}
            >
              <Check size={16} /> Concluir
            </button>
          </div>
        </div>
        <ContractTemplate data={contractData} />
      </div>
    );
  }

  return (
    <div className="w-full space-y-5 pb-10 md:space-y-6">
      {/* Header */}
      <div className="page-hero animate-fade-in">
        {/* `flex-wrap`: numa tela de 360px o botão Express disputava a linha com
            o título e sobravam ~100px para ele — "Cadastrar Novo Cliente" saía
            quebrado quase letra a letra. No celular o botão desce para a linha
            de baixo; no computador nada muda. */}
        <div className="page-hero-content flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (isNewContractOnly) {
                if (step > 2) setStep(step - 1);
                else navigate(`/clientes/${existingClientId}`);
              } else {
                if (step > 1) setStep(step - 1);
                else navigate("/clientes");
              }
            }}
            aria-label="Voltar"
            className="p-2.5 rounded-xl hover:bg-card/60 text-muted-foreground transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="page-hero-icon">
            <User size={22} />
          </div>
          <div className="flex-1 min-w-[9rem]">
            <h1 className="text-lg font-bold text-foreground sm:text-xl">
              {isNewContractOnly ? `Novo Contrato${existingClient?.name ? ` — ${existingClient.name}` : ""}` : "Cadastrar Novo Cliente"}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isNewContractOnly
                ? `Etapa ${step - 1} de 2 — ${stepLabels[step - 1]}`
                : `Etapa ${step} de 3 — ${stepLabels[step - 1]}`}
            </p>
          </div>
          {!isNewContractOnly && (
            <button
              type="button"
              onClick={() => setExpressMode(!expressMode)}
              className={`flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors sm:w-auto sm:justify-start ${expressMode ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              title="Reduz o formulário aos campos essenciais"
            >
              ⚡ {expressMode ? "Express ON" : "Modo Express"}
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex gap-2">
          {(isNewContractOnly ? [2, 3] : [1, 2, 3]).map((s) => (
            <button key={s} type="button" aria-label={`Ir para etapa ${s}`} aria-current={s === step ? "step" : undefined} onClick={() => { if (s < step && (!isNewContractOnly || s >= 2)) setStep(s); }}
              className={`h-2 flex-1 rounded-full transition-colors ${s < step ? "bg-success cursor-pointer" : s === step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>
      </div>

      {/* Draft restore banner */}
      {hasDraft && !isNewContractOnly && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-primary/30 bg-primary/5 animate-fade-in">
          <div className="flex items-center gap-2 text-sm">
            <Save size={16} className="text-primary" />
            <span className="text-foreground"><strong>Rascunho encontrado</strong> da última vez que você esteve aqui.</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={discardDraft} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1">
              Descartar
            </button>
            <button type="button" onClick={restoreDraft} className="flex items-center gap-1.5 text-xs font-semibold text-primary-foreground bg-primary px-3 py-1.5 rounded-lg hover:opacity-90">
              <RotateCcw size={12} /> Restaurar
            </button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          {/* Identificação */}
          <section className="space-y-4 rounded-2xl border border-border/50 bg-card/45 p-4 sm:p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <User size={16} className="text-primary" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Identificação</h2>
            </div>
            <div className="flex items-start gap-5">
              <div className="relative flex-shrink-0">
                <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-border flex items-center justify-center text-muted-foreground bg-muted/30 overflow-hidden">
                  {avatarPreview ? <img src={avatarPreview} alt="" className="w-16 h-16 object-cover" /> : <User size={24} />}
                </div>
                <label className="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg bg-primary">
                  <Camera size={12} className="text-primary-foreground" />
                  <input aria-label="Foto do cliente" type="file" accept="image/*" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) { setAvatarFile(file); setAvatarPreview(URL.createObjectURL(file)); }
                  }} className="hidden" />
                </label>
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <label htmlFor="loan-nome" className="text-xs font-semibold text-foreground mb-1.5 block">Nome Completo *</label>
                  <input id="loan-nome" aria-label="Nome Completo *" type="text" placeholder="Nome do Cliente" value={nome} onChange={(e) => setNome(e.target.value)} onBlur={() => markTouched("nome")} className={`${INPUT} ${errors.nome ? "border-destructive ring-1 ring-destructive/30" : ""}`} autoFocus={focarNoNome} />
                  {errors.nome && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.nome}</p>}
                </div>
                <div>
                  <label htmlFor="loan-cpfCnpj" className="text-xs font-semibold text-foreground mb-1.5 block">{cpfCnpjLabel}</label>
                  <input id="loan-cpfCnpj" aria-label="CPF ou CNPJ" type="text" placeholder={cpfCnpj.replace(/\D/g, "").length > 11 ? "00.000.000/0000-00" : "000.000.000-00"} value={cpfCnpj} onChange={(e) => setCpfCnpj(formatCpfCnpj(e.target.value))} onBlur={() => markTouched("cpfCnpj")} className={`${INPUT} ${errors.cpfCnpj ? "border-destructive ring-1 ring-destructive/30" : ""}`} inputMode="numeric" />
                  {errors.cpfCnpj && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.cpfCnpj}</p>}
                  {touched.cpfCnpj && cpfCnpj.trim() && !errors.cpfCnpj && cpfCnpj.replace(/\D/g, "").length >= 11 && (
                    <p className="text-xs text-success mt-1 flex items-center gap-1"><Check size={12} /> {cpfCnpj.replace(/\D/g, "").length <= 11 ? "CPF" : "CNPJ"} válido</p>
                  )}
                </div>
                <div>
                  <label htmlFor="loan-nascimento" className="text-xs font-semibold text-foreground mb-1.5 block">Data de nascimento</label>
                  <input id="loan-nascimento" aria-label="Data de nascimento" type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className={INPUT} max={todayLocalISO()} />
                  <p className="text-xs text-muted-foreground mt-1">É com ela, junto do CPF, que o cliente entra no portal.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Contato */}
          <section className="space-y-4 rounded-2xl border border-border/50 bg-card/45 p-4 sm:p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-info/10 flex items-center justify-center">
                <Phone size={16} className="text-info" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Contato</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="loan-email" className="text-xs font-semibold text-foreground mb-1.5 block">E-mail</label>
                <input id="loan-email" aria-label="E-mail" type="email" placeholder="email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => markTouched("email")} className={`${INPUT} ${errors.email ? "border-destructive" : ""}`} />
                {errors.email && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.email}</p>}
              </div>
              <div>
                <label htmlFor="loan-telefone" className="text-xs font-semibold text-foreground mb-1.5 block">Telefone</label>
                <input id="loan-telefone" aria-label="Telefone" type="tel" placeholder="(00) 00000-0000" value={telefone} onChange={(e) => setTelefone(formatPhone(e.target.value))} onBlur={() => markTouched("telefone")} className={`${INPUT} ${errors.telefone ? "border-destructive" : ""}`} inputMode="tel" />
                {errors.telefone && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle size={12} /> {errors.telefone}</p>}
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="loan-whatsapp" className="text-xs font-semibold text-foreground">WhatsApp</label>
                  {telefone.trim() && !whatsapp.trim() && (
                    <button type="button" onClick={copyPhoneToWhatsapp} className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                      <Copy size={10} /> Copiar do telefone
                    </button>
                  )}
                </div>
                <input id="loan-whatsapp" aria-label="WhatsApp" type="tel" placeholder="(00) 00000-0000" value={whatsapp} onChange={(e) => setWhatsapp(formatPhone(e.target.value))} className={INPUT} inputMode="tel" />
              </div>
            </div>
          </section>

          {/* Endereço */}
          <section className="space-y-4 rounded-2xl border border-border/50 bg-card/45 p-4 sm:p-6">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center">
                <MapPin size={16} className="text-warning" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Endereço</h2>
              <span className="text-xs text-muted-foreground ml-auto">(opcional)</span>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="loan-cep" className="text-xs font-semibold text-foreground mb-1.5 block">CEP</label>
                <input id="loan-cep" aria-label="CEP" type="text" placeholder="00000-000" value={cep} onChange={(e) => handleCepChange(e.target.value)} className={INPUT} inputMode="numeric" />
              </div>
              <button type="button" aria-label="Buscar endereço pelo CEP" onClick={() => buscarCep()} disabled={cepLoading} className="self-end rounded-xl border border-border bg-accent px-4 py-2.5 text-foreground transition-colors hover:bg-accent/70 disabled:opacity-50">
                {cepLoading ? <Loader2 aria-hidden="true" size={18} className="animate-spin" /> : <Search aria-hidden="true" size={18} />}
              </button>
            </div>
            {rua && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/5 border border-success/15 text-xs text-success">
                <Check size={14} /> Endereço preenchido automaticamente
              </div>
            )}
            <div className="grid grid-cols-[1fr_100px] gap-4">
              <div>
                <label htmlFor="loan-rua" className="text-xs font-semibold text-foreground mb-1.5 block">Rua</label>
                <input id="loan-rua" aria-label="Rua" type="text" placeholder="Ex: Rua das Flores" value={rua} onChange={(e) => setRua(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="loan-numero" className="text-xs font-semibold text-foreground mb-1.5 block">Número</label>
                <input id="loan-numero" aria-label="Número" type="text" placeholder="123" value={numero} onChange={(e) => setNumero(e.target.value)} className={INPUT} inputMode="numeric" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="loan-complemento" className="text-xs font-semibold text-foreground mb-1.5 block">Complemento</label>
                <input id="loan-complemento" aria-label="Complemento" type="text" placeholder="Apto 45" value={complemento} onChange={(e) => setComplemento(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="loan-bairro" className="text-xs font-semibold text-foreground mb-1.5 block">Bairro</label>
                <input id="loan-bairro" aria-label="Bairro" type="text" placeholder="Centro" value={bairro} onChange={(e) => setBairro(e.target.value)} className={INPUT} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="loan-cidade" className="text-xs font-semibold text-foreground mb-1.5 block">Cidade</label>
                <input id="loan-cidade" aria-label="Cidade" type="text" placeholder="São Paulo" value={cidade} onChange={(e) => setCidade(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label htmlFor="loan-estado" className="text-xs font-semibold text-foreground mb-1.5 block">Estado</label>
                <div className="relative">
                  <select id="loan-estado" aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} className={SELECT}>
                    <option value="">Selecione</option>
                    {["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ═══ STEP 2: LOAN CONFIG ═══ */}
      {step === 2 && (
        <div className="w-full space-y-6 pb-24">
          {!showFullLoanForm && (
          <div className="px-1 py-2">
            <div className="flex items-center">
              {[[1, "Tipo"], [2, "Frequência"], [3, "Valores"], [4, "Condições"]].map(([number, label], index) => (
                <div key={String(label)} className={`flex items-center ${index < 3 ? "flex-1" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${loanJourneyStep >= Number(number) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>
                      {loanJourneyStep > Number(number) ? <Check size={13} /> : number}
                    </span>
                    <span className={`hidden text-xs sm:block ${loanJourneyStep === Number(number) ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
                  </div>
                  {index < 3 && <div className={`mx-3 h-px flex-1 ${loanJourneyStep > Number(number) ? "bg-primary" : "bg-border"}`} />}
                </div>
              ))}
            </div>
          </div>
          )}
          {/* Modo & Frequência */}
          {/* Duplicate from previous */}
          {pastContracts.length > 0 && (
            <div className="rounded-2xl border border-white/[.08] bg-card/45 p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                  <History size={14} className="text-primary" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-foreground uppercase tracking-[0.15em]">Duplicar contrato anterior</h2>
                  <p className="text-xs text-muted-foreground">Clique para replicar os termos</p>
                </div>
              </div>
              <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
                {pastContracts.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => duplicateFrom(c)}
                    className="group shrink-0 rounded-xl border border-white/[.08] bg-white/[0.025] px-3.5 py-2.5 text-left transition-colors hover:border-primary/35 hover:bg-primary/[.06]"
                  >
                    <p className="text-xs font-bold text-foreground truncate max-w-[150px] group-hover:text-primary transition-colors">{(c.clients as any)?.name || "—"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">R$ {safeNumber(c.capital).toLocaleString("pt-BR")} · {c.num_installments || 0}x · {safeNumber(c.interest_rate)}%</p>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-3xl border border-white/[.10] bg-white/[.025] shadow-[0_24px_70px_-45px_rgba(0,0,0,.95)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
              <div>
                <p className="text-base font-semibold text-foreground">Tipo de empréstimo</p>
                <p className="mt-1 text-xs text-muted-foreground">Como o saldo será pago?</p>
              </div>
            </div>
            <div className="space-y-5 border-t border-border p-4 sm:p-5">
          {/* Loan Mode */}
          <div className="space-y-4">
            {!isNewContractOnly && !showFullLoanForm && loanJourneyStep === 1 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowMoreModes(v => !v)}
                  className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showMoreModes ? "Ver opções principais" : "Ver outros tipos"}
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(() => {
                const primary = [
                  { v: "installments" as LoanMode, label: "Parcelado", desc: "Valor dividido em parcelas", Icon: Hash },
                  { v: "bullet" as LoanMode, label: "Pagamento único", desc: "Capital + juros no vencimento", Icon: Target },
                  { v: "percentage" as LoanMode, label: "Por porcentagem", desc: "Juros por ciclo com renovação", Icon: Percent },
                ];
                const extra = [
                  { v: "price" as LoanMode, label: "Tabela Price", desc: "Parcela fixa com amortização", Icon: TrendingDown },
                  { v: "grace" as LoanMode, label: "Com carência", desc: "Início dos pagamentos adiado", Icon: PauseCircle },
                ];
                const all = (isNewContractOnly || showMoreModes || extra.some(m => m.v === loanMode)) ? [...primary, ...extra] : primary;
                const selected = [...primary, ...extra].find(m => m.v === loanMode)!;
                if (!showFullLoanForm && loanJourneyStep >= 2) {
                  return (
                    <div className="col-span-full flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:flex-row sm:items-center">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary"><selected.Icon size={17} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{selected.label}</p>
                        <p className="text-xs text-muted-foreground">{selected.desc}</p>
                      </div>
                      <button type="button" onClick={() => setLoanJourneyStep(1)} className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted">Alterar tipo</button>
                    </div>
                  );
                }
                return all.map(m => {
                  const active = loanMode === m.v;
                  return (
                    <button key={m.v} onClick={() => {
                      setLoanMode(m.v);
                      setValueMode(m.v === "installments" ? "installment" : "rate");
                      if (m.v === "bullet") setNumInstallments("1");
                      if (m.v === "percentage") setNumInstallments("0");
                      if (m.v === "installments" && (parseInt(numInstallments) || 0) < 2) setNumInstallments("2");
                      setLoanJourneyStep(2);
                    }}
                      className={`group flex min-h-[88px] items-center gap-3 rounded-xl border p-4 text-left transition-colors ${active ? "border-primary bg-primary/[.05]" : "border-border bg-background/40 hover:border-primary/40 hover:bg-muted/30"}`}>
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground"}`}>
                        <m.Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{m.label}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{m.desc}</p>
                      </div>
                      <ArrowRight size={15} className="shrink-0 text-muted-foreground" />
                    </button>
                  );
                });
              })()}
            </div>
            {loanMode === "grace" && (
              <div className="pt-3 border-t border-white/10">
                <label htmlFor="loan-gracePeriods" className="text-xs font-semibold text-foreground mb-1.5 block">Períodos de Carência</label>
                <input id="loan-gracePeriods" aria-label="Períodos de Carência"
                  type="number" min={1} max={24}
                  value={gracePeriods}
                  onChange={(e) => setGracePeriods(e.target.value)}
                  className={INPUT}
                  placeholder="2"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Durante a carência o cliente não paga; os juros simples acumulam sobre o capital.
                </p>
              </div>
            )}
          </div>


          {/* Frequency */}
          {(showFullLoanForm || loanJourneyStep === 2) && (
          <div className="space-y-4 border-t border-border pt-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                <Repeat size={14} className="text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Com que frequência o cliente pagará?</h2>
                <p className="text-xs text-muted-foreground">Mostraremos datas e campos compatíveis com esta escolha</p>
              </div>
            </div>
            <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-5 gap-2.5">
              {([
                { v: "daily" as Frequency, label: "Diário", Icon: Clock },
                { v: "weekly" as Frequency, label: "Semanal", Icon: Repeat },
                { v: "biweekly" as Frequency, label: "Quinzenal", Icon: Repeat },
                { v: "monthly" as Frequency, label: "Mensal", Icon: Calendar },
                { v: "custom" as Frequency, label: "Programado", Icon: Calendar },
              ]).map(f => {
                const active = frequency === f.v;
                return (
                  <button key={f.v} onClick={() => { setFrequency(f.v); setLoanJourneyStep(f.v === "daily" ? 2 : 3); }}
                    className={`group flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-colors ${active ? "border-primary/45 bg-primary/[.07]" : "border-white/[.08] bg-white/[0.02] hover:border-primary/30 hover:bg-primary/[.04]"}`}>
                    <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all ${active ? "bg-primary/25 border border-primary/40" : "bg-muted/40 border border-white/5 group-hover:bg-primary/10"}`}>
                      <f.Icon size={16} className={active ? "text-primary" : "text-muted-foreground group-hover:text-primary"} />
                    </div>
                    <p className={`relative text-xs font-bold ${active ? "text-primary" : "text-foreground"}`}>{f.label}</p>
                  </button>
                );
              })}
            </div>
            {frequency === "daily" && (
              <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2 pt-3 border-t border-white/10">
                {([
                  { v: "mon-fri" as DailyMode, label: "Seg → Sex" },
                  { v: "mon-sat" as DailyMode, label: "Seg → Sáb" },
                  { v: "mon-sun" as DailyMode, label: "Seg → Dom" },
                ]).map(d => {
                  const active = dailyMode === d.v;
                  return (
                    <button key={d.v} onClick={() => { setDailyMode(d.v); setLoanJourneyStep(3); }}
                      className={`rounded-xl border p-2.5 text-xs font-bold transition-colors ${active ? "border-primary/45 bg-primary/[.08] text-primary" : "border-white/[.08] bg-white/[0.02] text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}>
                      {d.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          )}
          {(showFullLoanForm || loanJourneyStep >= 3) && (
            <div className="flex flex-col gap-3 rounded-2xl border border-success/25 bg-success/[.05] p-4 sm:flex-row sm:items-center">
              <Check size={18} className="shrink-0 text-success" />
              <div className="flex-1"><p className="text-xs font-bold text-foreground">Frequência definida</p><p className="text-xs text-muted-foreground">{frequency === "daily" ? `Diário (${dailyMode === "mon-fri" ? "segunda a sexta" : dailyMode === "mon-sat" ? "segunda a sábado" : "todos os dias"})` : frequency === "weekly" ? "Semanal" : frequency === "biweekly" ? "Quinzenal" : frequency === "monthly" ? "Mensal" : "Datas programadas manualmente"}</p></div>
              <button type="button" onClick={() => setLoanJourneyStep(2)} className="rounded-xl border border-border px-3 py-2 text-xs font-bold text-foreground hover:bg-muted">Alterar frequência</button>
            </div>
          )}

            </div>
          </div>

          {/* Valores & Datas */}
          {(showFullLoanForm || loanJourneyStep >= 3) && (
          <div className="rounded-2xl border border-white/[.08] bg-card/45">
            <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
              <div>
                <p className="text-sm font-bold text-foreground">3 — Valores e vencimentos</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{calc ? `R$ ${fmt(calc.totalAmount)} em ${calc.numParcelas} pagamento(s)` : "Informe capital, taxa ou parcela e as datas"}</p>
              </div>
              <button type="button" onClick={() => setLoanJourneyStep(2)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-bold text-muted-foreground">Voltar</button>
            </div>
            <div className="space-y-7 border-t border-white/[.06] p-4 sm:p-6">

            <div className="space-y-5">
              {/* Capital em destaque */}
              <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="loan-capitalDisplay" className="block text-xs font-semibold uppercase tracking-wider text-foreground">
                  Capital Emprestado <span className="text-primary">*</span>
                  </label>
                  <span className="text-xs text-muted-foreground">Valor liberado ao cliente</span>
                </div>
                <div className="relative group">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-primary">R$</span>
                  <input id="loan-capitalDisplay" aria-label="Capital emprestado"
                    type="text"
                    value={capitalDisplay}
                    onChange={(e) => handleCapitalChange(e.target.value)}
                    onBlur={() => markTouched("capital")}
                    placeholder="0,00"
                    className={`w-full rounded-xl border bg-card py-3 pl-14 pr-5 text-xl font-bold text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 font-display sm:text-2xl ${touched.capital && loanErrors.capital ? "border-destructive/60" : "border-border"}`}
                    inputMode="numeric"
                    aria-invalid={!!(touched.capital && loanErrors.capital)}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[500, 1000, 2000, 5000, 10000, 20000].map(v => (
                    <button key={v} type="button" onClick={() => { handleCapitalChange(String(v * 100)); markTouched("capital"); }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 ${capital === String(v) ? "bg-primary/15 border-primary/30 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}>
                      R$ {v >= 1000 ? `${v / 1000}k` : v}
                    </button>
                  ))}
                </div>
                {touched.capital && loanErrors.capital && <p className="text-xs text-destructive ml-1">{loanErrors.capital}</p>}
              </div>

              {/* Parcela & Numero */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {valueMode === "rate" ? (
                  <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <label htmlFor="loan-taxaJuros" className="block text-xs font-semibold uppercase tracking-wider text-foreground">
                      Taxa (% por {periodLabel}) <span className="text-primary">*</span>
                    </label>
                    <div className="relative">
                      <Percent size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input id="loan-taxaJuros" aria-label="Taxa de juros" type="number" value={taxaJuros} onChange={(e) => setTaxaJuros(e.target.value)} onBlur={() => markTouched("taxa")} placeholder="10"
                        className={`w-full bg-card border rounded-xl py-3 pl-10 pr-4 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${touched.taxa && loanErrors.taxa ? "border-destructive/60" : "border-border"}`}
                        aria-invalid={!!(touched.taxa && loanErrors.taxa)} min={0} max={100} step="0.01" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[5, 10, 15, 20, 30].map(v => (
                        <button key={v} type="button" onClick={() => { setTaxaJuros(String(v)); markTouched("taxa"); }}
                          className={`min-w-11 min-h-11 flex items-center justify-center rounded-md border text-xs font-bold transition-colors ${taxaJuros === String(v) ? "bg-primary/20 border-primary/30 text-primary" : "bg-white/5 border-white/5 text-muted-foreground hover:bg-primary/15 hover:text-primary"}`}>
                          {v}%
                        </button>
                      ))}
                    </div>
                    {touched.taxa && loanErrors.taxa && <p className="text-xs text-destructive ml-1">{loanErrors.taxa}</p>}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <label htmlFor="loan-installmentValueDisplay" className="block text-xs font-semibold uppercase tracking-wider text-foreground">
                      Valor da Parcela (R$) <span className="text-primary">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">$</span>
                      <input id="loan-installmentValueDisplay" aria-label="Valor da parcela"
                        type="text"
                        value={installmentValueDisplay}
                        onChange={(e) => {
                          setInstallmentValueDisplay(formatCurrency(e.target.value));
                          setInstallmentValue(parseCurrency(e.target.value));
                        }}
                        onBlur={() => markTouched("parcela")}
                        placeholder="0,00"
                        className={`w-full bg-card border rounded-xl py-3 pl-10 pr-4 text-lg font-semibold text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${touched.parcela && loanErrors.parcela ? "border-destructive/60" : "border-border"}`}
                        inputMode="numeric"
                        aria-invalid={!!(touched.parcela && loanErrors.parcela)}
                      />
                    </div>
                    {touched.parcela && loanErrors.parcela && <p className="text-xs text-destructive ml-1">{loanErrors.parcela}</p>}
                    {(!touched.parcela || !loanErrors.parcela) && calc && (calc as any).derivedRate !== undefined && (
                      <p className="text-xs text-muted-foreground ml-1">Taxa equivalente: {(calc as any).derivedRate.toFixed(2)}% por {periodLabel}</p>
                    )}
                  </div>
                )}

                <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
                  <label htmlFor="loan-numInstallments" className="block text-xs font-semibold uppercase tracking-wider text-foreground">
                    {loanMode === "bullet"
                      ? <>Nº de Períodos até Vencimento <span className="text-primary">*</span></>
                      : loanMode === "percentage" && valueMode === "rate"
                        ? "Nº Períodos (opcional)"
                        : <>Nº de Parcelas <span className="text-primary">*</span></>}
                  </label>
                  <input id="loan-numInstallments" aria-label="Número de parcelas" type="number" value={numInstallments} onChange={(e) => setNumInstallments(e.target.value)} onBlur={() => markTouched("n")}
                    placeholder={loanMode === "bullet" ? `Ex: 3 ${periodLabel}s` : loanMode === "percentage" && valueMode === "rate" ? "Auto" : "10"}
                    className={`w-full bg-card border rounded-xl py-3 px-4 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${touched.n && loanErrors.n ? "border-destructive/60" : "border-border"}`}
                    inputMode="numeric" aria-invalid={!!(touched.n && loanErrors.n)} min={1} max={360} step={1} />
                  <div className="flex flex-wrap gap-1.5">
                    {(loanMode === "bullet" ? [1, 2, 3, 6, 12] : [4, 6, 8, 10, 12, 24]).map(v => (
                      <button key={v} type="button" onClick={() => { setNumInstallments(String(v)); markTouched("n"); }}
                        className={`min-min-w-11 min-h-11 px-2 flex items-center justify-center rounded-md border text-xs font-bold transition-colors ${numInstallments === String(v) ? "bg-primary/20 border-primary/30 text-primary" : "bg-white/5 border-white/5 text-muted-foreground hover:bg-primary/15 hover:text-primary"}`}>
                        {loanMode === "bullet" ? `${v} ${periodLabel}` : `${v}x`}
                      </button>
                    ))}
                  </div>
                  {touched.n && loanErrors.n && <p className="text-xs text-destructive ml-1">{loanErrors.n}</p>}
                </div>
              </div>

              {/* Datas */}
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 sm:p-5">
                <div className="flex items-center gap-4 mb-6">
                  <span className="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase">Agendamento</span>
                  <div className="flex-1 h-px bg-white/5" />
                </div>
                {frequency === "custom" ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm font-medium text-foreground/90 ml-1">Datas de cada parcela</label>
                      <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border bg-primary/15 text-primary border-primary/30">
                        📅 Programado — defina cada vencimento
                      </span>
                    </div>
                    {calc && calc.numParcelas > 0 ? (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-auto pr-1">
                          {Array.from({ length: calc.numParcelas }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs font-bold text-muted-foreground w-7">#{i + 1}</span>
                              <input
                                type="date"
                                aria-label={`Vencimento da parcela ${i + 1}`} value={customDates[i] || ""}
                                onChange={(e) => {
                                  const next = [...customDates];
                                  next[i] = e.target.value;
                                  setCustomDates(next);
                                }}
                                className="flex-1 bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 [color-scheme:dark]"
                              />
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground ml-1 italic">
                          Datas em branco serão preenchidas automaticamente (mensal). A 1ª data define o início do contrato.
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground italic ml-1">Defina capital e nº de parcelas para liberar as datas.</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {loanMode !== "bullet" && <div className="space-y-3">
                    <label htmlFor="loan-startDate" className="block text-sm font-medium text-foreground/90 ml-1">Data Início</label>
                    <input id="loan-startDate" aria-label="Data Início" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-4 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all [color-scheme:dark]" />
                    <div className="flex gap-2">
                      {[
                        { label: "Hoje", days: 0 },
                        { label: "+1d", days: 1 },
                        { label: "+7d", days: 7 },
                        { label: "+15d", days: 15 },
                      ].map(o => (
                        <button key={o.label} type="button" onClick={() => {
                          const d = new Date(); d.setDate(d.getDate() + o.days);
                          setStartDate(d.toISOString().split("T")[0]);
                        }} className="text-xs font-bold uppercase tracking-wider min-h-11 px-3 py-2 rounded bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors">
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>}
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label htmlFor="loan-firstDue" className="block text-sm font-medium text-foreground/90 ml-1">{loanMode === "bullet" ? "Data do pagamento total" : "1º vencimento"}</label>
                      <button
                        type="button"
                        onClick={() => {
                          if (autoFirstDue && startDate) {
                            const preview = generateDueDates(startDate, frequency, 1, dailyMode, undefined);
                            if (preview[0]) setFirstDueDate(toDateInputValue(preview[0]));
                          }
                          setAutoFirstDue(!autoFirstDue);
                        }}
                        className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border transition-all flex items-center gap-1.5 ${autoFirstDue ? "bg-primary/15 text-primary border-primary/30 hover:bg-primary/20" : "bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"}`}
                        title="Clique para alternar entre data automática e manual"
                      >
                        {autoFirstDue ? "🔒 Automático — clique para editar" : "✏️ Manual — clique para automatizar"}
                      </button>
                    </div>
                    <input
                      type="date"
                      id="loan-firstDue" aria-label="Primeiro vencimento" value={
                        autoFirstDue
                          ? (() => {
                              if (!startDate) return "";
                              const preview = generateDueDates(startDate, frequency, 1, dailyMode, undefined);
                              return preview[0] ? toDateInputValue(preview[0]) : "";
                          })()
                          : firstDueDate
                      }
                      onChange={(e) => setFirstDueDate(e.target.value)}
                      disabled={autoFirstDue}
                      className={`w-full border rounded-xl py-4 px-4 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all [color-scheme:dark] ${autoFirstDue ? "bg-white/[0.02] border-white/5 text-muted-foreground cursor-not-allowed" : "bg-white/5 border-white/10"}`}
                    />
                    {!autoFirstDue && (
                      <div className="flex gap-1.5 flex-wrap">
                        {[
                          { label: "+7d", days: 7 },
                          { label: "+15d", days: 15 },
                          { label: "+30d", days: 30 },
                          { label: "+45d", days: 45 },
                          { label: "+60d", days: 60 },
                        ].map(o => (
                          <button key={o.label} type="button" onClick={() => {
                            const base = startDate ? new Date(startDate + "T12:00:00") : new Date();
                            base.setDate(base.getDate() + o.days);
                            setFirstDueDate(base.toISOString().split("T")[0]);
                          }} className="text-xs font-bold uppercase tracking-wider min-h-11 px-3 py-2 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors border border-amber-500/20">
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {autoFirstDue ? (
                      <p className="text-xs text-muted-foreground ml-1 italic">Calculado a partir da data de início ({freqLabel.toLowerCase()}). Clique no botão acima para editar manualmente.</p>
                    ) : (
                      <p className="text-xs text-amber-400/80 ml-1 italic">Data personalizada — as próximas parcelas serão calculadas a partir desta.</p>
                    )}
                  </div>

                  </div>
                )}
              </div>
            {/* Multas movidas para "Condições Avançadas" — padrão: 4% ao dia, composto */}

            {/* Opções extras movidas para "Condições Avançadas" abaixo, evitando duplicação */}


            <div>
              <label htmlFor="loan-notes" className="text-xs font-semibold text-foreground mb-1.5 block">Observações</label>
              <textarea id="loan-notes" aria-label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" rows={2} className={`${INPUT} resize-none`} />
            </div>

            {calc && (
              <div className="bg-primary/5 border border-primary/15 rounded-xl p-4 space-y-3">
                <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <DollarSign size={14} className="text-primary" /> Resumo
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {[
                    { label: "Juros", value: `R$ ${fmt(calc.totalInterest)}` },
                    { label: "Total", value: `R$ ${fmt(calc.totalAmount)}` },
                    { label: `Valor/${periodLabel}`, value: `R$ ${fmt(calc.installmentAmount)}` },
                    { label: "Pagamentos", value: `${calc.numParcelas}x` },
                    ...(valueMode === "installment" && (calc as any).derivedRate !== undefined
                      ? [{ label: `Taxa equiv./${periodLabel}`, value: `${(calc as any).derivedRate.toFixed(2)}%` }]
                      : []),
                  ].map(i => (
                    <div key={i.label}>
                      <p className="text-muted-foreground text-xs uppercase tracking-wider">{i.label}</p>
                      <p className="font-bold text-foreground">{i.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Painel completo: amortização + avisos + datas editáveis */}
            {calc && calc.numParcelas > 0 && (
              <LoanPreviewPanel
                input={{
                  capital: parseFloat(capital) || 0,
                  rate: parseFloat(taxaJuros) || 0,
                  periods: parseInt(numInstallments) || 0,
                  frequency,
                  loanMode,
                  valueMode,
                  installmentValue: parseFloat(installmentValue) || 0,
                  gracePeriods: parseInt(gracePeriods) || 0,
                }}
                result={{
                  installmentAmount: calc.installmentAmount,
                  totalAmount: calc.totalAmount,
                  totalInterest: calc.totalInterest,
                  numInstallments: calc.numParcelas,
                  schedule: calc.schedule,
                  perPeriodLabel: periodLabel,
                  derivedRate: (calc as any).derivedRate,
                }}
                dueDates={(() => {
                  if (frequency === "custom") {
                    // Datas do usuário (vazias viram mensais auto)
                    return Array.from({ length: calc.numParcelas }).map((_, i) =>
                      customDates[i]
                        ? parseLocalDate(customDates[i])?.toISOString() ?? ""
                        : generateDueDates(startDate, "monthly", i + 1, dailyMode)[i] ?? ""
                    );
                  }
                  return generateDueDates(
                    startDate, frequency, calc.numParcelas, dailyMode,
                    autoFirstDue ? undefined : firstDueDate || undefined,
                  );
                })()}
                onDueDatesChange={(next) => {
                  // Edição inline marca freq como "custom" e atualiza datas
                  if (frequency !== "custom") setFrequency("custom");
                  setCustomDates(next.map(iso => iso ? toDateInputValue(iso) : ""));
                }}
              />
            )}

            {!calc && capital && taxaJuros && loanMode === "installments" && !numInstallments && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-warning/5 border border-warning/15 text-xs text-warning">
                <AlertCircle size={14} /> Informe o número de parcelas
              </div>
            )}
            {!showFullLoanForm && calc && (
              <button type="button" onClick={() => {
                // No modo expresso a etapa 4 ficava oculta, então o botão
                // mudava o estado sem apresentar nenhum resultado visível.
                setExpressMode(false);
                setLoanJourneyStep(4);
                requestAnimationFrame(() => document.getElementById("contract-conditions")?.scrollIntoView({ behavior: "smooth", block: "start" }));
              }} className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground">
                Continuar para condições e documentos
              </button>
            )}
            </div>
            </div>
          </div>
          )}



          {/* ── ADVANCED CONTRACT FIELDS ── */}
          {(showFullLoanForm || loanJourneyStep >= 4) && (
          <details id="contract-conditions" open className="bg-card border border-border rounded-2xl p-5 group">
            <summary className="cursor-pointer flex items-center justify-between list-none">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Shield size={14} className="text-primary" /> 4 — Condições, garantias e documentos
              </h2>
              <span className="text-xs uppercase tracking-wider text-muted-foreground group-open:hidden">Abrir</span>
              <span className="text-xs uppercase tracking-wider text-primary hidden group-open:inline">Fechar</span>
            </summary>

            <div className="mt-5 space-y-5">
              {/* Carência + Forma pagamento + desconto + teto */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label htmlFor="loan-graceDays" className="text-xs font-semibold text-foreground mb-1.5 block">Carência (dias)</label>
                  <input id="loan-graceDays" aria-label="Carência (dias)" type="number" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} placeholder="0" className={INPUT} />
                  <p className="text-xs text-muted-foreground mt-1">Dias sem multa após o vencimento</p>
                </div>
                <div>
                  <label htmlFor="loan-paymentMethod" className="text-xs font-semibold text-foreground mb-1.5 block">Forma de Pagamento</label>
                  <div className="relative">
                    <select id="loan-paymentMethod" aria-label="Forma de Pagamento" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)} className={SELECT}>
                      <option value="pix">PIX</option>
                      <option value="cash">Dinheiro</option>
                      <option value="boleto">Boleto</option>
                      <option value="transfer">Transferência</option>
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <label htmlFor="loan-earlyDiscount" className="text-xs font-semibold text-foreground mb-1.5 block">Desconto Antecipação (%)</label>
                  <input id="loan-earlyDiscount" aria-label="Desconto Antecipação (%)" type="number" step="0.1" value={earlyDiscount} onChange={(e) => setEarlyDiscount(e.target.value)} placeholder="0" className={INPUT} />
                  <p className="text-xs text-muted-foreground mt-1">% se pagar antes do vencimento</p>
                </div>
                <section className="rounded-2xl border border-border/70 bg-muted/20 p-4 sm:col-span-2 xl:col-span-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Multa por atraso</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Escolha uma única forma de cobrança diária.</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Opcional</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="loan-dailyPenaltyType" className="mb-1.5 block text-xs font-semibold text-foreground">Tipo de multa</label>
                      <div className="relative">
                        <select id="loan-dailyPenaltyType" aria-label="Tipo de multa" value={dailyPenaltyType} onChange={(e) => {
                          setDailyPenaltyType(e.target.value as "percentage" | "fixed");
                          setLateFeePercent("");
                          setDailyInterestPercent("0");
                        }} className={SELECT}>
                          <option value="percentage">Percentual por dia</option>
                          <option value="fixed">Valor fixo por dia</option>
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-foreground" htmlFor="daily-penalty-value">
                        {dailyPenaltyType === "percentage" ? "Percentual por dia (%)" : "Valor por dia (R$)"}
                      </label>
                      <input
                        id="daily-penalty-value"
                        aria-describedby="daily-penalty-help"
                        type="number"
                        min="0"
                        step="0.01"
                        value={lateFeePercent}
                        onChange={(e) => setLateFeePercent(e.target.value)}
                        placeholder="0"
                        className={INPUT}
                      />
                      <p id="daily-penalty-help" className="mt-2 text-xs text-muted-foreground">Informe o valor para esta modalidade. Use 0 para não cobrar multa.</p>
                    </div>
                  </div>
                </section>
              </div>

              {/* Renovação automática + Assinatura */}
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setAutoRenew(!autoRenew)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-colors text-left ${autoRenew ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${autoRenew ? "bg-primary" : "bg-muted"}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${autoRenew ? "left-4" : "left-0.5"}`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">Renovação Automática</p>
                    <p className="text-xs text-muted-foreground">Cria novo contrato ao quitar</p>
                  </div>
                </button>
                <button type="button" onClick={() => setRequireSignature(!requireSignature)}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-colors text-left ${requireSignature ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className={`w-9 h-5 rounded-full transition-colors relative ${requireSignature ? "bg-primary" : "bg-muted"}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${requireSignature ? "left-4" : "left-0.5"}`} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">Assinatura Digital</p>
                    <p className="text-xs text-muted-foreground">Gera link para o cliente assinar</p>
                  </div>
                </button>
              </div>

              {/* Alocação de capital (opcional) */}
              <InvestorAllocationSelect value={investorLoanId} onChange={setInvestorLoanId} />


              {/* Garantia / Aval */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Garantia / Aval</h3>
                <div className="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-5 gap-2">
                  {([
                    { v: "none", label: "Nenhuma" },
                    { v: "aval", label: "Avalista" },
                    { v: "vehicle", label: "Veículo" },
                    { v: "property", label: "Imóvel" },
                    { v: "other", label: "Outra" },
                  ] as const).map(g => (
                    <button key={g.v} type="button" onClick={() => setGuaranteeType(g.v)}
                      className={`min-w-0 p-2 rounded-lg border text-xs font-semibold transition-colors ${guaranteeType === g.v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                      {g.label}
                    </button>
                  ))}
                </div>

                {guaranteeType !== "none" && guaranteeType !== "aval" && (
                  <div>
                    <label htmlFor="loan-guaranteeDescription" className="text-xs font-semibold text-foreground mb-1.5 block">Descrição da Garantia</label>
                    <input id="loan-guaranteeDescription" aria-label="Descrição da Garantia" type="text" value={guaranteeDescription} onChange={(e) => setGuaranteeDescription(e.target.value)}
                      placeholder="Ex: Honda Civic 2020 placa ABC-1234" className={INPUT} />
                  </div>
                )}

                {guaranteeType === "aval" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="loan-guarantorName" className="text-xs font-semibold text-foreground mb-1.5 block">Nome do Avalista</label>
                      <input id="loan-guarantorName" aria-label="Nome do Avalista" type="text" value={guarantorName} onChange={(e) => setGuarantorName(e.target.value)} className={INPUT} />
                    </div>
                    <div>
                      <label htmlFor="loan-guarantorCpf" className="text-xs font-semibold text-foreground mb-1.5 block">CPF do Avalista</label>
                      <input id="loan-guarantorCpf" aria-label="CPF do Avalista" type="text" value={guarantorCpf} onChange={(e) => setGuarantorCpf(e.target.value)} className={INPUT} />
                    </div>
                    <div className="col-span-2">
                      <label htmlFor="loan-guarantorPhone" className="text-xs font-semibold text-foreground mb-1.5 block">Telefone do Avalista</label>
                      <input id="loan-guarantorPhone" aria-label="Telefone do Avalista" type="text" value={guarantorPhone} onChange={(e) => setGuarantorPhone(e.target.value)} className={INPUT} />
                    </div>
                  </div>
                )}
              </div>

              {/* Anexos */}
              <div className="space-y-3 pt-3 border-t border-border">
                <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Comprovantes Anexos</h3>
                <input
                  type="file"
                  aria-label="Documentos e anexos do contrato" accept="image/*,application/pdf"
                  multiple
                  disabled={uploadingAttachment}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []);
                    if (!files.length || !user) return;
                    setUploadingAttachment(true);
                    const uploaded: { name: string; url: string; type: string }[] = [];
                    for (const file of files) {
                      const path = `${user.id}/contracts/${Date.now()}-${file.name}`;
                      const { error } = await supabase.storage.from("uploads").upload(path, file);
                      if (!error) {
                        const signed = await getSignedUploadUrl(path);
                        if (signed) uploaded.push({ name: file.name, url: signed, type: file.type });
                      }
                    }
                    setAttachments([...attachments, ...uploaded]);
                    setUploadingAttachment(false);
                    e.target.value = "";
                    toast({ title: `${uploaded.length} arquivo(s) anexado(s)` });
                  }}
                  className="text-xs file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                />
                {attachments.length > 0 && (
                  <div className="space-y-1.5">
                    {attachments.map((att, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={12} className="text-primary shrink-0" />
                          <span className="text-xs text-foreground truncate">{att.name}</span>
                        </div>
                        <button type="button" onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))}
                          className="text-xs text-destructive hover:underline">Remover</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </details>
          )}

          
        </div>
      )}

      {/* Live summary stays in the form flow so it never covers fields or actions. */}
      {step === 2 && calc && parseFloat(capital) > 0 && (
        <div className="relative z-10 mx-auto mt-5 w-full max-w-[520px] md:sticky md:top-4 md:ml-auto md:mr-0">
          <div className="rounded-2xl border border-primary/25 bg-card/95 p-3 shadow-xl shadow-black/20 backdrop-blur">
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Resumo ao vivo</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-muted/50 px-2.5 py-2 text-center">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Parcela</p>
                <p className="mt-0.5 text-sm font-bold text-foreground">R$ {fmt(calc.installmentAmount)}</p>
              </div>
              <div className="rounded-xl bg-muted/50 px-2.5 py-2 text-center">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Total</p>
                <p className="mt-0.5 text-sm font-bold text-foreground">R$ {fmt(calc.totalAmount)}</p>
              </div>
              <div className="rounded-xl bg-success/10 px-2.5 py-2 text-center">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Juros</p>
                <p className="mt-0.5 text-sm font-bold text-success">R$ {fmt(calc.totalInterest)}</p>
              </div>
              <div className="rounded-xl bg-primary/10 px-2.5 py-2 text-center">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Parcelas</p>
                <p className="mt-0.5 text-sm font-bold text-primary">{calc.numParcelas}x</p>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ═══ STEP 3: REVIEW ═══ */}
      {step === 3 && calc && (
        <div className="space-y-4">
          <div className="space-y-5 rounded-2xl border border-border/50 bg-card/45 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText size={18} className="text-primary" /> Revisão Final
            </h2>

            {/* Client info */}
            <div className="bg-muted/30 rounded-xl p-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                {avatarPreview ? <img src={avatarPreview} className="w-12 h-12 rounded-full object-cover" alt="" /> : nome.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-foreground">{nome}</p>
                <p className="text-xs text-muted-foreground">{cpfCnpj || telefone || "—"}</p>
                {rua && <p className="text-xs text-muted-foreground">{rua}, {numero} - {cidade}/{estado}</p>}
              </div>
            </div>

            {/* Contract details — adapt per loan mode */}
            <div className="grid grid-cols-2 gap-3">
              {(() => {
                const effectiveFirstDue = (() => {
                  if (!autoFirstDue && firstDueDate) return formatBR(firstDueDate);
                  const dd = generateDueDates(startDate, frequency, 1, dailyMode, undefined);
                  return dd[0] ? formatBR(dd[0]) : "—";
                })();
                const modeLabel: Record<LoanMode, string> = {
                  installments: "Por Parcelas",
                  percentage: "Por Porcentagem",
                  interest_only: "Só Juros + Capital no Fim",
                  price: "Juros Compostos (Price)",
                  bullet: "Pagamento Único",
                  grace: "Com Carência",
                };
                const items: { label: string; value: string }[] = [
                  { label: "Capital", value: `R$ ${fmt(parseFloat(capital))}` },
                  { label: "Modo", value: modeLabel[loanMode] },
                  { label: "Frequência", value: `${freqLabel}${frequency === "daily" ? ` (${dailyMode === "mon-fri" ? "Seg-Sex" : dailyMode === "mon-sat" ? "Seg-Sáb" : "Seg-Dom"})` : ""}` },
                  { label: "Taxa", value: valueMode === "installment" && (calc as any).derivedRate !== undefined ? `${(calc as any).derivedRate.toFixed(2)}% por ${periodLabel} (derivada)` : `${taxaJuros}% por ${periodLabel}` },
                ];
                if (loanMode === "bullet") {
                  items.push({ label: "Períodos até vencimento", value: `${numInstallments || 1} ${periodLabel}(s)` });
                  items.push({ label: "Pagamento Único", value: `R$ ${fmt(calc.totalAmount)}` });
                } else {
                  items.push({ label: "Pagamentos", value: `${calc.numParcelas}x R$ ${fmt(calc.installmentAmount)}` });
                }
                if (loanMode === "grace") {
                  items.push({ label: "Carência", value: `${gracePeriods} ${periodLabel}(s) sem pagar` });
                }
                items.push({ label: "Data de Início", value: formatBR(startDate) });
                items.push({ label: "1º Vencimento", value: effectiveFirstDue });
                items.push({ label: "Total a Receber", value: `R$ ${fmt(calc.totalAmount)}` });
                items.push({
                  label: "Multa por atraso",
                  value: dailyPenaltyType === "fixed"
                    ? `R$ ${fmt(parseFloat(lateFeePercent) || 0)} por dia`
                    : `${lateFeePercent || 0}% por dia`,
                });
                return items.map(i => (
                  <div key={i.label} className="bg-muted/30 rounded-xl p-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">{i.label}</p>
                    <p className="font-semibold text-sm text-foreground mt-0.5">{i.value}</p>
                  </div>
                ));
              })()}
            </div>

            <div className="bg-success/5 border border-success/20 rounded-xl p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Lucro Estimado</p>
              <p className="text-xl font-bold text-success">R$ {fmt(calc.totalInterest)}</p>
            </div>

            {existingRisk.length > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <input type="checkbox" checked={riskAccepted} onChange={(e) => setRiskAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
                <span>
                  <span className="block text-sm font-bold text-destructive">Cliente com {existingRisk.length} parcela(s) vencida(s)</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Total vencido: R$ {fmt(existingRisk.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paid_amount || 0)), 0))}. Confirmo que revisei o risco e autorizo o novo contrato.
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>
      )}

      {/* ═══ NAV BAR ═══ */}
      <div className="mobile-dock sticky bottom-3 z-10 flex items-center justify-between gap-2 rounded-2xl border border-border bg-card/95 p-3 backdrop-blur sm:p-4">
        <button
          type="button"
          onClick={() => {
            if (isNewContractOnly) {
              if (step > 2) setStep(step - 1);
              else navigate(`/clientes/${existingClientId}`);
            } else {
              if (step > 1) setStep(step - 1);
              else navigate("/clientes");
            }
          }}
          className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:px-4"
        >
          <ArrowLeft size={16} />{" "}
          {isNewContractOnly ? (step > 2 ? "Voltar" : "Cancelar") : step > 1 ? "Voltar" : "Cancelar"}
        </button>
        {step < 3 ? (
          <button type="button" onClick={goNext}
            disabled={step === 2 && !calc}
            title={step === 2 && !calc ? "Preencha os valores do empréstimo para continuar" : undefined}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 sm:px-6">
            {step === 1 ? "Definir empréstimo" : "Revisar contrato"} <ArrowRight size={16} />
          </button>
        ) : (
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:px-6">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {saving ? "Criando..." : isNewContractOnly ? "Criar Contrato" : "Criar Cliente e Contrato"}
          </button>
        )}
      </div>
    </div>
  );
};

export default NovoCliente;
