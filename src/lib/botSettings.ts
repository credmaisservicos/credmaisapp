export const BOT_DEFAULTS = {
  bot_enabled:false, bot_auto_send:false, bot_use_ai:false, bot_tone:'formal',
  bot_process_audio:true, bot_process_receipts:true, bot_send_pix:true, bot_send_receipt:false, bot_send_birthday:false,
  bot_notify_owner:true, bot_stop_on_payment:true, bot_max_messages_per_day:50,
  bot_retry_interval_hours:24, bot_send_hour:9, bot_send_minute:0,
  bot_work_days:['mon','tue','wed','thu','fri'],
  bot_business_hours_only:false, bot_business_start:'08:00', bot_business_end:'18:00',
  bot_escalation_rules:[] as {days:number;template:string;channel:string}[],
  bot_greeting_message:'', bot_closing_message:'',
};
export type BotSettingsForm = typeof BOT_DEFAULTS;
export function loadBotSettings(row: Record<string, any>): BotSettingsForm {
  return Object.fromEntries(Object.entries(BOT_DEFAULTS).map(([key,value])=>[key,row[key] ?? value])) as BotSettingsForm;
}
export function validateBotSettings(form: BotSettingsForm): string | null {
  if (!Number.isInteger(form.bot_max_messages_per_day) || form.bot_max_messages_per_day<1 || form.bot_max_messages_per_day>500) return 'O limite diário deve ficar entre 1 e 500.';
  if (!Number.isInteger(form.bot_retry_interval_hours) || form.bot_retry_interval_hours<1 || form.bot_retry_interval_hours>168) return 'O intervalo deve ficar entre 1 e 168 horas.';
  if (!Number.isInteger(form.bot_send_hour) || form.bot_send_hour<0 || form.bot_send_hour>23 || !Number.isInteger(form.bot_send_minute) || form.bot_send_minute<0 || form.bot_send_minute>59) return 'Informe um horário válido para as cobranças.';
  if (form.bot_enabled && !form.bot_work_days.length) return 'Selecione pelo menos um dia de funcionamento.';
  if (![form.bot_business_start,form.bot_business_end].every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v))) return 'Informe um expediente válido.';
  if (form.bot_business_hours_only && form.bot_business_start===form.bot_business_end) return 'Início e fim do expediente devem ser diferentes.';
  if (form.bot_enabled && form.bot_business_hours_only) {
    const minutes=(time:string)=>Number(time.slice(0,2))*60+Number(time.slice(3));
    const send=form.bot_send_hour*60+form.bot_send_minute,start=minutes(form.bot_business_start),end=minutes(form.bot_business_end);
    if (!(start<end?send>=start&&send<end:send>=start||send<end)) return 'O horário de cobrança deve estar dentro do expediente.';
  }
  const stages=new Set<number>();
  for (const rule of form.bot_escalation_rules) {
    if (!Number.isInteger(rule.days) || rule.days< -30 || rule.days>365 || !['whatsapp','email','both'].includes(rule.channel)) return 'Revise os dias e canais da régua de cobrança.';
    if (stages.has(rule.days)) return 'Use apenas uma etapa para cada dia da régua.';
    stages.add(rule.days);
  }
  return null;
}
/** Only changed bot fields are saved; unrelated settings and secrets stay outside. */
export function botSettingsChanges(form: BotSettingsForm, saved: BotSettingsForm) {
  return Object.fromEntries(Object.keys(BOT_DEFAULTS).filter(key=>JSON.stringify(form[key as keyof BotSettingsForm])!==JSON.stringify(saved[key as keyof BotSettingsForm])).map(key=>[key,form[key as keyof BotSettingsForm]])) as Partial<BotSettingsForm>;
}
