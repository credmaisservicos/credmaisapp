const money = (value: unknown) => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
export const cents = (value: number) => Math.round(value * 100) / 100;
export const BOT_CONTRACT_FIELDS = 'status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent';
/** Matches pay_installment: stored floor, compound daily charge, penalty and cap. */
export function botLateFee(row: any, today = financialDay()!) {
  const stored=money(row.late_fee);
  const c=Array.isArray(row.contracts)?row.contracts[0]:row.contracts;
  if(['paid','cancelled'].includes(row.status)||row.pre_settlement_snapshot||c?.daily_interest_percent===undefined||!row.due_date)return stored;
  return financialLateFee({...row,...c,frozen:row.pre_settlement_snapshot!=null},ChargeDecimal,today);
}
export function botBalance(row: any, today?: string) {
  return cents(Math.max(0, money(row.amount) + botLateFee(row,today) - money(row.paid_amount)));
}
export function activeDebtAt(row: any,today?:string) {
  const contract = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
  return !['paid', 'cancelled'].includes(row.status)
    && ['active', 'overdue'].includes(String(contract?.status || '').toLowerCase())
    && botBalance(row,today) >= 0.01;
}
export function activeDebt(row:any){return activeDebtAt(row);}

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
import Decimal from 'https://esm.sh/decimal.js-light@2.5.1';
import {financialDay} from './financial_calendar.ts';
import {financialLateFee} from './financial_quote.ts';
const ChargeDecimal=Decimal.clone({precision:40});
