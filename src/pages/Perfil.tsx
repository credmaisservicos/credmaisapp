import { useState, useEffect } from "react";
import { User, Camera, Save, Key, Mail, Shield, Check, MessageSquare, LogOut, CreditCard, Clock, ExternalLink, Infinity as InfinityIcon, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useNavigate, Link } from "react-router-dom";
import { formatBR } from "@/lib/dateUtils";
import { getSignedUploadUrl } from "@/lib/storage";
import DangerZone from "@/components/perfil/DangerZone";
import { friendlyError } from "@/lib/friendlyError";
import MFACard from "@/components/perfil/MFACard";
import { isValidCNPJ, isValidCPF, onlyDigits } from "@/lib/cpfCnpj";
import { hasProfileEntitlement } from "@/lib/entitlement";
import { resolveProfileAccessEnd } from "@/lib/profileAccess";

const Perfil = () => {
  const { user, profile, signOut, isPlatformAdmin, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "", email: "", pix_key: "", pix_key_type: "cpf", billing_message: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name || "", email: profile.email || "",
        pix_key: profile.pix_key || "", pix_key_type: profile.pix_key_type || "cpf",
        billing_message: profile.billing_message || "",
      });
      setAvatarPreview(profile.avatar_url || null);
    }
  }, [profile]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ title: "Avatar inválido", description: "Use JPG, PNG ou WebP com até 5 MB.", variant: "destructive" });
      e.target.value = "";
      return;
    }
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  useEffect(() => () => {
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  const handleSave = async () => {
    if (!user) return;
    if (form.name.trim().length < 2) {
      toast({ title: "Nome inválido", description: "Informe pelo menos 2 caracteres.", variant: "destructive" });
      return;
    }
    const pix = form.pix_key.trim();
    const pixValid = !pix
      || (form.pix_key_type === "cpf" && isValidCPF(pix))
      || (form.pix_key_type === "cnpj" && isValidCNPJ(pix))
      || (form.pix_key_type === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pix))
      || (form.pix_key_type === "phone" && [10, 11].includes(onlyDigits(pix).length))
      || (form.pix_key_type === "random" && pix.length >= 8);
    if (!pixValid) {
      toast({ title: "Chave PIX inválida", description: "Confira a chave e o tipo selecionado.", variant: "destructive" });
      return;
    }
    setSaving(true);
    let avatar_url = profile?.avatar_url || null;
    if (avatarFile) {
      const ext = avatarFile.type === "image/png" ? "png" : avatarFile.type === "image/webp" ? "webp" : "jpg";
      const path = `${user.id}/avatars/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage.from("uploads").upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
      if (uploadError) {
        setSaving(false);
        toast({ ...friendlyError(uploadError, "Não foi possível enviar o avatar."), variant: "destructive" });
        return;
      }
      const signed = await getSignedUploadUrl(path);
      if (!signed) {
        setSaving(false);
        toast({ title: "Avatar não salvo", description: "Não foi possível gerar o acesso à imagem.", variant: "destructive" });
        return;
      }
      avatar_url = signed;
    }
    const { error } = await supabase.from("profiles").update({
      name: form.name.trim(), pix_key: form.pix_key.trim() || null,
      pix_key_type: form.pix_key_type, billing_message: form.billing_message.trim() || null, avatar_url,
    }).eq("id", user.id).select("id").single();
    setSaving(false);
    if (error) toast({ ...friendlyError(error, "Não foi possível salvar o perfil."), variant: "destructive" });
    else {
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      toast({ title: "✓ Perfil atualizado!" });
      setAvatarFile(null);
      await refreshProfile();
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const inputCls = "w-full px-4 py-3 rounded-2xl bg-card border border-border text-foreground placeholder:text-muted-foreground text-sm input-enhanced";
  const isLifetime = isPlatformAdmin || profile?.subscription_type === "lifetime";
  const effectiveAccess = resolveProfileAccessEnd(profile?.trial_ends_at, profile?.subscription_expires_at);
  const accessEnd = effectiveAccess.value;
  const accessActive = isPlatformAdmin || hasProfileEntitlement({
    subscriptionType: profile?.subscription_type,
    trialEndsAt: profile?.trial_ends_at,
    subscriptionExpiresAt: profile?.subscription_expires_at,
  });
  const accessTitle = isLifetime ? "Acesso Vitalício" : effectiveAccess.source === "trial" ? "Período de teste" : "Assinatura";

  return (
    <div className="space-y-5 max-w-2xl mx-auto animate-fade-in">
      <div className="page-hero">
        <div className="page-hero-content flex items-center gap-3">
          <div className="page-hero-icon">
            <User size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-shimmer">Meu Perfil</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Gerencie suas informações pessoais e chave PIX</p>
          </div>
        </div>
      </div>

      {/* Avatar Card */}
      <div className="rounded-2xl border border-border bg-card p-6 card-shine">
        <div className="flex items-center gap-5">
          <div className="relative group">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary overflow-hidden ring-2 ring-primary/20 transition-all group-hover:ring-primary/40">
              {avatarPreview ? <img src={avatarPreview} alt="" className="w-20 h-20 rounded-2xl object-cover" /> : profile?.name?.charAt(0)?.toUpperCase() || "U"}
            </div>
            <label className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer hover:scale-110 transition-transform" style={{ background: "var(--gradient-button)" }}>
              <Camera size={13} className="text-white" />
              <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
            </label>
          </div>
          <div className="flex-1">
            <p className="font-bold text-foreground text-lg">{profile?.name || "Usuário"}</p>
            <p className="text-sm text-muted-foreground">{profile?.email}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline" className="bg-gradient-to-r from-amber-500/15 to-yellow-500/15 text-amber-400 border-amber-500/30 text-[10px] font-bold">
                {isLifetime ? <InfinityIcon size={10} className="mr-1" /> : <CreditCard size={10} className="mr-1" />} {accessTitle}
              </Badge>
              {isPlatformAdmin && (
                <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-[10px]">
                  <Shield size={10} className="mr-1" /> Admin
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Access status */}
      <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.08] via-card to-yellow-500/[0.05] p-6 space-y-4 card-shine relative overflow-hidden group">
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500/20 to-yellow-500/20 flex items-center justify-center ring-1 ring-amber-500/30">
              {isLifetime ? <InfinityIcon size={18} className="text-amber-400" /> : <CreditCard size={18} className="text-amber-400" />}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{accessTitle}</h2>
              <p className="text-[11px] text-muted-foreground">Situação atual do seu acesso</p>
            </div>
          </div>
          <Badge className={`${accessActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-destructive/10 text-destructive border-destructive/30"} text-[10px] font-bold`}>
            <Sparkles size={10} className="mr-1" /> {accessActive ? "Ativo" : "Expirado"}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 relative z-10 pt-2">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Status</p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-sm font-bold text-foreground">{accessActive ? "Acesso liberado" : "Acesso expirado"}</p>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Validade</p>
            <div className="flex items-center gap-2">
              {isLifetime ? <InfinityIcon size={14} className="text-amber-400" /> : <Clock size={14} className="text-amber-400" />}
              <p className="text-sm font-bold text-foreground">{isLifetime ? "Sem expiração" : accessEnd ? formatBR(accessEnd) : "Não informada"}</p>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-amber-500/15 relative z-10">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isLifetime
              ? <>✨ Você tem <span className="font-semibold text-foreground">acesso ilimitado e vitalício</span> ao sistema.</>
              : accessActive
                ? <>Seu acesso está ativo até <span className="font-semibold text-foreground">{accessEnd ? formatBR(accessEnd) : "a data contratada"}</span>.</>
                : <>Seu acesso não está ativo. Consulte os planos ou fale com o suporte para renovar.</>}
          </p>
        </div>

        <InfinityIcon className="absolute -right-6 -bottom-6 w-36 h-36 text-amber-500/[0.04] -rotate-12 group-hover:rotate-0 transition-transform duration-700" />
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4 card-shine">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><User size={16} className="text-primary" /></div>
          <h2 className="text-sm font-semibold text-foreground">Informações</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-label mb-1.5 block">Nome</label>
            <input type="text" name="profile-name" autoComplete="name" aria-label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="text-label mb-1.5 block">Email</label>
            <div className="relative">
              <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input type="email" name="profile-email" autoComplete="email" aria-label="Email" value={form.email} disabled className={`${inputCls} pl-9 bg-muted/30 cursor-not-allowed opacity-60`} />
            </div>
          </div>
        </div>
      </div>

      {/* PIX */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4 card-shine">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-success/8 flex items-center justify-center"><Key size={16} className="text-success" /></div>
          <h2 className="text-sm font-semibold text-foreground">Chave PIX</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-label mb-1.5 block">Tipo</label>
            <select name="profile-pix-key-type" aria-label="Tipo da chave PIX" value={form.pix_key_type} onChange={(e) => setForm({ ...form, pix_key_type: e.target.value })} className={inputCls}>
              <option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">Email</option><option value="phone">Telefone</option><option value="random">Chave Aleatória</option>
            </select>
          </div>
          <div>
            <label className="text-label mb-1.5 block">Chave</label>
            <input type="text" name="profile-pix-key" aria-label="Chave PIX" value={form.pix_key} onChange={(e) => setForm({ ...form, pix_key: e.target.value })} placeholder="Sua chave PIX" className={inputCls} />
          </div>
        </div>
      </div>

      {/* Billing message */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4 card-shine">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-info/8 flex items-center justify-center"><MessageSquare size={16} className="text-info" /></div>
          <h2 className="text-sm font-semibold text-foreground">Mensagem de Cobrança</h2>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Variáveis: <code className="text-primary font-mono">{"{nome}"}</code>, <code className="text-primary font-mono">{"{parcela}"}</code>, <code className="text-primary font-mono">{"{valor}"}</code>, <code className="text-primary font-mono">{"{data}"}</code>
        </p>
        <textarea
          value={form.billing_message}
          onChange={(e) => setForm({ ...form, billing_message: e.target.value })}
          rows={4}
          className={`${inputCls} resize-none`}
          placeholder="Olá {nome}, sua parcela {parcela} de R$ {valor} venceu em {data}..."
        />
      </div>

      {/* 2FA (TOTP) */}
      <MFACard />

      {/* Zona LGPD: exportar / apagar conta */}
      <DangerZone />

      {/* Link política */}
      <div className="text-center pt-2">
        <Link to="/privacidade" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4">
          Política de Privacidade (LGPD)
        </Link>
      </div>

      {/* Actions */}
      <div className="mobile-dock sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl glass-strong border border-border/50">
        <button onClick={handleSignOut} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors focus-ring">
          <LogOut size={16} /> Sair
        </button>
        <button onClick={handleSave} disabled={saving}
          className={saved ? "btn-premium bg-success !shadow-none" : "btn-premium"}>
          {saved ? <><Check size={16} /> Salvo!</> : <><Save size={16} /> {saving ? "Salvando..." : "Salvar Alterações"}</>}
        </button>
      </div>
    </div>
  );
};

export default Perfil;
