import {UploadImage} from '@/components/UploadMedia';
import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const MarcaSection = ({ ctx }: SectionProps) => {
  const {
    form, setForm, inputCls, settings, templates,
    newTemplate, setNewTemplate, onAddTemplate, onDeleteTemplate, onAddPresetTemplate,
    logoInputRef, faviconInputRef, portalLogoInputRef,
    onUploadLogo, onUploadFavicon, onUploadPortalLogo,
    uploadingLogo, uploadingFavicon, uploadingPortalLogo,
    notify,
  } = ctx;

  return (
    <>
            <>
            {/* Identity Section */}
            <div className="space-y-6 p-6 rounded-2xl border border-border/20 bg-background/20 backdrop-blur-xs">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Building size={12} className="text-primary" /> Identidade
              </p>

              {/* Logo */}
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-muted/30 border-2 border-dashed border-border flex items-center justify-center overflow-hidden shrink-0 hover:border-primary/30 transition-colors">
                  {form.company_logo_url ? (
                    <UploadImage access={{kind:'owner'}} src={form.company_logo_url} alt="Logo" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center">
                      <Image size={24} className="text-muted-foreground/30 mx-auto" />
                      <p className="text-[8px] text-muted-foreground mt-1">Logo</p>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input ref={logoInputRef} type="file" accept="image/*" onChange={onUploadLogo} className="hidden" />
                  <button onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-border hover:bg-accent/30 transition-colors disabled:opacity-50 w-full justify-center">
                    <Upload size={14} /> {uploadingLogo ? "Enviando..." : "Enviar Logo"}
                  </button>
                  {form.company_logo_url && (
                    <button onClick={() => setForm({ ...form, company_logo_url: "" })}
                      className="text-xs text-destructive hover:underline block mx-auto">Remover logo</button>
                  )}
                  <p className="text-[10px] text-muted-foreground text-center">PNG ou JPG, máx 2MB</p>
                </div>
              </div>

              {/* Name */}
              <div>
                <label htmlFor="brand-system-name" className="text-xs font-medium text-muted-foreground mb-1.5 block">Nome do Sistema</label>

                <input id="brand-system-name" name="company_name" autoComplete="organization" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="CREDMAIS APP" className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">Aparece no menu lateral, topbar, login e título do navegador</p>
              </div>

              {/* Favicon */}
              <div className="flex items-center gap-4 pt-2 border-t border-border/20">
                <div className="w-14 h-14 rounded-xl bg-muted/30 border-2 border-dashed border-border flex items-center justify-center overflow-hidden shrink-0">
                  {form.favicon_url ? (
                    <UploadImage access={{kind:'owner'}} src={form.favicon_url} alt="Favicon" className="w-full h-full object-cover" />
                  ) : (
                    <Image size={18} className="text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 space-y-1.5">
                  <p className="text-xs font-medium text-foreground">Favicon (ícone da aba)</p>
                  <input ref={faviconInputRef} type="file" accept="image/*" onChange={onUploadFavicon} className="hidden" />
                  <div className="flex gap-2">
                    <button onClick={() => faviconInputRef.current?.click()} disabled={uploadingFavicon}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-accent/30 transition-colors disabled:opacity-50">
                      <Upload size={12} /> {uploadingFavicon ? "Enviando..." : "Enviar favicon"}
                    </button>
                    {form.favicon_url && (
                      <button onClick={() => setForm({ ...form, favicon_url: "" })}
                        className="text-[10px] text-destructive hover:underline">Remover</button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Recomendado: PNG quadrado 64×64 ou 128×128</p>
                </div>
              </div>
            </div>

            {/* Theme Mode */}
            <div className="space-y-3 p-4 rounded-2xl border border-border bg-accent/5">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Sun size={12} className="text-warning" /> Modo do Tema
              </p>
              <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2">
                {[
                  { value: "dark", label: "Escuro", icon: Moon, desc: "Interface dark" },
                  { value: "light", label: "Claro", icon: Sun, desc: "Interface light" },
                  { value: "system", label: "Sistema", icon: Monitor, desc: "Automático" },
                ].map(mode => (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={form.theme_mode === mode.value}
                    onClick={() => setForm({ ...form, theme_mode: mode.value as any })}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      form.theme_mode === mode.value
                        ? "border-primary/40 bg-primary/10 shadow-xs"
                        : "border-border hover:border-primary/20 hover:bg-accent/20"
                    }`}
                  >
                    <mode.icon size={20} className={`mx-auto mb-1.5 ${form.theme_mode === mode.value ? "text-primary" : "text-muted-foreground"}`} />
                    <p className="text-xs font-semibold text-foreground">{mode.label}</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Color Palette */}
            <div className="space-y-4 p-4 rounded-2xl border border-border bg-accent/5">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Palette size={12} className="text-primary" /> Paleta de Cores
              </p>

              {/* Presets Grid */}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    aria-label={`Usar paleta ${preset.label}`}
                    onClick={() => setForm({ ...form, primary_color: preset.primary, accent_color: preset.accent })}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all ${
                      form.primary_color === preset.primary
                        ? "border-primary bg-primary/10 shadow-xs scale-[1.02]"
                        : "border-border hover:border-primary/30 hover:bg-accent/20"
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg shadow-xs shrink-0" style={{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.accent})` }} />
                    <div className="text-left min-w-0">
                      <p className="text-[10px] font-semibold text-foreground truncate">{preset.label}</p>
                      <p className="text-[8px] text-muted-foreground font-mono">{preset.primary}</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Custom Color Pickers */}
              <div className="grid grid-cols-1 min-[400px]:grid-cols-2 items-center gap-4 pt-2">
                <div className="flex items-center gap-2.5 flex-1">
                  <input type="color" name="brand-primary-color" aria-label="Cor principal da marca" value={form.primary_color} onChange={(e) => setForm({ ...form, primary_color: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-border cursor-pointer shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-foreground">Principal</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{form.primary_color}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 flex-1">
                  <input type="color" name="brand-accent-color" aria-label="Cor de destaque da marca" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-border cursor-pointer shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-foreground">Destaque</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{form.accent_color}</p>
                  </div>
                </div>
              </div>
            </div>

            <details className="group rounded-2xl border border-border/30 bg-background/20 backdrop-blur-xs overflow-hidden">
              <summary className="cursor-pointer select-none px-5 py-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                <span className="flex items-center gap-2"><Settings size={12} className="text-primary" /> Personalização Avançada</span>
                <span className="text-[10px] opacity-60 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="p-4 space-y-6 border-t border-border/20">

            {/* Live Preview */}
            <div className="space-y-3 p-4 rounded-2xl border border-border bg-accent/5">

              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Eye size={12} className="text-primary" /> Pré-visualização ao Vivo
              </p>

              {/* Mockup: Sidebar + Header */}
              <div className="rounded-xl border border-border overflow-hidden bg-background">
                {/* Fake sidebar + main area */}
                <div className="flex">
                  {/* Mini sidebar */}
                  <div className="w-[140px] border-r border-border p-3 space-y-2 bg-card shrink-0 hidden sm:block">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0" style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})` }}>
                        {form.company_logo_url && <UploadImage access={{kind:'owner'}} src={form.company_logo_url} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <p className="text-[9px] font-bold truncate" style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                        {form.company_name || "CREDMAIS APP"}
                      </p>
                    </div>
                    {[
                      { icon: LayoutDashboard, label: "Dashboard", active: true },
                      { icon: Users, label: "Clientes", active: false },
                      { icon: Receipt, label: "Contratos", active: false },
                      { icon: Settings, label: "Config", active: false },
                    ].map(item => (
                      <div key={item.label} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[9px] ${
                        item.active ? "text-white font-semibold" : "text-muted-foreground"
                      }`} style={item.active ? { background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})` } : {}}>
                        <item.icon size={10} /> {item.label}
                      </div>
                    ))}
                  </div>

                  {/* Main content mockup */}
                  <div className="flex-1 p-3 space-y-2">
                    {/* Topbar */}
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold text-foreground">Dashboard</p>
                      <div className="flex gap-1">
                        <div className="w-5 h-5 rounded-md" style={{ background: `${form.primary_color}20` }} />
                        <div className="w-5 h-5 rounded-full bg-muted" />
                      </div>
                    </div>
                    {/* Stat cards */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {["R$ 15.000", "R$ 3.200", "12"].map((val, i) => (
                        <div key={i} className="rounded-lg border border-border p-2 bg-card">
                          <div className="w-4 h-4 rounded-md mb-1" style={{ background: `${form.primary_color}15` }}>
                            <div className="w-2 h-2 m-1 rounded-sm" style={{ background: form.primary_color }} />
                          </div>
                          <p className="text-[9px] font-bold text-foreground">{val}</p>
                          <p className="text-[7px] text-muted-foreground">{["Capital", "Lucro", "Clientes"][i]}</p>
                        </div>
                      ))}
                    </div>
                    {/* Button preview */}
                    <div className="flex gap-1.5 pt-1">
                      <div className="px-3 py-1.5 rounded-lg text-[9px] font-bold text-white" style={{ background: `linear-gradient(135deg, ${form.primary_color}, ${form.accent_color})` }}>
                        Novo Cliente
                      </div>
                      <div className="px-3 py-1.5 rounded-lg text-[9px] font-medium border border-border text-foreground">
                        Exportar
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar Style removido — usa "default" sempre */}

            {/* Font Family */}
            <div className="space-y-3 p-4 rounded-2xl border border-border bg-accent/5">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Settings size={12} className="text-primary" /> Tipografia
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { value: "default", label: "Space Grotesk", sample: "Aa 123" },
                  { value: "inter", label: "Inter", sample: "Aa 123" },
                  { value: "poppins", label: "Poppins", sample: "Aa 123" },
                ].map(font => (
                  <button
                    key={font.value}
                    type="button"
                    aria-pressed={form.font_family === font.value}
                    onClick={() => setForm({ ...form, font_family: font.value })}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      form.font_family === font.value
                        ? "border-primary/40 bg-primary/10 shadow-xs"
                        : "border-border hover:border-primary/20 hover:bg-accent/20"
                    }`}
                  >
                    <p className="text-lg font-bold text-foreground mb-0.5">{font.sample}</p>
                    <p className="text-[10px] text-muted-foreground font-medium">{font.label}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Border Radius */}
            <div className="space-y-3 p-4 rounded-2xl border border-border bg-accent/5">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Settings size={12} className="text-primary" /> Arredondamento
              </p>
              <div className="flex items-center gap-4">
                  <input
                    name="border_radius"
                    aria-label="Arredondamento dos cantos"
                  type="range"
                  min="0"
                  max="24"
                  step="2"
                  value={form.border_radius}
                  onChange={(e) => setForm({ ...form, border_radius: e.target.value })}
                  className="flex-1 accent-primary"
                />
                <div className="flex items-center gap-2">
                  <div
                    className="w-12 h-12 border-2 border-primary/40 bg-primary/10"
                    style={{ borderRadius: `${form.border_radius}px` }}
                  />
                  <span className="text-xs font-mono text-muted-foreground">{form.border_radius}px</span>
                </div>
              </div>
            </div>

            {/* Login Page Branding */}
            <div className="space-y-3 p-4 rounded-2xl border border-border bg-accent/5">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Shield size={12} className="text-primary" /> Tela de Login
              </p>
              <div className="space-y-3">
                <div>
                  <label htmlFor="login-brand-title" className="text-xs font-medium text-muted-foreground mb-1.5 block">Título Principal</label>
                  <input id="login-brand-title" name="login_title" value={form.login_title} onChange={(e) => setForm({ ...form, login_title: e.target.value })} placeholder="CREDMAIS APP" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="login-brand-subtitle" className="text-xs font-medium text-muted-foreground mb-1.5 block">Subtítulo</label>
                  <input id="login-brand-subtitle" name="login_subtitle" value={form.login_subtitle} onChange={(e) => setForm({ ...form, login_subtitle: e.target.value })} placeholder="SISTEMA DE GESTÃO DE EMPRÉSTIMOS" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="space-y-3 p-4 rounded-2xl border border-border bg-accent/5">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Info size={12} className="text-primary" /> Rodapé
              </p>
              <div>
                <label htmlFor="brand-footer-text" className="text-xs font-medium text-muted-foreground mb-1.5 block">Texto do Rodapé</label>
                <input id="brand-footer-text" name="footer_text" value={form.footer_text} onChange={(e) => setForm({ ...form, footer_text: e.target.value })} placeholder={`© ${new Date().getFullYear()} CREDMAIS APP · TODOS OS DIREITOS RESERVADOS`} className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">Aparece no login e no portal do cliente</p>
              </div>
            </div>
              </div>
            </details>
            </>
    </>
  );
};

export default MarcaSection;
