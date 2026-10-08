import {UploadImage} from '@/components/UploadMedia';
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { isClientPortalActive } from "@/lib/portalSession";
import { z } from "zod";
import defaultLogo from "@/assets/credmais-mark.svg";
import { supabase } from "@/integrations/supabase/client";
import { setRememberMe, getRememberMe,isAuthSessionTemporary } from "@/integrations/supabase/remember";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Globe,
  Users,
  BarChart3,
  ShieldCheck,
  MonitorSmartphone,
} from "lucide-react";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { toSafeHttpUrl } from "@/lib/safeUrl";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";
import { withTimeout } from "@/lib/withTimeout";
import {authFailureMessage,isTemporaryAuthFailure} from '@/lib/authFailure';

// ---------- Validação ----------
const emailSchema = z
  .string()
  .trim()
  .min(1, "Informe seu e-mail")
  .email("E-mail inválido")
  .max(255, "E-mail muito longo");

const passwordLoginSchema = z
  .string()
  .min(1, "Informe sua senha")
  .max(72, "Senha muito longa");

const passwordRegisterSchema = z
  .string()
  .min(6, "Use no mínimo 6 caracteres")
  .max(72, "Senha muito longa");

const AUTH_REQUEST_TIMEOUT_MS = 15_000;

const nameSchema = z
  .string()
  .trim()
  .min(2, "Informe seu nome (mín. 2 caracteres)")
  .max(80, "Nome muito longo");

