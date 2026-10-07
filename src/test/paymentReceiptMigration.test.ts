// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const contract='33333333-3333-4333-8333-333333333333',inst='44444444-4444-4444-8444-444444444444';
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
const receiptMigration='20261007230000_payment_receipt_outbox.sql';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync('src/test/fixtures/financialDatabase.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/paymentReceiptDatabase.sql','utf8'));
 const reliability=migration('20261007093000_bot_delivery_reliability.sql');
 await db.exec(reliability.slice(reliability.indexOf('CREATE OR REPLACE FUNCTION public.bot_phone_key'),reliability.indexOf('CREATE INDEX IF NOT EXISTS clients_bot_phone_idx')));
 for(const name of ['20260922130000_dynamic_late_fee_tracks_settlement.sql','20260922100000_reverse_percentage_settlement.sql',
   '20261007210000_incremental_payment_ledger.sql','20261007220000_financial_calendar_atomic_charges.sql',receiptMigration])await db.exec(migration(name));
 await db.exec(`CREATE TRIGGER takeover BEFORE UPDATE ON whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION bot_takeover_guard();`);
},30_000);
beforeEach(async()=>{
 await db.exec(`RESET ROLE;SET TimeZone='UTC';SET test.owner='${owner}';
 TRUNCATE contracts,contract_installments,transactions,profits,collection_attempts,whatsapp_scheduled_messages,whatsapp_conversations,clients,settings;
 INSERT INTO clients VALUES('${owner}','${owner}','Cliente fictício','11987654321',NULL);
 INSERT INTO settings(user_id,company_name) VALUES('${owner}','Empresa fictícia');
 INSERT INTO contracts(id,user_id,client_id,status) VALUES('${contract}','${owner}','${owner}','active');
 INSERT INTO contract_installments(id,user_id,client_id,contract_id,installment_number,amount,due_date,status)
 VALUES('${inst}','${owner}','${owner}','${contract}',1,100,current_date+30,'pending');`);
});
afterAll(async()=>{await db?.close();});
async function scalar(query:string,args:unknown[]=[]){return Object.values((await db.query(query,args)).rows[0])[0] as any;}
const pay=(amount:number)=>scalar('SELECT pay_installment($1::uuid,$2::numeric)',[inst,amount]);
const jobs=()=>db.query<any>('SELECT * FROM whatsapp_scheduled_messages ORDER BY expected_amount');
const request=(tx:string)=>scalar('SELECT request_payment_receipt($1::uuid)',[tx]);
const context=(tx:string)=>scalar('SELECT payment_receipt_context($1::uuid,$2::uuid)',[tx,owner]);

