// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const contract='33333333-3333-4333-8333-333333333333',installment='44444444-4444-4444-8444-444444444444';
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
let db:PGlite;
const money=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value)?Number(value):value]));
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.owner',true),'')::uuid$$;
 CREATE TABLE contracts(id uuid PRIMARY KEY,user_id uuid,client_id uuid,status text,daily_interest_percent numeric DEFAULT 4,daily_penalty_type text DEFAULT 'percentage',daily_penalty_value numeric DEFAULT 0,max_interest_cap_percent numeric DEFAULT 0);
 CREATE TABLE contract_installments(id uuid PRIMARY KEY,user_id uuid,client_id uuid,contract_id uuid,installment_number int,amount numeric,due_date date,status text,paid_amount numeric DEFAULT 0,late_fee numeric DEFAULT 0,scheduled_interest numeric DEFAULT 10,scheduled_principal numeric DEFAULT 90,paid_principal numeric DEFAULT 0,paid_interest numeric DEFAULT 0,paid_fees numeric DEFAULT 0,paid_at timestamptz,payment_method text,receipt_url text,pre_settlement_snapshot jsonb);
 CREATE TABLE transactions(user_id uuid,amount numeric,type text,category text,description text,client_id uuid,contract_id uuid,installment_id uuid,principal_amount numeric,interest_amount numeric,fee_amount numeric,source_key text);
 CREATE TABLE profits(user_id uuid,amount numeric,description text,client_id uuid,installment_id uuid);
 CREATE UNIQUE INDEX uq_profit_installment ON profits(installment_id) WHERE installment_id IS NOT NULL;
 CREATE TABLE collectors(id uuid PRIMARY KEY,user_id uuid,is_active boolean,name text);
 CREATE TABLE collector_tokens(id uuid,token text,collector_id uuid,user_id uuid,is_active boolean);
 CREATE TABLE collector_assignments(collector_id uuid,user_id uuid,client_id uuid);
 CREATE TABLE collection_attempts(user_id uuid,client_id uuid,contract_id uuid,installment_id uuid,channel text,message_preview text);
 INSERT INTO collectors VALUES('${owner}','${owner}',true,'Fictício');
 INSERT INTO collector_tokens VALUES('${owner}','fictional-collector','${owner}','${owner}',true);
 INSERT INTO collector_assignments VALUES('${owner}','${owner}','${owner}');`);
 await db.exec(migration('20260922130000_dynamic_late_fee_tracks_settlement.sql'));
 const reverse=migration('20260922100000_reverse_percentage_settlement.sql');
 await db.exec(reverse.slice(reverse.indexOf('CREATE OR REPLACE FUNCTION public.reverse_installment_payment')));
 await db.exec(migration('20261007200500_collector_quote_parity.sql'));
 await db.exec(migration('20261007210000_incremental_payment_ledger.sql'));
},30_000);
beforeEach(async()=>{
 await db.exec(`SET test.owner='${owner}'; TRUNCATE contracts,contract_installments,transactions,profits,collection_attempts;
 INSERT INTO contracts(id,user_id,client_id,status) VALUES('${contract}','${owner}','${owner}','active');
 INSERT INTO contract_installments(id,user_id,client_id,contract_id,installment_number,amount,due_date,status) VALUES('${installment}','${owner}','${owner}','${contract}',1,100,current_date+30,'pending');`);
});
afterAll(async()=>{await db?.close();});
async function pay(total:number,source:string|null=null,discount=0){
 return (await db.query<{result:any}>('SELECT pay_installment($1::uuid,$2::numeric,false,\'pix\',NULL,$3::text,$4::numeric) AS result',[installment,total,source,discount])).rows[0].result;
}
async function ledger(){
 return (await db.query<{amount:string;principal_amount:string;interest_amount:string;fee_amount:string}>('SELECT amount,principal_amount,interest_amount,fee_amount FROM transactions')).rows;
}
async function record(query:string){return (await db.query<Record<string,unknown>>(query)).rows[0];}
it('registra duas entradas de juros com o índice único real de lucro por parcela',async()=>{
 await pay(5);await pay(8);
 expect((await ledger()).map(r=>Number(r.amount))).toEqual([5,3]);
 const {rows}=await db.query<{amount:string}>('SELECT amount FROM profits');
 expect(rows).toHaveLength(1);expect(Number(rows[0].amount)).toBe(8);
});
it('só distribui o dinheiro novo quando os encargos crescem entre pagamentos',async()=>{
 await pay(40);
 // Mantém o primeiro recebimento; o aumento não pode reclassificar o capital antigo.
 await db.exec('UPDATE contract_installments SET late_fee=40;');
  await pay(70);
  const rows=await ledger(); const second=rows[1];
  expect(Number(second.amount)).toBe(30);
  expect(Number(second.principal_amount)+Number(second.interest_amount)+Number(second.fee_amount)).toBe(30);
  expect(money(second)).toMatchObject({principal_amount:0,interest_amount:0,fee_amount:30});
  const state=await record('SELECT paid_amount,paid_principal,paid_interest,paid_fees FROM contract_installments');
  expect(money(state)).toMatchObject({paid_amount:70,paid_principal:30,paid_interest:10,paid_fees:30});
});
it('conclui uma sequência de recebimentos mantendo lucro e caixa sem duplicar',async()=>{
 for(const total of [5,8,40])await pay(total);
 await db.exec('UPDATE contract_installments SET late_fee=40');
 await pay(70);await pay(140);
 const rows=await ledger();expect(rows.map(r=>Number(r.amount))).toEqual([5,3,32,30,70]);
 for(const row of rows)expect(Number(row.principal_amount)+Number(row.interest_amount)+Number(row.fee_amount)).toBe(Number(row.amount));
 const state=await record('SELECT paid_amount,paid_principal,paid_interest,paid_fees,status FROM contract_installments');
 expect(money(state)).toMatchObject({paid_amount:140,paid_principal:90,paid_interest:10,paid_fees:40,status:'paid'});
 const profits=(await db.query<{amount:string}>('SELECT amount FROM profits')).rows;
 expect(profits).toHaveLength(1);expect(Number(profits[0].amount)).toBe(50);
});
it('o cobrador continua um parcial do credor sem refazer a distribuição antiga',async()=>{
 await pay(8);await db.exec('UPDATE contract_installments SET late_fee=20');
 const result=(await db.query<{result:any}>(`SELECT collector_register_payment('fictional-collector','${installment}',120,'pix') AS result`)).rows[0].result;
 expect(result).toMatchObject({new_money:112,principal:90,interest:2,fees:20,allocation_pending_review:false});
 expect((await db.query<{amount:string}>('SELECT amount FROM profits')).rows.map(r=>Number(r.amount))).toEqual([30]);
});
it.each(['owner','collector'])('preserva recebimentos legados sem composição e identifica revisão: %s',async path=>{
 await db.exec("UPDATE contract_installments SET paid_amount=40");
 const result=path==='owner'?await pay(100):(await db.query<{result:any}>(`SELECT collector_register_payment('fictional-collector','${installment}',100,'pix') AS result`)).rows[0].result;
 expect(result).toMatchObject({allocation_pending_review:true,unallocated_amount:60});
 const row=await record('SELECT amount,principal_amount,interest_amount,fee_amount,unallocated_amount FROM transactions');
 expect(money(row)).toMatchObject({amount:60,principal_amount:0,interest_amount:0,fee_amount:0,unallocated_amount:60});
 expect((await db.query('SELECT * FROM profits')).rows).toHaveLength(0);
 const review=(await db.query<{result:any}>('SELECT payment_allocation_review() AS result')).rows[0].result;
 expect(review).toMatchObject({allocation_review_count:1,unallocated_received_total:100});
});
it('não refaz componentes antigos que já excedem o recebido',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40,paid_interest=10,paid_principal=50');
 await pay(70);
 const row=await record('SELECT paid_amount,paid_interest,paid_principal FROM contract_installments');
 expect(money(row)).toMatchObject({paid_amount:70,paid_interest:10,paid_principal:50});
 expect(Number((await record('SELECT unallocated_amount FROM transactions')).unallocated_amount)).toBe(30);
});
it('repetir o comprovante e o pagamento quitado não gera caixa nem lucro novos',async()=>{
 await pay(5,'receipt-1');expect(await pay(5,'receipt-1')).toMatchObject({idempotent:true});
 await pay(100,'receipt-2');expect(await pay(100,'receipt-2')).toMatchObject({idempotent:true});
 expect(await pay(100)).toMatchObject({idempotent:true});
 expect(await ledger()).toHaveLength(2);expect((await db.query('SELECT * FROM profits')).rows).toHaveLength(1);
});
it('comprovante de outra parcela não confirma um pagamento que não ocorreu',async()=>{
 await pay(5,'receipt-1');
 await db.exec(`INSERT INTO contract_installments(id,user_id,client_id,contract_id,amount,due_date,status) VALUES('${other}','${owner}','${owner}','${contract}',100,current_date+30,'pending')`);
 await expect(db.query(`SELECT pay_installment('${other}',100,false,'pix',NULL,'receipt-1')`)).rejects.toThrow('payment_source_conflict');
 expect(await ledger()).toHaveLength(1);
});
it('conciliação só mostra dados do dono da sessão e exige autenticação',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');
 await db.exec(`SET test.owner='${other}'`);
 expect((await db.query<{result:any}>('SELECT payment_allocation_review() AS result')).rows[0].result).toMatchObject({allocation_review_count:0,installments:[]});
 await db.exec("SET test.owner=''");
 await expect(db.query('SELECT payment_allocation_review()')).rejects.toThrow('auth_required');
});
it.each(['owner','collector'])('conflito de dono no lucro desfaz todo o recebimento: %s',async path=>{
 await db.exec(`INSERT INTO profits(user_id,installment_id,amount) VALUES('${other}','${installment}',2)`);
 const request=path==='owner'?pay(5):db.query(`SELECT collector_register_payment('fictional-collector','${installment}',100,'pix')`);
 await expect(request).rejects.toThrow('profit_owner_mismatch');
 expect(await ledger()).toHaveLength(0);
 expect((await record('SELECT paid_amount FROM contract_installments')).paid_amount).toBe('0');
 expect((await record('SELECT amount FROM profits')).amount).toBe('2');
});
it.each(['NaN','Infinity','-Infinity'])('recusa valor não finito sem alterar o dinheiro: %s',async value=>{
 await expect(db.query('SELECT pay_installment($1::uuid,$2::numeric,false)',[installment,value])).rejects.toThrow('invalid_payment_amount');
 await expect(db.query("SELECT collector_register_payment('fictional-collector',$1::uuid,$2::numeric,'pix')",[installment,value])).rejects.toThrow('valor_de_quitacao_invalido');
 expect(await ledger()).toHaveLength(0);
});
it('não recebe contrato cancelado',async()=>{
 await db.exec("UPDATE contracts SET status='cancelled'");await expect(pay(100)).rejects.toThrow('contract_closed');
 expect(await ledger()).toHaveLength(0);
});
it('não transforma encargos já recebidos em desconto sem estorno',async()=>{
 await db.exec('UPDATE contract_installments SET late_fee=20');await pay(10);
 await expect(db.query(`SELECT pay_installment('${installment}',100,true,'pix',NULL,NULL,20)`)).rejects.toThrow('fee_discount_exceeds_unpaid_fees');
 expect(await ledger()).toHaveLength(1);
 await db.query(`SELECT pay_installment('${installment}',110,true,'pix',NULL,'discount-final',10)`);
 expect(money(await record('SELECT paid_amount,paid_fees FROM contract_installments'))).toMatchObject({paid_amount:110,paid_fees:10});
 // Repetir a baixa com desconto é idempotente, mesmo após diminuir o saldo.
 expect((await db.query<{result:any}>(`SELECT pay_installment('${installment}',110,true,'pix',NULL,'discount-final',10) AS result`)).rows[0].result.idempotent).toBe(true);
});
it('helper interno não é acessível e o relatório não é anônimo',async()=>{
 const row=(await db.query(`SELECT has_function_privilege('anon','payment_allocation_review()','execute') AS anonymous_review,
 has_function_privilege('authenticated','payment_allocation_review()','execute') AS owner_review,
 has_function_privilege('authenticated','allocate_installment_receipt(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)','execute') AS internal_allocation`)).rows[0];
 expect(row).toEqual({anonymous_review:false,owner_review:true,internal_allocation:false});
});
it('reaplicar a migração preserva caixa, lucro e valores históricos',async()=>{
 await pay(5);const cash=await db.query('SELECT * FROM transactions'),profits=await db.query('SELECT * FROM profits'),before=await db.query('SELECT * FROM contract_installments');
 await db.exec(migration('20261007210000_incremental_payment_ledger.sql'));
 expect((await db.query('SELECT * FROM transactions')).rows).toEqual(cash.rows);
 expect((await db.query('SELECT * FROM profits')).rows).toEqual(profits.rows);
 expect((await db.query('SELECT * FROM contract_installments')).rows).toEqual(before.rows);
});
it('identifica lucro divergente mesmo quando a divisão da parcela soma o recebido',async()=>{
 await pay(40);await db.exec('UPDATE profits SET amount=5');
 const review=(await db.query<{result:any}>('SELECT payment_allocation_review() AS result')).rows[0].result;
 expect(review).toMatchObject({allocation_review_count:1,unallocated_received_total:0,overallocated_received_total:0});
 expect(review.installments[0]).toMatchObject({received:40,allocated:40,classified_profit:10,recorded_profit:5});
});
it.each([0,10,100])('conserva cada centavo recebido com juros programados de %s',async interest=>{
 await db.query('UPDATE contract_installments SET scheduled_interest=$1::numeric,scheduled_principal=100-$1::numeric',[interest]);
 for(const total of [0.01,0.02,5.33,29.66,40])await pay(total);
 await db.exec('UPDATE contract_installments SET late_fee=13.37');
 for(const total of [40.01,55.55,113.37])await pay(total);
 const rows=await ledger();
 for(const row of rows)expect(Math.round(100*(Number(row.principal_amount)+Number(row.interest_amount)+Number(row.fee_amount)))).toBe(Math.round(100*Number(row.amount)));
 expect(Number((await record('SELECT sum(amount) AS amount FROM transactions')).amount)).toBe(113.37);
 expect(Number((await record('SELECT sum(paid_principal+paid_interest+paid_fees) AS amount FROM contract_installments')).amount)).toBe(113.37);
});
it('status desconhecido não exclui encargos nem permite concluir sem saldo quitado',async()=>{
 await db.exec('UPDATE contract_installments SET status=NULL,due_date=current_date-2');
 const result=await pay(100);
 expect(result).toMatchObject({received:100,remaining:8.16,late_fee:8.16,status:'overdue'});
 expect((await record('SELECT status FROM contracts')).status).toBe('active');
 await pay(108.16);expect((await record('SELECT status FROM contracts')).status).toBe('completed');
});
it('estorno existente remove caixa, lucro e pendência de composição e permite receber de novo',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=40');await pay(100);
 expect(Number((await record('SELECT sum(unallocated_amount) AS amount FROM transactions')).amount)).toBe(60);
 await db.query(`SELECT reverse_installment_payment('${installment}')`);
 expect(await ledger()).toHaveLength(0);expect((await db.query('SELECT * FROM profits')).rows).toHaveLength(0);
 expect((await db.query<{result:any}>('SELECT payment_allocation_review() AS result')).rows[0].result.allocation_review_count).toBe(0);
 await pay(5);await pay(8);
 expect((await db.query<{amount:string}>('SELECT amount FROM profits')).rows.map(row=>Number(row.amount))).toEqual([8]);
});
