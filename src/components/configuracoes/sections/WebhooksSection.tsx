import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const WebhooksSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-info/8 flex items-center justify-center"><Webhook size={16} className="text-info" /></div>
              <div>
                <h2 className="font-semibold text-foreground">N8N / Webhooks</h2>
                <p className="text-xs text-muted-foreground">Integre com automações externas.</p>
              </div>
            </div>
            <div><label htmlFor="n8n-webhook-url" className="text-label mb-1.5 block">URL do Webhook N8N</label><input id="n8n-webhook-url" name="n8n_webhook_url" autoComplete="url" value={form.n8n_webhook_url} onChange={(e) => setForm({ ...form, n8n_webhook_url: e.target.value })} placeholder="https://n8n.exemplo.com/webhook/..." className={inputCls} /></div>
          </>
    </>
  );
};

export default WebhooksSection;
