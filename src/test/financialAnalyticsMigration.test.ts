// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',contract='33333333-3333-4333-8333-333333333333',inst='44444444-4444-4444-8444-444444444444';
let db:PGlite;
beforeAll(async()=>{db=new PGlite();for(const file of ['financialDatabase','paymentReceiptDatabase','walletCashDatabase'])await db.exec(readFileSync(`src/test/fixtures/${file}.sql`,'utf8'));
 for(const file of ['20260922130000_dynamic_late_fee_tracks_settlement.sql','20260922100000_reverse_percentage_settlement.sql','20261007210000_incremental_payment_ledger.sql','20261007220000_financial_calendar_atomic_charges.sql','20261008000000_wallet_cash_report.sql','20261008020000_financial_analytics_report.sql'])await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'));
},30000);
beforeEach(async()=>{await db.exec(`RESET ROLE;SET test.owner='${owner}';TRUNCATE contracts,contract_installments,transactions,profits,expenses;
 INSERT INTO contracts(id,user_id,client_id,status,capital)VALUES('${contract}','${owner}','${owner}','active',1000);
 INSERT INTO contract_installments(id,user_id,contract_id,client_id,amount,status,due_date)VALUES('${inst}','${owner}','${contract}','${owner}',100,'pending','2099-01-01');`);});
afterAll(async()=>{await db?.close();});
async function report(from:string|null=null,to:string|null=null){return ((await db.query('SELECT financial_analytics_report($1::date,$2::date) value',[from,to])).rows[0] as any).value;}
async function receipt(amount:number,date:string,principal=0,interest=0,fees=0,type='payment',category='loan_payment'){
 await db.query(`INSERT INTO transactions(user_id,contract_id,client_id,installment_id,amount,date,type,category,principal_amount,interest_amount,fee_amount)
 VALUES($1,$2,$1,$3,$4,$5::timestamptz,$6,$7,$8,$9,$10)`,[owner,contract,inst,amount,date,type,category,principal,interest,fees]);
}
it('separa parcial e quitação por data real, mantendo os eventos após concluir o contrato',async()=>{
 await receipt(40,'2026-08-31T23:59:00-03:00',30,10,0,'partial_payment');await receipt(60,'2026-09-01T00:01:00-03:00',50,10);
 await db.exec("UPDATE contract_installments SET status='paid',paid_amount=100,paid_at='2026-09-01';UPDATE contracts SET status='completed'");
 expect((await report('2026-08-01','2026-08-31')).receipts.map((r:any)=>r.amount)).toEqual([40]);
 expect((await report('2026-09-01','2026-09-30')).receipts.map((r:any)=>r.amount)).toEqual([60]);
 expect((await report()).wallet.totals.receipts).toBe(100);
});
it('cancelamento não fabrica devolução e principal parcial reduz o capital comprovado',async()=>{
 await db.query("INSERT INTO transactions(user_id,contract_id,amount,type,date)VALUES($1,$2,1000,'loan','2026-08-01')",[owner,contract]);
 await receipt(50,'2026-08-02',30,20);await db.exec("UPDATE contracts SET status='cancelled'");
 expect((await report()).capital[0]).toMatchObject({disbursed:1000,returned:30,outstanding:970});
});
it('capital contratado sem lançamento não vira liberação comprovada',async()=>{
 const r=await report();expect(r.capital[0].disbursed).toBe(0);expect(r.warnings.contracts_without_disbursement).toBe(1);
});
it('renovação permanece receita mesmo com parcela aberta, e multas vêm da composição recebida',async()=>{
 await receipt(25,'2026-08-02',0,20,5,'payment','interest_renewal');
 await db.exec('UPDATE contract_installments SET late_fee=999');
 const r=await report();expect(r.receipts[0]).toMatchObject({amount:25,interest:20,fees:5});expect(r.wallet.totals.profit).toBe(25);
});
it('composição incoerente fica sem classificação e lucro legado não é somado outra vez',async()=>{
 await receipt(40,'2026-08-02',50,20);await db.query('INSERT INTO profits(user_id,amount)VALUES($1,999)',[owner]);
 const r=await report();expect(r.receipts[0]).toMatchObject({principal:0,interest:0,fees:0,unclassified:40});expect(r.wallet.totals.profit).toBe(0);
});
it('mantém legado sem data fora dos períodos e exclui dinheiro futuro',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');await receipt(10,'2099-01-01',10);
 const r=await report('2026-08-01','2026-08-31');expect(r.receipts).toEqual([]);expect(r.wallet.warnings.legacy_gap_amount).toBe(30);expect(r.wallet.warnings.future_amount).toBe(10);
});
it('dia brasileiro e último dia inteiro não dependem do fuso da sessão',async()=>{
 await db.exec("SET TimeZone='Pacific/Auckland'");await receipt(20,'2026-09-01T02:59:59Z',0,20);
 const r=await report('2026-08-01','2026-08-31');expect(r.receipts[0].day).toBe('2026-08-31');
});
it('despesas do razão e manuais entram uma vez, sem incluir o futuro',async()=>{
 await db.query("INSERT INTO expenses(user_id,amount,date,description)VALUES($1,7,'2026-08-03','Gasto'),($1,100,'2099-01-01','Futuro')",[owner]);
 await db.query("INSERT INTO transactions(user_id,amount,type,date)VALUES($1,5,'expense','2026-08-03')",[owner]);
 const r=await report('2026-08-01','2026-08-31');expect(r.expenses.map((e:any)=>e.amount).sort()).toEqual([5,7]);
});
it('isola proprietário, exige autenticação e restringe execução',async()=>{
 await receipt(40,'2026-08-02');await db.exec(`SET test.owner='${other}'`);expect((await report()).receipts).toEqual([]);
 await db.exec("SET test.owner=''");await expect(report()).rejects.toThrow('auth_required');
 const rows=(await db.query("SELECT has_function_privilege('anon','financial_analytics_report(date,date,uuid)','EXECUTE') anon,has_function_privilege('authenticated','financial_analytics_report(date,date,uuid)','EXECUTE') authenticated,has_function_privilege('service_role','financial_analytics_report(date,date,uuid)','EXECUTE') service")).rows as any[];
 expect(rows[0]).toEqual({anon:false,authenticated:true,service:false});
});
it('rejeita intervalo parcial, invertido, infinito e excessivo sem alterar finanças',async()=>{
 for(const [from,to] of [['2026-01-01',null],['2026-08-02','2026-08-01'],['infinity','infinity'],['2000-01-01','2026-01-01']])await expect(report(from,to)).rejects.toThrow('invalid_financial_period');
 expect((await report()).wallet.totals.receipts).toBe(0);
});

it('sessão trocada entre preparação e envio não retorna caixa de outro proprietário',async()=>{
 await db.exec(`SET test.owner='${other}'`);await expect(db.query('SELECT financial_analytics_report(NULL,NULL,$1::uuid)',[owner])).rejects.toThrow('financial_owner_changed');
});
it('limite de eventos falha explicitamente sem truncar totais',async()=>{
 await db.exec(`INSERT INTO transactions(user_id,type,amount) SELECT '${owner}','capital_injection',1 FROM generate_series(1,50001)`);
 await expect(report()).rejects.toThrow('financial_event_limit');
 expect(Number((await db.query<{n:number}>('SELECT count(*) n FROM transactions')).rows[0].n)).toBe(50001);
});
