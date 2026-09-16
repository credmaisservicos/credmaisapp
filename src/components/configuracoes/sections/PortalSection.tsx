import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const PortalSection = ({ ctx }: SectionProps) => {
  const {
    form, setForm, inputCls, settings, templates,
    newTemplate, setNewTemplate, onAddTemplate, onDeleteTemplate, onAddPresetTemplate,
    logoInputRef, faviconInputRef, portalLogoInputRef,
    onUploadLogo, onUploadFavicon, onUploadPortalLogo,
    uploadingLogo, uploadingFavicon, uploadingPortalLogo,
    notify,
  } = ctx;
  const portalColor = /^#[0-9a-f]{6}$/i.test(form.portal_primary_color)
    ? form.portal_primary_color
    : /^#[0-9a-f]{6}$/i.test(form.primary_color) ? form.primary_color : "#f59e0b";

  const copyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/portal-cliente`);
      notify("Link copiado!");
    } catch {
      notify("Não foi possível copiar. Selecione o link manualmente.");
    }
  };

  return (
    <>
          <div className="space-y-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><LayoutDashboard size={16} className="text-primary" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Configurações do Portal do Cliente</h2>
                <p className="text-xs text-muted-foreground">Personalize a experiência do seu cliente ao acessar o portal</p>
              </div>
            </div>

            {/* Link do Portal */}
            <div className="space-y-3 p-4 rounded-2xl border border-primary/20 bg-primary/5 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Zap size={12} /> Link de Acesso ao Portal
                </p>
                <button type="button" onClick={() => void copyPortalLink()} className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                  <Copy size={10} aria-hidden="true" /> Copiar Link
                </button>
              </div>
              <div className="flex items-center gap-2 bg-card border border-border rounded-xl px-3 py-2">
                <p className="text-xs text-muted-foreground truncate flex-1 font-mono">
                  {window.location.origin}/portal-cliente
                </p>
                <button type="button" onClick={() => window.open(`${window.location.origin}/portal-cliente`, "_blank", "noopener,noreferrer")} className="p-1 rounded-lg hover:bg-accent text-muted-foreground transition-colors" title="Abrir link do portal" aria-label="Abrir link do portal">
                  <ExternalLink size={14} aria-hidden="true" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Este link é único e pode ser compartilhado com todos os seus clientes. Cada um enxerga apenas os próprios dados.
              </p>
            </div>

            <div className="space-y-2 rounded-2xl border border-success/20 bg-success/5 p-4">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Shield size={12} className="text-success" /> Acesso simplificado
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Seus clientes entram somente com o CPF. O acesso é protegido por limite de tentativas e cada cliente visualiza apenas os próprios dados.
              </p>
            </div>


            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4 p-4 rounded-2xl border border-border bg-accent/5">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Textos e Identidade</p>
                
                <div>
                  <label htmlFor="portal-title" className="text-xs font-medium text-muted-foreground mb-1.5 block">Título do Portal</label>
                  <input id="portal-title" name="portal_title" value={form.portal_title} onChange={(e) => setForm({ ...form, portal_title: e.target.value })} placeholder="Portal do Cliente" className={inputCls} />
                </div>

                <div>
                  <label htmlFor="portal-subtitle" className="text-xs font-medium text-muted-foreground mb-1.5 block">Subtítulo do Portal</label>
                  <input id="portal-subtitle" name="portal_subtitle" value={form.portal_subtitle} onChange={(e) => setForm({ ...form, portal_subtitle: e.target.value })} placeholder="Acompanhe seus contratos e pagamentos" className={inputCls} />
                </div>

                <div>
                  <label htmlFor="portal-welcome-message" className="text-xs font-medium text-muted-foreground mb-1.5 block">Mensagem de Boas-vindas</label>
                  <textarea id="portal-welcome-message" name="portal_welcome_message" value={form.portal_welcome_message} onChange={(e) => setForm({ ...form, portal_welcome_message: e.target.value })} placeholder="Olá, seja bem-vindo ao seu portal financeiro." className={`${inputCls} min-h-[80px] resize-none`} />
                </div>
              </div>

              <div className="space-y-4 p-4 rounded-2xl border border-border bg-accent/5">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Canais de Contato</p>
                
                <div>
                  <label htmlFor="portal-contact-phone" className="text-xs font-medium text-muted-foreground mb-1.5 block">Telefone de Suporte</label>
                  <input id="portal-contact-phone" name="portal_contact_phone" autoComplete="tel" value={form.portal_contact_phone} onChange={(e) => setForm({ ...form, portal_contact_phone: e.target.value })} placeholder="(00) 00000-0000" className={inputCls} />
                </div>

                <div>
                  <label htmlFor="portal-contact-email" className="text-xs font-medium text-muted-foreground mb-1.5 block">E-mail de Contato</label>
                  <input id="portal-contact-email" name="portal_contact_email" autoComplete="email" type="email" value={form.portal_contact_email} onChange={(e) => setForm({ ...form, portal_contact_email: e.target.value })} placeholder="suporte@empresa.com" className={inputCls} />
                </div>

                <div>
                  <label htmlFor="portal-primary-color" className="text-xs font-medium text-muted-foreground mb-1.5 block">Cor Primária do Portal</label>
                  <div className="flex gap-2">
                    <input id="portal-primary-color-picker" name="portal_primary_color_picker" type="color" value={portalColor} onChange={(e) => setForm({ ...form, portal_primary_color: e.target.value })} aria-label="Cor primária do portal" className="h-10 w-10 shrink-0 rounded-lg border border-border bg-transparent cursor-pointer" />
                    <input id="portal-primary-color" name="portal_primary_color" value={form.portal_primary_color || form.primary_color} onChange={(e) => setForm({ ...form, portal_primary_color: e.target.value })} placeholder="#f59e0b" aria-label="Cor primária em hexadecimal" className={inputCls} />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-border bg-accent/5 space-y-3">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Image size={12} className="text-primary" /> Logo Exclusiva do Portal (opcional)
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="w-16 h-16 rounded-xl bg-muted/30 border-2 border-dashed border-border flex items-center justify-center overflow-hidden shrink-0">
                  {form.portal_logo_url ? (
                    <img src={form.portal_logo_url} alt="Logo Portal" className="w-full h-full object-cover" />
                  ) : form.company_logo_url ? (
                    <img src={form.company_logo_url} alt="Logo padrão" className="w-full h-full object-cover opacity-50" />
                  ) : (
                    <Image size={20} className="text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 space-y-1.5">
                  <input ref={portalLogoInputRef} type="file" accept="image/*" onChange={onUploadPortalLogo} className="hidden" />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button onClick={() => portalLogoInputRef.current?.click()} disabled={uploadingPortalLogo}
                      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-accent/30 transition-colors disabled:opacity-50">
                      <Upload size={12} /> {uploadingPortalLogo ? "Enviando..." : "Enviar logo do portal"}
                    </button>
                    {form.portal_logo_url && (
                      <button onClick={() => setForm({ ...form, portal_logo_url: "" })}
                        className="text-[10px] text-destructive hover:underline self-center">Remover</button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Se vazio, o portal usará a logo definida na aba <strong>Marca</strong>.
                  </p>
                </div>
              </div>
            </div>
          </div>
    </>
  );
};

export default PortalSection;
