import { ModuleKey } from "@/contexts/WhiteLabelContext";

export type ThemeMode = "dark" | "light" | "system";

export interface SettingsForm {
  company_name: string;
  company_cnpj: string;
  company_address: string;
  company_phone: string;
  company_logo_url: string;
  favicon_url: string;
  primary_color: string;
  accent_color: string;
  theme_mode: ThemeMode;
  sidebar_style: string;
  login_title: string;
  login_subtitle: string;
  footer_text: string;
  border_radius: string;
  font_family: string;
  default_interest_rate: string;
  default_late_fee: string;
  default_daily_interest: string;
  default_frequency: string;
  default_num_installments: string;
  default_payment_method: string;
  default_max_interest_cap: string;
  whatsapp_api_url: string;
  whatsapp_api_key: string;
  whatsapp_instance: string;
  n8n_webhook_url: string;
  push_notifications_enabled: boolean;
  pix_key: string;
  pix_key_type: string;
  billing_message: string;
  bot_enabled: boolean;
  bot_auto_send: boolean;
  bot_send_hour: number;
  bot_send_minute: number;
  bot_max_messages_per_day: number;
  bot_work_days: string[];
  bot_escalation_rules: Array<{ days: number; template: string; channel: string }>;
  bot_retry_interval_hours: number;
  bot_stop_on_payment: boolean;
  bot_notify_owner: boolean;
  bot_greeting_message: string;
  bot_closing_message: string;
  bot_send_pix: boolean;
  bot_send_receipt: boolean;
  bot_tone: string;
  bot_use_ai: boolean;
  bot_process_audio: boolean;
  bot_process_receipts: boolean;
  portal_title: string;
  portal_subtitle: string;
  portal_welcome_message: string;
  portal_primary_color: string;
  portal_logo_url: string;
  portal_contact_phone: string;
  portal_contact_email: string;
  custom_contract_template: string;
  modules_enabled: Record<ModuleKey, boolean>;
}

export interface SettingsCtx {
  form: SettingsForm;
  setForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
  inputCls: string;
  settings: any;
  templates: any[];
  onUploadLogo: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUploadFavicon: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUploadPortalLogo: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadingLogo: boolean;
  uploadingFavicon: boolean;
  uploadingPortalLogo: boolean;
  logoInputRef: React.RefObject<HTMLInputElement>;
  faviconInputRef: React.RefObject<HTMLInputElement>;
  portalLogoInputRef: React.RefObject<HTMLInputElement>;
  onAddTemplate: () => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onAddPresetTemplate: (preset: any) => Promise<void>;
  newTemplate: { name: string; content: string; trigger_days: string };
  setNewTemplate: React.Dispatch<React.SetStateAction<{ name: string; content: string; trigger_days: string }>>;
  notify: (title: string) => void;
}


export interface SectionProps {
  ctx: SettingsCtx;
}
