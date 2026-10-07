import {
  Settings, Building, Percent, MessageSquare, Webhook, Bell, Save, Plus, Trash2, Check, AlertTriangle, Palette, Upload, Image, Key, CreditCard, Bot, Clock, Shield, Zap, ToggleLeft, Send, Volume2, Sun, Moon, Monitor, Eye, LayoutDashboard, Users, Receipt, Info, Copy, ExternalLink, FileText, RotateCcw, Sparkles, Package,
} from "lucide-react";
import { CONTRACT_PLACEHOLDERS, DEFAULT_CONTRACT_TEMPLATE } from "@/utils/contractTemplate";
import type { ModuleKey } from "@/contexts/WhiteLabelContext";
import InstallAppCard from "@/components/InstallAppCard";
import { COLOR_PRESETS } from "../constants";
import type { SectionProps } from "../types";

const NotificacoesSection = ({ ctx }: SectionProps) => {
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
              <div className="w-8 h-8 rounded-lg bg-warning/8 flex items-center justify-center"><Bell size={16} className="text-warning" /></div>
              <h2 className="font-semibold text-foreground">Notificações Push</h2>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/20 border border-border">
              <button
                onClick={() => setForm({ ...form, push_notifications_enabled: !form.push_notifications_enabled })}
                className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${form.push_notifications_enabled ? "bg-success" : "bg-muted"}`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-xs transition-transform duration-300 ${form.push_notifications_enabled ? "left-[26px]" : "left-1"}`} />
              </button>
              <div>
                <span className="text-sm font-medium text-foreground">{form.push_notifications_enabled ? "Ativadas" : "Desativadas"}</span>
                <p className="text-[10px] text-muted-foreground">Receba alertas sobre parcelas e cobranças</p>
              </div>
            </div>
          </>
    </>
  );
};

export default NotificacoesSection;
