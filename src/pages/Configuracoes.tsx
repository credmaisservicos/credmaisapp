import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import SectionRenderer from "@/components/configuracoes/SectionRenderer";
import type { SettingsCtx, SettingsForm } from "@/components/configuracoes/types";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package, Download } from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import { useConfirm } from "@/components/ConfirmProvider";
import { getSignedUploadUrl } from "@/lib/storage";
import { friendlyError } from "@/lib/friendlyError";
import { DEFAULT_MODULES, type ModuleKey } from "@/contexts/WhiteLabelContext";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import "@/configuracoes-overrides.css";

const COLOR_PRESETS = [
  { label: "Azul Steel", primary: "#4a86c8", accent: "#6ba3d6", emoji: "🔷" },
  { label: "Azul Royal", primary: "#2563eb", accent: "#3b82f6", emoji: "💎" },
  { label: "Esmeralda", primary: "#059669", accent: "#10b981", emoji: "💚" },
  { label: "Roxo", primary: "#7c3aed", accent: "#8b5cf6", emoji: "💜" },
  { label: "Âmbar", primary: "#d97706", accent: "#f59e0b", emoji: "🟡" },
  { label: "Vermelho", primary: "#dc2626", accent: "#ef4444", emoji: "❤️" },
];

const Configuracoes = () => {
  const confirm = useConfirm();
  const { user, profile, isPlatformAdmin } = useAuth();
  const { data: ownRole } = useQuery({
    queryKey: ["own-settings-role", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user!.id).maybeSingle();
      return data?.role ?? null;
    },
    enabled: !!user,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { refresh: refreshWhiteLabel } = useWhiteLabel();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [tab, setTab] = useState("marca");
  const { installed, canPrompt, install } = usePwaInstall();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const portalLogoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const [uploadingPortalLogo, setUploadingPortalLogo] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["settings", user?.id],
    queryFn: async () => {
      // Sem `as any`: é justamente esse cast que deixava o form ler/gravar colunas
      // que não existem no banco (foi assim que `checkout_url` passou batido
      // e o salvamento quebrou o link de cadastro).
      const { data, error } = await supabase.from("settings_safe").select("*").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["message-templates", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("message_templates").select("*").eq("user_id", user!.id).order("trigger_days");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const [form, setForm] = useState({
    company_name: "", company_cnpj: "", company_address: "", company_phone: "", company_logo_url: "", favicon_url: "",
    primary_color: "#006FEF", accent_color: "#FF9D16", theme_mode: "dark",
    sidebar_style: "default", login_title: "", login_subtitle: "",
    footer_text: "", border_radius: "16", font_family: "default",
    default_interest_rate: "10", default_late_fee: "0", default_daily_interest: "4", default_frequency: "monthly",
    default_num_installments: "", default_payment_method: "pix", default_max_interest_cap: "",
    whatsapp_api_url: "", whatsapp_api_key: "", whatsapp_instance: "",
    n8n_webhook_url: "", push_notifications_enabled: false,
    pix_key: "", pix_key_type: "cpf", billing_message: "",
    // Bot de cobranças
    bot_enabled: false, bot_auto_send: false,
    bot_send_hour: 9, bot_send_minute: 0,
    bot_max_messages_per_day: 50,
    bot_work_days: ["mon", "tue", "wed", "thu", "fri"] as string[],
    bot_escalation_rules: [
      { days: -3, template: "lembrete_pre", channel: "whatsapp" },
      { days: 0,  template: "cobranca_firme", channel: "whatsapp" },
      { days: 1,  template: "cobranca_multa", channel: "whatsapp" },
      { days: 3,  template: "cobranca_negociacao", channel: "whatsapp" },
      { days: 7,  template: "cobranca_cobrador", channel: "whatsapp" },
    ] as { days: number; template: string; channel: string }[],
    bot_retry_interval_hours: 24,
    bot_stop_on_payment: true, bot_notify_owner: true,
    bot_greeting_message: "Olá {nome}, aqui é do {empresa}.",
    bot_closing_message: "Qualquer dúvida, entre em contato. Obrigado!",
    bot_send_pix: true, bot_send_receipt: false,
    bot_tone: "formal",
    bot_use_ai: false,
    bot_process_audio: true,
    bot_process_receipts: true,
    portal_title: "Portal do Cliente",
    portal_subtitle: "Acompanhe seus contratos e pagamentos",
    portal_welcome_message: "",
    portal_primary_color: "",
    portal_logo_url: "",
    portal_contact_phone: "",
    portal_contact_email: "",
    custom_contract_template: "",
    modules_enabled: { ...DEFAULT_MODULES } as Record<ModuleKey, boolean>,
  });

  useEffect(() => {
    if (settings) {
      const s = settings as any;
      setForm(prev => ({
        ...prev,
        company_name: s.company_name || "",
        company_cnpj: s.company_cnpj || "",
        company_address: s.company_address || "",
        company_phone: s.company_phone || "",
        company_logo_url: s.company_logo_url || "",
        favicon_url: s.favicon_url || "",
        primary_color: s.primary_color || "#006FEF",
        accent_color: s.accent_color || "#FF9D16",
        theme_mode: s.theme_mode || "dark",
        sidebar_style: s.sidebar_style || "default",
        login_title: s.login_title || "",
        login_subtitle: s.login_subtitle || "",
        footer_text: s.footer_text || "",
        border_radius: s.border_radius || "16",
        font_family: s.font_family || "default",
        default_interest_rate: String(s.default_interest_rate || 10),
        default_late_fee: "0",
        default_daily_interest: String(s.default_daily_interest || 4),
        default_frequency: s.default_frequency || "monthly",
        default_num_installments: s.default_num_installments ? String(s.default_num_installments) : "",
        default_payment_method: s.default_payment_method || "pix",
        default_max_interest_cap: s.default_max_interest_cap ? String(s.default_max_interest_cap) : "",
        whatsapp_api_url: s.whatsapp_api_url || "",
        whatsapp_instance: s.whatsapp_instance || "",
        whatsapp_api_key: "", // never loaded from server; type new value to replace
        n8n_webhook_url: s.n8n_webhook_url || "",
        push_notifications_enabled: s.push_notifications_enabled || false,
        // Bot
        bot_enabled: s.bot_enabled || false,
        bot_auto_send: s.bot_auto_send || false,
        bot_send_hour: s.bot_send_hour ?? 9,
        bot_send_minute: s.bot_send_minute ?? 0,
        bot_max_messages_per_day: s.bot_max_messages_per_day ?? 50,
        bot_work_days: s.bot_work_days || ["mon", "tue", "wed", "thu", "fri"],
        bot_escalation_rules: s.bot_escalation_rules || prev.bot_escalation_rules,
        bot_retry_interval_hours: s.bot_retry_interval_hours ?? 24,
        bot_stop_on_payment: s.bot_stop_on_payment ?? true,
        bot_notify_owner: s.bot_notify_owner ?? true,
        bot_greeting_message: s.bot_greeting_message || "Olá {nome}, aqui é do {empresa}.",
        bot_closing_message: s.bot_closing_message || "Qualquer dúvida, entre em contato. Obrigado!",
        bot_send_pix: s.bot_send_pix ?? true,
        bot_send_receipt: s.bot_send_receipt ?? false,
        bot_tone: s.bot_tone || "formal",
        bot_use_ai: s.bot_use_ai || false,
        bot_process_audio: s.bot_process_audio ?? true,
        bot_process_receipts: s.bot_process_receipts ?? true,
        portal_title: s.portal_title || "Portal do Cliente",
        portal_subtitle: s.portal_subtitle || "Acompanhe seus contratos e pagamentos",
        portal_welcome_message: s.portal_welcome_message || "",
        portal_primary_color: s.portal_primary_color || "",
        portal_logo_url: s.portal_logo_url || "",
        portal_contact_phone: s.portal_contact_phone || "",
        portal_contact_email: s.portal_contact_email || "",
        custom_contract_template: s.custom_contract_template || "",
        modules_enabled: { ...DEFAULT_MODULES, ...(s.modules_enabled || {}) },
      }));
    }
  }, [settings]);

  useEffect(() => {
    if (profile) {
      setForm(prev => ({
        ...prev,
        pix_key: profile.pix_key || "",
        pix_key_type: profile.pix_key_type || "cpf",
        billing_message: profile.billing_message || "",
      }));
    }
  }, [profile]);

  const uploadImage = async (
    file: File,
    folder: string,
    field: "company_logo_url" | "favicon_url" | "portal_logo_url",
    setBusy: (b: boolean) => void,
    label: string
  ) => {
    if (!user) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/x-icon"]);
    if (!allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo inválido", description: "Use JPG, PNG, WebP, SVG ou ICO com até 5 MB.", variant: "destructive" });
      return;
    }
    setBusy(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${user.id}/${folder}/${field}.${ext}`;
    try {
      const { error } = await supabase.storage.from("uploads").upload(path, file, { upsert: true, contentType: file.type });
      if (error) {
        toast({ ...friendlyError(error, "Não foi possível enviar o arquivo."), variant: "destructive" });
      } else {
        const url = await getSignedUploadUrl(path);
        if (url) {
          setForm((f) => ({ ...f, [field]: url }));
          toast({ title: `✓ ${label} enviado!` });
        } else {
          toast({ title: "Upload incompleto", description: "O arquivo foi enviado, mas não foi possível gerar o acesso.", variant: "destructive" });
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUploadLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file, "logos", "company_logo_url", setUploadingLogo, "Logo");
  };
  const handleUploadFavicon = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file, "favicons", "favicon_url", setUploadingFavicon, "Favicon");
  };
  const handleUploadPortalLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file, "logos", "portal_logo_url", setUploadingPortalLogo, "Logo do Portal");
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const payload: any = {
      user_id: user.id,
      company_name: form.company_name || null, company_cnpj: form.company_cnpj || null,
      company_address: form.company_address || null, company_phone: form.company_phone || null,
      company_logo_url: form.company_logo_url || null,
      favicon_url: form.favicon_url || null,
      primary_color: form.primary_color,
      accent_color: form.accent_color,
      theme_mode: form.theme_mode as any,
      sidebar_style: form.sidebar_style,
      login_title: form.login_title || null,
      login_subtitle: form.login_subtitle || null,
      footer_text: form.footer_text || null,
      border_radius: form.border_radius,
      font_family: form.font_family,
      default_interest_rate: parseFloat(form.default_interest_rate),
      default_late_fee: 0,
      default_daily_interest: parseFloat(form.default_daily_interest),
      default_frequency: form.default_frequency,
      default_num_installments: form.default_num_installments ? Number(form.default_num_installments) : null,
      default_payment_method: form.default_payment_method || null,
      default_max_interest_cap: form.default_max_interest_cap ? Number(form.default_max_interest_cap) : null,
      // whatsapp_api_key intentionally omitted — saved via edge function settings-set-secret
      n8n_webhook_url: form.n8n_webhook_url || null,
      push_notifications_enabled: form.push_notifications_enabled,
      portal_title: form.portal_title,
      portal_subtitle: form.portal_subtitle,
      portal_welcome_message: form.portal_welcome_message,
      portal_primary_color: form.portal_primary_color,
      portal_logo_url: form.portal_logo_url,
      portal_contact_phone: form.portal_contact_phone,
      portal_contact_email: form.portal_contact_email,
      custom_contract_template: form.custom_contract_template?.trim() || null,
      // Nada de colunas de checkout da plataforma aqui: a view `settings_safe` não expõe essas colunas, então
      // o form as lia como "" e o save gravava NULL — apagando o link de checkout
      // que `get_signup_checkout_url()` usava e derrubando novos cadastros.
      // O link agora mora em `platform_settings` (/admin → Plataforma).
      modules_enabled: form.modules_enabled,
    };
    const { error } = settings
      ? await supabase.from("settings").update(payload).eq("user_id", user.id)
      : await supabase.from("settings").insert(payload);

    // Persist sensitive secrets via dedicated edge function (cols revoked from authenticated)
    let secretError: unknown = null;
    if (form.whatsapp_api_key && form.whatsapp_api_key.trim().length > 0) {
      const { error: secErr } = await supabase.functions.invoke("settings-set-secret", {
        body: { whatsapp_api_key: form.whatsapp_api_key.trim() },
      });
      secretError = secErr;
      if (!secErr) {
        // Clear from local form so the masked placeholder reappears
        setForm(prev => ({ ...prev, whatsapp_api_key: "" }));
      }
    }

    // Save PIX and billing message to profile
    const { error: profileError } = await supabase.from("profiles").update({
      pix_key: form.pix_key.trim() || null,
      pix_key_type: form.pix_key_type,
      billing_message: form.billing_message.trim() || null,
    }).eq("id", user.id);

    setSaving(false);
    if (error || profileError || secretError) {
      toast({
        ...friendlyError(error ?? profileError ?? secretError, "Não foi possível salvar todas as configurações."),
        variant: "destructive",
      });
    } else {
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      toast({ title: "✓ Configurações salvas!" });
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      refreshWhiteLabel();
    }
  };

  const [newTemplate, setNewTemplate] = useState({ name: "", content: "", trigger_days: "" });
  const handleAddTemplate = async () => {
    if (!user || !newTemplate.name || !newTemplate.content) return;
    const { error } = await supabase.from("message_templates").insert({
      user_id: user.id, name: newTemplate.name, content: newTemplate.content,
      trigger_days: newTemplate.trigger_days ? parseInt(newTemplate.trigger_days) : null,
    });
    if (error) toast({ ...friendlyError(error, "Não foi possível adicionar o template."), variant: "destructive" });
    else {
      toast({ title: "✓ Template adicionado!" });
      setNewTemplate({ name: "", content: "", trigger_days: "" });
      queryClient.invalidateQueries({ queryKey: ["message-templates"] });
    }
  };
  const handleDeleteTemplate = async (id: string) => {
    if (!user) return;
    if (!(await confirm("Excluir este template?"))) return;
    const { error } = await supabase.from("message_templates").delete().eq("id", id).eq("user_id", user.id);
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível excluir o template."), variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["message-templates"] });
  };

  const handleAddPresetTemplate = async (preset: { name: string; content: string; trigger_days: number | null }) => {
    if (!user) return;
    const { error } = await supabase.from("message_templates").insert({
      user_id: user.id, name: preset.name, content: preset.content, trigger_days: preset.trigger_days,
    });
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível adicionar o preset."), variant: "destructive" });
      return;
    }
    toast({ title: `✓ "${preset.name}" adicionado!` });
    queryClient.invalidateQueries({ queryKey: ["message-templates"] });
  };

  const inputCls = "w-full px-4 py-2.5 rounded-xl bg-background/50 border border-border/50 text-sm text-foreground placeholder:text-muted-foreground/30 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all outline-hidden";

  // Tudo que as seções consomem. As seções não sabem de Supabase nem de rota —
  // recebem dados e ações prontas, o que as torna testáveis isoladamente.
  const ctx: SettingsCtx = {
    form: form as any, setForm: setForm as any, inputCls, settings,
    templates,
    newTemplate, setNewTemplate,
    onAddTemplate: handleAddTemplate,
    onDeleteTemplate: handleDeleteTemplate,
    onAddPresetTemplate: handleAddPresetTemplate,
    logoInputRef, faviconInputRef, portalLogoInputRef,
    onUploadLogo: handleUploadLogo,
    onUploadFavicon: handleUploadFavicon,
    onUploadPortalLogo: handleUploadPortalLogo,
    uploadingLogo, uploadingFavicon, uploadingPortalLogo,
    notify: (title: string) => toast({ title }),
  };

  // === NAVEGAÇÃO POR GRUPOS ===
  // Esta tela é 100% do ASSINANTE: tudo aqui grava no próprio user_id
  // (tabela `settings` + `profiles`). O que vale para a plataforma inteira
  // (manutenção, cadastro aberto, link de checkout) vive em /admin.
  type Item = { id: string; label: string; icon: any; keywords?: string };
  type Group = { id: string; label: string; items: Item[] };

  const allGroups: Group[] = [
    {
      id: "essencial",
      label: "Essencial",
      items: [
        { id: "empresa", label: "Empresa & Dados", icon: Building, keywords: "cnpj nome empresa razão" },
        { id: "pix", label: "Chave PIX", icon: CreditCard, keywords: "pix chave pagamento recebimento" },
        { id: "padroes", label: "Padrões de Empréstimo", icon: Percent, keywords: "juros multa taxa frequência padrão" },
        { id: "notificacoes", label: "Notificações", icon: Bell, keywords: "push notificação alerta aviso celular" },
      ],
    },
    {
      id: "aparencia",
      label: "Aparência & Módulos",
      items: [
        { id: "marca", label: "Marca, Cores & Tema", icon: Palette, keywords: "white label logo cor tema dark light primária favicon rodapé login" },
        { id: "modulos", label: "Módulos Ativos", icon: Package, keywords: "modulos ativos ligar desligar penhores veiculos metas tarefas" },
        { id: "portal", label: "Portal do Cliente", icon: LayoutDashboard, keywords: "portal cliente cpf branding" },
        { id: "contrato", label: "Modelo de Contrato", icon: FileText, keywords: "contrato pdf template documento" },
      ],
    },
    {
      id: "cobranca",
      label: "Cobrança Automática",
      items: [
        { id: "bot", label: "Bot de Cobranças", icon: Bot, keywords: "bot ia automático mensagem cobrança horário" },
        { id: "templates", label: "Templates de Mensagem", icon: MessageSquare, keywords: "template mensagem padrão" },
        { id: "mensagem", label: "Mensagem Padrão", icon: MessageSquare, keywords: "mensagem padrão cobrança texto" },
      ],
    },
    {
      id: "integracoes",
      label: "Integrações",
      items: [
        { id: "whatsapp", label: "WhatsApp (Evolution)", icon: MessageSquare, keywords: "whatsapp evolution instance api" },
        { id: "webhooks", label: "Webhooks / N8N", icon: Webhook, keywords: "webhook n8n integração http automação externa" },
        { id: "pwa", label: "Aplicativo Mobile", icon: Zap, keywords: "pwa android ios mobile app instalar" },
      ],
    },
  ];

  // Operadores e leitores recebem uma tela enxuta. Controles de marca, módulos,
  // integrações e automações pertencem ao dono/admin da operação.
  const commonAllowed = ownRole === "viewer"
    ? new Set(["notificacoes"])
    : ownRole === "operator"
      ? new Set(["pix", "padroes", "notificacoes", "portal", "contrato", "mensagem"])
      : null;
  const groups = commonAllowed
    ? allGroups.map((group) => ({ ...group, items: group.items.filter((item) => commonAllowed.has(item.id)) }))
        .filter((group) => group.items.length > 0)
    : allGroups;

  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Atalho Ctrl+K / Cmd+K para focar a busca
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleGroups = groups
    .map(g => ({
      ...g,
      items: g.items.filter(i => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return i.label.toLowerCase().includes(q) || (i.keywords || "").toLowerCase().includes(q);
      }),
    }))
    .filter(g => g.items.length > 0);

  // Garante que a aba ativa exista; se busca esconder, vai para a primeira disponível
  useEffect(() => {
    const allIds = visibleGroups.flatMap(g => g.items.map(i => i.id));
    if (allIds.length && !allIds.includes(tab)) setTab(allIds[0]);

  }, [search]);

  const configSteps = [
    { label: "Marca e Logo", done: !!form.company_logo_url, tab: "marca" },
    { label: "Dados da Empresa", done: !!form.company_name, tab: "empresa" },
    { label: "Chave PIX", done: !!form.pix_key, tab: "pix" },
    { label: "WhatsApp", done: !!form.whatsapp_api_url, tab: "whatsapp" },
  ];
  const completedSteps = configSteps.filter(s => s.done).length;
  const progressPercent = (completedSteps / configSteps.length) * 100;

  const activeItem = groups.flatMap(g => g.items).find(i => i.id === tab);
  const activeGroup = groups.find(g => g.items.some(i => i.id === tab));

  const handleInstallApp = async () => {
    if (!canPrompt) {
      setSearch("");
      setTab("pwa");
      return;
    }

    setInstalling(true);
    try {
      const accepted = await install();
      if (accepted) toast({ title: "Aplicativo instalado!", description: "O CredMais já está disponível no seu dispositivo." });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="settings-page max-w-6xl mx-auto pb-20">
      {/* Header sticky */}
      {/* A margem negativa serve para a faixa encostar nas bordas da tela, e por
          isso precisa bater exatamente com o padding do `main`. Esse padding
          muda por faixa de largura (10px, 14px, 20px...), então a faixa lê o
          mesmo valor pela variável `--app-gutter` em vez de fixar `-mx-3`:
          qualquer diferença vira rolagem horizontal no celular. */}
      <div className="app-edge-strip sticky top-0 z-30 py-3 mb-4 bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Settings size={18} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1 basis-44">
            <h1 className="text-lg font-bold text-foreground truncate">Configurações</h1>
            <p className="text-[11px] text-muted-foreground truncate">
              {activeItem ? activeItem.label : "Personalize o sistema"}
              {progressPercent < 100 && ` • ${completedSteps}/${configSteps.length} configurações essenciais`}
            </p>
          </div>
          <div className="hidden md:block relative">
            <input
              ref={searchInputRef}
              id="settings-search-desktop"
              name="settings_search"
              aria-label="Buscar configuração"
              autoComplete="off"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar configuração... (Ctrl+K)"
              className="w-72 pl-8 pr-12 py-2 rounded-lg bg-card border border-border/50 text-sm placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-hidden"
            />
            <Settings size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono px-1.5 py-0.5 rounded border border-border/50 bg-muted/30 text-muted-foreground/70 pointer-events-none">⌘K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleInstallApp()}
            disabled={installed || installing}
            title={installed ? "Aplicativo já instalado" : "Instalar aplicativo"}
            className="h-10 px-3 rounded-lg border border-border/50 bg-card text-foreground text-sm font-semibold flex items-center justify-center gap-2 transition hover:bg-accent/40 disabled:cursor-default disabled:opacity-60 shrink-0"
          >
            {installed ? <Check size={15} className="text-success" /> : <Download size={15} className="text-primary" />}
            <span className="hidden sm:inline">{installed ? "Instalado" : installing ? "Instalando..." : "Instalar"}</span>
          </button>
          <button type="button" onClick={handleSave} disabled={saving} aria-label={saving ? "Salvando configurações" : saved ? "Configurações salvas" : "Salvar configurações"}
            className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition shrink-0 ${
              saved ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            }`}>
            {saved ? <><Check size={15} /> Salvo</> : saving ? "Salvando..." : <><Save size={15} /> Salvar</>}
          </button>
          </div>
        </div>

        {/* Mobile search */}
        <div className="md:hidden relative mt-3">
          <input
            id="settings-search-mobile"
            name="settings_search_mobile"
            aria-label="Buscar configuração"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar configuração..."
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-card border border-border/50 text-sm placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-hidden"
          />
          <Settings size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
        </div>

        {/* Progress bar fina */}
        {progressPercent < 100 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-700" style={{ width: `${progressPercent}%` }} />
            </div>
            <span className="text-[10px] font-semibold text-primary tabular-nums">{Math.round(progressPercent)}%</span>
          </div>
        )}
      </div>

      <section className="settings-overview-grid" aria-label="Resumo das configurações">
        <button type="button" className="settings-overview-card" aria-label="Abrir configuração essencial" onClick={() => setTab(configSteps.find(s => !s.done)?.tab || "marca")}><span className="settings-overview-icon"><Check size={16} aria-hidden="true"/></span><span><small>Configuração essencial</small><strong>{completedSteps}/{configSteps.length} concluídas</strong><em>{completedSteps === configSteps.length ? "Tudo pronto" : "Continue sua configuração"}</em></span></button>
        <button type="button" className="settings-overview-card" aria-label="Abrir módulos ativos" onClick={() => setTab("modulos")}><span className="settings-overview-icon is-purple"><Package size={16} aria-hidden="true"/></span><span><small>Módulos ativos</small><strong>{Object.values(form.modules_enabled).filter(Boolean).length}</strong><em>Recursos disponíveis no app</em></span></button>
        <button type="button" className="settings-overview-card" aria-label="Abrir aparência atual" onClick={() => setTab("marca")}><span className="settings-overview-icon is-amber"><Palette size={16} aria-hidden="true"/></span><span><small>Aparência atual</small><strong>{form.theme_mode === "light" ? "Modo claro" : form.theme_mode === "system" ? "Automático" : "Modo escuro"}</strong><em>Personalize cores e identidade</em></span></button>
      </section>

      <div className="grid md:grid-cols-[240px_1fr] gap-5">
        {/* Sidebar nav */}
        <aside className="settings-sidebar md:sticky md:top-32 md:self-start space-y-4 md:max-h-[calc(100vh-9rem)] md:overflow-y-auto pr-1">
          {visibleGroups.map(group => (
            <div key={group.id}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/60 px-3 mb-1.5">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active = tab === item.id;
                  const done = configSteps.find(s => s.tab === item.id)?.done;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => setTab(item.id)}
                      className={`settings-nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition group ${
                        active
                          ? "bg-primary/12 text-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                      }`}
                    >
                      <Icon size={15} className={active ? "text-primary" : ""} />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {done && <Check size={12} className="text-success shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {isPlatformAdmin && !search.trim() && (
            <Link
              to="/admin"
              className="w-full flex items-start gap-2 px-3 py-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 text-[11px] text-muted-foreground hover:bg-amber-500/10 transition"
            >
              <Shield size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <span className="text-left">
                <span className="block font-semibold text-foreground">Configurações da plataforma</span>
                Manutenção, cadastro e checkout ficam no painel do dono do app.
              </span>
            </Link>
          )}
        </aside>

        {/* Conteúdo */}
        <div className="settings-page-shell rounded-2xl border border-border/30 bg-card/30 backdrop-blur-md p-6 md:p-8 space-y-8 animate-fade-in shadow-xl min-w-0">
          <div className="settings-content-header">
            <div className="settings-content-icon"><Settings size={18} /></div>
            <div className="min-w-0">
              <p>{activeGroup?.label || "Configurações"}</p>
              <h2>{activeItem?.label || "Personalize o sistema"}</h2>
              <span>Altere os dados desta área e salve no topo quando terminar.</span>
            </div>
          </div>
          <SectionRenderer tab={tab} ctx={ctx} />

        </div>
      </div>
    </div>
  );
};
export default Configuracoes;
