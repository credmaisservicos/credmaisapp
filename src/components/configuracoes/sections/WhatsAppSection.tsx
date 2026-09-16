import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const WhatsAppSection = ({ ctx }: SectionProps) => {
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
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-success/8 flex items-center justify-center"><MessageSquare size={16} className="text-success" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Integração WhatsApp</h2>
                <p className="text-xs text-muted-foreground">Evolution API para envio automático</p>
              </div>
            </div>
            <div className="space-y-4">
              <div><label htmlFor="whatsapp-api-url" className="text-label mb-1.5 block">URL da API</label><input id="whatsapp-api-url" name="whatsapp_api_url" autoComplete="url" value={form.whatsapp_api_url} onChange={(e) => setForm({ ...form, whatsapp_api_url: e.target.value })} placeholder="https://api.exemplo.com" className={inputCls} /></div>
              <div>
                <label className="text-label mb-1.5 block">
                  API Key {(settings as any)?.whatsapp_api_key_configured && <span className="ml-2 text-[10px] text-success font-bold">✓ Configurada</span>}
                </label>
                <input id="whatsapp-api-key" name="whatsapp_api_key" autoComplete="new-password" type="password" value={form.whatsapp_api_key} onChange={(e) => setForm({ ...form, whatsapp_api_key: e.target.value })} placeholder={(settings as any)?.whatsapp_api_key_configured ? "••••••••  (deixe vazio para manter)" : "Cole a chave da Evolution API"} className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">Por segurança, a chave nunca é exibida. Digite uma nova para substituir.</p>
              </div>
              <div>
                <label className="text-label mb-1.5 block">Nome da instância</label>
                <input
                  id="whatsapp-instance"
                  name="whatsapp_instance"
                  autoComplete="off"
                  value={form.whatsapp_instance}
                  onChange={(e) => setForm({ ...form, whatsapp_instance: e.target.value })}
                  placeholder="instancia-da-sua-empresa"
                  className={inputCls}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  É o nome da instância criada no Evolution. Sem ele o bot não consegue
                  enviar nem receber mensagem, mesmo com URL e chave corretas.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-info/5 border border-info/20">
                <p className="text-[11px] text-info leading-relaxed">
                  💡 No painel do Evolution, aponte o webhook desta instância para
                  <code className="mx-1 px-1 rounded bg-muted/40 font-mono text-[10px]">/functions/v1/whatsapp-webhook?secret=…</code>
                  usando o segredo cadastrado. Sem o segredo na URL, as mensagens são recusadas.
                </p>
              </div>
            </div>
          </>
    </>
  );
};

export default WhatsAppSection;
