// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,expect,it} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const installment='33333333-3333-4333-8333-333333333333',receipt='44444444-4444-4444-8444-444444444444',request='55555555-5555-4555-8555-555555555555';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.owner',true),'')::uuid$$;
 CREATE TABLE clients(id uuid PRIMARY KEY,user_id uuid);
 CREATE TABLE contracts(id uuid PRIMARY KEY,user_id uuid,client_id uuid,status text);
 CREATE TABLE contract_installments(id uuid PRIMARY KEY,user_id uuid,contract_id uuid,client_id uuid,paid_amount numeric,paid_principal numeric DEFAULT 0,paid_interest numeric DEFAULT 0,paid_fees numeric DEFAULT 0,status text,paid_at timestamptz);
 CREATE TABLE transactions(id uuid PRIMARY KEY,user_id uuid,client_id uuid,contract_id uuid,installment_id uuid,type text,amount numeric,date timestamptz,principal_amount numeric DEFAULT 0,interest_amount numeric DEFAULT 0,fee_amount numeric DEFAULT 0,unallocated_amount numeric DEFAULT 0);
 CREATE TABLE profits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,client_id uuid,installment_id uuid,amount numeric,status text DEFAULT 'available',date timestamptz,description text);`);
 await db.exec(readFileSync('supabase/migrations/20261008140000_manual_payment_classification.sql','utf8'));
},30_000);
beforeEach(async()=>{
 await db.exec(`SET test.owner='${owner}';TRUNCATE payment_classification_history,payment_classification_cancellations,profits,transactions,contract_installments,contracts,clients;
 INSERT INTO clients VALUES('${owner}','${owner}');
 INSERT INTO contracts VALUES('${owner}','${owner}','${owner}','active');
 INSERT INTO contract_installments(id,user_id,contract_id,client_id,paid_amount,status,paid_at) VALUES('${installment}','${owner}','${owner}','${owner}',100,'paid','2026-01-02T12:00:00Z');
 INSERT INTO transactions(id,user_id,client_id,contract_id,installment_id,type,amount,date,unallocated_amount) VALUES('${receipt}','${owner}','${owner}','${owner}','${installment}','payment',100,'2026-01-02T12:00:00Z',100);`);
});
afterAll(async()=>{await db?.close();});
async function detail(){return (await db.query<{value:any}>('SELECT payment_classification_detail($1) AS value',[installment])).rows[0].value;}
async function classify(version:string,overrides:Record<string,unknown>={}){
 const values={request,owner,receipt,version,principal:80,interest:15,fees:5,reason:'Conferência humana do extrato fictício',evidence:'Extrato fictício 2026/0001',confirmed:true,...overrides};
 return (await db.query<{value:any}>('SELECT reclassify_payment_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value',Object.values(values))).rows[0].value;
}
it('classifica um recebimento sem alterar dinheiro, data, estado da parcela ou contrato',async()=>{
 const before=await detail();expect(before.can_reconcile).toBe(true);
 expect(await classify(before.version)).toMatchObject({ok:true,replayed:false});
 const after=await detail();
 expect(after.installment).toMatchObject({...before.installment,paid_principal:80,paid_interest:15,paid_fees:5});
 expect(after.transactions).toEqual([{...before.transactions[0],principal:80,interest:15,fees:5,unallocated:0}]);
 expect((await db.query<{status:string}>('SELECT status FROM contracts')).rows[0].status).toBe('active');
 expect(after.history).toHaveLength(1);expect(after.history[0]).toMatchObject({reason:'Conferência humana do extrato fictício',evidence:'Extrato fictício 2026/0001'});
 expect((await db.query<{amount:string}>('SELECT amount FROM profits')).rows[0].amount).toBe('20');
});
it('repetir uma resposta perdida não cria histórico nem lucro duplicados',async()=>{
 const before=await detail();await classify(before.version);
 expect(await classify(before.version)).toMatchObject({ok:true,replayed:true});
 expect((await detail()).history).toHaveLength(1);expect((await db.query('SELECT * FROM profits')).rows).toHaveLength(1);
 await expect(classify(before.version,{reason:'Outro motivo não pode reutilizar o pedido'})).rejects.toThrow('classification_request_conflict');
});
it('rejeita versão antiga quando outro recebimento mudou os dados',async()=>{
 const before=await detail();await db.exec("UPDATE transactions SET amount=120;UPDATE contract_installments SET paid_amount=120");
 await expect(classify(before.version)).rejects.toThrow('classification_changed');
 expect((await detail()).history).toHaveLength(0);
});
it.each([{principal:79},{fees:-1},{interest:15.001},{interest:'NaN'},{reason:'curto'},{evidence:''},{confirmed:false}])('recusa valores/documentação inválidos sem alterar o recebimento: %j',async override=>{
 const before=await detail();await expect(classify(before.version,override)).rejects.toThrow();
 expect(await detail()).toEqual(before);
});
it('bloqueia quando parcelas e caixa não correspondem, sem inventar evento faltante',async()=>{
 await db.exec('UPDATE contract_installments SET paid_amount=120');const before=await detail();expect(before.can_reconcile).toBe(false);
 await expect(classify(before.version)).rejects.toThrow('classification_cash_mismatch');expect(await detail()).toEqual(before);
});
it('não abre nem modifica recebimento de outra empresa ou sessão sem autenticação',async()=>{
 const before=await detail();await db.exec(`SET test.owner='${other}'`);
 await expect(detail()).rejects.toThrow('installment_not_found');await expect(classify(before.version,{owner:other})).rejects.toThrow('receipt_not_found');
 await db.exec("SET test.owner=''");await expect(detail()).rejects.toThrow('auth_required');await expect(classify(before.version)).rejects.toThrow('auth_required');
});
it('não aceita referência de outra empresa dentro de um recebimento próprio',async()=>{
 await db.exec(`UPDATE transactions SET client_id='${other}'`);await expect(detail()).rejects.toThrow('payment_reference_mismatch');
});
it('preserva data e estado de um lucro existente e impede apagar a auditoria',async()=>{
 await db.exec(`INSERT INTO profits(user_id,client_id,installment_id,amount,status,date) VALUES('${owner}','${owner}','${installment}',50,'withdrawn','2026-01-01T12:00:00Z')`);
 await classify((await detail()).version);
 expect((await db.query('SELECT amount,status,date FROM profits')).rows[0]).toMatchObject({amount:'20',status:'withdrawn',date:new Date('2026-01-01T12:00:00Z')});
 await expect(db.exec('DELETE FROM payment_classification_history')).rejects.toThrow('payment_classification_history_immutable');
});
it('visitantes e serviço não executam a conciliação humana e titulares não gravam a auditoria diretamente',async()=>{
 const signature='reclassify_payment_receipt(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,boolean)';
 const row=(await db.query(`SELECT has_function_privilege('anon','${signature}','execute') AS visitor,has_function_privilege('service_role','${signature}','execute') AS service,has_function_privilege('authenticated','${signature}','execute') AS owner,has_table_privilege('authenticated','payment_classification_history','insert') AS forge`)).rows[0];
 expect(row).toEqual({visitor:false,service:false,owner:true,forge:false});
});
it('cancelamento confirmado bloqueia uma tentativa que chega depois',async()=>{
 const before=await detail();
 const result=(await db.query<{value:any}>('SELECT cancel_payment_classification($1,$2) AS value',[request,owner])).rows[0].value;
 expect(result).toMatchObject({ok:true,cancelled:true,request_id:request});
 await expect(classify(before.version)).rejects.toThrow('classification_cancelled');
 expect(await detail()).toEqual(before);
});
it('cancelar uma resposta perdida informa aplicação anterior e não desfaz classificação',async()=>{
 await classify((await detail()).version);
 const result=(await db.query<{value:any}>('SELECT cancel_payment_classification($1,$2) AS value',[request,owner])).rows[0].value;
 expect(result).toMatchObject({ok:true,cancelled:false,replayed:true});
 expect((await detail()).history).toHaveLength(1);
});
it('recalcula a composição de vários recebimentos sem alterar os outros eventos',async()=>{
 await db.exec(`UPDATE transactions SET amount=40,unallocated_amount=40;
 INSERT INTO transactions(id,user_id,client_id,contract_id,installment_id,type,amount,date,principal_amount,interest_amount,fee_amount)
 VALUES('${other}','${owner}','${owner}','${owner}','${installment}','payment',60,'2026-01-03T12:00:00Z',50,8,2)`);
 await classify((await detail()).version,{principal:30,interest:9,fees:1});
 expect((await detail()).installment).toMatchObject({paid_amount:100,paid_principal:80,paid_interest:17,paid_fees:3});
 expect((await db.query('SELECT amount,principal_amount FROM transactions WHERE id=$1',[other])).rows[0]).toEqual({amount:'60',principal_amount:'50'});
});
it('não reclassifica entradas de aporte ou receita avulsa como pagamento de parcela',async()=>{
 await db.exec("UPDATE transactions SET type='income'");const before=await detail();
 expect(before.can_reconcile).toBe(false);expect(before.transactions).toHaveLength(0);
 await expect(classify(before.version)).rejects.toThrow('receipt_not_found');
});