it('gera uma confirmação por recebimento incremental, inclusive parcial e final',async()=>{
 await pay(40);await pay(70);await pay(100);
 const {rows}=await jobs();expect(rows).toHaveLength(3);
 expect(rows.map(r=>Number(r.expected_amount))).toEqual([30,30,40]);
 for(const r of rows){expect(r.purpose).toBe('payment_receipt');expect(r.text).toContain(`R$ ${Number(r.expected_amount).toFixed(2).replace('.',',')}`);expect(r.text).not.toContain('quitad');expect(r.payment_transaction_id).toBeTruthy();}
 expect(await scalar('SELECT count(*) FROM whatsapp_conversations')).toBe(1);
});
it('pagamento repetido e solicitações repetidas não duplicam confirmação',async()=>{
 await pay(40);const job=(await jobs()).rows[0];
 await expect(pay(40)).rejects.toThrow('payment_below_installment_balance');
 expect((await request(job.payment_transaction_id)).duplicate).toBe(true);
 expect((await request(job.payment_transaction_id)).job_id).toBe(job.id);
 expect((await jobs()).rows).toHaveLength(1);
});
it('estado pago sem lançamento de caixa não dispara mensagem',async()=>{
 await db.exec("UPDATE contract_installments SET paid_amount=100,status='paid'");
 expect((await jobs()).rows).toHaveLength(0);
 expect(await scalar('SELECT count(*) FROM transactions')).toBe(0);
});
it('desativar recibos preserva o pagamento sem criar conversa ou fila',async()=>{
 await db.exec('UPDATE settings SET bot_send_receipt=false');await pay(40);
 expect((await jobs()).rows).toHaveLength(0);expect(await scalar('SELECT count(*) FROM whatsapp_conversations')).toBe(0);
 expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(40);
});
it('modo manual e bot desligado exigem aprovação',async()=>{
 await db.exec('UPDATE settings SET bot_auto_send=false');await pay(40);
 expect((await jobs()).rows[0].status).toBe('awaiting_approval');
});
it('estorno cancela confirmação não enviada e invalida a prova de caixa',async()=>{
 await pay(40);const job=(await jobs()).rows[0];
 await scalar('SELECT reverse_installment_payment($1::uuid)',[inst]);
 expect((await jobs()).rows[0].status).toBe('cancelled');expect((await context(job.payment_transaction_id)).valid).toBe(false);
 expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(0);
});
it('estorno conserva o histórico de uma entrega já iniciada',async()=>{
 await pay(40);await db.exec("UPDATE whatsapp_scheduled_messages SET status='processing',delivery_started_at=now()");
 await scalar('SELECT reverse_installment_payment($1::uuid)',[inst]);
 expect((await jobs()).rows[0].status).toBe('processing');expect((await jobs()).rows[0].delivery_started_at).toBeTruthy();
});
it('modificar valor ou data do caixa cancela a confirmação antiga',async()=>{
 await pay(40);await db.exec('UPDATE transactions SET amount=30');expect((await jobs()).rows[0].status).toBe('cancelled');
});
it('atualização sem mudança financeira preserva o recibo',async()=>{
 await pay(40);await db.exec('UPDATE transactions SET amount=amount');expect((await jobs()).rows[0].status).toBe('pending');
});
it('atendimento humano mantém só confirmação e cancela cobranças automáticas',async()=>{
 await pay(40);const job=(await jobs()).rows[0];
 await db.query("INSERT INTO whatsapp_scheduled_messages(user_id,conversation_id,purpose,status) VALUES($1,$2,'collection','pending')",[owner,job.conversation_id]);
 await db.exec('UPDATE whatsapp_conversations SET needs_human=true');
 const {rows}=await db.query<any>('SELECT purpose,status FROM whatsapp_scheduled_messages ORDER BY purpose');
 expect(rows).toEqual([{purpose:'collection',status:'cancelled'},{purpose:'payment_receipt',status:'pending'}]);
 expect(await scalar('SELECT bot_paused FROM whatsapp_conversations')).toBe(true);
});
it('preserva JID existente sem nono dígito',async()=>{
 await db.exec(`INSERT INTO whatsapp_conversations(user_id,client_id,phone,jid,instance) VALUES('${owner}','${owner}','551187654321','551187654321@s.whatsapp.net','main');`);
 await pay(40);expect(await scalar('SELECT count(*) FROM whatsapp_conversations')).toBe(1);
 expect(await scalar('SELECT jid FROM whatsapp_conversations')).toBe('551187654321@s.whatsapp.net');
});
it.each(['','123','551112345678900'])('telefone inválido %s não produz recibo nem impede recebimento',async phone=>{
 await db.query('UPDATE clients SET phone=$1',[phone]);await pay(40);expect((await jobs()).rows).toHaveLength(0);
 expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(40);
});
it('telefone compartilhado por clientes impede exposição de informações financeiras',async()=>{
 await db.exec(`INSERT INTO clients VALUES('${other}','${owner}','Outro cliente fictício','11987654321',NULL)`);
 await pay(40);expect((await jobs()).rows).toHaveLength(0);
});
it('proíbe enviar no grupo ou na conversa vinculada a outro cliente',async()=>{
 await db.exec(`INSERT INTO whatsapp_conversations(user_id,client_id,phone,jid,instance) VALUES('${owner}','${other}','5511987654321','5511987654321@g.us','main')`);
 await pay(40);expect((await jobs()).rows).toHaveLength(0);
});
it('usuário não consegue solicitar recibo de outro dono e anônimo não executa RPC',async()=>{
 await pay(40);const tx=(await jobs()).rows[0].payment_transaction_id;
 await db.exec(`SET test.owner='${other}'`);await expect(request(tx)).rejects.toThrow('payment_not_found');
 expect(await scalar("SELECT has_function_privilege('anon','request_payment_receipt(uuid)','execute')")).toBe(false);
 expect(await scalar("SELECT has_function_privilege('authenticated','payment_receipt_context(uuid,uuid)','execute')")).toBe(false);
 expect(await scalar("SELECT has_function_privilege('authenticated','enqueue_payment_receipt(uuid,uuid)','execute')")).toBe(false);
 expect(await scalar("SELECT has_function_privilege('service_role','payment_receipt_context(uuid,uuid)','execute')")).toBe(true);
});
it('data do comprovante usa o recebimento no Brasil, sem inventar a data atual',async()=>{
 await pay(40);const tx=(await jobs()).rows[0].payment_transaction_id;
 await db.exec("UPDATE transactions SET date='2026-10-08T01:00:00Z'");
 expect((await context(tx)).text).toContain('07/10/2026');
});
it('renovação humana descreve apenas os juros recebidos',async()=>{
 await db.exec(`INSERT INTO transactions(user_id,type,category,description,amount,client_id,contract_id,installment_id)
 VALUES('${owner}','payment','interest_renewal','Recebimento fictício',10,'${owner}','${contract}','${inst}')`);
 expect((await jobs()).rows).toHaveLength(1);expect((await jobs()).rows[0].text).toContain('Recebimento de juros');
 expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(0);
});
it('migração idempotente não cria recibos históricos nem modifica caixa',async()=>{
 await pay(40);const before=await scalar('SELECT to_jsonb(t) FROM transactions t');
 await db.exec(migration(receiptMigration));expect((await jobs()).rows).toHaveLength(1);
 expect(await scalar('SELECT to_jsonb(t) FROM transactions t')).toEqual(before);
});
