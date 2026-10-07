import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const ModulosSection = ({ ctx }: SectionProps) => {
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
          <div className="space-y-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><Package size={16} className="text-primary" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Módulos Ativos</h2>
                <p className="text-xs text-muted-foreground">Ligue ou desligue módulos para simplificar o menu lateral</p>
              </div>
            </div>

            {([
              { group: "Visão Geral & Relatórios", items: [
                ["analises", "Análises", "Gráficos e indicadores avançados"],
                ["relatorios", "Relatórios", "Relatórios em PDF e Excel"],
              ]},
              { group: "Operação", items: [
                ["inadimplencia", "Inadimplência", "Painel de clientes em atraso"],
                ["cobradores", "Cobradores", "Gestão de cobradores externos"],
                ["portais", "Portais (QR Code)", "Portal do cliente e do cobrador"],
              ]},
              { group: "Financeiro", items: [
                ["lucros", "Lucros", "Painel de lucros gerados"],
                ["gastos", "Gastos", "Controle de despesas"],
              ]},
              { group: "Comunicação", items: [
                ["comunicacao_inbox", "Inbox WhatsApp", "Conversas do WhatsApp dentro do app"],
                ["chat_interno", "Chat interno", "Chat entre operadores"],
              ]},
              { group: "Ferramentas", items: [
                ["simulador", "Simulador", "Simulador de empréstimos"],
                ["metas", "Metas", "Definição e acompanhamento de metas"],
                ["tarefas", "Tarefas", "Lista de tarefas pessoais"],
                ["anotacoes", "Anotações", "Bloco de notas"],
                ["planilha", "Planilha", "Planilha estilo Excel"],
                ["puxada_dados", "Puxada de Dados", "Consulta CPF/CNPJ"],
              ]},
              { group: "Módulos extras (off por padrão)", items: [
                ["penhores", "Penhores", "Gestão de itens em penhor"],
                ["veiculos", "Veículos", "Gestão de veículos financiados"],
                ["alugueis", "Aluguéis", "Gestão de aluguéis"],
                ["estoque", "Estoque", "Controle de estoque"],
              ]},
            ] as { group: string; items: [ModuleKey, string, string][] }[]).map(section => (
              <div key={section.group} className="rounded-2xl border border-border/30 bg-background/20 p-4 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">{section.group}</p>
                <div className="space-y-1.5">
                  {section.items.map(([key, label, desc]) => {
                    const enabled = form.modules_enabled[key] ?? false;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, modules_enabled: { ...f.modules_enabled, [key]: !enabled } }))}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition text-left ${enabled ? "border-primary/40 bg-primary/8" : "border-border/40 hover:bg-accent/20"}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-[11px] text-muted-foreground">{desc}</p>
                        </div>
                        <div className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${enabled ? "bg-primary" : "bg-muted"}`}>
                          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs text-muted-foreground flex gap-2">
              <Info size={14} className="text-primary shrink-0 mt-0.5" />
              <span>As alterações aparecem no menu lateral após salvar e recarregar a página. Módulos desligados continuam acessíveis pela URL direta — isso apenas limpa o menu.</span>
            </div>
          </div>
    </>
  );
};

export default ModulosSection;
