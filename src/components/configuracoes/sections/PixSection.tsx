import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const PixSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-success/8 flex items-center justify-center"><CreditCard size={16} className="text-success" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Chave PIX</h2>
                <p className="text-xs text-muted-foreground">Configurar chave PIX para recebimentos</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pix-key-type" className="text-label mb-1.5 block">Tipo da Chave</label>
                <select id="pix-key-type" name="pix_key_type" value={form.pix_key_type} onChange={(e) => setForm({ ...form, pix_key_type: e.target.value })} className={inputCls}>
                  <option value="cpf">CPF</option>
                  <option value="cnpj">CNPJ</option>
                  <option value="email">Email</option>
                  <option value="phone">Telefone</option>
                  <option value="random">Chave Aleatória</option>
                </select>
              </div>
              <div>
                <label htmlFor="pix-key" className="text-label mb-1.5 block">Chave PIX</label>
                <input id="pix-key" name="pix_key" value={form.pix_key} onChange={(e) => setForm({ ...form, pix_key: e.target.value })} placeholder="Sua chave PIX" className={inputCls} />
              </div>
            </div>
            <div className="p-3 rounded-xl bg-info/5 border border-info/20">
              <p className="text-[11px] text-info">💡 A chave PIX será exibida no portal do cliente para facilitar o pagamento.</p>
            </div>
          </>
    </>
  );
};

export default PixSection;
