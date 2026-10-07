import { activeDebt, botBalance, botLateFee, cents } from './bot_finance.ts';

export function saoPauloDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Overdue collection excludes future installments; reminders share one due date. */
export function collectionPlan(rows: any[], rules: any[], today: string) {
  const debts = rows.filter(activeDebt).sort((a, b) =>
    String(a.due_date).localeCompare(String(b.due_date)) || String(a.id).localeCompare(String(b.id)));
  if (!debts.length) return null;
  const selected = debts[0];
  const days = Math.round((Date.parse(`${today}T12:00:00Z`) -
    Date.parse(`${String(selected.due_date).slice(0, 10)}T12:00:00Z`)) / 86400000);
  const rule = days > 0
    ? rules.filter(r => Number(r.days) > 0).sort((a, b) => Number(b.days) - Number(a.days)).find(r => days >= Number(r.days))
    : rules.find(r => Number(r.days) === days);
  if (!rule) return null;
  const installments = debts.filter(r => days > 0
    ? String(r.due_date).slice(0, 10) <= today
    : String(r.due_date).slice(0, 10) === String(selected.due_date).slice(0, 10));
  const amount = cents(installments.reduce((sum, r) => sum + botBalance(r), 0));
  const fees = cents(installments.reduce((sum, r) => sum + Math.min(botLateFee(r), botBalance(r)), 0));
  return { installments, rule, days, isPreDue: days <= 0, amount, fees };
}

export function collectionCooldownHours(value: unknown) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 1 ? Math.min(168, hours) : 24;
}

/** Every queued charge rechecks agreements and opt-out across the client's inbox. */
export async function collectionSuppression(db: any, owner: string, client: string, now = new Date(), humanApproved = false) {
  const [promises, conversations] = await Promise.all([
    db.from('payment_promises').select('id').eq('user_id', owner).eq('client_id', client)
      .eq('status', 'open').gte('promised_for', saoPauloDay(now)).limit(1),
    db.from('whatsapp_conversations').select('id').eq('user_id', owner).eq('client_id', client)
      .or('blocked.eq.true,bot_paused.eq.true,needs_human.eq.true').limit(1),
  ]);
  if (promises.error || conversations.error) throw Error('collection_policy_unavailable');
  if (promises.data?.length) return 'payment_promise_active';
  if (conversations.data?.length && !humanApproved) return 'human_takeover';
  return null;
}

export async function collectionPaymentAfter(db: any, owner: string, client: string, since: string) {
  const {data,error} = await db.from('transactions').select('id').eq('user_id',owner)
    .eq('client_id',client).eq('type','payment').gt('created_at',since).limit(1);
  if (error) throw Error('payment_state_unavailable');
  return !!data?.length;
}

/** AI gets a shared budget for the entire cron run; standard messages stay available. */
export function collectionAiBudget(totalMs = 10_000, clock = Date.now) {
  let spent = 0;
  return async (generate: (timeoutMs: number) => Promise<string>) => {
    const remaining = totalMs - spent;
    if (remaining < 500) return '';
    const start = clock();
    try { return await generate(Math.min(3_000, remaining)); }
    catch { return ''; }
    finally { spent += Math.max(1, clock() - start); }
  };
}
