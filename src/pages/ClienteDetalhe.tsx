import {UploadImage} from '@/components/UploadMedia';
import "@/components/cliente-detalhe/client-profile.css";
import {paymentReviewDescription} from '@/lib/paymentFeedback';
import "@/components/cliente-detalhe/client-reference.css";
import "@/components/cliente-detalhe/client-tabs.css";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import VoiceRecorder from "@/components/VoiceRecorder";
import EditClienteModal from "@/components/cliente-detalhe/modals/EditClienteModal";
import EditAddressModal from "@/components/cliente-detalhe/modals/EditAddressModal";
import NovoEmprestimoModal from "@/components/cliente-detalhe/modals/NovoEmprestimoModal";
import EditContratoModal from "@/components/cliente-detalhe/modals/EditContratoModal";
import EditParcelaModal from "@/components/cliente-detalhe/modals/EditParcelaModal";
import PagamentoModal from "@/components/cliente-detalhe/modals/PagamentoModal";
import PagamentoDistribuidoModal from "@/components/cliente-detalhe/modals/PagamentoDistribuidoModal";
import RenegociarModal, { type RenegotiationPayload } from "@/components/cliente-detalhe/modals/RenegociarModal";
import { LOAN_MODES, fmt, FREQ, formatFrequency, INPUT } from "@/components/cliente-detalhe/constants";
import { interestOnlyAmount } from "@/lib/interestOnly";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {clientFinancialSummary} from '@/lib/clientFinancialSummary';
import {financialAnalyticsSchema} from '@/lib/financialAnalytics';
import {useFinancialClock} from '@/hooks/useFinancialClock';
import ClientReceiptChart from '@/components/cliente-detalhe/ClientReceiptChart';
import { useMultiTableRealtime } from "@/hooks/useRealtimeSubscription";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  ArrowLeft, User, Phone, Mail, MapPin, FileText, DollarSign,
  CheckCircle, AlertTriangle, Clock, Edit, Trash2, Plus, Send, Copy,
  MessageSquare, Star, Ban, RotateCcw, Download, TrendingUp,
  Calendar, Receipt, Activity, Search, X, Percent, Wallet, Printer, Camera,
  Wrench, Repeat, PhoneCall, StickyNote,
  Info, UploadCloud, File as FileIcon, ImageIcon, ShieldCheck, Sparkles, ChevronRight, MoreHorizontal,
  ChevronDown, Layers3, Building2, CreditCard, BarChart3, CircleDollarSign, Eye,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import ErrorState from "@/components/feedback/ErrorState";
