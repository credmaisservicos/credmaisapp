import {financialDay,sumMoney,type FinancialAnalytics} from './financialAnalytics';
import {isPortalInstallmentOpen,portalOutstandingAmount,withPortalContract} from './portalAmounts';

/** Contract status and installment rateio do not prove movement of money. */
export function clientFinancialSummary(clientId:string,contracts:any[],installments:any[],cash:FinancialAnalytics|undefined,now=new Date()) {
 const contractMap=new Map(contracts.map(c=>[c.id,c]));
 const rows=installments.map(i=>withPortalContract(i,contractMap.get(i.contract_id)||{}));
 const open=rows.filter(i=>isPortalInstallmentOpen(i)&&['active','overdue'].includes(i.contracts?.status||''));
 const today=financialDay(now)!;
 const overdueInst=open.filter(i=>{const day=financialDay(i.due_date);return day!=null&&day<today;});
 const pendingInst=open.filter(i=>!overdueInst.includes(i));
 const belongs=(r:{client_id:string|null;contract_id:string|null})=>r.client_id===clientId||(r.client_id==null&&r.contract_id!=null&&contractMap.has(r.contract_id));
 const receipts=cash?.receipts.filter(belongs);
 const capital=cash?.capital.filter(c=>contractMap.has(c.contract_id));
 const disbursements=cash?.disbursements.filter(belongs);
 const totalOverdue=sumMoney(overdueInst,i=>portalOutstandingAmount(i,now));
 const totalPending=sumMoney(pendingInst,i=>portalOutstandingAmount(i,now));
 const month=today.slice(0,7);
 const monthly=Array.from({length:6},(_,n)=>{
  const date=new Date(`${month}-15T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+n-5);
  const key=date.toISOString().slice(0,7);
  return {month:key,label:date.toLocaleDateString('pt-BR',{month:'short',timeZone:'America/Sao_Paulo'}),amount:receipts?sumMoney(receipts.filter(r=>r.day?.startsWith(key)),r=>r.amount):null};
 });
 return {activeContracts:contracts.filter(c=>['active','overdue'].includes(c.status)),paidInst:rows.filter(i=>i.status==='paid'),overdueInst,pendingInst,
  totalOverdue,totalPending,remaining:Math.round((totalOverdue+totalPending)*100)/100,
  totalCapital:capital?sumMoney(capital,c=>c.outstanding):null,
  lifetimeCapital:disbursements?sumMoney(disbursements,r=>r.amount):null,
  totalPaid:receipts?sumMoney(receipts,r=>r.amount):null,
  totalProfit:receipts?sumMoney(receipts,r=>r.interest+r.fees):null,
  unclassified:receipts?sumMoney(receipts,r=>r.unclassified):null,
  undated:receipts?sumMoney(receipts.filter(r=>r.day==null),r=>r.amount):null,
  missingDisbursements:capital?.filter(c=>c.disbursed===0).length||0,
  receiptCount:receipts?.length||0,monthly,
  ticketMedio:contracts.length?sumMoney(contracts,c=>c.capital)/contracts.length:0,
  nextDueInst:pendingInst.slice().sort((a,b)=>(financialDay(a.due_date)||'9999').localeCompare(financialDay(b.due_date)||'9999'))[0],
 };
}
