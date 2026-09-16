import { CredinhoBannerArt } from "@/components/brand/Credinho";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, Lock, ShieldCheck, User, CreditCard, PartyPopper, Mail, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { toast } from "sonner";
import { TextEffect } from "@/components/vexon/ui/text-effect";
import { PLANS, PLAN_LIST, normalizeTier, type PlanTier } from "@/lib/plans";


const MP_SDK_SRC = "https://sdk.mercadopago.com/js/v2";
const MP_SECURITY_SRC = "https://www.mercadopago.com/v2/security.js";

declare global {
  interface Window {
    MercadoPago?: any;
    MP_DEVICE_SESSION_ID?: string;
  }
}

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if ((existing as any)._loaded) return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`Falha ao carregar ${src}`)));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    s.onload = () => { (s as any)._loaded = true; resolve(); };
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

function loadMPSdk() { return loadScript(MP_SDK_SRC); }
function loadMPSecurity() {
  return loadScript(MP_SECURITY_SRC, { view: "checkout", output: "deviceId" });
}

type Step = 1 | 2 | 3;

export default function Checkout() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { config } = useWhiteLabel();
  const brand = config.companyName || "CredMais App";

  const [planTier, setPlanTier] = useState<PlanTier>(normalizeTier(searchParams.get("plan")));
  const selectedPlan = PLANS[planTier];
  const PLAN_AMOUNT = selectedPlan.price;

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [docType, setDocType] = useState<"CPF" | "CNPJ">("CPF");
  const [doc, setDoc] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [brickLoading, setBrickLoading] = useState(false);
  const [pixData, setPixData] = useState<{ qr: string; qrBase64: string } | null>(null);
  const [boletoUrl, setBoletoUrl] = useState<string | null>(null);
  const [successPaymentId, setSuccessPaymentId] = useState<string | null>(null);
  const brickControllerRef = useRef<any>(null);
  const brickContainerId = "credmais-payment-brick";

  const onlyDigits = (v: string) => v.replace(/\D/g, "");
  const maskCPF = (v: string) => onlyDigits(v).slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  const maskCNPJ = (v: string) => onlyDigits(v).slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
  const maskPhone = (v: string) => {
    const d = onlyDigits(v).slice(0, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
    return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
  };
  const isValidCPF = (v: string) => {
    const c = onlyDigits(v);
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    let s = 0; for (let i = 0; i < 9; i++) s += parseInt(c[i]) * (10 - i);
    let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== parseInt(c[9])) return false;
    s = 0; for (let i = 0; i < 10; i++) s += parseInt(c[i]) * (11 - i);
    let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === parseInt(c[10]);
  };
  const isValidCNPJ = (v: string) => {
    const c = onlyDigits(v);
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    const calc = (base: string, weights: number[]) => {
      const s = weights.reduce((acc, w, i) => acc + parseInt(base[i]) * w, 0);
      const r = s % 11; return r < 2 ? 0 : 11 - r;
    };
    const w1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    const w2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    const d1 = calc(c.slice(0, 12), w1);
    const d2 = calc(c.slice(0, 12) + d1, w2);
    return d1 === parseInt(c[12]) && d2 === parseInt(c[13]);
  };
  const validDoc = docType === "CPF" ? isValidCPF(doc) : isValidCNPJ(doc);
  const validPhone = onlyDigits(whatsapp).length >= 10;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validName = name.trim().length >= 2;
  const canContinue = validName && validEmail && validDoc && validPhone;

  useEffect(() => {
    document.title = `Checkout — ${brand}`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", `Assine o ${brand} com checkout seguro do Mercado Pago.`);
    const linkId = "credmais-checkout-fonts";
    if (!document.getElementById(linkId)) {
      const l = document.createElement("link");
      l.id = linkId;
      l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap";
      document.head.appendChild(l);
    }
  }, [brand]);

  useEffect(() => {
    return () => {
      try { brickControllerRef.current?.unmount?.(); } catch { /* noop */ }
    };
  }, []);

  const goToPayment = async () => {
    if (!canContinue) {
      setFormError("Preencha nome, e-mail, CPF/CNPJ e WhatsApp corretamente");
      toast.error("Confira os dados antes de continuar");
      return;
    }
    setFormError(null);
    setBrickLoading(true);
    setStep(2);
    try {
      const { data: cfg, error: cfgErr } = await supabase.functions.invoke("mercadopago-config");
      if (cfgErr) throw cfgErr;
      const publicKey = (cfg as any)?.publicKey;
      if (!publicKey) throw new Error("Public key do Mercado Pago não configurada.");

      await Promise.all([loadMPSdk(), loadMPSecurity().catch(() => null)]);

      const mp = new window.MercadoPago(publicKey, { locale: "pt-BR" });
      const bricksBuilder = mp.bricks();

      try { brickControllerRef.current?.unmount?.(); } catch { /* noop */ }

      const [firstName, ...rest] = (name || "").trim().split(/\s+/);
      const lastName = rest.join(" ");

      const settings = {
        initialization: {
          amount: PLAN_AMOUNT,
          payer: {
            email,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
            identification: { type: docType, number: onlyDigits(doc) },
          },
        },
        customization: {
          paymentMethods: {
            creditCard: "all",
            debitCard: "all",
            bankTransfer: ["pix"],
            ticket: ["bolbradesco"],
            maxInstallments: 12,
          },
          visual: {
            style: {
              theme: "dark",
              customVariables: {
                baseColor: "#F5BD59",
                textPrimaryColor: "#F4F1E8",
                borderRadiusMedium: "12px",
                borderRadiusLarge: "16px",
              },
            },
          },
        },
        callbacks: {
          onReady: () => setBrickLoading(false),
          onError: (err: any) => {
            console.error("Brick error:", err);
            toast.error(err?.message || "Erro no formulário de pagamento");
          },
          onSubmit: async ({ selectedPaymentMethod, formData }: any) => {
            try {
              const deviceId = window.MP_DEVICE_SESSION_ID;
              const { data, error } = await supabase.functions.invoke("mercadopago-process-payment", {
                body: { selectedPaymentMethod, formData, email, name, deviceId, docType, doc: onlyDigits(doc), whatsapp: onlyDigits(whatsapp), planTier },
              });
              if (error) throw error;
              if ((data as any)?.error) throw new Error((data as any)?.message || "Pagamento recusado");
              const status = (data as any)?.status;
              const pmId = (data as any)?.payment_method_id;
              const poi = (data as any)?.point_of_interaction?.transaction_data;
              const boleto = (data as any)?.transaction_details?.external_resource_url;
              const paymentId = (data as any)?.id;

              if ((pmId === "pix" || selectedPaymentMethod === "pix" || selectedPaymentMethod === "bank_transfer") && poi?.qr_code) {
                setPixData({ qr: poi.qr_code, qrBase64: poi.qr_code_base64 });
                toast.success("Pix gerado! Escaneie ou copie o código.");
                return;
              }
              if ((pmId === "bolbradesco" || selectedPaymentMethod === "ticket" || selectedPaymentMethod === "bolbradesco") && boleto) {
                setBoletoUrl(boleto);
                toast.success("Boleto gerado com sucesso!");
                return;
              }

              if (status === "approved") {
                setSuccessPaymentId(paymentId ? String(paymentId) : null);
                setStep(3);
              } else if (status === "in_process" || status === "pending") {
                const qs = paymentId ? `?id=${paymentId}&email=${encodeURIComponent(email)}` : "";
                navigate(`/checkout/pendente${qs}`);
              } else {
                const qs = paymentId ? `?id=${paymentId}&email=${encodeURIComponent(email)}` : "";
                navigate(`/checkout/erro${qs}`);
              }
            } catch (err: any) {
              console.error(err);
              toast.error(err?.message || "Falha ao processar pagamento");
              throw err;
            }
          },
        },
      };

      await new Promise((r) => requestAnimationFrame(() => r(null)));
      for (let i = 0; i < 20 && !document.getElementById(brickContainerId); i++) {
        await new Promise((r) => setTimeout(r, 25));
      }
      brickControllerRef.current = await bricksBuilder.create("payment", brickContainerId, settings);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Erro ao carregar o checkout");
      setBrickLoading(false);
    }
  };

  const backToStep1 = () => {
    try { brickControllerRef.current?.unmount?.(); } catch { /* noop */ }
    setPixData(null);
    setBoletoUrl(null);
    setStep(1);
  };

  // Poll Pix status → auto-advance to success screen
  useEffect(() => {
    if (!pixData || step !== 2) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        // The webhook creates the account; we just check via a lightweight approach —
        // for now, we consider Pix pending and let the user go to success via the /sucesso route.
        // If server exposes a status endpoint, we could use it here.
      } catch { /* noop */ }
      if (attempts < 60) setTimeout(tick, 5000);
    };
    setTimeout(tick, 5000);
    return () => { cancelled = true; };
  }, [pixData, step]);

  const copyPix = async () => {
    if (!pixData) return;
    try {
      await navigator.clipboard.writeText(pixData.qr);
      toast.success("Código Pix copiado!");
    } catch {
      toast.error("Não foi possível copiar. Selecione manualmente.");
    }
  };

  const c = {
    bg: "#101010",
    ink: "#201a10",
    inkSoft: "#292115",
    gold: "#F5BD59",
    goldSoft: "#FFDC91",
    cream: "#F5F7FF",
  };

  const heading: React.CSSProperties = { fontFamily: "'Outfit', system-ui, sans-serif" };
  const body: React.CSSProperties = { fontFamily: "'Figtree', system-ui, sans-serif" };

  const inputBase =
    "w-full px-4 py-3 bg-white/[0.04] border rounded-xl outline-none transition-all text-white placeholder:text-white/35 focus:ring-2 focus:ring-[#F5BD59]/30";

  const STEPS = [
    { n: 1, label: "Identificação", icon: User },
    { n: 2, label: "Pagamento", icon: CreditCard },
    { n: 3, label: "Confirmação", icon: PartyPopper },
  ] as const;

  return (
    <div className="relative min-h-dvh w-full flex items-start justify-center py-6 px-4 md:px-8 overflow-hidden" style={{ backgroundColor: c.bg, ...body }}>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{ background: "radial-gradient(circle at 50% 0%, rgba(245,189,89,0.16), transparent 55%), radial-gradient(circle at 50% 100%, rgba(0,0,0,0.95), transparent 60%)" }}
      />
      <motion.div
        initial={{ opacity: 0, y: 24, filter: "blur(12px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-5xl"
      >
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 text-xs" style={{ color: c.goldSoft }}>
          <button onClick={() => step === 3 ? navigate("/") : navigate("/")} className="inline-flex items-center gap-2 font-semibold hover:opacity-70 transition-opacity">
            <ArrowLeft size={14} /> Voltar
          </button>
          <div className="inline-flex items-center gap-2 opacity-70">
            <Lock size={13} /> Checkout seguro · Mercado Pago
          </div>
        </div>

        {step !== 3 && <section className="credinho-banner credinho-context-banner mb-6">
          <CredinhoBannerArt scene="checkout" priority />
          <div className="credinho-banner-copy relative z-10 py-7 pl-6 sm:pl-8">
            <span className="credinho-kicker">SEU PRÓXIMO PASSO COMEÇA AQUI</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Mais controle para suas conquistas.</h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/70">Você escolheu o plano <strong className="text-[#f5bd59]">{selectedPlan.name}</strong>. Complete seus dados para continuar.</p>
          </div>
        </section>}

        {/* Stepper */}
        {step !== 3 && (
          <div className="mb-6 rounded-2xl bg-black/40 backdrop-blur-3xl border border-white/10 p-4 md:p-5 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
            <div className="flex items-center justify-between gap-2">
              {STEPS.map((s, i) => {
                const active = step === s.n;
                const done = step > s.n;
                const Icon = s.icon;
                return (
                  <div key={s.n} className="flex-1 flex items-center gap-3">
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <motion.div
                        animate={{ scale: active ? 1.05 : 1 }}
                        className="w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm font-bold shadow-sm transition-colors"
                        style={{
                          backgroundColor: done ? c.gold : active ? "rgba(245,189,89,0.22)" : "rgba(255,255,255,0.06)",
                          color: done ? "#0A0A0A" : active ? c.gold : "rgba(255,255,255,0.35)",
                          border: active ? `1px solid ${c.gold}` : "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        {done ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}
                      </motion.div>
                      <div className="hidden md:block">
                        <div className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: c.inkSoft }}>Etapa {s.n}</div>
                        <div className="text-sm font-bold" style={{ ...heading, color: active || done ? c.cream : "rgba(255,255,255,0.35)" }}>{s.label}</div>
                      </div>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className="flex-1 h-[2px] mx-2 rounded-full overflow-hidden bg-white/10">
                        <motion.div
                          initial={false}
                          animate={{ width: step > s.n ? "100%" : "0%" }}
                          transition={{ duration: 0.4 }}
                          className="h-full"
                          style={{ backgroundColor: c.gold }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {step !== 3 && (
            <motion.div
              key="card"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full rounded-3xl overflow-hidden border border-white/10 bg-black/40 backdrop-blur-3xl shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] flex flex-col md:flex-row"
            >
              {/* Left — Plan summary */}
              <aside
                className="w-full md:w-5/12 p-8 md:p-10 flex flex-col relative overflow-hidden"
                style={{ backgroundColor: c.ink, color: c.cream }}
              >
                <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full opacity-20 blur-3xl" style={{ backgroundColor: c.inkSoft }} />
                <div className="pointer-events-none absolute -bottom-24 -left-24 w-64 h-64 rounded-full opacity-15 blur-3xl" style={{ backgroundColor: c.gold }} />

                <div className="relative z-10 mb-8">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: c.gold }}>
                      <Sparkles size={18} style={{ color: c.cream }} />
                    </div>
                    <span className="text-2xl font-bold tracking-tight text-white" style={heading}>{brand}</span>
                  </div>

                  <p className="font-semibold uppercase tracking-widest text-[11px] mb-3" style={{ color: c.goldSoft }}>Escolha seu plano</p>

                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {PLAN_LIST.map((p) => {
                      const active = p.tier === planTier;
                      return (
                        <button
                          key={p.tier}
                          type="button"
                          onClick={() => setPlanTier(p.tier)}
                          disabled={step === 2}
                          className="rounded-2xl px-3 py-3 text-left transition-all border disabled:opacity-60"
                          style={{
                            backgroundColor: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                            borderColor: active ? c.gold : "rgba(255,255,255,0.12)",
                          }}
                        >
                          <span className="block text-[11px] uppercase tracking-widest font-bold" style={{ color: active ? c.gold : c.goldSoft }}>
                            {p.name}
                          </span>
                          <span className="block text-lg font-bold text-white" style={heading}>R$ {p.priceLabel}</span>
                          <span className="block text-[10px] text-white/60 leading-tight mt-1">
                            {p.tier === "completo" ? "com IA e automações" : "sem IA e automações"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <h1 className="text-2xl md:text-3xl font-bold text-white mb-2" style={heading}>Plano {selectedPlan.name}</h1>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-medium opacity-80">R$</span>
                    <span className="text-5xl font-bold" style={{ ...heading, color: c.gold }}>{selectedPlan.priceLabel},00</span>
                    <span className="text-lg font-medium opacity-80">/mês</span>
                  </div>
                  <p className="text-sm mt-3 leading-relaxed" style={{ color: c.goldSoft }}>
                    {selectedPlan.tagline} · Cancele quando quiser
                  </p>
                </div>

                <div className="relative z-10 space-y-4 flex-grow">
                  {selectedPlan.features.slice(0, 6).map((f) => (
                    <div key={f} className="flex gap-3 items-start">
                      <div className="mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: c.gold }}>
                        <Check size={12} strokeWidth={3} style={{ color: c.cream }} />
                      </div>
                      <p className="font-medium text-white/90 text-[14px]">{f}</p>
                    </div>
                  ))}
                  {selectedPlan.missing?.map((f) => (
                    <div key={f} className="flex gap-3 items-start opacity-50">
                      <div className="mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center border border-white/30">
                        <span className="text-[11px] leading-none text-white/70">–</span>
                      </div>
                      <p className="font-medium text-white/70 text-[13px] line-through">{f}</p>
                    </div>
                  ))}
                </div>

                <div className="relative z-10 mt-8 pt-6 border-t flex items-center justify-between text-[11px]" style={{ borderColor: `${c.inkSoft}55`, color: c.goldSoft }}>
                  <span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} /> SSL 256-bit</span>
                  <span className="italic">Mercado Pago</span>
                </div>
              </aside>

              {/* Right — content per step */}
              <main className="w-full md:w-7/12 p-8 md:p-12">
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div
                      key="step1"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.25 }}
                    >
                      <header className="mb-8">
                        <h2 className="text-2xl md:text-3xl font-bold" style={{ ...heading, color: c.cream }}>
                          <TextEffect preset="blur" per="char" as="span">Quem é você?</TextEffect>
                        </h2>
                        <p className="text-sm text-white/60 mt-1">Precisamos desses dados para gerar sua conta e emitir a nota.</p>
                      </header>

                      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); goToPayment(); }}>
                        <div>
                          <label htmlFor="checkout-name" className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: c.goldSoft }}>Nome completo *</label>
                          <input
                            id="checkout-name"
                            name="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Como no seu documento"
                            className={`${inputBase} border-white/10 focus:border-[#F5BD59]`}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label htmlFor="checkout-email" className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: c.goldSoft }}>E-mail *</label>
                            <input
                              id="checkout-email"
                              name="email"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="voce@empresa.com"
                              className={`${inputBase} border-white/10 focus:border-[#F5BD59]`}
                            />
                          </div>
                          <div>
                            <label htmlFor="checkout-whatsapp" className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: c.goldSoft }}>WhatsApp *</label>
                            <input
                              id="checkout-whatsapp"
                              name="whatsapp"
                              type="tel"
                              inputMode="numeric"
                              value={whatsapp}
                              onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
                              placeholder="(11) 99999-9999"
                              className={`${inputBase} ${whatsapp && !validPhone ? "border-red-400" : "border-white/10 focus:border-[#F5BD59]"}`}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label htmlFor="checkout-document" className="block text-[11px] font-bold uppercase tracking-wider" style={{ color: c.goldSoft }}>Documento *</label>
                            <div className="flex bg-white/5 border border-white/10 p-1 rounded-lg">
                              {(["CPF", "CNPJ"] as const).map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  onClick={() => { setDocType(t); setDoc(""); }}
                                  className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                                    docType === t ? "bg-white/15 shadow-sm text-white" : "text-white/40"
                                  }`}
                                  style={docType === t ? { color: c.cream } : undefined}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                          <input
                            id="checkout-document"
                            name="document"
                            inputMode="numeric"
                            value={doc}
                            onChange={(e) => setDoc(docType === "CPF" ? maskCPF(e.target.value) : maskCNPJ(e.target.value))}
                            placeholder={docType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
                            className={`${inputBase} ${doc && !validDoc ? "border-red-400" : "border-white/10 focus:border-[#F5BD59]"}`}
                          />
                          {doc && !validDoc && (
                            <p className="text-[11px] text-red-500 mt-2">{docType} inválido</p>
                          )}
                        </div>

                        <div className="rounded-xl border border-dashed p-4 text-[12px] text-white/60 leading-relaxed flex gap-3 items-start" style={{ borderColor: "rgba(245,189,89,0.40)", backgroundColor: "rgba(255,255,255,0.04)" }}>
                          <Mail size={16} className="mt-0.5 flex-shrink-0" style={{ color: c.inkSoft }} />
                          <span>Após a confirmação você recebe um <strong style={{ color: c.gold }}>link de acesso</strong> em <strong style={{ color: c.gold }}>{email || "seu e-mail"}</strong>.</span>
                        </div>

                        {formError && <p className="text-xs text-red-500">{formError}</p>}

                        <button
                          type="submit"
                          disabled={brickLoading || !canContinue}
                          className="w-full py-4 rounded-xl font-bold text-[15px] transition-all shadow-[0_8px_20px_-4px_rgba(245,189,89,0.5)] hover:brightness-110 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
                          style={{ ...heading, backgroundColor: c.gold, color: c.cream }}
                        >
                          {brickLoading ? (
                            <><Loader2 size={18} className="animate-spin" /> Carregando pagamento...</>
                          ) : (
                            <>Continuar para pagamento <ArrowRight size={18} strokeWidth={2.5} /></>
                          )}
                        </button>

                        <p className="text-center text-[11px] text-white/40 pt-1">
                          Ao continuar você concorda com nossos{" "}
                          <a href="/privacidade" className="underline hover:text-[#64B5FF]">Termos e Política de Privacidade</a>.
                        </p>
                      </form>
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.25 }}
                    >
                      <header className="mb-6">
                        <h2 className="text-2xl md:text-3xl font-bold" style={{ ...heading, color: c.cream }}>
                          <TextEffect preset="blur" per="char" as="span">Forma de pagamento</TextEffect>
                        </h2>
                        <div className="mt-2 flex items-center justify-between text-xs text-white/60">
                          <span>Pagando como <strong style={{ color: c.gold }}>{email}</strong></span>
                          <button onClick={backToStep1} className="underline hover:text-[#64B5FF]">alterar</button>
                        </div>
                      </header>

                      {brickLoading && (
                        <div className="flex items-center justify-center py-12 text-sm text-white/60 gap-2">
                          <Loader2 size={18} className="animate-spin" /> Preparando pagamento seguro...
                        </div>
                      )}

                      <div id={brickContainerId} className="min-h-[300px] rounded-2xl" />

                      {pixData && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-6 p-6 rounded-2xl border"
                          style={{ borderColor: `${c.inkSoft}33`, backgroundColor: "rgba(255,255,255,0.05)" }}
                        >
                          <div className="text-sm font-bold mb-3" style={{ color: c.goldSoft }}>Pague com Pix</div>
                          {pixData.qrBase64 && (
                            <img src={`data:image/png;base64,${pixData.qrBase64}`} alt="QR Code Pix" className="w-56 h-56 mx-auto rounded-xl bg-white p-2 border border-white/10" />
                          )}
                          <button
                            onClick={copyPix}
                            className="w-full mt-4 py-3 rounded-xl font-bold text-sm transition-all hover:brightness-95"
                            style={{ backgroundColor: c.gold, color: c.cream, ...heading }}
                          >
                            Copiar código Pix
                          </button>
                          <p className="text-[11px] text-white/60 mt-3 text-center">
                            A confirmação é automática. Assim que pago, você recebe o acesso por e-mail.
                          </p>
                        </motion.div>
                      )}

                      {boletoUrl && (
                        <div className="mt-6 p-6 rounded-2xl border text-center" style={{ borderColor: `${c.gold}55`, backgroundColor: "rgba(245,189,89,0.10)" }}>
                          <div className="text-sm font-bold mb-3" style={{ color: c.goldSoft }}>Boleto gerado</div>
                          <a
                            href={boletoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block px-6 py-3 rounded-xl font-bold text-sm transition-all hover:brightness-95"
                            style={{ backgroundColor: c.gold, color: c.cream, ...heading }}
                          >
                            Abrir boleto para pagamento
                          </a>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </main>
            </motion.div>
          )}

          {step === 3 && (
            <SuccessScreen
              key="success"
              brand={brand}
              email={email}
              name={name}
              paymentId={successPaymentId}
              onGoToLogin={() => navigate("/login")}
              tokens={c}
              heading={heading}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function SuccessScreen({
  brand,
  email,
  name,
  paymentId,
  onGoToLogin,
  tokens: c,
  heading,
}: {
  brand: string;
  email: string;
  name: string;
  paymentId: string | null;
  onGoToLogin: () => void;
  tokens: { bg: string; ink: string; inkSoft: string; gold: string; goldSoft: string; cream: string };
  heading: React.CSSProperties;
}) {
  const firstName = (name || "").trim().split(/\s+/)[0] || "bem-vindo(a)";

  // Confetti particles
  const particles = Array.from({ length: 24 }, (_, i) => i);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative w-full rounded-3xl overflow-hidden border border-white/10 bg-white/[0.03] backdrop-blur-2xl shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
    >
      <div
        className="relative overflow-hidden px-6 md:px-12 py-14 md:py-20 text-center"
        style={{ background: `linear-gradient(135deg, ${c.ink} 0%, ${c.inkSoft} 100%)` }}
      >
        {/* Confetti */}
        <div className="pointer-events-none absolute inset-0">
          {particles.map((i) => {
            const left = Math.random() * 100;
            const delay = Math.random() * 0.8;
            const duration = 2 + Math.random() * 2;
            const size = 6 + Math.random() * 8;
            const colors = [c.gold, c.goldSoft, "#ffffff", "#a7f3d0"];
            const color = colors[i % colors.length];
            return (
              <motion.span
                key={i}
                initial={{ y: -40, opacity: 0, rotate: 0 }}
                animate={{ y: 600, opacity: [0, 1, 1, 0], rotate: 360 }}
                transition={{ delay, duration, ease: "easeIn", repeat: Infinity, repeatDelay: 1.5 }}
                className="absolute top-0 rounded-sm"
                style={{ left: `${left}%`, width: size, height: size * 0.4, backgroundColor: color }}
              />
            );
          })}
        </div>

        {/* Check icon animation */}
        <motion.div
          initial={{ scale: 0, rotate: -180 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          className="relative z-10 mx-auto w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-[0_10px_40px_rgba(245,189,89,0.5)]"
          style={{ backgroundColor: c.gold }}
        >
          <motion.div
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            <Check size={48} strokeWidth={3.5} style={{ color: c.cream }} />
          </motion.div>
          {/* Pulse ring */}
          <motion.div
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity }}
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: c.gold }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="relative z-10"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-4" style={{ backgroundColor: `${c.gold}25`, color: c.goldSoft, border: `1px solid ${c.gold}55` }}>
            <Sparkles size={12} /> Pagamento aprovado
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-3" style={heading}>
            Bem-vindo(a), <span style={{ color: c.goldSoft }}>{firstName}!</span>
          </h1>
          <p className="text-white/70 max-w-lg mx-auto text-sm md:text-base leading-relaxed">
            Sua assinatura do <strong className="text-white">{brand}</strong> foi confirmada. Estamos preparando sua conta agora mesmo.
          </p>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="px-6 md:px-12 py-10"
      >
        <div className="max-w-lg mx-auto space-y-4">
          <div className="flex items-start gap-4 p-4 rounded-2xl border" style={{ borderColor: `${c.inkSoft}22`, backgroundColor: "rgba(255,255,255,0.05)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: c.inkSoft }}>
              <Mail size={18} className="text-white" />
            </div>
            <div className="text-sm text-left">
              <p className="font-bold" style={{ color: c.goldSoft }}>Link de acesso enviado</p>
              <p className="text-white/60 mt-0.5">Enviamos suas credenciais para <strong style={{ color: c.gold }}>{email}</strong>. Verifique também sua caixa de spam.</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-2xl border" style={{ borderColor: `${c.gold}33`, backgroundColor: "rgba(245,189,89,0.10)" }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: c.gold }}>
              <ShieldCheck size={18} style={{ color: c.cream }} />
            </div>
            <div className="text-sm text-left">
              <p className="font-bold" style={{ color: c.goldSoft }}>Tudo liberado</p>
              <p className="text-white/60 mt-0.5">Clientes ilimitados, agente de IA, portal white-label — tudo pronto pra você começar.</p>
            </div>
          </div>

          <button
            onClick={onGoToLogin}
            className="w-full py-4 rounded-xl font-bold text-[15px] transition-all shadow-[0_8px_20px_-4px_rgba(245,189,89,0.5)] hover:brightness-110 active:scale-[0.99] flex items-center justify-center gap-2 mt-4"
            style={{ ...heading, backgroundColor: c.gold, color: c.cream }}
          >
            Acessar minha conta <ArrowRight size={18} strokeWidth={2.5} />
          </button>

          {paymentId && (
            <p className="text-center text-[11px] text-white/40 pt-1">ID do pagamento: {paymentId}</p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
