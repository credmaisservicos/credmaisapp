import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import VariaveisDisponiveis from "../VariaveisDisponiveis";
import VariaveisNaoReconhecidas from "../VariaveisNaoReconhecidas";
import type { SectionProps } from "../types";

const MensagemSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-warning/8 flex items-center justify-center"><MessageSquare size={16} className="text-warning" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Mensagem Padrão de Cobrança</h2>
                <p className="text-xs text-muted-foreground">Mensagem enviada automaticamente nas cobranças</p>
              </div>
            </div>
            <div>
              <VariaveisDisponiveis onCopiar={(t) => { navigator.clipboard?.writeText(t); notify(`${t} copiado`); }} />
              <textarea
                id="billing-message"
                name="billing_message"
                aria-label="Mensagem padrão de cobrança"
                value={form.billing_message}
                onChange={(e) => setForm({ ...form, billing_message: e.target.value })}
                rows={5}
                className={`${inputCls} resize-none`}
                placeholder="{empresa}: {nome}, identificamos um atraso em sua parcela de {valor}..."
              />
              <VariaveisNaoReconhecidas texto={form.billing_message} />
            </div>
            <div className="space-y-2">
              <p className="text-label">Mensagens Prontas</p>
              {[
                { label: "Formal", text: "[Nome da Empresa]: Sr(a) [Nome do Cliente], identificamos um atraso em sua parcela de empréstimo. O valor pendente é de R$ [Valor da Parcela]. Por favor, entre em contato para regularizar." },
                { label: "Amigável", text: "Olá [Nome do Cliente]! 😊 Aqui é da [Nome da Empresa]. Notamos que sua parcela de R$ [Valor da Parcela] ainda não foi paga. Podemos ajudar? Entre em contato conosco!" },
                { label: "Urgente", text: "⚠️ [Nome da Empresa] informa: [Nome do Cliente], sua parcela de R$ [Valor da Parcela] está em atraso. Regularize imediatamente para evitar juros adicionais e restrições no seu CPF." },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={form.billing_message === preset.text}
                  onClick={() => setForm({ ...form, billing_message: preset.text })}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    form.billing_message === preset.text
                      ? "border-primary/40 bg-primary/5"
                      : "border-border hover:border-primary/20 hover:bg-primary/5"
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground">{preset.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{preset.text}</p>
                </button>
              ))}
            </div>
          </>
    </>
  );
};

export default MensagemSection;