import { formatBR, parseLocalDate, todayLocalISO, localNoonISO } from "@/lib/dateUtils";
import {financialDay} from '../../supabase/functions/_shared/financial_calendar';
import { useConfirm } from "@/components/ConfirmProvider";
import { calculateLoan, generateInstallmentSchedule, LOAN_MODE_LABEL, type LoanMode, type Frequency, type DailyMode } from "@/lib/loanMath";
import { getSignedUploadUrl } from "@/lib/storage";
import ClientToolsPanel, { type ToolGroup } from "@/components/clients/ClientToolsPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { computeLateFeeBreakdown, DEFAULT_DAILY_LATE_RATE, outstandingDue } from "@/lib/lateFee";
import { accumulatedPaymentTotal, portalInstallmentAmount } from "@/lib/portalAmounts";
import { friendlyError } from "@/lib/friendlyError";
import { buildPendingSchedule, createContractAtomically } from "@/lib/contractPersistence";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPreferredPhone, resolveClientPhones } from "@/lib/phone";

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const moneyLike = (value: number) => `R$ ${safeNumber(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const InfoCell = ({ icon: Icon, label, value, tone = "blue" }: { icon: any; label: string; value: string; tone?: string }) => <div className="reference-info-cell"><span className={`reference-info-icon ${tone}`}><Icon size={15}/></span><span><small>{label}</small><strong>{value}</strong></span></div>;
const StatCell = ({ icon: Icon, value, label, tone = "blue" }: { icon: any; value: string; label: string; tone?: string }) => <div className="reference-stat-cell"><span className={`reference-info-icon ${tone}`}><Icon size={14}/></span><span><strong>{value}</strong><small>{label}</small></span></div>;


const ClienteDetalhe = () => {
  const confirm = useConfirm();
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const clock = useFinancialClock();

  const [contractFilter, setContractFilter] = useState<"all" | "active" | "settled">("all");
  const [contractSearch, setContractSearch] = useState("");
  const [docsOpen, setDocsOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("overview");
  const [sectionDialog, setSectionDialog] = useState<"loans" | "payments" | "info" | "stats" | null>(null);

  const [expandedContracts, setExpandedContracts] = useState<Set<string>>(new Set());
  const toggleContract = (cid: string) => setExpandedContracts(prev => {
    const n = new Set(prev);
    if (n.has(cid)) n.delete(cid);
    else n.add(cid);
    return n;
  });


  const [historyFilter, setHistoryFilter] = useState<"all" | "contract" | "payment" | "profit" | "note" | "contact">("all");
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [editAddressMode, setEditAddressMode] = useState(false);
  const [addrData, setAddrData] = useState<any>({});
  const [newLoanMode, setNewLoanMode] = useState(false);
  const [partialPayModal, setPartialPayModal] = useState<any>(null);
  const [partialAmount, setPartialAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("pix");
  const [payFeeDiscount, setPayFeeDiscount] = useState(0);
  const [payReceiptFile, setPayReceiptFile] = useState<File | null>(null);
  const [payUploading, setPayUploading] = useState(false);
  const [distributedPayOpen, setDistributedPayOpen] = useState(false);
  const [loanCapital, setLoanCapital] = useState("");
  const [loanInstallments, setLoanInstallments] = useState("");
  const [loanFreq, setLoanFreq] = useState("monthly");
  const [loanStartDate, setLoanStartDate] = useState(todayLocalISO());
  const [loanStart, setLoanStart] = useState(todayLocalISO());
  const [loanInterestRate, setLoanInterestRate] = useState("10");
  const [loanDailyFee, setLoanDailyFee] = useState(String(DEFAULT_DAILY_LATE_RATE));
  const [loanLateFee, setLoanLateFee] = useState("0");
  const [loanMode, setLoanMode] = useState<LoanMode>("installments");
  const [loanGracePeriods, setLoanGracePeriods] = useState("2");
  const [loanGraceDays, setLoanGraceDays] = useState("0");
  const [loanPaymentMethod, setLoanPaymentMethod] = useState("pix");
  const [loanEarlyDiscount, setLoanEarlyDiscount] = useState("0");
  const [loanMaxInterestCap, setLoanMaxInterestCap] = useState("");
  const [loanNotes, setLoanNotes] = useState("");
  const [loanDocuments, setLoanDocuments] = useState<File[]>([]);
  const [loanLoading, setLoanLoading] = useState(false);
  const [loanValueMode, setLoanValueMode] = useState<"rate" | "installment">("rate");
  const [loanInstallmentValue, setLoanInstallmentValue] = useState("");
  const [loanDailyMode, setLoanDailyMode] = useState<DailyMode>("mon-fri");
  const [loanFirstDueAuto, setLoanFirstDueAuto] = useState(true);
  const [loanCustomDates, setLoanCustomDates] = useState<string[]>([]);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [editContract, setEditContract] = useState<any>(null);
  const [editContractForm, setEditContractForm] = useState<any>({});
  const [editContractRegen, setEditContractRegen] = useState(false);
  const [editContractSaving, setEditContractSaving] = useState(false);
  const [editInst, setEditInst] = useState<any>(null);
  const [editInstForm, setEditInstForm] = useState<{ amount: string; due_date: string }>({ amount: "", due_date: "" });
  const [editInstSaving, setEditInstSaving] = useState(false);
  const [renegotiating, setRenegotiating] = useState<any>(null);

  const inv = useCallback((key: string) => qc.invalidateQueries({ queryKey: [key, id, user?.id] }), [qc, id, user?.id]);
  const invAll = useCallback(() => {
    ["client-detail", "client-contracts", "client-installments", "client-transactions", "client-profits"].forEach(k => inv(k));
    qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    qc.invalidateQueries({ queryKey: ["cobrancas-installments"] });
    qc.invalidateQueries({ queryKey: ["payment-allocation-review"] });
    qc.invalidateQueries({ queryKey: ["financial-analytics"] });
  }, [inv, qc]);

  useMultiTableRealtime(
    ["clients", "contracts", "contract_installments", "transactions", "profits"],
    [
      ["client-detail", id || "", user?.id || ""],
      ["client-contracts", id || "", user?.id || ""],
      ["client-installments", id || "", user?.id || ""],
      ["client-transactions", id || "", user?.id || ""],
      ["client-profits", id || "", user?.id || ""],
      ["financial-analytics", user?.id || ""],
    ],
  );

  const { data: client, isLoading, error: clientError, refetch: refetchClient } = useQuery({
    queryKey: ["client-detail", id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id!).eq("user_id", user!.id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!user,
    staleTime: 30_000,
  });

  const { data: contractSettings } = useQuery({
    queryKey: ["client-contract-settings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings")
        .select("company_name, company_cnpj, company_address, company_phone")
        .eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const { data: contracts = [], isLoading: contractsLoading, error: contractsError } = useQuery({
    queryKey: ["client-contracts", id, user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("contracts").select("*")
        .eq("client_id", id!).eq("user_id", user!.id).order("created_at", { ascending: false }).range(from, to));
    },
    enabled: !!id && !!user,
    staleTime: 30_000,
  });

  // Sincroniza os padrões do modal "Novo Empréstimo" com o último contrato do
  // cliente, para que empréstimos subsequentes herdem taxa, frequência, multas
  // e condições avançadas do histórico — evitando divergência com o wizard.
  useEffect(() => {
    if (!newLoanMode) return;
    const last = (contracts as any[])[0];
    if (!last) return;
    if (last.loan_mode) setLoanMode(last.loan_mode as LoanMode);
    if (last.frequency) setLoanFreq(last.frequency);
    if (last.interest_rate != null) setLoanInterestRate(String(last.interest_rate));
    if (last.num_installments) setLoanInstallments(String(last.num_installments));
    if (last.daily_interest_percent != null) setLoanDailyFee(String(last.daily_interest_percent));
    if (last.late_fee_percent != null) setLoanLateFee(String(last.late_fee_percent));
    if (last.grace_periods) setLoanGracePeriods(String(last.grace_periods));
    if (last.grace_days != null) setLoanGraceDays(String(last.grace_days));
    if (last.payment_method) setLoanPaymentMethod(last.payment_method);
    if (last.early_payment_discount_percent != null) setLoanEarlyDiscount(String(last.early_payment_discount_percent));
    if (last.max_interest_cap_percent != null) setLoanMaxInterestCap(String(last.max_interest_cap_percent));
    // valueMode segue o padrão do wizard: "installment" quando o modo é parcelas.
    setLoanValueMode(last.loan_mode === "installments" ? "installment" : "rate");

  }, [newLoanMode]);



  const { data: installments = [], isLoading: installmentsLoading, error: installmentsError } = useQuery({
    queryKey: ["client-installments", id, user?.id],
    queryFn: async () => {
      const data = await fetchAll((from, to) => supabase.from("contract_installments")
        .select("*, contracts(capital, frequency, daily_interest_percent, max_interest_cap_percent, daily_penalty_type, daily_penalty_value)")
        .eq("client_id", id!).eq("user_id", user!.id).order("due_date").range(from, to));
      const now = new Date();
      return (data || []).map((i: any) => {
        const dueTime = parseLocalDate(i.due_date)?.getTime() ?? NaN;
        return i.status === "pending" && Number.isFinite(dueTime) && dueTime < now.getTime() ? { ...i, status: "overdue" } : i;
      });
    },
    enabled: !!id && !!user,
    staleTime: 30_000,
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["client-transactions", id, user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("transactions").select("*")
        .eq("client_id", id!).eq("user_id", user!.id)
        .order("date", { ascending: false }).range(from, to));
    },
    enabled: !!id && !!user,
    staleTime: 30_000,
  });

  const { data: profits = [] } = useQuery({
    queryKey: ["client-profits", id, user?.id],
    queryFn: async () => {
      return fetchAll((from, to) => supabase.from("profits").select("*")
        .eq("client_id", id!).eq("user_id", user!.id).order("date", { ascending: false }).range(from, to));
    },
    enabled: !!id && !!user,
    staleTime: 30_000,
  });

  const {data:cash,error:cashError,isLoading:cashLoading,refetch:refetchCash}=useQuery({
    queryKey:['financial-analytics',user?.id,'client',id,financialDay(clock)],enabled:!!user&&!!id,
    queryFn:async()=>{const {data,error}=await supabase.rpc('financial_analytics_report',{_expected_owner:user!.id});if(error)throw error;return financialAnalyticsSchema.parse(data);},
  });
  const financialReady=!!cash&&!cashError&&!cashLoading&&!contractsLoading&&!installmentsLoading&&!contractsError&&!installmentsError;
  const kpis=useMemo(()=>clientFinancialSummary(id||'',contracts,installments,financialReady?cash:undefined,clock),[id,contracts,installments,cash,financialReady,clock]);
  const financialFailure=cashError||contractsError||installmentsError;
  const requireFinancialReport=()=>{
    if(financialReady)return true;
    toast({title:'Aguarde a conferência financeira',description:'O resumo só pode ser exportado após confirmar os recebimentos.',variant:'destructive'});return false;
  };

  // ===== Documentos & Anexos (Storage) =====
  const docsFolder = id && user ? `${user.id}/client-docs/${id}` : "";
  const { data: clientDocs = [], error: clientDocsError, refetch: refetchDocs } = useQuery({
    queryKey: ["client-docs", id, user?.id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const folders=[docsFolder,`client-docs/${id}`];
      const lists=await Promise.all(folders.map(async folder=>{
        const {data,error}=await supabase.storage.from('uploads').list(folder,{limit:100,sortBy:{column:'created_at',order:'desc'}});
        if(error)throw error;
        return (data||[]).filter(f=>f.name&&!f.name.startsWith('.')&&f.id).map(f=>({...f,path:`${folder}/${f.name}`}));
      }));
      return lists.flat();
    },
  });
  const [docUploading, setDocUploading] = useState(false);
  const uploadDoc = async (file: File) => {
    if (!file || !id || !user) return;
    setDocUploading(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${docsFolder}/${Date.now()}-${file.name.replace(/[^a-z0-9.-]/gi, "_")}`;
      const { error } = await supabase.storage.from("uploads").upload(path, file, {
        upsert: false, contentType: file.type,
      });
      if (error) throw error;
      toast({ title: "Documento anexado" });
      inv("client-docs");
    } catch (e: any) {
      toast({ title: "Falha ao anexar", description: e.message, variant: "destructive" });
    } finally { setDocUploading(false); }
  };
  const deleteDoc = async (path: string) => {
    if (!(await confirm("Remover este documento?"))) return;
    const { error } = await supabase.storage.from("uploads").remove([path]);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
    toast({ title: "Documento removido" });
    inv("client-docs");
  };
  const signedUrl = async (path: string) => {
    const { data } = await supabase.storage.from("uploads").createSignedUrl(path, 60 * 10);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };


  const groupedInstallments = useMemo(() => {
    const groups: Record<string, any[]> = {};
    installments.forEach((inst: any) => {
      const cid = inst.contract_id || "no-contract";
      if (!groups[cid]) groups[cid] = [];
      groups[cid].push(inst);
    });
    // Ordena cada grupo por número da parcela
    Object.values(groups).forEach((arr) => arr.sort((a: any, b: any) => (a.installment_number ?? 0) - (b.installment_number ?? 0)));
    // Ordena os grupos por data de criação do contrato (mais recente primeiro)
    const order = new Map(contracts.map((c: any, idx: number) => [c.id, idx]));
    const sorted: Record<string, any[]> = {};
    Object.keys(groups)
      .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
      .forEach((k) => { sorted[k] = groups[k]; });
    return sorted;
  }, [installments, contracts]);

  const loanCalc = useMemo(() => {
    const cap = parseFloat(loanCapital) || 0;
    const rate = parseFloat(loanInterestRate) || 0;
    const n = parseInt(loanInstallments) || 0;
    const grace = parseInt(loanGracePeriods) || 0;
    const instVal = parseFloat(loanInstallmentValue) || 0;
    if (!cap) return null;
    const r = calculateLoan({
      capital: cap, rate, periods: n,
      frequency: loanFreq as any, loanMode,
      gracePeriods: loanMode === "grace" ? grace : 0,
      valueMode: loanMode === "installments" ? loanValueMode : "rate",
      installmentValue: instVal,
    });
    if (!r) return null;
    return {
      installmentAmount: r.installmentAmount,
      total: r.totalAmount,
      totalInterest: r.totalInterest,
      schedule: r.schedule,
      numInstallments: r.numInstallments,
      derivedRate: r.derivedRate,
    };
  }, [loanCapital, loanInterestRate, loanInstallments, loanFreq, loanMode, loanGracePeriods, loanValueMode, loanInstallmentValue]);

  // Actions
  const startEdit = () => {
    const phones = resolveClientPhones(client?.phone, client?.whatsapp);
    setEditData({ name: client?.name || "", phone: phones.phone || "", email: client?.email || "", cpf_cnpj: client?.cpf_cnpj || "", whatsapp: phones.whatsapp || "", birth_date: (client as any)?.birth_date || "" });
    setEditMode(true);
  };

  const saveEdit = async () => {
    // `birth_date` é uma coluna date: string vazia faz o Postgres recusar a
    // gravação inteira. Campo em branco significa "sem data", não "".
    const phones = resolveClientPhones(editData.phone, editData.whatsapp);
    const payload = { ...editData, ...phones, birth_date: editData.birth_date || null };
    const { error } = await supabase.from("clients").update(payload).eq("id", id!);
    if (error) { toast({ ...friendlyError(error, "Não foi possível salvar o cliente."), variant: "destructive" }); return; }
    toast({ title: "Cliente atualizado!" }); setEditMode(false); inv("client-detail");
  };

  const startEditAddress = () => {
    const a = (client?.address as any) || {};
    setAddrData({ cep: a.cep || "", street: a.street || "", number: a.number || "", neighborhood: a.neighborhood || "", city: a.city || "", state: a.state || "" });
    setEditAddressMode(true);
  };

  const buscarCep = async () => {
    const raw = (addrData.cep || "").replace(/\D/g, "");
    if (raw.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const data = await res.json();
      if (!data.erro) setAddrData((prev: any) => ({ ...prev, street: data.logradouro || "", neighborhood: data.bairro || "", city: data.localidade || "", state: data.uf || "" }));
    } catch {}
  };

  const saveAddress = async () => {
    const { error } = await supabase.from("clients").update({ address: addrData }).eq("id", id!);
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível salvar o endereço."), variant: "destructive" });
      return;
    }
    toast({ title: "Endereço atualizado!" }); setEditAddressMode(false); inv("client-detail");
  };

  // M3: usa o mesmo gerador do NovoCliente (loanMath) para não divergir. Antes
  // esta tela usava quinzenal = 14 dias e diária = dias corridos; agora fica
  // quinzenal = 15 dias e diária = dias úteis (mon-fri), igual à criação padrão.
  const generateDueDates = (start: string, freq: string, count: number, periodsAhead?: number) => {
    // freq pode vir como "daily_mon-fri" | "daily_mon-sat" | "daily_mon-sun"
    let baseFreq: Frequency = "monthly" as Frequency;
    let dailyMode: "mon-fri" | "mon-sat" | "mon-sun" = "mon-fri";
    if (freq?.startsWith("daily")) {
      baseFreq = "daily" as Frequency;
      const suffix = freq.split("_")[1];
      if (suffix === "mon-sat" || suffix === "mon-sun" || suffix === "mon-fri") dailyMode = suffix;
    } else {
      baseFreq = (freq || "monthly") as Frequency;
    }
    return generateInstallmentSchedule({
      startDate: start,
      frequency: baseFreq,
      count,
      periodsAhead,
      dailyMode,
    });
  };

  const handleCreateLoan = async ({ signatureRequired }: { signatureRequired: boolean }) => {
    if (!user || !loanCalc) return;
    setLoanLoading(true);
    try {
      const nInput = parseInt(loanInstallments) || 0;
      const nReal = loanCalc.numInstallments;
      const periodsAhead = loanMode === "bullet" ? nInput : undefined;
      const effectiveRate = loanMode === "installments" && loanValueMode === "installment"
        ? (loanCalc.derivedRate ?? parseFloat(loanInterestRate) ?? 0)
        : parseFloat(loanInterestRate);
      const contractPayload = {
        capital: parseFloat(loanCapital),
        interest_rate: effectiveRate, num_installments: nReal,
        installment_amount: loanCalc.installmentAmount, frequency: loanFreq,
        start_date: localNoonISO(loanStartDate),
        late_fee_percent: 0, daily_interest_percent: parseFloat(loanDailyFee) || DEFAULT_DAILY_LATE_RATE,
        total_amount: loanCalc.total, total_interest: loanCalc.totalInterest,
        status: signatureRequired ? "pending_signature" : "active",
        signature_status: signatureRequired ? "pending" : "not_required",
        loan_mode: loanMode,
        grace_periods: loanMode === "grace" ? (parseInt(loanGracePeriods) || 0) : 0,
        grace_days: parseInt(loanGraceDays) || 0,
        payment_method: loanPaymentMethod,
        early_payment_discount_percent: parseFloat(loanEarlyDiscount) || 0,
        max_interest_cap_percent: loanMaxInterestCap ? parseFloat(loanMaxInterestCap) : null,
        notes: loanNotes || null,
      };

      const dueDates = generateInstallmentSchedule({
        startDate: loanStartDate,
        firstDueDate: loanFirstDueAuto ? undefined : loanStart,
        frequency: loanFreq as Frequency,
        count: nReal,
        periodsAhead,
        dailyMode: loanDailyMode,
        customDates: loanFreq === "custom" ? loanCustomDates : undefined,
      });
      const createdContract = await createContractAtomically(supabase as any, {
        clientId: id!,
        contract: contractPayload,
        installments: dueDates.map((dd, i) => ({
          installment_number: i + 1,
          amount: loanCalc.schedule[i] ?? loanCalc.installmentAmount,
          due_date: dd,
        })),
      });

      const uploadedDocuments: Array<{ name: string; path: string; type: string; size: number; uploaded_at: string }> = [];
      const failedDocuments: string[] = [];
      for (const file of loanDocuments) {
        const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
        const path = `${user.id}/clients/${id}/contracts/${createdContract.contract_id}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (uploadError) {
          failedDocuments.push(file.name);
          continue;
        }
        uploadedDocuments.push({ name: file.name, path, type: file.type, size: file.size, uploaded_at: new Date().toISOString() });
      }
      if (uploadedDocuments.length > 0) {
        const { error: attachmentError } = await supabase.from("contracts")
          .update({ attachments: uploadedDocuments as any })
          .eq("id", createdContract.contract_id)
          .eq("user_id", user.id);
        if (attachmentError) throw attachmentError;
      }

      toast({
        title: "Empréstimo criado!",
        description: failedDocuments.length
          ? `${nReal} parcela(s) gerada(s). ${failedDocuments.length} documento(s) não puderam ser anexados.`
          : `${nReal} parcela(s) gerada(s). ${uploadedDocuments.length} documento(s) anexado(s).`,
        variant: failedDocuments.length ? "destructive" : "default",
      });
      setNewLoanMode(false); setLoanCapital(""); setLoanInstallments(""); setLoanNotes(""); setLoanDocuments([]);
      invAll();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setLoanLoading(false); }
  };

  const handleRenegotiate = async (payload: RenegotiationPayload) => {
    if (!user || !renegotiating) return;
    const old = renegotiating;
    try {
      const contractPayload = {
        capital: payload.totalCapital,
        interest_rate: payload.interestRate,
        num_installments: payload.numInstallments,
        installment_amount: payload.installmentAmount,
        frequency: payload.frequency,
        start_date: localNoonISO(payload.startDate),
        late_fee_percent: payload.lateFeePercent,
        daily_interest_percent: payload.dailyInterestPercent,
        total_amount: payload.totalAmount,
        total_interest: payload.totalInterest,
        status: "active",
        loan_mode: "installments",
        notes: payload.notes || null,
      };

      const dueDates = generateDueDates(payload.startDate, payload.frequency, payload.numInstallments);
      const { error } = await (supabase as any).rpc("renegotiate_contract_atomically", {
        _old_contract_id: old.id,
        _contract: contractPayload,
        _installments: dueDates.map((dd, i) => ({
          installment_number: i + 1,
          amount: payload.schedule[i] ?? payload.installmentAmount,
          due_date: dd,
        })),
        _new_cash_disbursed: payload.addCapital,
        _reason: payload.notes || null,
      });
      if (error) throw error;

      toast({ title: "Contrato renegociado!", description: `${payload.numInstallments || 0}x de R$ ${Number(payload.installmentAmount || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` });
      setRenegotiating(null);
      invAll();
    } catch (err: any) {
      toast({ ...friendlyError(err, "Não foi possível concluir a renegociação."), variant: "destructive" });
    }
  };



  const openEditContract = (c: any) => {
    setEditContract(c);
    const raw = c.frequency || "monthly";
    const isDaily = raw.startsWith("daily");
    const baseFreq = isDaily ? "daily" : raw;
    const dailyMode = isDaily ? (raw.split("_")[1] || "mon-fri") : "mon-fri";
    setEditContractForm({
      capital: String(c.capital ?? ""),
      interest_rate: String(c.interest_rate ?? ""),
      num_installments: String(c.num_installments ?? ""),
      installment_amount: String(c.installment_amount ?? ""),
      frequency: baseFreq,
      daily_mode: dailyMode,
      start_date: financialDay(c.start_date) || "",
      late_fee_percent: String(c.late_fee_percent ?? "0"),
      daily_interest_percent: String(c.daily_interest_percent ?? "0"),
      notes: c.notes || "",
    });
    setEditContractRegen(false);
  };

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToSection = (key: string, sectionId: string) => {
    setActiveSection(key);
    scrollToSection(sectionId);
  };

  const focusContract = (contractId: string) => {
    setExpandedContracts((prev) => {
      const next = new Set(prev);
      next.add(contractId);
      return next;
    });
    // Aguarda o cartão expandido ser renderizado e garante que ele fique visível.
    window.setTimeout(() => {
      const target = document.getElementById(`contract-${contractId}`);
      if (!target) return;
      target.setAttribute("tabindex", "-1");
      target.scrollIntoView({ behavior: "auto", block: "center" });
      (target as HTMLElement).focus({ preventScroll: true });
    }, 120);
  };

  const handleSaveContract = async () => {
    if (!editContract || !user) return;
    setEditContractSaving(true);
    try {
      const f = editContractForm;
      const n = parseInt(f.num_installments);
      const cap = parseFloat(f.capital);
      const rate = parseFloat(f.interest_rate);
      const instAmt = parseFloat(f.installment_amount);
      const totalAmount = instAmt * n;
      const totalInterest = totalAmount - cap;

      if (!Number.isInteger(n) || n <= 0 || !Number.isFinite(cap) || cap <= 0 || !Number.isFinite(instAmt) || instAmt <= 0) {
        throw new Error("Revise capital, quantidade e valor das parcelas.");
      }

      const freqValue = f.frequency === "daily" ? `daily_${f.daily_mode || "mon-fri"}` : f.frequency;

      const startDate = new Date(f.start_date + "T12:00:00");
      const lateFee = parseFloat(f.late_fee_percent);
      const dailyInterest = parseFloat(f.daily_interest_percent);
      if (!Number.isFinite(rate) || !Number.isFinite(lateFee) || !Number.isFinite(dailyInterest) || Number.isNaN(startDate.getTime())) {
        throw new Error("Revise os valores financeiros e a data de início.");
      }

      let newInst: Array<Record<string, unknown>> = [];
      if (editContractRegen) {
        const existing = installments.filter((i: any) => i.contract_id === editContract.id);
        const paid = existing.filter((i: any) => i.status === "paid");
        const paidNumbers = new Set(paid.map((i: any) => Number(i.installment_number)));
        if (paid.length > n || [...paidNumbers].some((number) => number < 1 || number > n)) {
          throw new Error("A nova quantidade não pode excluir parcelas que já foram pagas.");
        }

        const dueDates = generateDueDates(f.start_date, freqValue, n);
        newInst = buildPendingSchedule({
          dueDates,
          paidInstallmentNumbers: paidNumbers,
          amount: instAmt,
          userId: user.id,
          contractId: editContract.id,
          clientId: id!,
        });
      }

      const contractPatch = {
        capital: cap,
        interest_rate: rate,
        num_installments: n,
        installment_amount: instAmt,
        frequency: freqValue,
        start_date: localNoonISO(f.start_date),
        late_fee_percent: lateFee,
        daily_interest_percent: dailyInterest,
        total_amount: totalAmount,
        total_interest: totalInterest,
        notes: f.notes || null,
      };

      const { error } = await (supabase as any).rpc("update_contract_atomically", {
        _contract_id: editContract.id,
        _contract: contractPatch,
        _regenerate: editContractRegen,
        _installments: newInst.map(({ user_id: _userId, contract_id: _contractId, client_id: _clientId, status: _status, ...installment }) => installment),
      });
      if (error) {
        // Banco ainda sem a migração da RPC: aplica a mesma mudança direto
        // nas tabelas, protegidas por RLS, do mesmo jeito que a exclusão de
        // contrato já faz enquanto a migração não é aplicada.
        const missingRpc = error.code === "PGRST202" || /schema cache|could not find the function/i.test(error.message || "");
        if (!missingRpc) throw error;

        const { error: contractError } = await supabase
          .from("contracts")
          .update(contractPatch)
          .eq("id", editContract.id)
          .eq("user_id", user.id);
        if (contractError) throw contractError;

        if (editContractRegen) {
          const { error: deleteError } = await supabase
            .from("contract_installments")
            .delete()
            .eq("contract_id", editContract.id)
            .eq("user_id", user.id)
            .neq("status", "paid");
          if (deleteError) throw deleteError;

          if (newInst.length > 0) {
            const { error: insertError } = await supabase.from("contract_installments").insert(newInst as any);
            if (insertError) throw insertError;
          }
        }
      }

      toast({ title: "Contrato atualizado!", description: editContractRegen ? "Parcelas pendentes regeneradas." : undefined });
      setEditContract(null);
      invAll();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setEditContractSaving(false);
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    const ok = await confirm({
      title: "Excluir Empréstimo?",
      description: "Isso apagará o contrato, todas as parcelas e movimentações ligadas a ele. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
      cancelLabel: "Voltar",
      variant: "destructive"
    });
    if (!ok) return;

    try {
      // Deleta parcelas primeiro (FK)
      const { error } = await (supabase as any).rpc("delete_contract_atomically", {
        _contract_id: contractId,
      });
      if (error) {
        // Older self-hosted Supabase instances may not have the RPC in the
        // PostgREST schema cache yet. Keep deletion usable while that
        // migration is being applied, deleting dependents before the parent.
        const missingRpc = error.code === "PGRST202" || /schema cache|could not find the function/i.test(error.message || "");
        if (!missingRpc || !user?.id) throw error;

        const dependentDeletes = [
          ["client_notifications", "contract_id"],
          ["collection_attempts", "contract_id"],
          ["profits", "contract_id"],
          ["transactions", "contract_id"],
          ["loan_collateral", "contract_id"],
          // contract_events tem ON DELETE CASCADE e o authenticated só tem
          // SELECT nela — tentar apagar aqui falharia por falta de privilégio.
          ["contract_installments", "contract_id"],
        ] as const;
        for (const [table, column] of dependentDeletes) {
          const { error: deleteError } = await (supabase as any)
            .from(table)
            .delete()
            .eq(column, contractId)
            .eq("user_id", user.id);
          if (deleteError) throw deleteError;
        }

        const { error: contractDeleteError } = await supabase
          .from("contracts")
          .delete()
          .eq("id", contractId)
          .eq("user_id", user.id);
        if (contractDeleteError) throw contractDeleteError;
      }
      // Deleta transações ligadas ao contrato
      // Deleta o contrato
      toast({ title: "Empréstimo excluído com sucesso!" });
      invAll();
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
  };

  const openEditInst = (inst: any) => {
    setEditInst(inst);
    setEditInstForm({
      amount: String(inst.amount ?? ""),
      due_date: financialDay(inst.due_date) || "",
    });
  };

  const handleSaveInst = async () => {
    if (!editInst) return;
    setEditInstSaving(true);
    try {
      const amt = parseFloat(editInstForm.amount);
      const dueDate = editInstForm.due_date ? parseLocalDate(editInstForm.due_date) : null;
      const dd = dueDate ? dueDate.toISOString() : editInstForm.due_date ? null : editInst.due_date;
      if (isNaN(amt) || amt <= 0) throw new Error("Valor inválido");
      if (!dd) throw new Error("Data de vencimento inválida");
      const { error } = await supabase.from("contract_installments").update({ amount: amt, due_date: dd }).eq("id", editInst.id);
      if (error) throw error;
      toast({ title: "Parcela atualizada!" });
      setEditInst(null);
      invAll();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setEditInstSaving(false);
    }
  };


  const patchInstallment = (instId: string, patch: any) => {
    const key = ["client-installments", id, user?.id];
    const prev = qc.getQueryData<any[]>(key);
    qc.setQueryData<any[]>(key, (old) =>
      (old || []).map((i: any) => (i.id === instId ? { ...i, ...patch, _optimistic: true } : i))
    );
    return prev;
  };

  const uploadReceipt = async (file: File): Promise<string | null> => {
    if (!user) return null;
    const ext = file.name.split(".").pop() || "bin";
    const path = `${user.id}/receipts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("uploads").upload(path, file, { upsert: false });
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível enviar o comprovante."), variant: "destructive" });
      return null;
    }
    return await getSignedUploadUrl(path);
  };

  const payFull = async (instId: string, amount: number, method: string = "pix", receiptUrl: string | null = null, announce = true, feeDiscount = 0): Promise<boolean> => {
    if (!user) return false;
    const patch: any = { status: "paid", paid_at: new Date().toISOString(), paid_amount: amount, payment_method: method };
    if (receiptUrl) patch.receipt_url = receiptUrl;
    const snapshot = patchInstallment(instId, patch);
    // RPC atômico: parcela + lucro (juros reais) + caixa (só dinheiro novo) +
    // conclusão do contrato, tudo numa transação no servidor.
    const { data: payment, error } = await supabase.rpc("pay_installment", {
      _installment_id: instId,
      _paid_total: amount,
      _mark_paid: true,
      _method: method,
      _receipt_url: receiptUrl,
      _source_key: null,
      _fee_discount: Math.max(0, safeNumber(feeDiscount)),
    });
    if (error) {
      qc.setQueryData(["client-installments", id, user?.id], snapshot);
      const paymentFailure = friendlyError(error, "Não foi possível quitar a parcela.");
      toast({
        ...paymentFailure,
        description: paymentFailure.description,
        variant: "destructive",
      });
      return false;
    }
    if(announce)toast({title:payment&&typeof payment==='object'&&'status'in payment&&payment.status==='paid'?'Parcela quitada!':'Pagamento registrado!',description:paymentReviewDescription(payment)});
    invAll();
    return true;
  };

  const handlePartialPay = async () => {
    if (!partialPayModal || !user) return;
    const val = parseFloat(partialAmount);
    if (!val || val <= 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }
    const alreadyPaid = Number(partialPayModal.paid_amount || 0);
    const contract: any = (contracts as any[]).find((c: any) => c.id === partialPayModal.contract_id);
    const paymentInput = {
      ...partialPayModal,
      daily_interest_percent: contract?.daily_interest_percent,
      max_interest_cap_percent: contract?.max_interest_cap_percent,
    };
    const remainingDue = portalInstallmentAmount(paymentInput);
    const adjustedDue = Math.max(0, Math.round((remainingDue - payFeeDiscount) * 100) / 100);
    if (val > adjustedDue + 0.005) {
      toast({ title: "Valor acima do saldo", description: `O saldo com desconto é R$ ${fmt(adjustedDue)}.`, variant: "destructive" });
      return;
    }
    setPayUploading(true);
    let receiptUrl: string | null = null;
    if (payReceiptFile) {
      receiptUrl = await uploadReceipt(payReceiptFile);
      if (!receiptUrl) { setPayUploading(false); return; }
    }
    if (val + 0.005 >= adjustedDue) {
      await payFull(partialPayModal.id, accumulatedPaymentTotal(paymentInput, adjustedDue), payMethod, receiptUrl, true, payFeeDiscount);
    } else {
      const patch: any = { paid_amount: alreadyPaid + val, payment_method: payMethod };
      if (receiptUrl) patch.receipt_url = receiptUrl;
      const snapshot = patchInstallment(partialPayModal.id, patch);
      // RPC atômico (parcial: não quita, lança só o dinheiro novo no caixa).
      const { data: payment, error } = await supabase.rpc("pay_installment", {
        _installment_id: partialPayModal.id,
        _paid_total: alreadyPaid + val,
        _mark_paid: false,
        _method: payMethod,
        _receipt_url: receiptUrl,
        _source_key: null,
        _fee_discount: Math.max(0, safeNumber(payFeeDiscount)),
      });
      if (error) {
        qc.setQueryData(["client-installments", id, user?.id], snapshot);
        toast({ ...friendlyError(error, "Não foi possível registrar o pagamento."), variant: "destructive" });
      } else {
        toast({title:`R$ ${fmt(val)} registrado!`,description:paymentReviewDescription(payment)});
        invAll();
      }
    }
    setPayUploading(false);
    setPartialPayModal(null);
    setPayReceiptFile(null);
    setPayMethod("pix");
    setPayFeeDiscount(0);
  };

  const handleInterestRenewal = async (nextDueDate: string) => {
    if (!partialPayModal || !user || !nextDueDate) return;
    setPayUploading(true);
    try {
      let receiptUrl: string | null = null;
      if (payReceiptFile) {
        receiptUrl = await uploadReceipt(payReceiptFile);
        if (!receiptUrl) return;
      }
      const { data: renewed, error } = await (supabase as any).rpc("renew_installment_interest", {
        _installment_id: partialPayModal.id,
        _next_due_date: nextDueDate,
        _method: payMethod,
        _origin: "detalhe_cliente",
      });
      if (error) throw error;
      const received = Number(renewed?.amount || partialAmount || 0);
      if (receiptUrl) {
        await supabase.from("contract_installments").update({ receipt_url: receiptUrl })
          .eq("id", partialPayModal.id).eq("user_id", user.id);
      }
      toast({
        title: "Juros recebidos e vencimento renovado",
        description: `Recebido R$ ${fmt(received)}. Novo vencimento: ${formatBR(nextDueDate)}.`,
      });
      setPartialPayModal(null);
      setPartialAmount("");
      setPayReceiptFile(null);
      setPayMethod("pix");
      setPayFeeDiscount(0);
      invAll();
    } catch (error: any) {
      toast({ ...friendlyError(error, "Não foi possível renovar o vencimento."), variant: "destructive" });
    } finally {
      setPayUploading(false);
    }
  };

  const handleDistributedPayment = async (amount: number, method: string) => {
    if (!user || !id) return;
    setPayUploading(true);
    try {
      const { data, error } = await (supabase as any).rpc("pay_client_balance", {
        _client_id: id,
        _amount: amount,
        _method: method,
        _receipt_url: null,
      });
      if (error) throw error;
      const paid = Number(data?.paid_installments || 0);
      const partial = Number(data?.partial_installments || 0);
      toast({
        title: "Pagamento distribuído!",
        description: `${paid} parcela(s) quitada(s)${partial ? " e saldo aplicado parcialmente na próxima" : ""}.`,
      });
      setDistributedPayOpen(false);
      invAll();
    } catch (error: any) {
      toast({ ...friendlyError(error, "Não foi possível distribuir o pagamento."), variant: "destructive" });
    } finally {
      setPayUploading(false);
    }
  };

  const reversePayment = async (instId: string) => {
    const inst = installments.find((i: any) => i.id === instId);
    const paidAmount = Number(inst?.paid_amount || 0);
    const isPartial = inst?.status !== "paid" && paidAmount > 0;
    const ok = await confirm({
      title: isPartial ? "Estornar pagamento parcial?" : "Estornar pagamento?",
      description: isPartial
        ? `Isso remove os R$ ${fmt(paidAmount)} já pagos desta parcela (e o lucro/caixa lançados por eles) e volta o saldo devedor ao valor cheio.`
        : "Isso remove o valor pago, o lucro e o caixa lançados por esta parcela, reabrindo-a como pendente.",
      confirmLabel: "Estornar",
      variant: "warning",
    });
    if (!ok) return;
    const snapshot = patchInstallment(instId, { status: "pending", paid_at: null, paid_amount: null });
    toast({ title: "Estornado!" });
    // RPC atômico: reverte a parcela E remove o lucro/caixa lançados por ela
    // (vinculados por installment_id), reabrindo o contrato se estava concluído.
    // Funciona tanto para quitação total quanto para pagamento parcial: zera
    // paid_amount/paid_fees/paid_interest/paid_principal e recalcula o status.
    const { error } = await supabase.rpc("reverse_installment_payment", { _installment_id: instId });
    if (error) {
      qc.setQueryData(["client-installments", id, user?.id], snapshot);
      toast({ ...friendlyError(error, "Não foi possível estornar o pagamento."), variant: "destructive" });
      return;
    }
    invAll();
  };

  const getPhone = () => (client?.whatsapp || client?.phone || "").replace(/\D/g, "");

  const sendBilling = (inst: any) => {
    const phone = getPhone();
    if (!phone) { toast({ title: "Sem telefone", variant: "destructive" }); return; }
    const msg = encodeURIComponent(`Olá ${client?.name}, sua parcela #${inst.installment_number} de R$ ${fmt(Number(inst.amount))} venceu em ${formatBR(inst.due_date)}. Regularize o pagamento.`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const sendPortalLink = () => {
    const phone = getPhone();
    if (!phone) { toast({ title: "Sem telefone", variant: "destructive" }); return; }
    const portalUrl = `${window.location.origin}/portal-cliente?o=${user!.id}`;
    const msg = encodeURIComponent(`Olá ${client?.name}, aqui está o link para o seu portal do cliente: ${portalUrl}\n\nLá você pode conferir suas parcelas, gerar PIX para pagamento e ver seu saldo devedor.\n\nPara acessar, informe somente o seu CPF.`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const sendAllOverdue = () => {
    if (!kpis.overdueInst.length) { toast({ title: "Sem parcelas atrasadas" }); return; }
    const phone = getPhone();
    if (!phone) { toast({ title: "Sem telefone", variant: "destructive" }); return; }
    const total = kpis.overdueInst.reduce((s: number, i: any) => {
      const contract: any = (contracts as any[]).find((c: any) => c.id === i.contract_id);
      return s + portalInstallmentAmount({
        ...i,
        daily_interest_percent: contract?.daily_interest_percent,
        max_interest_cap_percent: contract?.max_interest_cap_percent,
      });
    }, 0);
    const msg = encodeURIComponent(`Olá ${client?.name}, você possui ${kpis.overdueInst.length} parcela(s) em atraso, total R$ ${fmt(total)}. Entre em contato para regularizar.`);
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const payAllPending = async () => {
    const unpaid = installments.filter((i: any) => i.status !== "paid");
    if (!unpaid.length) { toast({ title: "Todas pagas!" }); return; }
    if (!(await confirm(`Quitar ${unpaid.length} parcela(s)?`))) return;
    let completed = 0;
    for (const inst of unpaid) {
      const contract: any = (contracts as any[]).find((c: any) => c.id === inst.contract_id);
      const paymentInput = {
        ...inst,
        daily_interest_percent: contract?.daily_interest_percent,
        max_interest_cap_percent: contract?.max_interest_cap_percent,
      };
      if (await payFull(inst.id, accumulatedPaymentTotal(paymentInput, portalInstallmentAmount(paymentInput)), "pix", null, false)) completed += 1;
    }
    if (completed === unpaid.length) {
      toast({ title: `${completed} parcela(s) quitada(s)!` });
    } else {
      toast({
        title: "Quitação concluída parcialmente",
        description: `${completed} de ${unpaid.length} parcela(s) foram quitadas. Tente novamente nas restantes.`,
        variant: "destructive",
      });
    }
  };

  const copyClientInfo = () => {
    navigator.clipboard.writeText(`Nome: ${client?.name}\nCPF: ${client?.cpf_cnpj || "—"}\nTel: ${client?.phone || "—"}\nWhatsApp: ${client?.whatsapp || "—"}\nEmail: ${client?.email || "—"}`);
    toast({ title: "Copiado!" });
  };

  const exportSummary = () => {
    if(!requireFinancialReport())return;
    navigator.clipboard.writeText([
      `=== ${client?.name} ===`, `CPF: ${client?.cpf_cnpj || "—"}`,
      `Capital em aberto: R$ ${fmt(kpis.totalCapital!)}`, `Recebido: R$ ${fmt(kpis.totalPaid!)}`,
      `Atraso: R$ ${fmt(kpis.totalOverdue)}`, `Restante: R$ ${fmt(kpis.remaining)}`,
    ].join("\n"));
    toast({ title: "Resumo copiado!" });
  };

  const generatePDF = () => {
    if(!requireFinancialReport())return;
    const doc = new jsPDF();
    const now = new Date();
    doc.setFillColor(20, 20, 25); doc.rect(0, 0, 210, 38, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("EXTRATO DO CLIENTE", 14, 16);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text(`Emitido em ${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR")}`, 14, 24);
    doc.text(`Cliente: ${client?.name || "—"}  |  CPF/CNPJ: ${client?.cpf_cnpj || "—"}`, 14, 31);

    let y = 46;
    doc.setTextColor(40, 40, 40); doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text("Resumo Financeiro", 14, y); y += 2;

    autoTable(doc, {
      startY: y,
      head: [["Descrição", "Valor"]],
      body: [
        ["Capital em aberto", `R$ ${fmt(kpis.totalCapital!)}`],
        ["Total Recebido", `R$ ${fmt(kpis.totalPaid!)}`],
        ["Total em Atraso", `R$ ${fmt(kpis.totalOverdue)}`],
        ["Saldo Restante", `R$ ${fmt(kpis.remaining)}`],
        ["Juros e encargos recebidos", `R$ ${fmt(kpis.totalProfit!)}`],
      ],
      theme: "grid",
      headStyles: { fillColor: [20, 20, 25], fontSize: 9 },
      bodyStyles: { fontSize: 8.5 },
      columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 82, halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;

    if (installments.length > 0) {
      if (y > 230) { doc.addPage(); y = 20; }
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text("Parcelas", 14, y); y += 2;
      autoTable(doc, {
        startY: y,
        head: [["Nº", "Valor", "Vencimento", "Status"]],
        body: installments.map((i: any) => [String(i.installment_number), `R$ ${fmt(Number(i.amount))}`, formatBR(i.due_date), i.status === "paid" ? "Pago" : i.status === "overdue" ? "Atrasada" : "Pendente"]),
        theme: "grid", headStyles: { fillColor: [20, 20, 25], fontSize: 8 }, bodyStyles: { fontSize: 7.5 }, margin: { left: 14, right: 14 },
        didParseCell: (data: any) => { if (data.section === "body" && data.column.index === 3) { if (data.cell.raw === "Atrasada") data.cell.styles.textColor = [220, 50, 50]; else if (data.cell.raw === "Pago") data.cell.styles.textColor = [34, 139, 34]; } },
      });
    }

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(140); doc.text(`Página ${p}/${pages}`, 105, 290, { align: "center" }); }
    doc.save(`extrato_${(client?.name || "cliente").replace(/\s+/g, "_")}.pdf`);
    toast({ title: "PDF gerado!" });
  };

  const buildContractPDF = (c: any) => {
    const doc = new jsPDF();
    const now = new Date();
    const cInsts = installments.filter((i: any) => i.contract_id === c.id);
    const totalContract = Number(c.total_amount || Number(c.installment_amount) * Number(c.num_installments));
    const creditorName = contractSettings?.company_name || "CREDOR";

    doc.setFillColor(20, 20, 25); doc.rect(0, 0, 210, 38, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("CONTRATO DE EMPRÉSTIMO PESSOAL", 14, 16);
    doc.setFontSize(9); doc.setFont("helvetica", "normal");
    doc.text("Instrumento particular de confissão de dívida", 14, 24);
    doc.text(`Contrato #${String(c.id).slice(0, 8)}  |  Início: ${formatBR(c.start_date)}`, 14, 31);

    let y = 46;
    doc.setTextColor(40, 40, 40); doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text("Identificação das Partes", 14, y); y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ["Credor", creditorName],
        ["CNPJ/CPF do credor", contractSettings?.company_cnpj || "—"],
        ["Endereço do credor", contractSettings?.company_address || "—"],
        ["Devedor(a)", client?.name || "—"],
        ["CPF/CNPJ do devedor", client?.cpf_cnpj || "—"],
        ["Contato", client?.phone || client?.whatsapp || client?.email || "—"],
      ],
      theme: "grid", bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 50, fontStyle: "bold" }, 1: { cellWidth: 132 } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text("Condições Contratadas", 14, y); y += 2;
    autoTable(doc, {
      startY: y,
      body: [
        ["Capital emprestado", `R$ ${fmt(Number(c.capital))}`],
        ["Modalidade", LOAN_MODE_LABEL[(c.loan_mode || "installments") as LoanMode] || c.loan_mode],
        ["Frequência", formatFrequency(c.frequency)],
        ["Parcelas", `${c.num_installments}x R$ ${fmt(Number(c.installment_amount))}`],
        ["Taxa contratada", `${Number(c.interest_rate || 0)}% por ${formatFrequency(c.frequency).toLowerCase()}`],
        ["Custo financeiro total", `R$ ${fmt(Number(c.total_interest || Math.max(0, totalContract - Number(c.capital))))}`],
        ["Total a pagar", `R$ ${fmt(totalContract)}`],
        ["Encargo diário por atraso", `${Number(c.daily_interest_percent || 0)}%`],
        ["Limite dos encargos", Number(c.max_interest_cap_percent || 0) > 0 ? `${Number(c.max_interest_cap_percent)}% da parcela` : "Sem limite adicional informado"],
        ["Forma de pagamento", String(c.payment_method || "Não informada").toUpperCase()],
      ],
      theme: "grid", bodyStyles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 70, fontStyle: "bold" }, 1: { cellWidth: 112, halign: "right" } },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    if (cInsts.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text("Cronograma de Pagamentos", 14, y); y += 2;
      autoTable(doc, {
        startY: y,
        head: [["Parcela", "Vencimento", "Valor"]],
        body: cInsts.map((i: any) => [
          String(i.installment_number),
          formatBR(i.due_date),
          `R$ ${fmt(Number(i.amount))}`,
        ]),
        theme: "grid", headStyles: { fillColor: [20, 20, 25], fontSize: 9 }, bodyStyles: { fontSize: 8.5 },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }

    if (y > 205) { doc.addPage(); y = 20; }
    doc.setTextColor(40); doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("Cláusulas Gerais", 14, y); y += 7;
    doc.setFontSize(8.5); doc.setFont("helvetica", "normal");
    const clauses = [
      "1. O devedor declara ter recebido o capital informado e compromete-se a pagar as parcelas nas datas do cronograma.",
      `2. No atraso, incidirão os encargos contratados de ${Number(c.daily_interest_percent || 0)}% ao dia, observado o limite indicado neste documento.`,
      `3. A quitação antecipada é permitida com redução proporcional dos encargos futuros${Number(c.early_payment_discount_percent || 0) > 0 ? ` e desconto adicional de ${Number(c.early_payment_discount_percent)}%` : ""}.`,
      "4. Pagamentos devem ser comprovados por recibo, comprovante bancário ou registro no portal do cliente.",
      "5. A tolerância de uma parte não representa renúncia, novação ou alteração das condições pactuadas.",
      "6. As partes admitem comunicações e assinatura por meios eletrônicos, respeitada a legislação aplicável.",
      "7. Eventuais controvérsias serão submetidas ao foro legalmente competente, preservadas as normas de proteção ao consumidor.",
    ];
    for (const clause of clauses) {
      const lines = doc.splitTextToSize(clause, 182);
      if (y + lines.length * 4.2 > 265) { doc.addPage(); y = 20; }
      doc.text(lines, 14, y); y += lines.length * 4.2 + 2;
    }

    if (y > 225) { doc.addPage(); y = 25; }
    y += 8; doc.setFontSize(9); doc.text(`${creditorName} (Credor)`, 52, y, { align: "center" }); doc.text(`${client?.name || "Devedor(a)"}`, 158, y, { align: "center" });
    y += 15; doc.line(20, y, 84, y); doc.line(126, y, 190, y);
    y += 5; doc.setFontSize(7.5); doc.text("Assinatura do credor", 52, y, { align: "center" }); doc.text("Assinatura do devedor", 158, y, { align: "center" });
    y += 20; doc.line(20, y, 84, y); doc.line(126, y, 190, y);
    y += 5; doc.text("Testemunha 1 · Nome e CPF", 52, y, { align: "center" }); doc.text("Testemunha 2 · Nome e CPF", 158, y, { align: "center" });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(140); doc.text(`Página ${p}/${pages}`, 105, 290, { align: "center" }); }

    return { doc, fileName: `contrato_${(client?.name || "cliente").replace(/\s+/g, "_")}_${String(c.id).slice(0, 6)}.pdf` };
  };

  const exportContractPDF = (c: any) => {
    const { doc, fileName } = buildContractPDF(c);
    doc.save(fileName);
    toast({ title: "PDF do contrato gerado!" });
  };

  const sendContractWhatsApp = async (c: any) => {
    const phone = getPhone();
    if (!phone) { toast({ title: "Cliente sem telefone", variant: "destructive" }); return; }
    const { doc, fileName } = buildContractPDF(c);
    const blob = doc.output("blob");
    const file = new File([blob], fileName, { type: "application/pdf" });

    const nav: any = navigator;
    const canShareFile = typeof nav.canShare === "function" && nav.canShare({ files: [file] });
    const totalContract = Number(c.total_amount || Number(c.installment_amount) * Number(c.num_installments));
    const msgText = `Olá ${client?.name || ""}, segue o contrato:\n\n• Capital: R$ ${fmt(Number(c.capital))}\n• Parcelas: ${c.num_installments}x R$ ${fmt(Number(c.installment_amount))}\n• Total: R$ ${fmt(totalContract)}\n• Início: ${formatBR(c.start_date)}\n\nPDF em anexo.`;

    if (canShareFile) {
      try {
        await nav.share({ files: [file], title: "Contrato", text: msgText });
        toast({ title: "Contrato compartilhado!" });
        return;
      } catch (e: any) {
        if (e?.name === "AbortError") return;
      }
    }

    // Fallback: baixa o PDF e abre o WhatsApp para o usuário anexar manualmente
    doc.save(fileName);
    const msg = encodeURIComponent(`${msgText}\n\n(O PDF foi baixado no seu dispositivo — anexe-o na conversa)`);
    window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
    toast({ title: "PDF baixado", description: "Anexe-o no WhatsApp que abriu." });
  };

  const toggleStatus = async () => {
    const s = client?.status === "Ativo" ? "Inativo" : "Ativo";
    const key = ["client-detail", id, user?.id];
    const prev = qc.getQueryData<any>(key);
    qc.setQueryData(key, (old: any) => (old ? { ...old, status: s } : old));
    toast({ title: `Status: ${s}` });
    const { error } = await supabase.from("clients").update({ status: s }).eq("id", id!);
    if (error) {
      qc.setQueryData(key, prev);
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    }
  };

  const updateScore = async (delta: number) => {
    const ns = Math.max(0, Math.min(100, (client?.credit_score || 0) + delta));
    const key = ["client-detail", id, user?.id];
    const prev = qc.getQueryData<any>(key);
    qc.setQueryData(key, (old: any) => (old ? { ...old, credit_score: ns } : old));
    toast({ title: `Score: ${ns}` });
    const { error } = await supabase.from("clients").update({ credit_score: ns }).eq("id", id!);
    if (error) {
      qc.setQueryData(key, prev);
      toast({ title: "Erro ao atualizar score", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!(await confirm("Excluir este cliente e todos os dados?"))) return;
    const { error } = await supabase.rpc("delete_client_cascade", { _client_id: id! });
    if (error) { toast({ ...friendlyError(error, "Não foi possível excluir o cliente."), variant: "destructive" }); return; }
    toast({ title: "Cliente excluído!" }); navigate("/clientes");
  };

  // --- Novas ações úteis ---

  const duplicateLastLoan = async () => {
    if (!user) return;
    const last = contracts[0];
    if (!last) { toast({ title: "Nenhum empréstimo anterior", variant: "destructive" }); return; }
    if (!(await confirm(`Duplicar último empréstimo de R$ ${fmt(Number(last.capital))} (${last.num_installments}x)?`))) return;
    try {
      const today = todayLocalISO();
      const contractPayload = {
        capital: last.capital, interest_rate: last.interest_rate,
        num_installments: last.num_installments, installment_amount: last.installment_amount,
        frequency: last.frequency, start_date: localNoonISO(today),
        late_fee_percent: last.late_fee_percent, daily_interest_percent: last.daily_interest_percent,
        total_amount: last.total_amount, total_interest: last.total_interest, status: "active",
        loan_mode: last.loan_mode, grace_periods: last.grace_periods,
        notes: `Renovação de contrato anterior (${formatBR(last.start_date)})`,
      };
      const dueDates = generateDueDates(today, last.frequency, last.num_installments);
      await createContractAtomically(supabase as any, {
        clientId: id!,
        contract: contractPayload,
        installments: dueDates.map((dd, i) => ({
          installment_number: i + 1,
          amount: Number(last.installment_amount),
          due_date: dd,
        })),
      });
      toast({ title: "Empréstimo duplicado!" });
      invAll();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const markContact = async () => {
    if (!user) return;
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, amount: 0, type: "contact",
      description: `Contato realizado com ${client?.name}`,
      client_id: id,
    });
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível registrar o contato."), variant: "destructive" });
      return;
    }
    toast({ title: "Contato registrado!" });
    invAll();
  };

  const quickNote = async () => {
    if (!user) return;
    const text = window.prompt("Anotação rápida (aparece no histórico):");
    if (!text || !text.trim()) return;
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id, amount: 0, type: "note",
      description: `📝 ${text.trim()}`,
      client_id: id,
    });
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível salvar a anotação."), variant: "destructive" });
      return;
    }
    toast({ title: "Anotação salva!" });
    invAll();
  };



  if (isLoading) return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );

  if (clientError) return <ErrorState error={clientError} onRetry={() => refetchClient()} />;

  if (!client) return (
    <div className="text-center py-16"><User size={48} className="mx-auto text-muted-foreground/20 mb-4" /><p className="text-muted-foreground">Cliente não encontrado</p></div>
  );

  const address = client.address as any;








  const toolGroups: ToolGroup[] = [
    {
      label: "Contrato",
      actions: [
        { icon: Plus, label: "Novo Empréstimo", description: "Wizard completo com todas as opções", action: () => navigate(`/clientes/novo?clientId=${id}`) },
        { icon: Repeat, label: "Duplicar Último", description: "Renovação rápida com os mesmos valores", action: duplicateLastLoan, disabled: contracts.length === 0 },
        { icon: Layers3, label: "Distribuir Pagamento", description: "Quita as antigas e abate o restante na próxima", action: () => setDistributedPayOpen(true), disabled: kpis.pendingInst.length + kpis.overdueInst.length === 0 },
        { icon: CheckCircle, label: "Quitar Todas", description: "Marca todas as parcelas pendentes como pagas", action: payAllPending },
        { icon: Edit, label: "Editar Cliente", description: "Nome, telefone, CPF, email", action: startEdit },
      ],
    },
    {
      label: "Cobrança",
      actions: [
        { icon: Send, label: "Cobrar Atrasadas", description: `${kpis.overdueInst.length} parcela(s) em atraso via WhatsApp`, action: sendAllOverdue, disabled: kpis.overdueInst.length === 0 },
        { icon: MessageSquare, label: "Enviar Portal", description: "Link do portal do cliente via WhatsApp", action: sendPortalLink },
        { icon: PhoneCall, label: "Marcar Contato", description: "Registra um contato realizado no histórico", action: markContact },
        { icon: StickyNote, label: "Anotação Rápida", description: "Adiciona uma nota no histórico do cliente", action: quickNote },
      ],
    },
    {
      label: "Documentos",
      actions: [
        { icon: Printer, label: "Gerar PDF", description: "Extrato completo do cliente em PDF", action: generatePDF },
        { icon: Download, label: "Exportar Resumo", description: "Copia resumo financeiro para a área de transferência", action: exportSummary },
        { icon: Copy, label: "Copiar Dados", description: "Nome, CPF, telefone e email", action: copyClientInfo },
      ],
    },
    {
      label: "Score & Status",
      actions: [
        { icon: Star, label: "Score +5", description: "Aumenta o score de crédito", action: () => updateScore(5) },
        { icon: TrendingUp, label: "Score -5", description: "Reduz o score de crédito", action: () => updateScore(-5) },
        { icon: Ban, label: client.status === "Ativo" ? "Inativar Cliente" : "Reativar Cliente", description: client.status === "Ativo" ? "Suspende novas operações" : "Volta a aceitar operações", action: toggleStatus },
        { icon: Trash2, label: "Excluir Cliente", description: "Remove cliente e todos os dados — irreversível", action: handleDelete, destructive: true },
      ],
    },
  ];


  const visibleContracts = contracts.filter((contract: any) => {
    const rows = installments.filter((row: any) => row.contract_id === contract.id);
    const settled = rows.length > 0 && rows.every((row: any) => row.status === "paid");
    const matchesStatus = contractFilter === "all" || (contractFilter === "settled" ? settled : !settled && ["active", "overdue"].includes(contract.status));
    const searchable = [fmt(Number(contract.capital)), formatBR(contract.start_date), formatFrequency(contract.frequency), LOAN_MODE_LABEL[contract.loan_mode as LoanMode] || contract.loan_mode].join(" ").toLocaleLowerCase("pt-BR");
    return matchesStatus && searchable.includes(contractSearch.trim().toLocaleLowerCase("pt-BR"));
  });

  const clientCreatedAt = parseLocalDate(client.created_at)?.getTime() ?? NaN;
  const hasValidClientCreatedAt = Number.isFinite(clientCreatedAt);
  const daysAsClient = hasValidClientCreatedAt ? Math.max(1, Math.floor((Date.now() - clientCreatedAt) / 86400000)) : 0;
  const clientSince = hasValidClientCreatedAt ? new Date(clientCreatedAt).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).toUpperCase() : "—";
  const riskLabel = (client.credit_score || 0) >= 75 ? "Baixo Risco" : (client.credit_score || 0) >= 50 ? "Risco Moderado" : (client.credit_score || 0) >= 25 ? "Risco Elevado" : "Risco Alto";

  return (
    <div className="client-profile">
      <div className="client-profile-breadcrumb"><button onClick={() => navigate('/clientes')}><ArrowLeft size={15} /> Clientes</button><ChevronRight size={13} /><span>Ficha do cliente</span></div>
      <header className="client-profile-header">
        <div className="client-profile-identity">
                      <div className="client-profile-avatar relative shrink-0">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-primary/15 bg-primary/10 text-3xl font-extrabold text-primary md:h-24 md:w-24 md:text-4xl"
                   style={{ fontFamily: "'Sora','Space Grotesk',sans-serif" }}>
                {client.avatar_url ? <UploadImage src={client.avatar_url} alt="" className="w-full h-full object-cover" /> : client.name?.charAt(0)?.toUpperCase()}
              </div>
              <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground ring-2 ring-card" title="Trocar foto">
                <Camera size={12} className="text-primary-foreground" />
                <input type="file" accept="image/*" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.currentTarget.value = "";
                  if (!file || !id || !user) return;
                  const extensions: Record<string, string> = {
                    "image/jpeg": "jpg",
                    "image/png": "png",
                    "image/webp": "webp",
                  };
                  const ext = extensions[file.type];
                  if (!ext) {
                    toast({ title: "Formato de foto não suportado", description: "Envie uma imagem JPG, PNG ou WebP.", variant: "destructive" });
                    return;
                  }
                  if (file.size > 5 * 1024 * 1024) {
                    toast({ title: "Foto muito grande", description: "O tamanho máximo é de 5 MB.", variant: "destructive" });
                    return;
                  }
                  const path = `${user.id}/client-avatars/${id}.${ext}`;
                  const { error: upErr } = await supabase.storage.from("uploads").upload(path, file, {
                    upsert: true,
                    contentType: file.type,
                    cacheControl: "3600",
                  });
                  if (!upErr) {
                    const url = await getSignedUploadUrl(path);
                    if (!url) {
                      toast({ title: "Não foi possível carregar a foto", variant: "destructive" });
                      return;
                    }
                    const { error: updateError } = await supabase.from("clients").update({ avatar_url: url })
                      .eq("id", id).eq("user_id", user!.id);
                    if (updateError) {
                      toast({ title: "Não foi possível salvar a foto", description: updateError.message, variant: "destructive" });
                      return;
                    }
                    inv("client-detail");
                    toast({ title: "✓ Foto atualizada!" });
                  } else {
                    toast({ title: "Erro no upload", description: upErr.message, variant: "destructive" });
                  }
                }} className="sr-only" aria-label="Trocar foto do cliente" />
              </label>
            </div>


          <div className="min-w-0">
            <span className="client-profile-eyebrow">RELACIONAMENTO · CREDMAIS</span>
            <h1>{client.name}</h1>
            <div className="client-profile-meta"><span className={client.status === 'Ativo' ? 'client-profile-status' : ''}><span aria-hidden="true">●</span> {client.status}</span><span>Cliente desde {clientSince.toLowerCase()}</span>{client.cpf_cnpj && <span className="font-mono">{client.cpf_cnpj}</span>}</div>
          </div>
        </div>
        <div className="client-profile-primary-actions">
          <button className="client-profile-button is-primary" onClick={() => navigate(`/clientes/novo?clientId=${id}`)}><Plus size={17} /> Novo empréstimo</button>
          <button className="client-profile-button" onClick={() => setDistributedPayOpen(true)} disabled={kpis.remaining <= 0}><Wallet size={16} /> Registrar pagamento</button>
          <ClientToolsPanel open={showMoreActions} onOpenChange={setShowMoreActions} groups={toolGroups} trigger={<button className="client-profile-button is-icon" aria-label="Mais ações do cliente"><MoreHorizontal size={20} /></button>} />
        </div>
      </header>
      <section className="client-profile-metrics" aria-label="Resumo financeiro">
        {[
          {label:'Saldo em aberto',value:kpis.remaining,detail:`${kpis.pendingInst.length + kpis.overdueInst.length} parcelas a receber`,Icon:Wallet,featured:true},
          {label:'Capital em aberto',value:kpis.totalCapital,detail:'Capital liberado menos principal devolvido',Icon:FileText},
          {label:'Total recebido',value:kpis.totalPaid,detail:`${kpis.receiptCount} recebimentos registrados`,Icon:CheckCircle},
          {label:'Juros e encargos recebidos',value:kpis.totalProfit,detail:'Composição comprovada dos recebimentos',Icon:TrendingUp},
        ].map(metric => <article key={metric.label} className={metric.featured ? 'is-featured' : ''}><div className="client-profile-metric-label"><span>{metric.label}</span><metric.Icon size={17} /></div><p><span>R$</span> {financialReady&&metric.value!=null?fmt(metric.value):"—"}</p><small>{metric.detail}</small></article>)}
      </section>

      {financialFailure&&<div role="alert" className="rounded-xl border border-border p-4 text-sm">Não foi possível conferir os recebimentos. <button type="button" onClick={()=>{void refetchCash();inv('client-contracts');inv('client-installments');}} className="underline">Conferir novamente</button></div>}
      {financialReady&&((kpis.unclassified||0)>0||(kpis.undated||0)>0||kpis.missingDisbursements>0)&&<p role="status" className="rounded-xl border border-border p-4 text-sm">{(kpis.unclassified||0)>0&&`R$ ${fmt(kpis.unclassified!)} recebidos sem classificação de principal, juros e encargos. `}{(kpis.undated||0)>0&&`R$ ${fmt(kpis.undated!)} recebidos sem data válida; fora do gráfico mensal. `}{kpis.missingDisbursements>0&&`${kpis.missingDisbursements} contrato(s) sem liberação comprovada no caixa.`}</p>}

      <nav className="client-profile-action-strip" aria-label="Ações rápidas do cliente">
        <button onClick={() => { const phone = getPhone(); if (phone) window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer'); }}><span className="action-icon whatsapp"><MessageSquare size={20}/></span><span><strong>WhatsApp</strong><small>Enviar mensagem</small></span></button>
        <button onClick={() => { const phone = getPreferredPhone(client); if (phone) window.open(`tel:${phone.replace(/\D/g,'')}`, '_self'); }} disabled={!getPreferredPhone(client)}><span className="action-icon phone"><Phone size={20}/></span><span><strong>Ligar</strong><small>Fazer ligação</small></span></button>
        <button onClick={() => { if (client.email) window.open(`mailto:${client.email}`, '_self'); }} disabled={!client.email}><span className="action-icon mail"><Mail size={20}/></span><span><strong>E-mail</strong><small>Enviar e-mail</small></span></button>
        <button onClick={sendPortalLink}><span className="action-icon portal"><Send size={20}/></span><span><strong>Portal</strong><small>Acessar portal</small></span></button>
        <button onClick={() => navigate(`/clientes/novo?clientId=${id}`)}><span className="action-icon loan"><FileText size={20}/></span><span><strong>Empréstimo</strong><small>Novo empréstimo</small></span></button>
        <button onClick={() => setShowMoreActions(true)}><span className="action-icon tools"><Wrench size={20}/></span><span><strong>Mais ações</strong><small>Outras opções</small></span></button>
        <button onClick={startEdit}><span className="action-icon edit"><Edit size={20}/></span><span><strong>Editar</strong><small>Editar cliente</small></span></button>
      </nav>

      <nav className="client-profile-tab-strip" aria-label="Seções da ficha">
        <button type="button" className={`tab-overview ${activeSection === "overview" ? "is-active" : ""}`} aria-current={activeSection === "overview" ? "page" : undefined} title="Resumo financeiro, cadastro e indicadores" onClick={() => { setActiveSection("overview"); setSectionDialog(null); }}><Wallet size={15}/> <span>Visão geral<small>Resumo</small></span></button>
        <button type="button" className={`tab-loans ${activeSection === "loans" ? "is-active" : ""}`} aria-current={activeSection === "loans" ? "page" : undefined} title="Ver contratos e parcelas do cliente" onClick={() => { setActiveSection("loans"); setSectionDialog("loans"); }}><FileText size={15}/> <span>Empréstimos<small>Contratos</small></span> <b>{contracts.length}</b></button>
        <button type="button" className={`tab-payments ${activeSection === "payments" ? "is-active" : ""}`} aria-current={activeSection === "payments" ? "page" : undefined} title="Acompanhar parcelas pagas, abertas e atrasadas" onClick={() => { setActiveSection("payments"); setSectionDialog("payments"); }}><CreditCard size={15}/> <span>Pagamentos<small>Parcelas</small></span> <b>{kpis.paidInst.length}</b></button>
        <button type="button" className={`tab-info ${activeSection === "info" ? "is-active" : ""}`} aria-current={activeSection === "info" ? "page" : undefined} title="Consultar dados cadastrais do cliente" onClick={() => { setActiveSection("info"); setSectionDialog("info"); }}><Info size={15}/> <span>Informações<small>Cadastro</small></span></button>
        <button type="button" className={`tab-stats ${activeSection === "stats" ? "is-active" : ""}`} aria-current={activeSection === "stats" ? "page" : undefined} title="Analisar desempenho e taxa de pagamento" onClick={() => { setActiveSection("stats"); setSectionDialog("stats"); }}><BarChart3 size={15}/> <span>Estatísticas<small>Desempenho</small></span></button>
        <button type="button" className={`tab-history ${activeSection === "history" ? "is-active" : ""}`} aria-current={activeSection === "history" ? "page" : undefined} title="Ver atividades e movimentações" onClick={() => { setActiveSection("history"); setHistOpen(true); }}><Clock size={15}/> <span>Histórico<small>Atividades</small></span></button>
        <button type="button" className={`tab-docs ${activeSection === "docs" ? "is-active" : ""}`} aria-current={activeSection === "docs" ? "page" : undefined} title="Consultar documentos e anexos" onClick={() => { setActiveSection("docs"); setDocsOpen(true); }}><FileIcon size={15}/> <span>Documentos<small>Anexos</small></span></button>
      </nav>

      <Dialog open={sectionDialog !== null} onOpenChange={(open) => !open && setSectionDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{sectionDialog === "loans" ? "Empréstimos e contratos" : sectionDialog === "payments" ? "Pagamentos e parcelas" : sectionDialog === "info" ? "Informações do cliente" : "Estatísticas do cliente"}</DialogTitle></DialogHeader>
          {sectionDialog === "loans" && <div className="space-y-3">{contracts.map((c: any) => <div key={c.id} className="rounded-xl border border-border/60 bg-muted/20 p-3"><div className="flex items-center justify-between gap-3"><strong>R$ {fmt(Number(c.capital))}</strong><Badge variant="outline">{c.status === "active" ? "Em andamento" : "Encerrado"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{c.num_installments} parcelas · {formatFrequency(c.frequency)} · início {formatBR(c.start_date)}</p></div>)}</div>}
          {sectionDialog === "payments" && <div className="space-y-2">{installments.map((i: any, index: number) => <div key={i.id || index} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"><div><strong>Parcela {index + 1}</strong><p className="text-xs text-muted-foreground">Vencimento {formatBR(i.due_date)}</p></div><Badge variant="outline">{i.status === "paid" ? "Paga" : i.status === "overdue" ? "Em atraso" : "Em aberto"}</Badge></div>)}</div>}
          {sectionDialog === "info" && <div className="grid gap-3 sm:grid-cols-2">{[["Telefone", getPreferredPhone(client) || "Não informado"], ["E-mail", client.email || "Não informado"], ["CPF/CNPJ", client.cpf_cnpj || "Não informado"], ["Endereço", address?.street || "Não informado"]].map(([label, value]) => <div key={label} className="rounded-xl border border-border/60 p-3"><small>{label}</small><strong className="mt-1 block">{value}</strong></div>)}</div>}
          {sectionDialog === "stats" && <div className="grid gap-3 sm:grid-cols-2">{[["Contratos", contracts.length], ["Parcelas pagas", `${kpis.paidInst.length}/${installments.length}`], ["Taxa de atraso", `${installments.length ? Math.round((kpis.overdueInst.length / installments.length) * 100) : 0}%`], ["Ticket médio", `R$ ${fmt(kpis.ticketMedio)}`]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border/60 p-3"><small>{label}</small><strong className="mt-1 block text-lg">{value}</strong></div>)}</div>}
        </DialogContent>
      </Dialog>

      <section id="resumo" className="client-profile-reference-layout" aria-label="Visão geral do cliente">
        <article className="reference-card reference-summary-card">
          <div className="reference-card-heading"><div><span className="client-profile-eyebrow">RESUMO FINANCEIRO</span><h2>Visão geral dos valores</h2></div><span className="reference-select">Últimos 6 meses</span></div>
          <ClientReceiptChart months={kpis.monthly}/>
          <div className="reference-summary-legend"><span><i className="dot green"/> {financialReady?moneyLike(kpis.totalPaid!):"—"}<small>Total recebido</small></span><span><i className="dot gold"/> {financialReady?moneyLike(kpis.totalCapital!):"—"}<small>Capital em aberto</small></span><span><i className="dot blue"/> {financialReady?moneyLike(kpis.totalProfit!):"—"}<small>Juros e encargos recebidos</small></span></div>
        </article>
        <article id="info-cliente" className="reference-card reference-info-card"><div className="reference-card-heading"><div><span className="client-profile-eyebrow">CADASTRO</span><h2>Informações do cliente</h2></div><button className="reference-select" onClick={startEdit}><Edit size={14}/> Editar</button></div><div className="reference-info-grid"><InfoCell icon={Phone} label="Telefone" value={getPreferredPhone(client) || 'Adicionar'} /><InfoCell icon={MessageSquare} label="WhatsApp" value={getPhone() || 'Adicionar'} tone="green"/><InfoCell icon={Mail} label="E-mail" value={client.email || 'Adicionar'} tone="gold"/><InfoCell icon={User} label="CPF/CNPJ" value={client.cpf_cnpj || 'Adicionar'} tone="violet"/><InfoCell icon={MapPin} label="Endereço" value={address?.street ? `${address.street}${address.number ? `, ${address.number}` : ''}` : 'Adicionar'} tone="red"/><InfoCell icon={Building2} label="Cidade" value={address?.city || 'Adicionar'} tone="blue"/></div><div className="reference-info-footer"><InfoCell icon={Calendar} label="Cliente desde" value={clientSince} tone="gold"/><InfoCell icon={Clock} label="Última atividade" value="Hoje" tone="slate"/></div></article>
        <article id="estatisticas" className="reference-card reference-stats-card"><div className="reference-card-heading"><div><span className="client-profile-eyebrow">PERFORMANCE</span><h2>Estatísticas</h2></div><button className="reference-select">Ver mais <ChevronRight size={14}/></button></div><div className="reference-stat-grid"><StatCell icon={FileText} value={String(contracts.length)} label="Contratos"/><StatCell icon={CheckCircle} value={`${kpis.paidInst.length}/${installments.length || 0}`} label="Parcelas pagas" tone="green"/><StatCell icon={Clock} value={`${kpis.overdueInst.length ? Math.round((kpis.overdueInst.length / Math.max(1, installments.length)) * 100) : 0}%`} label="Taxa de atraso" tone="red"/><StatCell icon={CircleDollarSign} value={moneyLike(kpis.ticketMedio)} label="Ticket médio" tone="gold"/></div><div className="reference-donut-row"><div className="reference-donut" style={{'--progress':`${Math.round((kpis.paidInst.length / Math.max(1, installments.length)) * 100)}%`} as React.CSSProperties}><strong>{Math.round((kpis.paidInst.length / Math.max(1, installments.length)) * 100)}%</strong><small>Taxa de pagamento</small></div><div className="reference-key"><span><i className="dot green"/>Pagas <b>{kpis.paidInst.length}</b></span><span><i className="dot gold"/>Em aberto <b>{kpis.pendingInst.length}</b></span><span><i className="dot red"/>Atrasadas <b>{kpis.overdueInst.length}</b></span><span><i className="dot slate"/>Total <b>{installments.length}</b></span></div></div></article>
        <article className="reference-card reference-loans-card"><div className="reference-card-heading"><div><span className="client-profile-eyebrow">HISTÓRICO</span><h2>Últimos empréstimos</h2><p>Histórico de empréstimos do cliente</p></div><button className="client-profile-button is-primary" onClick={() => navigate(`/clientes/novo?clientId=${id}`)}><Plus size={15}/> Novo empréstimo</button></div><div className="reference-table-wrap"><table className="reference-loans-table"><thead><tr><th>#</th><th>Valor</th><th>Parcelas</th><th>Início</th><th>Vencimento</th><th>Status</th><th>Lucro</th><th>Ações</th></tr></thead><tbody>{contracts.slice(0,5).map((c:any)=>{const ci=installments.filter((i:any)=>i.contract_id===c.id);const paid=ci.filter((i:any)=>i.status==='paid').length;const late=ci.filter((i:any)=>i.status==='overdue').length;const last=ci[ci.length-1];return <tr key={c.id}><td className="font-mono">#{String(c.id).slice(0,6).toUpperCase()}</td><td><strong>{moneyLike(c.capital)}</strong></td><td>{paid}/{ci.length} parcelas</td><td>{formatBR(c.start_date)}</td><td>{last?.due_date?formatBR(last.due_date):'—'}</td><td><span className={`reference-status ${late?'late':paid===ci.length?'paid':'open'}`}><i/>{late?`${late} em atraso`:paid===ci.length?'Quitado':'Em andamento'}</span></td><td className="reference-profit">+{moneyLike(Number(c.total_interest || 0))}</td><td><div className="reference-row-actions"><button type="button" onClick={()=>focusContract(c.id)} aria-label="Visualizar contrato"><Eye size={15}/></button><button type="button" onClick={()=>openEditContract(c)} aria-label="Editar contrato"><Edit size={15}/></button><button type="button" onClick={()=>setShowMoreActions(true)} aria-label="Mais ações"><MoreHorizontal size={15}/></button></div></td></tr>})}</tbody></table></div></article>
      </section>

      {/* ===== MODALS ===== */}

      {editMode && (
        <EditClienteModal
          editData={editData}
          setEditData={setEditData}
          onClose={() => setEditMode(false)}
          onSave={saveEdit}
        />
      )}

      {editAddressMode && (
        <EditAddressModal
          addrData={addrData}
          setAddrData={setAddrData}
          onClose={() => setEditAddressMode(false)}
          onSave={saveAddress}
          onBuscarCep={buscarCep}
        />
      )}

      {newLoanMode && (
        <NovoEmprestimoModal
          clientName={client.name}
          loanMode={loanMode}
          setLoanMode={setLoanMode}
          loanGracePeriods={loanGracePeriods}
          setLoanGracePeriods={setLoanGracePeriods}
          loanCapital={loanCapital}
          setLoanCapital={setLoanCapital}
          loanInstallments={loanInstallments}
          setLoanInstallments={setLoanInstallments}
          loanInterestRate={loanInterestRate}
          setLoanInterestRate={setLoanInterestRate}
          loanFreq={loanFreq}
          setLoanFreq={setLoanFreq}
          loanStartDate={loanStartDate}
          setLoanStartDate={setLoanStartDate}
          loanStart={loanStart}
          setLoanStart={setLoanStart}
          loanDailyFee={loanDailyFee}
          setLoanDailyFee={setLoanDailyFee}
          loanLateFee={loanLateFee}
          setLoanLateFee={setLoanLateFee}
          loanNotes={loanNotes}
          setLoanNotes={setLoanNotes}
          loanGraceDays={loanGraceDays}
          setLoanGraceDays={setLoanGraceDays}
          loanPaymentMethod={loanPaymentMethod}
          setLoanPaymentMethod={setLoanPaymentMethod}
          loanEarlyDiscount={loanEarlyDiscount}
          setLoanEarlyDiscount={setLoanEarlyDiscount}
          loanMaxInterestCap={loanMaxInterestCap}
          setLoanMaxInterestCap={setLoanMaxInterestCap}
          loanValueMode={loanValueMode}
          setLoanValueMode={setLoanValueMode}
          loanInstallmentValue={loanInstallmentValue}
          setLoanInstallmentValue={setLoanInstallmentValue}
          loanDailyMode={loanDailyMode}
          setLoanDailyMode={setLoanDailyMode}
          loanFirstDueAuto={loanFirstDueAuto}
          setLoanFirstDueAuto={setLoanFirstDueAuto}
          loanCustomDates={loanCustomDates}
          setLoanCustomDates={setLoanCustomDates}
          loanCalc={loanCalc}
          loanLoading={loanLoading}
          loanDocuments={loanDocuments}
          setLoanDocuments={setLoanDocuments}
          onClose={() => { setNewLoanMode(false); setLoanDocuments([]); }}
          onSubmit={handleCreateLoan}
        />
      )}

      {editContract && (
        <EditContratoModal
          form={editContractForm}
          setForm={setEditContractForm}
          regen={editContractRegen}
          setRegen={setEditContractRegen}
          saving={editContractSaving}
          onClose={() => setEditContract(null)}
          onSave={handleSaveContract}
        />
      )}

      {editInst && (
        <EditParcelaModal
          inst={editInst}
          form={editInstForm}
          setForm={setEditInstForm}
          saving={editInstSaving}
          onClose={() => setEditInst(null)}
          onSave={handleSaveInst}
        />
      )}

      {partialPayModal && (() => {
        const c: any = (contracts as any[]).find((ct: any) => ct.id === partialPayModal.contract_id);
        const remainingDue = portalInstallmentAmount({
          ...partialPayModal,
          daily_interest_percent: c?.daily_interest_percent,
          max_interest_cap_percent: c?.max_interest_cap_percent,
        });
        const feeTotal = computeLateFeeBreakdown({
          ...partialPayModal,
          daily_interest_percent: c?.daily_interest_percent,
          max_interest_cap_percent: c?.max_interest_cap_percent,
        }).total;
        const interestOnly = interestOnlyAmount(partialPayModal, c, feeTotal);
        return (
          <PagamentoModal
            inst={partialPayModal}
            amount={partialAmount}
            setAmount={setPartialAmount}
            method={payMethod}
            setMethod={setPayMethod}
            receiptFile={payReceiptFile}
            setReceiptFile={setPayReceiptFile}
            uploading={payUploading}
            interestOnly={interestOnly}
            loanMode={c?.loan_mode}
            frequency={c?.frequency}
            remainingDue={remainingDue}
            feeTotal={feeTotal}
            onFeeDiscount={setPayFeeDiscount}
            onClose={() => { setPartialPayModal(null); setPayReceiptFile(null); setPayMethod("pix"); setPayFeeDiscount(0); }}
            onSubmit={handlePartialPay}
            onRenewInterest={handleInterestRenewal}
          />
        );
      })()}

      {distributedPayOpen && (
        <PagamentoDistribuidoModal
          installments={installments}
          loading={payUploading}
          onClose={() => setDistributedPayOpen(false)}
          onConfirm={handleDistributedPayment}
        />
      )}

      {renegotiating && (
        <RenegociarModal
          contract={renegotiating}
          installments={installments.filter((i: any) => i.contract_id === renegotiating.id)}
          clientName={client?.name || ""}
          onClose={() => setRenegotiating(null)}
          onConfirm={handleRenegotiate}
        />
      )}




      <div className="client-profile-grid">
        <aside className="client-profile-sidebar">
          <section className="client-profile-panel">
            <div className="client-profile-section-heading"><h2>Dados do cliente</h2><button onClick={startEdit} aria-label="Editar dados do cliente"><Edit size={16} /></button></div>
            <dl className="client-profile-contact">
              <div><dt><Phone size={14} /> Telefone</dt><dd>{getPreferredPhone(client) || 'Não informado'}</dd></div>
              <div><dt><Mail size={14} /> E-mail</dt><dd>{client.email || 'Não informado'}</dd></div>
              <div><dt><MapPin size={14} /> Endereço <button onClick={startEditAddress} aria-label="Editar endereço"><Edit size={12} /></button></dt><dd>{address?.street ? `${address.street}${address.number ? `, ${address.number}` : ''}` : 'Não informado'}{address?.city && <small>{address.neighborhood ? `${address.neighborhood} · ` : ''}{address.city}/{address.state}</small>}</dd></div>
            </dl>
            <button className="client-profile-button is-whatsapp" disabled={!getPhone()} onClick={() => { const phone = getPhone(); if (phone) window.open(`https://wa.me/${phone}`, '_blank', 'noopener,noreferrer'); }}><MessageSquare size={16} /> Conversar no WhatsApp</button>
            <div className="client-profile-contact-actions"><button disabled={!getPreferredPhone(client)} onClick={() => {const phone=getPreferredPhone(client);if(phone)window.open(`tel:${phone.replace(/\D/g,'')}`,'_self');}}><Phone size={14} /> Ligar</button><button disabled={!client.email} onClick={() => {if(client.email)window.open(`mailto:${client.email}`,'_self');}}><Mail size={14} /> E-mail</button><button onClick={sendPortalLink}><Send size={14} /> Enviar portal</button></div>
          </section>
          <section className="client-profile-panel">
            <div className="client-profile-section-heading"><h2>Relacionamento</h2><ShieldCheck size={17} className="text-primary" /></div>
            <div className="client-profile-score"><span>Score cadastrado</span><strong>{client.credit_score ?? 0}<small>/100</small></strong></div>
            <div className="client-profile-score-track" aria-hidden="true"><span style={{width:`${Math.max(0,Math.min(100,client.credit_score || 0))}%`}} /></div>
            <div className="client-profile-meta mt-3"><span>{riskLabel}</span><span>{daysAsClient} dias de relacionamento</span></div>
            <div className="client-profile-stat-row"><span>Parcelas pagas</span><strong>{kpis.paidInst.length} de {installments.length}</strong></div>
            <div className="client-profile-stat-row"><span>Ticket médio</span><strong>R$ {fmt(kpis.ticketMedio)}</strong></div>
          </section>
          <section className="client-profile-panel client-profile-shortcuts" aria-label="Arquivos e acompanhamento">
            <button onClick={() => setDocsOpen(true)}><span className="client-profile-shortcut-icon"><FileIcon size={18} /></span><span><strong>Documentos</strong><small>{clientDocs.length} arquivos anexados</small></span><ChevronRight size={16} /></button>
            <button onClick={() => setHistOpen(true)}><span className="client-profile-shortcut-icon"><Clock size={18} /></span><span><strong>Histórico</strong><small>Atividades e movimentações</small></span><ChevronRight size={16} /></button>
            <button onClick={quickNote}><span className="client-profile-shortcut-icon"><StickyNote size={18} /></span><span><strong>Nova anotação</strong><small>Registre algo importante</small></span><Plus size={16} /></button>
          </section>
        </aside>
        <div className="client-profile-main">
          <section className={`client-profile-followup ${kpis.overdueInst.length > 0 ? 'has-overdue' : ''}`}>
            <div className="client-profile-followup-icon">{kpis.overdueInst.length > 0 ? <AlertTriangle size={22} /> : <Calendar size={22} />}</div>
            <div className="min-w-0 flex-1"><span className="client-profile-eyebrow">ACOMPANHAMENTO</span><h2>{kpis.overdueInst.length > 0 ? `${kpis.overdueInst.length} parcelas precisam de atenção` : kpis.nextDueInst ? `Próximo vencimento · ${formatBR(kpis.nextDueInst.due_date)}` : 'Tudo em dia por aqui'}</h2><p>{kpis.overdueInst.length > 0 ? `R$ ${fmt(kpis.totalOverdue)} em atraso. Consulte as parcelas antes de cobrar.` : kpis.nextDueInst ? `Parcela de R$ ${fmt(Number(kpis.nextDueInst.amount))}. Acompanhe os detalhes do contrato abaixo.` : 'Nenhuma parcela pendente. O histórico do cliente continua disponível.'}</p></div>
            {kpis.overdueInst.length > 0 && <button className="client-profile-button" onClick={sendAllOverdue}><Send size={15} /> Cobrar atrasadas</button>}
          </section>
          <section className="client-profile-contract-toolbar" aria-label="Filtrar contratos">
            <div className="client-profile-section-heading"><div><span className="client-profile-eyebrow">CARTEIRA DO CLIENTE</span><h2>Contratos <span>{contracts.length}</span></h2></div><button className="client-profile-button" onClick={generatePDF}><Download size={15} /> Extrato PDF</button></div>
            <div className="client-profile-filters"><div className="client-profile-filter-options">{([{value:'all',label:'Todos'},{value:'active',label:'Em andamento'},{value:'settled',label:'Quitados'}] as const).map(filter => <button key={filter.value} aria-pressed={contractFilter === filter.value} onClick={() => setContractFilter(filter.value)}>{filter.label}</button>)}</div><label className="client-profile-search"><Search size={16} /><input value={contractSearch} onChange={e => setContractSearch(e.target.value)} placeholder="Valor, data ou modalidade" aria-label="Buscar contrato" />{contractSearch && <button onClick={() => setContractSearch('')} aria-label="Limpar busca"><X size={14} /></button>}</label></div>
          </section>

      {/* Modal de Documentos & Anexos */}
      <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><FileIcon size={14} /></div>
              Documentos & Anexos
              {clientDocs.length > 0 && <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{clientDocs.length}</span>}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-semibold cursor-pointer hover:bg-primary/20 transition-all ${docUploading ? "opacity-60 pointer-events-none" : ""}`}>
              <UploadCloud size={14} /> {docUploading ? "Enviando..." : "Anexar arquivo"}
              <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.currentTarget.value = ""; }} />
            </label>

            {clientDocsError ? <ErrorState error={clientDocsError} onRetry={()=>refetchDocs()}/> : clientDocs.length === 0 ? (
              <EmptyState compact icon={FileIcon} title="Nenhum documento anexado" description="RG, comprovante de renda, contrato assinado..." />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto pr-1">
                {clientDocs.map((d: any) => {
                  const documentName = String(d.name || "documento");
                  const isImg = /\.(png|jpe?g|gif|webp|heic)$/i.test(documentName);
                  return (
                    <div key={d.path} className="group relative flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-background/40 hover:border-primary/40 transition-colors">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isImg ? "bg-violet-500/10 text-violet-400" : "bg-sky-500/10 text-sky-400"}`}>
                        {isImg ? <ImageIcon size={14} /> : <FileIcon size={14} />}
                      </div>
                      <button type="button" onClick={() => signedUrl(d.path)} className="flex-1 min-w-0 text-left">
                        <p className="text-[11px] text-foreground font-semibold truncate">{documentName.replace(/^\d+-/, "")}</p>
                        <p className="text-[9px] text-muted-foreground">{d.metadata?.size ? `${Math.round(d.metadata.size / 1024)} KB` : ""}</p>
                      </button>
                      <button type="button" onClick={() => deleteDoc(d.path)} className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-destructive/10 text-destructive transition-opacity" title="Remover">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>





      {/* Section: Contratos */}
      <section id="sec-contratos" className="scroll-mt-24">{(


        <div className="space-y-3">
          <button
            onClick={() => navigate(`/clientes/novo?clientId=${id}`)}
            className="group w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl border border-dashed border-border/70 bg-card/30 text-sm font-semibold text-muted-foreground hover:border-primary/50 hover:bg-primary/5 hover:text-primary transition-all"
          >
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Plus size={14} strokeWidth={2.5} />
            </span>
            Novo Empréstimo
          </button>

          {contracts.length === 0 ? (
            <EmptyState compact title="Nenhum contrato" description="Clique em Novo Empréstimo para começar." />
          ) : visibleContracts.length === 0 ? (
            <EmptyState compact title="Nenhum contrato encontrado" description="Tente outro valor, data ou filtro." />
          ) : visibleContracts.map((c: any) => {
            const cInsts = installments.filter((i: any) => i.contract_id === c.id);
            const total = cInsts.length;
            const paid = cInsts.filter((i: any) => i.status === "paid").length;
            const overdue = cInsts.filter((i: any) => i.status === "overdue").length;
            const isPaid = total > 0 && paid === total;
            const status = isPaid
              ? { label: "Quitado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", dot: "bg-emerald-500" }
              : overdue > 0
              ? { label: `${overdue} em atraso`, cls: "bg-destructive/15 text-destructive border-destructive/25", dot: "bg-destructive" }
              : { label: `${paid}/${total} pagas`, cls: "bg-amber-500/15 text-amber-400 border-amber-500/25", dot: "bg-amber-400" };
            const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((paid / total) * 100))) : 0;
            const barColor = isPaid ? "bg-emerald-500" : overdue > 0 ? "bg-destructive" : "bg-primary";
            const isExpanded = expandedContracts.has(c.id);
            return (
            <div id={`contract-${c.id}`} key={c.id} className={`client-profile-contract group relative overflow-hidden rounded-2xl border bg-card/55 transition-colors ${isExpanded ? "border-primary/40" : "border-border/50 hover:border-primary/30"}`}>
              {/* Faixa lateral de status */}
              <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${barColor}`} />

              {/* Header clicável — abre/recolhe parcelas */}
              <button
                type="button"
                onClick={() => toggleContract(c.id)}
                aria-expanded={isExpanded}
                aria-controls={`contract-installments-${c.id}`}
                className="w-full text-left p-4 pl-5 hover:bg-accent/20 transition-colors"
              >
                {/* Linha superior: valor + status + lucro */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xl font-bold text-foreground tracking-tight tabular-nums leading-none">R$ {fmt(Number(c.capital))}</p>
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${status.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40 text-foreground/80 font-semibold tabular-nums">{c.num_installments}× R$ {fmt(Number(c.installment_amount))}</span>
                      <span className="opacity-40">·</span>
                      <span>{formatFrequency(c.frequency)}</span>
                      <span className="opacity-40">·</span>
                      <span className="tabular-nums">{formatBR(c.start_date)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Lucro</p>
                    <p className="text-base font-bold text-primary tabular-nums leading-tight">+R$ {fmt(Number(c.total_interest))}</p>
                  </div>
                </div>

                {/* Progresso */}
                {total > 0 && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-1 rounded-full bg-muted/50 overflow-hidden">
                      <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground tabular-nums shrink-0">
                      {paid}/{total} · {pct}%
                    </span>
                  </div>
                )}
              </button>

              {/* Barra de ações */}
              <div className="px-4 pl-5 pb-3 flex items-center gap-1 flex-wrap">
                {c.status === "active" && !isPaid && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenegotiating(c); }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-amber-500/10 text-amber-400 text-[11px] font-semibold transition-colors"
                    title="Renegociar contrato"
                  >
                    <Repeat size={12} /> Renegociar
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); sendContractWhatsApp(c); }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-emerald-500/10 text-emerald-500 text-[11px] font-semibold transition-colors"
                  title="Enviar detalhes por WhatsApp"
                >
                  <MessageSquare size={12} /> Enviar
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); exportContractPDF(c); }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground text-[11px] font-semibold transition-colors"
                  title="Exportar PDF"
                >
                  <Download size={12} /> PDF
                </button>

                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditContract(c); }}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                    title="Editar empréstimo"
                  >
                    <Edit size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteContract(c.id); }}
                    className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Excluir empréstimo"
                  >
                    <Trash2 size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleContract(c.id); }}
                    className="ml-1 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-bold transition-colors"
                  >
                    {isExpanded ? "Recolher" : `${total} parcelas`}
                    <ChevronDown size={12} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Parcelas inline (expandable) */}
              {expandedContracts.has(c.id) && (
                <div id={`contract-installments-${c.id}`} className="client-profile-installments border-t border-border/40 bg-background/30 p-3 space-y-2">
                  {cInsts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhuma parcela</p>
                  ) : cInsts.map((inst: any) => {
                    const isOverdue = inst.status === "overdue";
                    const isPaid = inst.status === "paid";
                    const partial = !isPaid && Number(inst.paid_amount || 0) > 0;
                    const dailyPct = Number(c.daily_interest_percent || 0);
                    const base = Number(inst.amount || 0);
                    const paidAmount = Number(inst.paid_amount || 0);
                    const feeInput = {
                      amount: base, due_date: inst.due_date, status: inst.status, late_fee: inst.late_fee,
                      paid_amount: paidAmount,
                      daily_interest_percent: dailyPct,
                      max_interest_cap_percent: c.max_interest_cap_percent,
                    };
                    const fee = computeLateFeeBreakdown(feeInput);
                    const feeLive = fee.total;
                    const daysOverdue = fee.daysLate;
                    const baseOutstanding = Math.max(0, base - paidAmount);
                    const totalDue = outstandingDue(feeInput);
                    // Uma parcela "paga" deveria ter recebido base + a multa/juros
                    // gravada no momento da baixa (inst.late_fee, já congelada).
                    // Se paid_amount ficou abaixo disso, algo fechou a parcela
                    // sem cobrir o total devido — mostra isso em vez de "Pago"
                    // silencioso, que escondia exatamente esse tipo de saldo.
                    const owedAtSettlement = Math.round((base + Number(inst.late_fee || 0)) * 100) / 100;
                    const paidShortfall = isPaid ? Math.max(0, Math.round((owedAtSettlement - paidAmount) * 100) / 100) : 0;
                    return (
                      <div key={inst.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${isOverdue ? "bg-destructive/4 border-destructive/20" : isPaid ? "bg-success/4 border-success/15" : "bg-card border-border/60"}`}>
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${isOverdue ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20" : isPaid ? "bg-success/10 text-success ring-1 ring-success/20" : "bg-muted text-muted-foreground"}`}>
                          {inst.installment_number}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <p className="text-sm font-bold text-foreground tabular-nums">
                              R$ {fmt(partial ? baseOutstanding : paidShortfall > 0.01 ? paidAmount : base)}
                            </p>
                            {isOverdue && feeLive > 0 && (
                              <>
                                <span className="text-[10px] font-medium text-destructive/80 tabular-nums">+ R$ {fmt(feeLive)}</span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive tabular-nums">
                                  <span className="opacity-50">=</span> R$ {fmt(totalDue)}
                                </span>
                              </>
                            )}
                            {paidShortfall > 0.01 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning tabular-nums">
                                <AlertTriangle size={10} /> faltam R$ {fmt(paidShortfall)}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatBR(inst.due_date)}
                            {isOverdue && <span className="text-destructive/70 font-medium"> · {daysOverdue}d atraso</span>}
                            {inst.paid_at && ` · Pago ${formatBR(inst.paid_at)}`}
                            {partial && ` · Parcial R$ ${fmt(Number(inst.paid_amount))}`}
                            {paidShortfall > 0.01 && <span className="text-warning font-semibold"> · recebido R$ {fmt(paidAmount)} de R$ {fmt(owedAtSettlement)}</span>}
                          </p>
                          {(inst.scheduled_principal != null || inst.paid_principal != null) && (
                            <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                              Principal R$ {fmt(Number(isPaid ? inst.paid_principal : inst.scheduled_principal) || 0)}
                              {" · "}Juros R$ {fmt(Number(isPaid ? inst.paid_interest : inst.scheduled_interest) || 0)}
                              {Number(inst.paid_fees || 0) > 0 && ` · Encargos R$ ${fmt(Number(inst.paid_fees))}`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {isOverdue && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors" title="Cálculo"><Info size={14} /></button>
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-80 p-0 overflow-hidden">
                                <div className="bg-destructive/10 border-b border-destructive/20 px-4 py-3">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Cálculo · Parcela #{inst.installment_number}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{formatBR(inst.due_date)} · {daysOverdue}d atrás</p>
                                </div>
                                <div className="p-4 space-y-3 text-xs">
                                  <div className="flex items-center justify-between text-muted-foreground"><span>Valor original</span><span className="font-mono font-semibold text-foreground">R$ {fmt(base)}</span></div>
                                  {partial && <div className="flex items-center justify-between text-muted-foreground"><span>Pago parcialmente</span><span className="font-mono font-semibold text-success">- R$ {fmt(paidAmount)}</span></div>}
                                  <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">Juros diários compostos</p>
                                    <p className="font-mono text-[11px] text-muted-foreground">
                                      R$ {fmt(base)} × (1 + {fee.jurosPct / 100})^{daysOverdue} - R$ {fmt(base)} = <span className="text-destructive font-bold">R$ {fmt(fee.juros)}</span>
                                    </p>
                                    {Number(c.max_interest_cap_percent || 0) > 0 && <p className="text-[10px] text-muted-foreground">Teto aplicado: {Number(c.max_interest_cap_percent)}% do valor original.</p>}
                                  </div>
                                  <div className="border-t border-border pt-2 flex items-center justify-between"><span className="text-[10px] font-bold uppercase text-foreground">Total</span><span className="font-mono text-sm font-bold text-destructive">R$ {fmt(totalDue)}</span></div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                          <button onClick={() => openEditInst(inst)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title="Editar"><Edit size={14} /></button>
                          {isPaid ? (
                            <button onClick={() => reversePayment(inst.id)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title="Estornar"><RotateCcw size={14} /></button>
                          ) : (
                            <>
                              {partial && (
                                <button onClick={() => reversePayment(inst.id)} className="p-1.5 rounded-lg hover:bg-warning/10 text-warning" title={`Estornar pagamento parcial de R$ ${fmt(paidAmount)}`}><RotateCcw size={14} /></button>
                              )}
                              <button onClick={() => sendBilling(inst)} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title="Cobrar"><Send size={14} /></button>
                              <button onClick={() => { setPartialPayModal(inst); setPartialAmount(""); setPayMethod("pix"); setPayReceiptFile(null); setPayFeeDiscount(0); }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground" title="Parcial"><Percent size={14} /></button>
                              <button onClick={() => {
                                const contract: any = (contracts as any[]).find((c: any) => c.id === inst.contract_id);
                                setPartialPayModal(inst);
                                setPayFeeDiscount(0);
                                setPartialAmount(String(portalInstallmentAmount({ ...inst, daily_interest_percent: contract?.daily_interest_percent, max_interest_cap_percent: contract?.max_interest_cap_percent }).toFixed(2)));
                                setPayMethod("pix"); setPayReceiptFile(null);
                              }} className="px-2.5 py-1.5 rounded-lg text-[10px] font-semibold bg-success/10 text-success hover:bg-success/20 transition-colors">Pagar</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}</section>
        </div>
      </div>




      {/* Modal: Histórico (timeline unificada) */}
      <Dialog open={histOpen} onOpenChange={setHistOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Clock size={14} /></div>
              Histórico de Atividades
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto pr-1">{(() => {

        const events: any[] = [];
        // Contratos criados
        contracts.forEach((c: any) => events.push({
          id: `c-${c.id}`, date: c.created_at, type: "contract",
          title: `Contrato criado · R$ ${fmt(Number(c.capital))}`,
          subtitle: `${c.num_installments}x · ${formatFrequency(c.frequency)}`,
          icon: FileText, color: "text-primary", bg: "bg-primary/10",
        }));
        // Pagamentos (parcelas pagas)
        installments.filter((i: any) => i.status === "paid" && i.paid_at).forEach((i: any) => events.push({
          id: `i-${i.id}`, date: i.paid_at, type: "payment",
          title: `Parcela #${i.installment_number} paga`,
          subtitle: `R$ ${fmt(Number(i.paid_amount || i.amount))}`,
          icon: CheckCircle, color: "text-success", bg: "bg-success/10",
        }));
        // Lucros
        profits.forEach((p: any) => events.push({
          id: `p-${p.id}`, date: p.date, type: "profit",
          title: p.description, subtitle: `+ R$ ${fmt(Number(p.amount))}`,
          icon: TrendingUp, color: "text-success", bg: "bg-success/10",
        }));
        // Transações genéricas restantes (incluindo notas e contatos)
        transactions.filter((t: any) => t.type !== "payment").forEach((t: any) => {
          const isNote = t.type === "note";
          const isContact = t.type === "contact";
          events.push({
            id: `t-${t.id}`, date: t.date, type: t.type,
            title: t.description,
            subtitle: isNote || isContact ? "" : `R$ ${fmt(Number(t.amount))}`,
            icon: isNote ? StickyNote : isContact ? PhoneCall : DollarSign,
            color: isNote ? "text-warning" : isContact ? "text-primary" : "text-muted-foreground",
            bg: isNote ? "bg-warning/10" : isContact ? "bg-primary/10" : "bg-muted",
          });
        });
        const sorted = events.sort((a, b) => (parseLocalDate(b.date)?.getTime() ?? 0) - (parseLocalDate(a.date)?.getTime() ?? 0));
        const filters = [
          { key: "all", label: "Tudo", count: sorted.length },
          { key: "contract", label: "Contratos", count: sorted.filter(e => e.type === "contract").length },
          { key: "payment", label: "Pagamentos", count: sorted.filter(e => e.type === "payment").length },
          { key: "profit", label: "Lucros", count: sorted.filter(e => e.type === "profit").length },
          { key: "note", label: "Notas", count: sorted.filter(e => e.type === "note").length },
          { key: "contact", label: "Contatos", count: sorted.filter(e => e.type === "contact").length },
        ] as const;
        const filtered = historyFilter === "all" ? sorted : sorted.filter(e => e.type === historyFilter);
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {filters.map(f => (
                <button key={f.key} onClick={() => setHistoryFilter(f.key as any)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${historyFilter === f.key ? "bg-primary/15 text-primary border-primary/40" : "bg-card/40 text-muted-foreground border-border/40 hover:text-foreground hover:border-border"}`}>
                  {f.label} <span className="opacity-60 ml-1">{f.count}</span>
                </button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-12">Nenhum evento nesta categoria</p>
            ) : (
              <div className="relative pl-6 space-y-3">
                <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />
                {filtered.map(ev => (
                  <div key={ev.id} className="relative">
                    <div className={`absolute left-[-18px] top-3 w-3 h-3 rounded-full ${ev.bg} border-2 border-background`} />
                    <div className="bg-card border border-border rounded-2xl p-3 flex items-start gap-3 hover:border-primary/30 transition-colors">
                      <div className={`w-8 h-8 rounded-lg ${ev.bg} flex items-center justify-center shrink-0`}>
                        <ev.icon size={14} className={ev.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{ev.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatBR(ev.date) || "Data indisponível"} · {parseLocalDate(ev.date)?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "—"}
                        </p>
                      </div>
                      <p className={`text-sm font-bold ${ev.color} shrink-0`}>{ev.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}</div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default ClienteDetalhe;
