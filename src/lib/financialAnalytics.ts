import {z} from 'zod';
import {walletCashReportSchema} from './walletCashReport';
import {financialDay,financialDaysBetween} from '../../supabase/functions/_shared/financial_calendar';
import {portalInstallmentAmount,isPortalInstallmentOpen,withPortalContract} from './portalAmounts';
export {financialDay,financialDaysBetween};
const money=z.number().finite().nonnegative().max(90071992547409.91);
const event=z.object({id:z.string(),contract_id:z.string().nullable(),client_id:z.string().nullable(),date:z.string().nullable(),day:z.string().nullable(),amount:money});
export const financialAnalyticsSchema=z.object({wallet:walletCashReportSchema,
 receipts:z.array(event.extend({installment_id:z.string().nullable(),description:z.string(),client_name:z.string().optional(),category:z.string().nullable(),principal:money,interest:money,fees:money,unclassified:money})),
 disbursements:z.array(event),expenses:z.array(z.object({id:z.string(),description:z.string().nullable(),category:z.string().nullable(),amount:money,date:z.string(),day:z.string()})),capital:z.array(z.object({contract_id:z.string(),disbursed:money,returned:money,outstanding:money})),
 warnings:z.object({contracts_without_disbursement:z.number().int().nonnegative(),unlinked_principal:money})});
export type FinancialAnalytics=z.infer<typeof financialAnalyticsSchema>;
export type CashReceipt=FinancialAnalytics['receipts'][number];
export const sumMoney=(rows:unknown[],value:(row:any)=>unknown)=>Math.round(rows.reduce<number>((sum,row)=>sum+(Number(value(row))||0),0)*100)/100;
export function addFinancialDays(day:string,days:number){return new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
/** Picker dates are civil choices; persisted timestamps use the financial zone. */
export const pickerDay=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function financialStart(day:string){
 const target=Date.parse(day+'T00:00:00Z');let low=target-86400000,high=target+86400000;
 // Find the first instant of the civil Brazilian day, including historic DST.
 while(low<high){const mid=Math.floor((low+high)/2);if(financialDay(new Date(mid))!<day)low=mid+1;else high=mid;}
 return new Date(low).toISOString();
}
export function financialBounds(from:string,to:string){
 if(!financialDay(from)||!financialDay(to)||from>to)throw Error('invalid_financial_period');
 return {startDay:from,endDay:to,startDateTime:financialStart(from),endDateTime:financialStart(addFinancialDays(to,1))};
}
export function receiptsInPeriod(receipts:CashReceipt[],from:string,to:string){return receipts.filter(r=>r.day!=null&&r.day>=from&&r.day<=to);}
export function periodReceiptTotals(receipts:CashReceipt[],from:string,to:string){const rows=receiptsInPeriod(receipts,from,to);return {
 rows,received:sumMoney(rows,r=>r.amount),principal:sumMoney(rows,r=>r.principal),interest:sumMoney(rows,r=>r.interest),fees:sumMoney(rows,r=>r.fees),unclassified:sumMoney(rows,r=>r.unclassified)};}
export function quotedInstallments(contracts:any[],installments:any[],now=new Date()){
 const owned=new Map(contracts.map(c=>[c.id,c]));
 return installments.map(i=>{
  const contract=owned.get(i.contract_id);
  const row=contract?withPortalContract(i,contract):i;
  return {...row,amount:portalInstallmentAmount(row,now),original_amount:i.amount};
 });
}
export function openFinancialInstallments(contracts:any[],installments:any[],now=new Date()){
 return quotedInstallments(contracts,installments,now).filter(i=>isPortalInstallmentOpen(i)&&['active','overdue'].includes(i.contracts?.status||''));
}
