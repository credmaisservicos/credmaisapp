const money = (value: unknown) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
export const cents = (value: number) => Math.round(value * 100) / 100;
export const BOT_CONTRACT_FIELDS = 'status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent';
/** Matches pay_installment: stored floor, compound daily charge, penalty and cap. */
export function botLateFee(row: any, today = new Date().toISOString().slice(0,10)) {
  const stored=money(row.late_fee);
  const c=Array.isArray(row.contracts)?row.contracts[0]:row.contracts;
  if(['paid','cancelled'].includes(row.status)||row.pre_settlement_snapshot||c?.daily_interest_percent===undefined||!row.due_date)return stored;
  const days=Math.max(0,Math.floor((new Date(`${today}T12:00:00Z`).getTime()-new Date(`${String(row.due_date).slice(0,10)}T12:00:00Z`).getTime())/86400000));
  const base=money(row.amount),rate=Math.max(0,Number(c.daily_interest_percent)||4),penalty=money(c.daily_penalty_value);
  let fee=cents(base*(Math.pow(1+rate/100,days)-1)+(c.daily_penalty_type==='fixed'?penalty*days:base*penalty/100*days));
  const cap=money(c.max_interest_cap_percent);
  if(cap>0)fee=Math.min(fee,cents(base*cap/100));
  if(!Number.isFinite(fee))throw Error('financial_charge_unavailable');
  return Math.max(stored,fee);
}
export function botBalance(row: any, today?: string) {
  return cents(Math.max(0, money(row.amount) + botLateFee(row,today) - money(row.paid_amount)));
}
export function activeDebt(row: any) {
  const contract = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
  return !['paid', 'cancelled'].includes(row.status)
    && ['active', 'overdue'].includes(String(contract?.status || '').toLowerCase())
    && botBalance(row) >= 0.01;
}

/** Quote matches renew_installment_interest, which uses stored fees and period interest. */
export function botRenewalQuote(inst: any, contract: any): number | null {
  const roundQuote = (value: number) => Math.round((value + Number.EPSILON * Math.max(1,Math.abs(value))) * 100) / 100;
  if(!contract || !['active','overdue'].includes(contract.status) || ['paid','cancelled'].includes(inst.status) || money(inst.paid_amount)>0)return null;
  const capital=money(contract.capital),rate=money(contract.interest_rate)/100;
  const totalInterest=contract.total_interest==null ? Math.max(0,money(contract.total_amount)-capital) : money(contract.total_interest);
  const elapsed=Math.max(0,Number(inst.installment_number ?? 1)-1),n=Number(contract.num_installments || 0),grace=Math.max(0,Number(contract.grace_periods || 0));
  const payment=Number(contract.installment_amount) || Number(inst.amount) || 0;
  let interest:number;
  if(contract.loan_mode==='bullet')interest=totalInterest;
  else if(['percentage','interest_only'].includes(contract.loan_mode))interest=roundQuote(capital*rate);
  else if(money(inst.scheduled_interest)>0)interest=money(inst.scheduled_interest);
  else if(contract.loan_mode==='price' && rate>0){const growth=Math.pow(1+rate,elapsed);interest=roundQuote(Math.max(0,capital*growth-payment*((growth-1)/rate))*rate);}
  else if(contract.loan_mode==='grace' && n-grace>0)interest=roundQuote(Number(inst.installment_number || 0)>grace?Math.max(0,payment-capital/(n-grace)):capital*rate);
  else if(n>0)interest=roundQuote(totalInterest/n);
  else interest=money(inst.amount);
  const quote=roundQuote(Math.max(0,interest)+money(inst.stored_late_fee ?? inst.late_fee));
  return Number.isFinite(quote) && quote>0 ? quote : null;
}