// ---------- Tradução de erros do Supabase ----------
const friendlyAuthError = (err: any): string => {
  const msg = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toLowerCase();
  if (code.includes("invalid_credentials") || msg.includes("invalid login"))
    return "E-mail ou senha incorretos.";
  if (msg.includes("email not confirmed"))
    return "Confirme seu e-mail antes de entrar.";
  if (code === "user_already_exists" || msg.includes("already registered") || msg.includes("user already"))
    return "Este e-mail já está cadastrado. Faça login.";
  if (msg.includes("rate limit") || err?.status === 429)
    return "Muitas tentativas. Aguarde alguns minutos.";
  if (msg.includes("weak password"))
    return "Senha fraca. Use letras e números.";
  if (isTemporaryAuthFailure(err)||err?.status>=500)
    return authFailureMessage(err);
  return err?.message || "Não foi possível concluir. Tente novamente.";
};

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get("plan");
  const { settings: platform } = usePlatformSettings();
  const [isRegister, setIsRegister] = useState(!!planParam);

  // Se o dono do app fechar o cadastro, ninguém fica preso na aba de criar conta
  // (inclusive quem chegou por um link antigo com ?plan=).
  useEffect(() => {
    if (!platform.allow_new_registrations && isRegister) setIsRegister(false);
  }, [platform.allow_new_registrations, isRegister]);
  const [selectedPlan, setSelectedPlan] = useState<"trial" | "paid" | null>(
    planParam === "paid" ? "paid" : planParam === "trial" ? "trial" : null,
  );
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMeState] = useState<boolean>(() => getRememberMe());
  const [errors, setErrors] = useState<{ email?: string; password?: string; name?: string; plan?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean; name?: boolean }>({});
  const navigate = useNavigate();
  // Estes três ficavam DEPOIS do `return` logo abaixo. Quando `hasPortalSession()`
  // mudava de valor entre dois renders — é o que acontece ao sair do portal do
  // cliente neste mesmo navegador — a quantidade de hooks mudava junto e o React
  // derrubava a tela de login inteira (erro #310).
  const { toast } = useToast();
  const { config } = useWhiteLabel();

  // Se este navegador possui sessão do portal do cliente, não permitir acesso
  // à tela de login do credor — devolve o cliente ao portal dele.
  const temSessaoDoPortal = isClientPortalActive();

  const sanitizeNext = (raw: string | null): string | null => {
    if (!raw) return null;
    if (!raw.startsWith("/")) return null;
    if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
    if (raw.toLowerCase().startsWith("/login") || raw.toLowerCase().startsWith("/reset-password")) return null;
    return raw;
  };
  const nextPath = sanitizeNext(searchParams.get("next"));
  const logoSrc = config.companyLogo || defaultLogo;
  const brandTitle = config.loginTitle || config.companyName || "CREDMAIS APP";
  const brandSubtitle = config.loginSubtitle || "SISTEMA DE GESTÃO DE EMPRÉSTIMOS";
  const footerText = config.footerText || `© ${new Date().getFullYear()} CREDMAIS APP · TODOS OS DIREITOS RESERVADOS`;

  // Força da senha (apenas no registro)
  const passwordStrength = useMemo(() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 6) s++;
    if (password.length >= 10) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return Math.min(s, 4);
  }, [password]);
  const strengthLabel = ["", "Fraca", "Razoável", "Boa", "Forte"][passwordStrength];
  const strengthColor = [
    "bg-white/10",
    "bg-red-400/80",
    "bg-amber-400/80",
    "bg-yellow-300/80",
    "bg-emerald-400/80",
  ][passwordStrength];

  const validateField = (field: "email" | "password" | "name", value: string) => {
    try {
      if (field === "email") emailSchema.parse(value);
      if (field === "password") (isRegister ? passwordRegisterSchema : passwordLoginSchema).parse(value);
      if (field === "name") nameSchema.parse(value);
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    } catch (err) {
      if (err instanceof z.ZodError) {
        setErrors((prev) => ({ ...prev, [field]: err.errors[0]?.message }));
      }
    }
  };

  const validateAll = (mode: "login" | "register"): boolean => {
    const next: typeof errors = {};
    const eRes = emailSchema.safeParse(email);
    if (!eRes.success) next.email = eRes.error.errors[0]?.message;
    if (mode === "login") {
      const pRes = passwordLoginSchema.safeParse(password);
      if (!pRes.success) next.password = pRes.error.errors[0]?.message;
    }
    if (mode === "register") {
      const nRes = nameSchema.safeParse(name);
      if (!nRes.success) next.name = nRes.error.errors[0]?.message;
      // No password / plan validation: account is created after payment confirmation.
    }
    setErrors(next);
    setTouched({ email: true, password: mode === "login", name: mode === "register" });
    return Object.keys(next).length === 0;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validateAll("login")) return;
    setLoading(true);
    setRememberMe(rememberMe);
    let error: { message?: string; code?: string; status?: number } | null = null;
    try {
      ({ error } = await withTimeout(supabase.auth.signInWithPassword({ email: email.trim(), password }), AUTH_REQUEST_TIMEOUT_MS));
    } catch (authError) {
      error = authError as typeof error;
    }
    if (error) {
      setLoading(false);
      const msg = friendlyAuthError(error);
      setFormError(msg);
      toast({ title: "Erro ao entrar", description: msg, variant: "destructive" });
      return;
    }

    // A decisão de assinatura pertence ao ProtectedRoute, que também considera
    // vitalício, administrador e a tabela de assinaturas. Duplicar a regra aqui
    // mandava contas válidas ao checkout antes da verificação completa.
    setLoading(false);
    if(isAuthSessionTemporary())toast({title:'Sessão temporária',description:'Você entrou. Será preciso entrar novamente ao recarregar ou fechar este app.'});
    navigate(nextPath ?? "/dashboard", { replace: true });
  };

  // NEW FLOW: don't create the auth user here. Send the visitor straight to checkout.
  // The Mercado Pago webhook will create the account (invite email) only after a confirmed payment.
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validateAll("register")) return;
    setLoading(true);

    try {
      const { data: checkoutUrl } = await supabase.rpc("get_signup_checkout_url");
      if (!checkoutUrl) {
        setLoading(false);
        const msg = "Nenhum link de pagamento configurado. Entre em contato com o suporte.";
        setFormError(msg);
        toast({ title: "Indisponível", description: msg, variant: "destructive" });
        return;
      }

      // Pass email + name to the checkout so Mercado Pago can pre-fill and link the payer.
      const checkout = toSafeHttpUrl(checkoutUrl);
      if (!checkout) {
        setLoading(false);
        const msg = "O endereço de pagamento configurado é inválido. Entre em contato com o suporte.";
        setFormError(msg);
        toast({ title: "Pagamento indisponível", description: msg, variant: "destructive" });
        return;
      }
      checkout.searchParams.set("email", email.trim());
      if (name.trim()) checkout.searchParams.set("name", name.trim());
      const url = checkout.toString();

      toast({
        title: "Redirecionando para o pagamento 💳",
        description: "Após a confirmação, você receberá um e-mail para criar sua senha e acessar o sistema.",
      });
      setTimeout(() => {
        window.location.href = url;
      }, 1200);
    } catch (err: any) {
      setLoading(false);
      const msg = err?.message || "Não foi possível abrir o checkout. Tente novamente.";
      setFormError(msg);
      toast({ title: "Erro", description: msg, variant: "destructive" });
    }
  };

  // ---------- Estilos ----------
  const inputBase =
    "w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/4 border text-white placeholder:text-white/30 text-sm focus:outline-hidden focus:ring-2 transition-all duration-200";
  const inputOk = "border-white/8 focus:ring-white/30 focus:border-white/30";
  const inputErr = "border-red-400/40 focus:ring-red-400/40 focus:border-red-400/60";
  const cls = (field: "email" | "password" | "name") =>
    `${inputBase} ${touched[field] && errors[field] ? inputErr : inputOk}`;

  const FieldError = ({ msg }: { msg?: string }) =>
    msg ? (
      <p className="mt-1.5 text-[11px] text-red-300/90 flex items-center gap-1.5 animate-fade-in">
        <AlertCircle size={12} className="shrink-0" />
        <span>{msg}</span>
      </p>
    ) : null;

  // O desvio para o portal do cliente acontece aqui embaixo, com todos os hooks
  // já chamados — o comportamento é o mesmo de antes, sem o risco de mudar a
  // quantidade de hooks entre um render e outro.
  if (temSessaoDoPortal) {
    return <Navigate to="/portal-cliente" replace />;
  }

  return (
    <div
      className="credinho-auth relative min-h-dvh flex flex-col overflow-x-hidden font-body bg-[#0c0b09] bg-cover bg-center bg-no-repeat px-5 py-6 sm:px-8 lg:px-12"
      style={{
        backgroundImage:
          "url('/mascots/credinho-v2/login-background.webp')",
      }}
    >
      <div className="credinho-auth-shade absolute inset-0 z-0" />

      <button
        onClick={() => navigate("/")}
        className="absolute top-6 left-6 md:top-8 md:left-8 z-20 flex items-center gap-2 text-white/50 hover:text-white transition-colors group"
      >
        <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
        <span className="text-sm font-medium hidden sm:inline">Voltar para o site</span>
      </button>

      <div className="absolute right-8 top-7 z-20 hidden items-center gap-2 text-xs font-medium text-white/75 sm:flex">
        <Globe size={14} /> Português (BR) <span className="ml-2 text-white/45">⌄</span>
      </div>

      <aside className="credinho-auth-copy">
        <span className="credinho-kicker">SEU PARCEIRO EM CADA CONQUISTA</span>
        <h2 className="mt-4 font-display font-semibold text-white">Seu próximo passo<br />começa <span className="text-[#f5bd59]">aqui.</span></h2>
        <p className="mt-5 max-w-sm text-sm leading-7 text-white/55">Organize sua carteira, acompanhe seus resultados e conquiste uma rotina mais tranquila.</p>
        <div className="mt-6 flex gap-6 text-xs text-[#f5bd59]"><span className="flex items-center gap-2"><ShieldCheck size={16} /> Confiança</span><span className="flex items-center gap-2"><BarChart3 size={16} /> Progresso</span></div>
      </aside>
      {/* Card */}
      <div className="relative z-10 w-full max-w-[500px] mx-auto animate-scale-in">
        <div className="rounded-[26px] overflow-hidden border border-amber-200/20 bg-[#101010]/90 shadow-[0_0_0_1px_rgba(245,189,89,.08),0_30px_90px_rgba(0,0,0,.55),0_0_35px_rgba(245,189,89,.22)] backdrop-blur-2xl">
          <div className="flex flex-col items-center px-6 pt-7 sm:pt-8">
            <UploadImage access={{kind:'brand'}} src={logoSrc} alt={brandTitle} width={64} height={64} className="h-16 w-16 rounded-2xl object-cover ring-1 ring-amber-400/60 shadow-[0_0_28px_rgba(245,189,89,.35)]" />
            <p className="mt-3 text-xl font-bold tracking-tight text-white">CREDMAIS <span className="text-amber-400">APP</span></p>
            <p className="mt-1 text-[9px] tracking-[0.18em] text-white/40">{brandSubtitle}</p>
          </div>
          {!isRegister ? (
            <div className="flex flex-col md:flex-row">
              {/* Form de Login */}
              <div className="flex-1 p-6 sm:p-8 md:p-10 bg-white/2.5">
                <div className="mb-7 grid grid-cols-2 border-b border-white/15">
                  <button type="button" role="tab" aria-selected="true" aria-label="Aba de login" onClick={() => setIsRegister(false)} className="relative pb-3 text-sm font-semibold text-white after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-amber-400">Entrar</button>
                  <button type="button" role="tab" aria-selected="false" aria-label="Aba de criação de conta" onClick={() => platform.allow_new_registrations && setIsRegister(true)} className="pb-3 text-sm font-semibold text-white/45 transition hover:text-white/80">Criar conta</button>
                </div>
                <h2 className="font-display text-xl font-semibold text-white mb-1">Bem-vindo</h2>
                <p className="text-white/40 text-sm mb-6">Acesse sua conta para continuar</p>

                {formError && (
                  <div
                    role="alert"
                    className="mb-4 p-3 rounded-xl border border-red-400/30 bg-red-500/10 text-red-100 text-xs flex items-start gap-2 animate-fade-in"
                  >
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="login-email" className="text-[11px] font-medium text-white/50 uppercase tracking-wider mb-1.5 block">
                      E-mail
                    </label>
                    <div className="relative">
                      <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (touched.email) validateField("email", e.target.value);
                        }}
                        onBlur={() => {
                          setTouched((t) => ({ ...t, email: true }));
                          validateField("email", email);
                        }}
                        aria-invalid={!!(touched.email && errors.email)}
                        aria-describedby={errors.email ? "login-email-err" : undefined}
                        className={cls("email")}
                      />
                    </div>
                    <div id="login-email-err"><FieldError msg={touched.email ? errors.email : undefined} /></div>
                  </div>

                  <div>
                    <label htmlFor="login-password" className="text-[11px] font-medium text-white/50 uppercase tracking-wider mb-1.5 block">
                      Senha
                    </label>
                    <div className="relative">
                      <Lock size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (touched.password) validateField("password", e.target.value);
                        }}
                        onBlur={() => {
                          setTouched((t) => ({ ...t, password: true }));
                          validateField("password", password);
                        }}
                        aria-invalid={!!(touched.password && errors.password)}
                        aria-describedby={errors.password ? "login-pwd-err" : undefined}
                        className={cls("password") + " pr-11"}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors p-1"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div id="login-pwd-err"><FieldError msg={touched.password ? errors.password : undefined} /></div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none group">
                      <span className="relative inline-flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMeState(e.target.checked)}
                          className="peer sr-only"
                        />
                        <span className="w-4 h-4 rounded-[5px] border border-white/20 bg-white/4 peer-checked:bg-white/90 peer-checked:border-white/90 transition-all duration-200" />
                        <svg
                          viewBox="0 0 16 16"
                          className="absolute w-3 h-3 text-black opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 8.5l3.5 3.5L13 5" />
                        </svg>
                      </span>
                      <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors">
                        Lembrar-me
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        navigate(nextPath ? `/reset-password?next=${encodeURIComponent(nextPath)}` : "/reset-password")
                      }
                      className="text-xs text-white/40 hover:text-white/80 transition-colors"
                    >
                      Esqueceu a senha?
                    </button>
                  </div>


                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:shadow-lg hover:shadow-white/10 flex items-center justify-center gap-2"
                    style={{ background: "var(--gradient-button)", color: "hsl(var(--primary-foreground))" }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Entrando...
                      </>
                    ) : (
                      <>
                        Entrar no Sistema <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>


              </div>

              {/* Painel direito */}
              <div className="hidden flex-1 flex-col items-center justify-center p-5 sm:p-7 md:p-10 glass bg-white/2 border-t md:border-t-0 md:border-l border-white/6">
                <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-5">
                  <ArrowRight size={28} className="text-white/70" />
                </div>
                <h2 className="font-display text-xl font-bold text-white mb-2">
                  {platform.allow_new_registrations ? "Primeira vez?" : "Cadastro fechado"}
                </h2>
                <p className="text-white/40 text-sm text-center mb-6 max-w-[260px]">
                  {platform.allow_new_registrations
                    ? "Crie uma conta gratuita e descubra todas as possibilidades."
                    : "No momento não estamos aceitando novos cadastros. Fale com o suporte se já é cliente."}
                </p>
                {platform.allow_new_registrations && (
                  <button
                    onClick={() => {
                      setIsRegister(true);
                      setErrors({});
                      setFormError(null);
                      setTouched({});
                    }}
                    className="px-8 py-2.5 rounded-2xl border border-white/20 text-white/70 text-sm font-medium hover:bg-white/10 transition-all duration-300"
                  >
                    Criar Conta
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 flex flex-col items-center justify-center p-7 md:p-10 glass bg-white/2 border-b md:border-b-0 md:border-r border-white/6">
                <h2 className="font-display text-xl font-bold text-white mb-2">Já tem conta?</h2>
                <p className="text-white/40 text-sm text-center mb-6 max-w-[260px]">
                  Entre com suas credenciais e acesse o sistema.
                </p>
                <button
                  onClick={() => {
                    setIsRegister(false);
                    setErrors({});
                    setFormError(null);
                    setTouched({});
                  }}
                  className="px-8 py-2.5 rounded-2xl border border-white/20 text-white/70 text-sm font-medium hover:bg-white/10 transition-all duration-300"
                >
                  Fazer Login
                </button>
              </div>

              <div className="flex-1 p-7 md:p-10 glass bg-white/3">
                <h2 className="font-display text-xl font-semibold text-white mb-1">Assinar &amp; criar conta</h2>
                <p className="text-white/40 text-sm mb-4">
                  Pague primeiro com segurança. Sua conta é criada automaticamente após a confirmação — você recebe um e-mail para definir a senha.
                </p>

                <div className="mb-5 p-3 rounded-xl border border-amber-400/20 bg-amber-400/4 text-[11px] text-amber-100/80 leading-relaxed">
                  <strong className="text-amber-200">Como funciona:</strong> preencha nome e e-mail →
                  é redirecionado para o pagamento no Mercado Pago → recebe e-mail de boas-vindas com link para entrar.
                </div>

                {formError && (
                  <div
                    role="alert"
                    className="mb-4 p-3 rounded-xl border border-red-400/30 bg-red-500/10 text-red-100 text-xs flex items-start gap-2 animate-fade-in"
                  >
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                <form onSubmit={handleRegister} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="reg-name" className="text-[11px] font-medium text-white/50 uppercase tracking-wider mb-1.5 block">
                      Nome
                    </label>
                    <div className="relative">
                      <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        id="reg-name"
                        type="text"
                        autoComplete="name"
                        placeholder="Nome completo"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (touched.name) validateField("name", e.target.value);
                        }}
                        onBlur={() => {
                          setTouched((t) => ({ ...t, name: true }));
                          validateField("name", name);
                        }}
                        aria-invalid={!!(touched.name && errors.name)}
                        className={cls("name")}
                      />
                    </div>
                    <FieldError msg={touched.name ? errors.name : undefined} />
                  </div>

                  <div>
                    <label htmlFor="reg-email" className="text-[11px] font-medium text-white/50 uppercase tracking-wider mb-1.5 block">
                      E-mail
                    </label>
                    <div className="relative">
                      <Mail size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                      <input
                        id="reg-email"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        placeholder="seu@email.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (touched.email) validateField("email", e.target.value);
                        }}
                        onBlur={() => {
                          setTouched((t) => ({ ...t, email: true }));
                          validateField("email", email);
                        }}
                        aria-invalid={!!(touched.email && errors.email)}
                        className={cls("email")}
                      />
                    </div>
                    <FieldError msg={touched.email ? errors.email : undefined} />
                    <p className="mt-1.5 text-[10px] text-white/40">
                      Use o mesmo e-mail no checkout para que sua assinatura seja vinculada à sua conta.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 rounded-xl text-sm font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:shadow-lg hover:shadow-white/10 flex items-center justify-center gap-2"
                    style={{ background: "var(--gradient-button)", color: "white" }}
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> Abrindo checkout...
                      </>
                    ) : (
                      <>
                        Ir para o pagamento <ArrowRight size={16} />
                      </>
                    )}
                  </button>

                  <p className="text-[10px] text-white/30 text-center leading-relaxed">
                    Pagamento processado de forma segura pelo Mercado Pago. Sem fidelidade — cancele quando quiser.
                  </p>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="relative z-10 text-white/20 text-[10px] mt-8 tracking-wider text-center px-4">
        {footerText}
      </p>
      <Link to="/baixar" className="relative z-10 mt-4 text-xs font-semibold text-white/65 hover:text-white">Instalar aplicativo</Link>
    </div>
  );
};

export default Login;
