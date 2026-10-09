// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const contract='33333333-3333-4333-8333-333333333333',inst='44444444-4444-4444-8444-444444444444';
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync('src/test/fixtures/financialDatabase.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/paymentReceiptDatabase.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/walletCashDatabase.sql','utf8'));
 for(const name of ['20260922130000_dynamic_late_fee_tracks_settlement.sql','20260922100000_reverse_percentage_settlement.sql',
  '20261007210000_incremental_payment_ledger.sql','20261007220000_financial_calendar_atomic_charges.sql','20261008000000_wallet_cash_report.sql','20261009010000_wallet_commercial_cash.sql'])await db.exec(migration(name));
},30_000);
beforeEach(async()=>{
 await db.exec(`RESET ROLE;SET TimeZone='UTC';SET test.owner='${owner}';TRUNCATE contracts,contract_installments,transactions,profits,expenses;
 INSERT INTO contracts(id,user_id,client_id,status) VALUES('${contract}','${owner}','${owner}','active');
 INSERT INTO contract_installments(id,user_id,client_id,contract_id,installment_number,amount,due_date,status)
 VALUES('${inst}','${owner}','${owner}','${contract}',1,100,((now() AT TIME ZONE 'America/Sao_Paulo')::date+30+time '12:00') AT TIME ZONE 'America/Sao_Paulo','pending');`);
});
afterAll(async()=>{await db?.close();});
async function scalar(query:string,args:unknown[]=[]){return Object.values((await db.query(query,args)).rows[0])[0] as any;}
const report=(days:number|null=null,search='',offset=0,limit=50)=>scalar('SELECT wallet_cash_report($1::int,$2::text,$3::int,$4::int)',[days,search,offset,limit]);
async function payment(amount:number,daysAgo=0,category:string|null='loan_payment',linked=true){
 await db.query(`INSERT INTO transactions(user_id,type,category,description,amount,client_id,contract_id,installment_id,date)
 VALUES($1,'payment',$2,'Recebimento fictício',$3,$1,$4,$5,((now() AT TIME ZONE 'America/Sao_Paulo')::date-$6::int+time '12:00') AT TIME ZONE 'America/Sao_Paulo')`,[owner,category,amount,contract,linked?inst:null,daysAgo]);
}
it('pagamentos parciais permanecem no dia do caixa depois da quitação',async()=>{
 await scalar('SELECT pay_installment($1::uuid,40)',[inst]);
 await db.exec("UPDATE transactions SET date=((now() AT TIME ZONE 'America/Sao_Paulo')::date-20+time '12:00') AT TIME ZONE 'America/Sao_Paulo'");
 await scalar('SELECT pay_installment($1::uuid,100)',[inst]);
 const all=await report(),week=await report(7);
 expect(all.totals.receipts).toBe(100);expect(all.timeline.map((r:any)=>r.amount)).toEqual([60,40]);
 expect(week.period).toMatchObject({inflows:60,outflows:0,opening_balance:40,closing_balance:100});
 expect(week.timeline).toHaveLength(1);expect(week.warnings.legacy_gap_amount).toBe(0);
});
it('inclui recebido parcial sem data no total e informa exclusão do filtro',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');
 const all=await report(),week=await report(7);
 expect(all.totals.receipts).toBe(40);expect(all.timeline[0].date).toBeNull();expect(all.warnings.undated_amount).toBe(40);
 expect(week.period.inflows).toBe(0);expect(week.period.opening_balance).toBe(40);
});
it('não transforma valor previsto ou status pago sem caixa em recebimento',async()=>{
 await db.exec("UPDATE contract_installments SET status='paid',paid_amount=0");
 const value=await report();expect(value.totals.receipts).toBe(0);expect(value.timeline).toEqual([]);
});
it('deduplica ledger legado sem parcela usando o contrato e cliente, sem inventar datas',async()=>{
 await db.exec("UPDATE contract_installments SET paid_amount=100,status='paid',paid_at=now()");await payment(90,0,null,false);
 const all=await report(),week=await report(7);
 expect(all.totals.receipts).toBe(100);expect(all.warnings.legacy_gap_amount).toBe(10);
 expect(all.timeline.map((r:any)=>r.amount)).toEqual([90,10]);expect(week.period.inflows).toBe(90);
});
it('inclui o tipo histórico partial_payment sem repetir o acumulado',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');await payment(40,0,null,false);
 await db.exec("UPDATE transactions SET type='partial_payment'");
 expect((await report()).totals.receipts).toBe(40);expect((await report()).warnings.legacy_gap_amount).toBe(0);
});
it('juros de renovação entram no caixa independentemente do estado da parcela',async()=>{
 await payment(20,0,'interest_renewal');await db.exec('UPDATE transactions SET interest_amount=20');
 const value=await report();expect(value.totals.receipts).toBe(20);expect(value.totals.profit).toBe(20);
 expect(value.timeline[0].source).toBe('Juros de renovação');expect(value.warnings.legacy_gap_amount).toBe(0);
});
it('soma caixa em centavos, não soma lucro novamente e mostra composição comprovada',async()=>{
 await scalar('SELECT pay_installment($1::uuid,40)',[inst]);
 await db.exec(`INSERT INTO transactions(user_id,type,description,amount) VALUES('${owner}','capital_injection','Aporte',200),
 ('${owner}','capital_withdrawal','Retirada',10),('${owner}','loan_disbursement','Liberação',100),('${owner}','expense','Investidor',5);
 INSERT INTO expenses(user_id,description,amount,date) VALUES('${owner}','Gasto',7,now());
 INSERT INTO profits(user_id,amount) VALUES('${owner}',2000);`);
 const value=await report();expect(value.totals).toMatchObject({inflows:240,outflows:122,balance:118,principal:30,profit:10,unclassified:0});
 expect(value.warnings.recorded_profit).toBe(2010);
});
it('inclui empréstimos registrados pelo tipo legado loan',async()=>{
 await db.exec(`INSERT INTO transactions(user_id,type,description,amount) VALUES('${owner}','loan','Liberação legada',30)`);
 expect((await report()).totals.disbursements).toBe(30);expect((await report()).totals.balance).toBe(-30);
});
it('não adivinha lucro ou principal de composição legada incoerente',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');await payment(40);
 await db.exec('UPDATE transactions SET principal_amount=50,interest_amount=20');
 expect((await report()).totals).toMatchObject({receipts:40,principal:0,profit:0,unclassified:40});
});
it('períodos usam dias brasileiros inclusivos e anteriores sem sobreposição',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=100');
 for(const [value,days] of [[10,0],[20,6],[30,7],[40,13]])await payment(value,days);
 const week=await report(7);expect(week.period).toMatchObject({inflows:30,previous_inflows:70,opening_balance:70,closing_balance:100});
});
it('lançamento posterior a hoje não entra no caixa atual ou no saldo inicial',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');await payment(40,-1);
 const value=await report(7);expect(value.totals.balance).toBe(0);expect(value.period.opening_balance).toBe(0);expect(value.warnings.future_amount).toBe(40);
});
it('o filtro de busca só altera o histórico, mantendo saldo e período',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');await payment(40);
 const value=await report(null,'sem resultado');expect(value.timeline).toEqual([]);expect(value.totals.balance).toBe(40);expect(value.period.inflows).toBe(40);
});
it('busca trata porcentagem como texto literal, sem curinga SQL',async()=>{
 await db.exec(`INSERT INTO transactions(user_id,type,description,amount) VALUES('${owner}','capital_injection','Meta 10%',10),('${owner}','capital_injection','Outra meta',20)`);
 expect((await report(null,'%')).timeline_count).toBe(1);
});
it('histórico pagina de forma estável sem limite de 1.000 nos totais',async()=>{
 await db.exec(`INSERT INTO transactions(user_id,type,description,amount) SELECT '${owner}','capital_injection','Aporte fictício',0.01 FROM generate_series(1,1101)`);
 const first=await report(null,'',0,50),second=await report(null,'',50,50);
 expect(first.timeline_count).toBe(1101);expect(first.totals.balance).toBe(11.01);expect(first.timeline).toHaveLength(50);
 expect(new Set([...first.timeline,...second.timeline].map(r=>r.id)).size).toBe(100);
});
it('estorno remove caixa e movimentações derivadas sem apagar outras entradas',async()=>{
 await scalar('SELECT pay_installment($1::uuid,40)',[inst]);
 await db.exec(`INSERT INTO transactions(user_id,type,description,amount) VALUES('${owner}','capital_injection','Aporte',30)`);
 await scalar('SELECT reverse_installment_payment($1::uuid)',[inst]);expect((await report()).totals.balance).toBe(30);
});
it('saldo não depende do status ativo, quitado ou cancelado de um contrato',async()=>{
 await scalar('SELECT pay_installment($1::uuid,40)',[inst]);await db.exec("UPDATE contracts SET status='completed'");
 expect((await report()).totals.receipts).toBe(40);expect((await report()).forecast.d90).toBe(0);
});
it('previsão inclui encargos e desconta pagamentos parciais com a regra da baixa',async()=>{
 await db.exec("UPDATE contract_installments SET paid_amount=40,late_fee=7,pre_settlement_snapshot='{}',due_date=now()-interval '1 day'");
 expect((await report()).forecast).toEqual({d7:67,d30:67,d90:67});
});
it('outro dono fica fora do caixa, composição, histórico e previsão',async()=>{
 await db.exec(`INSERT INTO transactions(user_id,type,description,amount) VALUES('${other}','capital_injection','Outra conta',999);
 INSERT INTO expenses(user_id,description,amount,date) VALUES('${other}','Outro gasto',100,now());
 INSERT INTO profits(user_id,amount) VALUES('${other}',400);`);
 expect((await report()).totals.balance).toBe(0);expect((await report()).warnings.recorded_profit).toBe(0);
 expect(await scalar("SELECT has_function_privilege('anon','wallet_cash_report(integer,text,integer,integer)','execute')")).toBe(false);
 expect(await scalar("SELECT has_function_privilege('service_role','wallet_cash_report(integer,text,integer,integer)','execute')")).toBe(false);
});
it.each([[1,'',0,50],[null,'',-1,50],[null,'',0,101],[null,'x'.repeat(201),0,50]])('recusa filtro inválido %#',async(days,search,offset,limit)=>{
 await expect(report(days as number|null,search as string,offset as number,limit as number)).rejects.toThrow('invalid_wallet_filter');
});
it.each(['NaN','Infinity','-Infinity','-1'])('valor de caixa inválido %s não vira saldo zero',async value=>{
 await db.query(`INSERT INTO transactions(user_id,type,description,amount) VALUES($1,'capital_injection','Dado inválido',$2::numeric)`,[owner,value]);
 await expect(report()).rejects.toThrow('invalid_wallet_amount');
});
it('a consulta e repetição da migração não modificam registros financeiros',async()=>{
 await scalar('SELECT pay_installment($1::uuid,40)',[inst]);const before=await scalar('SELECT jsonb_agg(to_jsonb(t)) FROM transactions t');
 await report();await db.exec(migration('20261008000000_wallet_cash_report.sql'));
 expect(await scalar('SELECT jsonb_agg(to_jsonb(t)) FROM transactions t')).toEqual(before);
});
