import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const EmpresaSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><Building size={16} className="text-primary" /></div>
              <h2 className="font-semibold text-foreground">Dados da Empresa</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label htmlFor="company-name" className="text-label mb-1.5 block">Nome da Empresa</label><input id="company-name" name="company_name" autoComplete="organization" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Minha Empresa" className={inputCls} /></div>
              <div><label htmlFor="company-cnpj" className="text-label mb-1.5 block">CNPJ</label><input id="company-cnpj" name="company_cnpj" value={form.company_cnpj} onChange={(e) => setForm({ ...form, company_cnpj: e.target.value })} placeholder="00.000.000/0001-00" className={inputCls} /></div>
              <div className="sm:col-span-2">
                <label htmlFor="company-address" className="text-label mb-1.5 block">Endereço</label>
                <input id="company-address" name="company_address" autoComplete="street-address" value={form.company_address} onChange={(e) => setForm({ ...form, company_address: e.target.value })} placeholder="Rua, número, bairro, cidade/UF" className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Entra na qualificação do credor no contrato, pela variável <code className="bg-muted px-1 rounded">{"{{empresa_endereco}}"}</code>. Preencha uma vez e vale para todos.
                </p>
              </div>
              <div>
                <label htmlFor="company-phone" className="text-label mb-1.5 block">Telefone</label>
                <input id="company-phone" name="company_phone" autoComplete="tel" value={form.company_phone} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} placeholder="(00) 00000-0000" className={inputCls} />
                <p className="text-[10px] text-muted-foreground mt-1">Variável <code className="bg-muted px-1 rounded">{"{{empresa_telefone}}"}</code>.</p>
              </div>
            </div>
          </>
    </>
  );
};

export default EmpresaSection;
