import { activeDebtAt, botBalance, botLateFee, cents } from './bot_finance.ts';
import {financialDay,financialDaysBetween} from './financial_calendar.ts';

export function saoPauloDay(now = new Date()) {
  return financialDay(now)!;
}

/** Overdue collection excludes future installments; reminders share one due date. */
export function collectionPlan(rows: any[], rules: any[], today: string) {
  const debts = rows.filter(row=>activeDebtAt(row,today)).sort((a, b) =>
    String(a.due_date).localeCompare(String(b.due_date)) || String(a.id).localeCompare(String(b.id)));
  if (!debts.length) return null;
  const selected = debts[0];
  const days = financialDaysBetween(selected.due_date,today);
  const rule = days > 0
    ? rules.filter(r => Number(r.days) > 0).sort((a, b) => Number(b.days) - Number(a.days)).find(r => days >= Number(r.days))
    : rules.find(r => Number(r.days) === days);
  if (!rule) return null;
  const installments = debts.filter(r => days > 0
    ? financialDay(r.due_date)! <= today
    : financialDay(r.due_date) === financialDay(selected.due_date));
  const amount = cents(installments.reduce((sum, r) => sum + botBalance(r,today), 0));
  const fees = cents(installments.reduce((sum, r) => sum + Math.min(botLateFee(r,today), botBalance(r,today)), 0));
  return { installments, rule, days, isPreDue: days <= 0, amount, fees };
}

export function collectionCooldownHours(value: unknown) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 1 ? Math.min(168, hours) : 24;
}
/** Portal and WhatsApp receipts require human review before another charge. */
export async function pendingClientReceipt(db:any,owner:string,client:string) {
  const [portal,whatsapp]=await Promise.all([
    db.from('contract_installments').select('id').eq('user_id',owner).eq('client_id',client)
      .eq('receipt_review_status','pending').not('status','in','("paid","cancelled")').limit(1),
    db.from('whatsapp_receipt_reviews').select('id').eq('user_id',owner).eq('client_id',client).eq('status','pending').limit(1),
  ]);
  if(portal.error || whatsapp.error)throw Error('receipt_state_unavailable');
  return !!(portal.data?.length || whatsapp.data?.length);
}

/** Every queued charge rechecks agreements and opt-out across the client's inbox. */
export async function collectionSuppression(db: any, owner: string, client: string, now = new Date(), humanApproved = false) {
  const [promises, conversations,receiptPending] = await Promise.all([
    db.from('payment_promises').select('id').eq('user_id', owner).eq('client_id', client)
      .eq('status', 'open').gte('promised_for', saoPauloDay(now)).limit(1),
    db.from('whatsapp_conversations').select('id').eq('user_id', owner).eq('client_id', client)
      .or('blocked.eq.true,bot_paused.eq.true,needs_human.eq.true').limit(1),
    pendingClientReceipt(db,owner,client),
  ]);
  if (promises.error || conversations.error) throw Error('collection_policy_unavailable');
  if (receiptPending) return 'receipt_under_review';
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
