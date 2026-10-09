import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import {DailyInterestNotice} from '@/components/DailyInterestNotice';
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const PadroesSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-primary/8 flex items-center justify-center"><Percent size={16} className="text-primary" /></div>
              <h2 className="font-semibold text-foreground">Valores Padrão para Novos Contratos</h2>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground leading-relaxed">
              <p className="font-semibold text-foreground mb-1">Como funciona o atraso</p>
              <p>
                Existe <span className="text-foreground font-medium">apenas uma cobrança de atraso</span>: o
                <span className="text-foreground font-medium"> juros diário</span>, aplicado a cada dia sobre o
                <span className="text-foreground font-medium"> valor já acumulado</span> (juros composto).
              </p>
              <p className="mt-1.5 italic">Ex.: parcela R$ 100 com 4% ao dia → 1º dia R$ 104 · 2º dia R$ 108,16 · 3º dia R$ 112,49.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label htmlFor="default-interest-rate" className="text-label mb-1.5 block">Taxa de juros padrão (% por período)</label>
                <input
                  id="default-interest-rate" name="default_interest_rate" aria-label="Taxa de juros padrão por período" type="number"
                  step="0.01"
                  min="0"
                  value={form.default_interest_rate}
                  onChange={(e) => setForm({ ...form, default_interest_rate: e.target.value })}
                  className={inputCls}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Vem preenchida ao criar um empréstimo novo — dá para alterar contrato a contrato.
                  É a taxa do empréstimo em si, diferente do juros de atraso abaixo.
                </p>
              </div>

              <div>
                <label htmlFor="default-daily-interest" className="text-label mb-1.5 block">Juros de atraso (% ao dia)</label>
                <input id="default-daily-interest" name="default_daily_interest" aria-label="Juros de atraso ao dia" aria-describedby="default-daily-interest-note" type="number" step="0.01" value={form.default_daily_interest} onChange={(e) => setForm({ ...form, default_daily_interest: e.target.value })} className={inputCls} />
                <DailyInterestNotice id="default-daily-interest-note" value={form.default_daily_interest}/>
              </div>
              <div>
                <label htmlFor="default-fixed-fine" className="text-label mb-1.5 block">Multa fixa</label>
                <input id="default-fixed-fine" name="default_fixed_fine" aria-label="Multa fixa desativada" type="number" value="0" disabled className={inputCls + " opacity-60"} />
                <p className="text-[10px] text-muted-foreground mt-1">Desativada — agora só existe o juros diário.</p>
              </div>

              <div className="col-span-2">
                <label htmlFor="default-frequency" className="text-label mb-1.5 block">Frequência Padrão</label>
                <select id="default-frequency" name="default_frequency" value={form.default_frequency} onChange={(e) => setForm({ ...form, default_frequency: e.target.value })} className={inputCls}>
                  <option value="daily">Diário</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option>
                </select>
              </div>

              <div>
                <label htmlFor="default-installments" className="text-label mb-1.5 block">Nº de parcelas padrão</label>
                <input
                  id="default-installments" name="default_num_installments" aria-label="Número de parcelas padrão" type="number" min="1" step="1" placeholder="Ex: 6"
                  value={form.default_num_installments}
                  onChange={(e) => setForm({ ...form, default_num_installments: e.target.value })}
                  className={inputCls}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Deixe em branco para digitar a cada empréstimo.</p>
              </div>

              <div>
                <label htmlFor="default-payment-method" className="text-label mb-1.5 block">Forma de pagamento padrão</label>
                <select id="default-payment-method" name="default_payment_method" value={form.default_payment_method} onChange={(e) => setForm({ ...form, default_payment_method: e.target.value })} className={inputCls}>
                  <option value="pix">PIX</option>
                  <option value="cash">Dinheiro</option>
                  <option value="boleto">Boleto</option>
                  <option value="transfer">Transferência</option>
                </select>
              </div>

              <div className="col-span-2">
                <label htmlFor="default-max-interest-cap" className="text-label mb-1.5 block">Teto dos juros de atraso (%)</label>
                <input
                  id="default-max-interest-cap" name="default_max_interest_cap" aria-label="Teto dos juros de atraso" type="number" min="0" step="1" placeholder="Ex: 100 — os juros nunca passam do valor da parcela"
                  value={form.default_max_interest_cap}
                  onChange={(e) => setForm({ ...form, default_max_interest_cap: e.target.value })}
                  className={inputCls}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Limita quanto os juros de atraso podem crescer. Com 100%, uma parcela de R$ 100
                  nunca acumula mais de R$ 100 de juros, por mais tempo que fique em aberto.
                  Em branco, não há teto. Vale para os contratos criados a partir de agora.
                </p>
              </div>
            </div>
          </>
    </>
  );
};

export default PadroesSection;
