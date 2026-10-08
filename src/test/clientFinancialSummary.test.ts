import {expect,it} from 'vitest';
import {clientFinancialSummary} from '@/lib/clientFinancialSummary';
import {emptyFinancialAnalyticsReport} from '../../e2e/helpers/financialAnalytics';
it('gráfico usa o mês financeiro brasileiro, preserva parciais e não inventa datas para legado',()=>{
 const cash=emptyFinancialAnalyticsReport();
 const receipt=(id:string,day:string|null,amount:number)=>({id,day,date:day?`${day}T12:00:00Z`:null,amount,client_id:'client',contract_id:null,installment_id:null,description:'Recibo',category:null,principal:0,interest:0,fees:0,unclassified:amount});
 cash.receipts=[receipt('previous','2026-08-31',40),receipt('current','2026-09-01',60),receipt('legacy',null,25),{...receipt('foreign','2026-09-01',999),client_id:'another-client'}];
 const before=clientFinancialSummary('client',[],[],cash,new Date('2026-09-01T01:00:00Z'));
 expect(before.monthly.at(-1)).toMatchObject({month:'2026-08',amount:40});
 const after=clientFinancialSummary('client',[],[],cash,new Date('2026-09-01T03:00:00Z'));
 expect(after.monthly.at(-1)).toMatchObject({month:'2026-09',amount:60});expect(after.totalPaid).toBe(125);expect(after.undated).toBe(25);
});
it('cotação inclui juros de 1% e encargo fixo de R$ 4 após parcial, mas não cobra contrato cancelado',()=>{
 const contracts=[{id:'active',status:'active',daily_penalty_type:'fixed',daily_penalty_value:4,daily_interest_percent:1},{id:'cancelled',status:'cancelled',daily_penalty_type:'fixed',daily_penalty_value:4}];
 const rows=contracts.map(c=>({id:c.id,contract_id:c.id,status:'pending',amount:100,paid_amount:40,due_date:'2026-09-01'}));
 const summary=clientFinancialSummary('client',contracts,rows,emptyFinancialAnalyticsReport(),new Date('2026-09-02T15:00:00Z'));
 expect(summary.totalOverdue).toBe(65);expect(summary.overdueInst).toHaveLength(1);expect(summary.remaining).toBe(65);
});
it('ausência de caixa confirmado mantém recebimento, capital, composição e gráfico indisponíveis',()=>{
 const summary=clientFinancialSummary('client',[{id:'contract',capital:100,status:'cancelled'}],[],undefined);
 expect([summary.totalCapital,summary.totalPaid,summary.totalProfit,summary.lifetimeCapital]).toEqual([null,null,null,null]);expect(summary.monthly.every(m=>m.amount===null)).toBe(true);
});
