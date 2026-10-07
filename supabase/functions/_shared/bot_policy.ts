import {testRecipientScope} from './bot_test_scope.ts';
export function automationAccountActive(profile: any, now = new Date()) {
  if (!profile || profile.is_blocked) return false;
  const trial = new Date(profile.trial_ends_at || 0).getTime() > now.getTime();
  const active = profile.is_admin || profile.subscription_type === 'lifetime' || trial
    || new Date(profile.subscription_expires_at || 0).getTime() > now.getTime();
  return !!active && (profile.is_admin || trial || profile.plan_tier === 'completo');
}
export function withinBotHours(settings: any, now = new Date()) {
  if (!settings?.bot_business_hours_only) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone:'America/Sao_Paulo', weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const day = get('weekday').toLowerCase();
  if (!(settings.bot_work_days || ['mon','tue','wed','thu','fri']).includes(day)) return false;
  const value = Number(get('hour')) * 60 + Number(get('minute'));
  const minutes = (s: string) => { const [h,m] = String(s).split(':').map(Number); return h*60+m; };
  const start = minutes(settings.bot_business_start || '08:00'), end = minutes(settings.bot_business_end || '18:00');
  return start <= end ? value >= start && value < end : value >= start || value < end;
}
export function deliveryPolicy(settings: any, convo: any, profile: any, job: any, now = new Date()) {
  if (!convo || convo.blocked) return 'conversation_blocked';
  const testScope=testRecipientScope(job.user_id || settings?.user_id,String(convo.jid || convo.phone || ''));
  if (testScope === false) return 'test_recipient_blocked';
  if (job.purpose === 'manual' || job.approved_by) return null;
  if (!settings?.bot_enabled) return 'bot_disabled';
  if (!automationAccountActive(profile, now)) return 'automation_unavailable';
  if ((convo.bot_paused || convo.needs_human) && job.purpose !== 'handoff_notice') return 'human_takeover';
  if (!withinBotHours(settings, now)) return 'outside_business_hours';
  if (settings.bot_auto_send !== true && testScope !== true) return 'approval_required';
  return null;
}
