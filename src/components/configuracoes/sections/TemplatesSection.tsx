import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS, TEMPLATE_PRESETS } from "../constants";
import VariaveisDisponiveis from "../VariaveisDisponiveis";
import VariaveisNaoReconhecidas from "../VariaveisNaoReconhecidas";
import type { SettingsCtx } from "../types";

const TemplatesSection = ({ ctx }: {ctx:Pick<SettingsCtx,'templates'|'newTemplate'|'setNewTemplate'|'onAddTemplate'|'onDeleteTemplate'|'onAddPresetTemplate'|'inputCls'|'notify'>}) => {
  const {
    inputCls, templates,
    newTemplate, setNewTemplate, onAddTemplate, onDeleteTemplate, onAddPresetTemplate,
    notify,
  } = ctx;

  return (
    <>
          <>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><MessageSquare size={16} className="text-primary" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Templates de Mensagem</h2>
                <p className="text-xs text-muted-foreground">Escreva a mensagem e use variáveis para os dados do cliente.</p>
              </div>
            </div>

            {/* Templates prontos para usar */}
            <div className="space-y-2">
              <p className="text-label">Templates Prontos</p>
              <p className="text-[11px] text-muted-foreground mb-2">Clique para adicionar ao seu sistema</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TEMPLATE_PRESETS.map((preset, idx) => {
                  const alreadyAdded = templates.some((t: any) => t.name === preset.name);
                  return (
                    <button
                      key={idx}
                      disabled={alreadyAdded}
                      onClick={() => onAddPresetTemplate(preset)}
                      className={`text-left p-3 rounded-xl border transition-colors ${
                        alreadyAdded
                          ? "border-success/30 bg-success/5 opacity-60 cursor-default"
                          : "border-border hover:border-primary/30 hover:bg-primary/5 cursor-pointer"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">{preset.name}</p>
                        {alreadyAdded ? (
                          <Check size={12} className="text-success shrink-0" />
                        ) : (
                          <Plus size={12} className="text-primary shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{preset.content}</p>
                      {preset.trigger_days !== null && (
                        <span className="inline-block mt-1.5 text-[9px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded-md">
                          {preset.trigger_days === 0 ? "No vencimento" : `${preset.trigger_days}d de atraso`}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Templates existentes do usuário */}
            {templates.length > 0 && (
              <div className="space-y-3 border-t border-border pt-5">
                <p className="text-label">Seus Templates</p>
                {templates.map((t: any) => (
                  <div key={t.id} className="flex items-start gap-3 p-4 rounded-2xl bg-muted/20 border border-border group">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{t.content}</p>
                      {t.trigger_days !== null && (
                        <div className="flex items-center gap-1 mt-2">
                          <AlertTriangle size={10} className="text-warning" />
                          <span className="text-[10px] text-warning font-medium">
                            {t.trigger_days === 0 ? "No dia do vencimento" : `Dispara após ${t.trigger_days} dia(s) de atraso`}
                          </span>
                        </div>
                      )}
                    </div>
                    <button aria-label={`Excluir modelo ${t.name}`} onClick={() => onDeleteTemplate(t.id)} className="min-h-11 min-w-11 text-muted-foreground hover:text-destructive p-2"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Criar template personalizado */}
            <div className="border-t border-border pt-5 space-y-3">
              <p className="text-sm font-semibold text-foreground">Template Personalizado</p>
              <VariaveisDisponiveis onCopiar={(t) => {
                navigator.clipboard?.writeText(t);
                notify(`${t} copiado`);
              }} />
              <input id="template-name" name="template_name" value={newTemplate.name} onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })} placeholder="Nome do template" className={inputCls} aria-label="Nome do template" />
              <textarea id="template-content" name="template_content" value={newTemplate.content} onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })} placeholder="Olá {nome}, sua parcela de {valor} está atrasada há {dias} dias..." className={`${inputCls} min-h-[80px] resize-none`} aria-label="Conteúdo do template" />
              <VariaveisNaoReconhecidas texto={newTemplate.content} />
              <input id="template-trigger-days" name="template_trigger_days" type="number" value={newTemplate.trigger_days} onChange={(e) => setNewTemplate({ ...newTemplate, trigger_days: e.target.value })} placeholder="Dias de atraso para disparar (opcional)" className={inputCls} aria-label="Dias de atraso para disparar" />
              <button type="button" onClick={onAddTemplate} disabled={!newTemplate.name || !newTemplate.content}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-ring"
                style={{ background: "var(--gradient-button)" }}>
                <Plus size={14} /> Adicionar Template
              </button>
            </div>
          </>
    </>
  );
};

export default TemplatesSection;
