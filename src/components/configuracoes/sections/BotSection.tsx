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

const BotSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><Bot size={16} className="text-primary" /></div>
              <div>
                <h2 className="font-semibold text-foreground">Bot de Cobranças Automático</h2>
                <p className="text-xs text-muted-foreground">Configure o envio automático de cobranças via WhatsApp</p>
              </div>
            </div>

            {/* Toggle principal */}
            <div className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${form.bot_enabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
              <button
                type="button"
                aria-label={form.bot_enabled ? "Desativar bot de cobranças" : "Ativar bot de cobranças"}
                aria-pressed={form.bot_enabled}
                onClick={() => setForm({ ...form, bot_enabled: !form.bot_enabled })}
                className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${form.bot_enabled ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${form.bot_enabled ? "left-[26px]" : "left-1"}`} />
              </button>
              <div>
                <span className="text-sm font-medium text-foreground">{form.bot_enabled ? "Bot Ativado" : "Bot Desativado"}</span>
                <p className="text-[10px] text-muted-foreground">O bot enviará cobranças automaticamente conforme as regras abaixo</p>
              </div>
            </div>

            {form.bot_enabled && (
              <div className="space-y-5">
                {/* Modo de envio */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-warning" />
                    <p className="text-label">Modo de Envio</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[
                      { value: false, label: "Aprovação Manual", desc: "Revise cada mensagem antes de enviar", icon: Shield },
                      { value: true, label: "Envio Automático", desc: "Mensagens enviadas sem intervenção", icon: Zap },
                    ].map((opt) => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        aria-pressed={form.bot_auto_send === opt.value}
                        onClick={() => setForm({ ...form, bot_auto_send: opt.value })}
                        className={`text-left p-3 rounded-xl border transition-all ${
                          form.bot_auto_send === opt.value ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/20"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <opt.icon size={14} className={form.bot_auto_send === opt.value ? "text-primary" : "text-muted-foreground"} />
                          <span className="text-xs font-semibold text-foreground">{opt.label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tom da mensagem */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Volume2 size={14} className="text-info" />
                    <p className="text-label">Tom da Mensagem</p>
                  </div>
                  <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2">
                    {[
                      { value: "formal", label: "Formal", emoji: "👔" },
                      { value: "amigavel", label: "Amigável", emoji: "😊" },
                      { value: "urgente", label: "Urgente", emoji: "⚠️" },
                    ].map((tone) => (
                      <button
                        key={tone.value}
                        type="button"
                        aria-pressed={form.bot_tone === tone.value}
                        onClick={() => setForm({ ...form, bot_tone: tone.value })}
                        className={`p-3 rounded-xl border text-center transition-all ${
                          form.bot_tone === tone.value ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/20"
                        }`}
                      >
                        <span className="text-lg">{tone.emoji}</span>
                        <p className="text-xs font-medium text-foreground mt-1">{tone.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* AI and Negotiation */}
                <div className="space-y-4 p-4 rounded-2xl border border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-2">
                    <Bot size={16} className="text-primary" />
                    <p className="text-sm font-semibold text-foreground">Inteligência Artificial</p>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground">Gerar Mensagens com IA</p>
                        <p className="text-[10px] text-muted-foreground">Usa o Lovable AI para criar mensagens personalizadas e persuasivas</p>
                      </div>
                      <button
                        type="button"
                        aria-label="Alternar geração de mensagens com IA"
                        aria-pressed={form.bot_use_ai}
                        onClick={() => setForm({ ...form, bot_use_ai: !form.bot_use_ai })}
                        className={`w-10 h-6 rounded-full transition-colors relative ${form.bot_use_ai ? "bg-primary" : "bg-muted"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.bot_use_ai ? "left-5" : "left-1"}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground">Enviar Áudio (Beta)</p>
                        <p className="text-[10px] text-muted-foreground">O bot envia áudios curtos personalizados (TTS)</p>
                      </div>
                      <button 
                        type="button"
                        aria-label="Alternar envio de áudio"
                        aria-pressed={form.bot_send_audio}
                        onClick={() => setForm({ ...form, bot_send_audio: !form.bot_send_audio })}
                        className={`w-10 h-6 rounded-full transition-colors relative ${form.bot_send_audio ? "bg-primary" : "bg-muted"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.bot_send_audio ? "left-5" : "left-1"}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground">Entender Áudios</p>
                        <p className="text-[10px] text-muted-foreground">O bot transcreve e entende o que o cliente fala em áudio</p>
                      </div>
                      <button 
                        type="button"
                        aria-label="Alternar entendimento de áudios"
                        aria-pressed={form.bot_process_audio}
                        onClick={() => setForm({ ...form, bot_process_audio: !form.bot_process_audio })}
                        className={`w-10 h-6 rounded-full transition-colors relative ${form.bot_process_audio ? "bg-primary" : "bg-muted"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.bot_process_audio ? "left-5" : "left-1"}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground">Reconhecer Comprovantes</p>
                        <p className="text-[10px] text-muted-foreground">O bot analisa imagens para identificar comprovantes de pagamento</p>
                      </div>
                      <button 
                        type="button"
                        aria-label="Alternar reconhecimento de comprovantes"
                        aria-pressed={form.bot_process_receipts}
                        onClick={() => setForm({ ...form, bot_process_receipts: !form.bot_process_receipts })}
                        className={`w-10 h-6 rounded-full transition-colors relative ${form.bot_process_receipts ? "bg-primary" : "bg-muted"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.bot_process_receipts ? "left-5" : "left-1"}`} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-foreground">Baixa Automática (Smart Pay)</p>
                        <p className="text-[10px] text-muted-foreground">Dá baixa na parcela automaticamente após validar o comprovante</p>
                      </div>
                      <button 
                        type="button"
                        aria-label="Alternar baixa automática de pagamentos"
                        aria-pressed={form.bot_auto_confirm_payment}
                        onClick={() => setForm({ ...form, bot_auto_confirm_payment: !form.bot_auto_confirm_payment })}
                        className={`w-10 h-6 rounded-full transition-colors relative ${form.bot_auto_confirm_payment ? "bg-primary" : "bg-muted"}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${form.bot_auto_confirm_payment ? "left-5" : "left-1"}`} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Horário de envio */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock size={14} className="text-primary" />
                    <p className="text-label">Horário de Envio</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Hora</label>
                      <select id="bot-send-hour" name="bot_send_hour" aria-label="Hora de envio" value={form.bot_send_hour} onChange={(e) => setForm({ ...form, bot_send_hour: parseInt(e.target.value) })} className={inputCls}>
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, "0")}h</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Minuto</label>
                      <select id="bot-send-minute" name="bot_send_minute" aria-label="Minuto de envio" value={form.bot_send_minute} onChange={(e) => setForm({ ...form, bot_send_minute: parseInt(e.target.value) })} className={inputCls}>
                        {[0, 15, 30, 45].map(m => (
                          <option key={m} value={m}>{String(m).padStart(2, "0")}min</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Mensagens serão enviadas às {String(form.bot_send_hour).padStart(2, "0")}:{String(form.bot_send_minute).padStart(2, "0")}</p>
                </div>

                {/* Dias de funcionamento */}
                <div className="space-y-3">
                  <p className="text-label">Dias de Funcionamento</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { key: "mon", label: "Seg" }, { key: "tue", label: "Ter" }, { key: "wed", label: "Qua" },
                      { key: "thu", label: "Qui" }, { key: "fri", label: "Sex" }, { key: "sat", label: "Sáb" }, { key: "sun", label: "Dom" },
                    ].map((day) => {
                      const active = form.bot_work_days.includes(day.key);
                      return (
                        <button
                          key={day.key}
                          type="button"
                          aria-pressed={active}
                          aria-label={`${active ? "Remover" : "Adicionar"} ${day.label} dos dias de funcionamento`}
                          onClick={() => {
                            const days = active
                              ? form.bot_work_days.filter(d => d !== day.key)
                              : [...form.bot_work_days, day.key];
                            setForm({ ...form, bot_work_days: days });
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                            active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/20"
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Limites */}
                <div className="space-y-3">
                  <p className="text-label">Limites e Intervalos</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Máx. mensagens/dia</label>
                          <input id="bot-max-messages" name="bot_max_messages_per_day" type="number" aria-label="Máximo de mensagens por dia" value={form.bot_max_messages_per_day} onChange={(e) => setForm({ ...form, bot_max_messages_per_day: parseInt(e.target.value) || 50 })} className={inputCls} min={1} max={500} />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">Intervalo entre cobranças (h)</label>
                          <input id="bot-retry-interval" name="bot_retry_interval_hours" type="number" aria-label="Intervalo entre cobranças em horas" value={form.bot_retry_interval_hours} onChange={(e) => setForm({ ...form, bot_retry_interval_hours: parseInt(e.target.value) || 24 })} className={inputCls} min={1} max={168} />
                    </div>
                  </div>
                </div>

                {/* Fluxo de escalação */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-label">Fluxo de Escalação</p>
                    <button
                      onClick={() => {
                        const rules = [...form.bot_escalation_rules, { days: 0, template: "", channel: "whatsapp" }];
                        setForm({ ...form, bot_escalation_rules: rules });
                      }}
                      className="flex items-center gap-1 text-[11px] text-primary font-medium hover:underline"
                    >
                      <Plus size={12} /> Adicionar etapa
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Defina em quantos dias de atraso cada mensagem será enviada</p>
                  <div className="space-y-2">
                    {form.bot_escalation_rules.map((rule, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-3 rounded-xl border border-border bg-muted/10">
                        <div className="w-8 h-8 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-warning">{idx + 1}</span>
                        </div>
                        <div className="flex-1 grid grid-cols-1 min-[420px]:grid-cols-3 gap-2 min-w-0">
                          <div>
                            <label className="text-[9px] text-muted-foreground">Dias atraso</label>
                            <input
                              type="number" min={0} value={rule.days}
                              onChange={(e) => {
                                const rules = [...form.bot_escalation_rules];
                                rules[idx] = { ...rules[idx], days: parseInt(e.target.value) || 0 };
                                setForm({ ...form, bot_escalation_rules: rules });
                              }}
                              name={`bot_escalation_days_${idx}`} aria-label={`Dias de atraso da etapa ${idx + 1}`} className="w-full px-2 py-1.5 rounded-lg bg-card border border-border text-xs text-foreground"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-muted-foreground">Template</label>
                            <select
                              value={rule.template}
                              onChange={(e) => {
                                const rules = [...form.bot_escalation_rules];
                                rules[idx] = { ...rules[idx], template: e.target.value };
                                setForm({ ...form, bot_escalation_rules: rules });
                              }}
                              name={`bot_escalation_template_${idx}`} aria-label={`Template da etapa ${idx + 1}`} className="w-full px-2 py-1.5 rounded-lg bg-card border border-border text-xs text-foreground"
                            >
                              <option value="">Selecionar...</option>
                              {templates.map((t: any) => (
                                <option key={t.id} value={t.name}>{t.name}</option>
                              ))}
                              <option value="lembrete">Lembrete</option>
                              <option value="cobranca_1d">Cobrança 1d</option>
                              <option value="cobranca_3d">Cobrança 3d</option>
                              <option value="cobranca_7d">Cobrança 7d</option>
                              <option value="cobranca_15d">Cobrança 15d</option>
                              <option value="cobranca_30d">Cobrança 30d</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-muted-foreground">Canal</label>
                            <select
                              value={rule.channel}
                              onChange={(e) => {
                                const rules = [...form.bot_escalation_rules];
                                rules[idx] = { ...rules[idx], channel: e.target.value };
                                setForm({ ...form, bot_escalation_rules: rules });
                              }}
                              name={`bot_escalation_channel_${idx}`} aria-label={`Canal da etapa ${idx + 1}`} className="w-full px-2 py-1.5 rounded-lg bg-card border border-border text-xs text-foreground"
                            >
                              <option value="whatsapp">WhatsApp</option>
                              <option value="sms">SMS</option>
                              <option value="email">E-mail</option>
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const rules = form.bot_escalation_rules.filter((_, i) => i !== idx);
                            setForm({ ...form, bot_escalation_rules: rules });
                          }}
                          className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Mensagens do bot */}
                <div className="space-y-3">
                  <p className="text-label">Mensagens Personalizadas</p>
                  <VariaveisDisponiveis onCopiar={(t) => { navigator.clipboard?.writeText(t); notify(`${t} copiado`); }} />
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Saudação Inicial</label>
                    <input value={form.bot_greeting_message} onChange={(e) => setForm({ ...form, bot_greeting_message: e.target.value })} className={inputCls} placeholder="Olá {nome}, aqui é do {empresa}." />
                    <VariaveisNaoReconhecidas texto={form.bot_greeting_message} />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground mb-1 block">Mensagem de Encerramento</label>
                    <input value={form.bot_closing_message} onChange={(e) => setForm({ ...form, bot_closing_message: e.target.value })} className={inputCls} placeholder="Qualquer dúvida, chama aqui. Att, {empresa}" />
                    <VariaveisNaoReconhecidas texto={form.bot_closing_message} />
                  </div>
                </div>

                {/* Opções extras */}
                <div className="space-y-3">
                  <p className="text-label">Opções Adicionais</p>
                  <div className="space-y-2">
                    {[
                      { key: "bot_stop_on_payment" as const, label: "Parar ao detectar pagamento", desc: "Interrompe a sequência se a parcela for paga" },
                      { key: "bot_notify_owner" as const, label: "Notificar proprietário", desc: "Receba um alerta cada vez que o bot enviar uma cobrança" },
                      { key: "bot_send_pix" as const, label: "Incluir chave PIX", desc: "Anexar chave PIX na mensagem para pagamento rápido" },
                      { key: "bot_send_receipt" as const, label: "Enviar comprovante ao pagar", desc: "Envia confirmação automática quando o pagamento é registrado" },
                    ].map((opt) => (
                      <div key={opt.key} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/10">
                        <button
                          onClick={() => setForm({ ...form, [opt.key]: !form[opt.key] })}
                          className={`relative w-10 h-6 rounded-full transition-colors duration-300 shrink-0 ${(form[opt.key] as boolean) ? "bg-primary" : "bg-muted"}`}
                        >
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${(form[opt.key] as boolean) ? "left-[18px]" : "left-0.5"}`} />
                        </button>
                        <div>
                          <span className="text-xs font-medium text-foreground">{opt.label}</span>
                          <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Status info */}
                <div className="p-4 rounded-xl bg-info/5 border border-info/20 space-y-2">
                  <p className="text-xs font-semibold text-info flex items-center gap-2"><Bot size={14} /> Como funciona</p>
                  <ul className="text-[11px] text-muted-foreground space-y-1.5 list-disc list-inside">
                    <li>O bot verifica parcelas em atraso diariamente no horário configurado</li>
                    <li>Envia a mensagem correspondente ao nível de atraso (fluxo de escalação)</li>
                    <li>Respeita os limites de mensagens/dia e dias de funcionamento</li>
                    <li>Requer integração com WhatsApp (Evolution API) configurada na aba "WhatsApp"</li>
                    <li>Templates devem ser criados na aba "Templates" para uso no fluxo</li>
                  </ul>
                </div>
              </div>
            )}
          </>
    </>
  );
};

export default BotSection;
