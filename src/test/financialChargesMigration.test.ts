// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';
import {computeLateFee} from '@/lib/lateFee';
import {botLateFee} from '../../supabase/functions/_shared/bot_finance';

const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const contract='33333333-3333-4333-8333-333333333333',inst='44444444-4444-4444-8444-444444444444',next='55555555-5555-4555-8555-555555555555';
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
const calendar='20261007220000_financial_calendar_atomic_charges.sql';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync('src/test/fixtures/financialDatabase.sql','utf8'));
 for(const name of ['20260922130000_dynamic_late_fee_tracks_settlement.sql','20260922100000_reverse_percentage_settlement.sql','20261005120000_renew_interest_uses_scheduled_breakdown.sql',
  '20261006120000_guard_contract_completion.sql','20261007100000_receipt_review_partial_payments.sql','20261007210000_incremental_payment_ledger.sql',calendar])await db.exec(migration(name));
 await db.exec(`CREATE TRIGGER cancel_charges AFTER UPDATE OF status,paid_amount ON contract_installments FOR EACH ROW EXECUTE FUNCTION cancel_scheduled_charges_after_installment_change();
 INSERT INTO collectors VALUES('${owner}','${owner}',true,'Fictício');
 INSERT INTO collector_tokens VALUES('${owner}','fictitious-collector','${owner}','${owner}',true);
 INSERT INTO collector_assignments VALUES('${owner}','${owner}','${owner}');`);
},30_000);
beforeEach(async()=>{
 await db.exec(`RESET ROLE;SET TimeZone='UTC';SET test.owner='${owner}';TRUNCATE contracts,contract_installments,transactions,profits,collection_attempts,client_notifications,notifications,whatsapp_scheduled_messages,whatsapp_receipt_reviews,settings;
 INSERT INTO contracts(id,user_id,client_id,status) VALUES('${contract}','${owner}','${owner}','active');
 INSERT INTO contract_installments(id,user_id,client_id,contract_id,installment_number,amount,due_date,status)
 VALUES('${inst}','${owner}','${owner}','${contract}',1,100,((now() AT TIME ZONE 'America/Sao_Paulo')::date-1+time '12:00') AT TIME ZONE 'America/Sao_Paulo','pending');`);
});
afterAll(async()=>{await db?.close();});
async function scalar(query:string,args:unknown[]=[]){return Object.values((await db.query(query,args)).rows[0])[0] as any;}
const refresh=(cursor:string|null=null,limit=250)=>scalar('SELECT refresh_installment_charges($1::uuid,$2::int)',[cursor,limit]);
const quoteArgs=(amount=201,stored=0,snapshot:any=null,rate:any=.5,type='percentage',penalty=0,cap=0)=>[amount,'2026-10-07T15:00:00Z','pending',stored,snapshot===null?null:JSON.stringify(snapshot),rate,type,penalty,cap,'2026-10-08T03:00:00Z'];
const sqlQuote=(args:unknown[])=>scalar('SELECT quote_installment_late_fee($1::numeric,$2::timestamptz,$3::text,$4::numeric,$5::jsonb,$6::numeric,$7::text,$8::numeric,$9::numeric,$10::timestamptz)',args);

it.each([
 quoteArgs(),quoteArgs(100,0,null,4,'fixed',2),quoteArgs(100,15,null,1,'percentage',2,10),
 quoteArgs(100,7,{},4,'fixed',10),quoteArgs(100,0,null,0),quoteArgs(100,0,null,null),
 quoteArgs(100,0,null,-2,'fixed',2),quoteArgs(0,5,null,4,'fixed',10),
 ['100','2026-10-08T01:00:00Z',null,0,null,4,'percentage',0,0,'2026-10-08T03:00:00Z'],
 ['100','2018-11-03T15:00:00Z','overdue',0,null,1,'fixed',2,0,'2018-11-05T02:30:00Z'],
 ['100','2019-02-16T15:00:00Z','overdue',0,null,1,'fixed',2,0,'2019-02-18T03:30:00Z'],
])('SQL, portal and bot agree on monetary and calendar case %#',async(...args)=>{
 const [amount,due_date,status,late_fee,snapshot,rate,type,penalty,cap,at]=args;
 const settings={daily_interest_percent:rate,daily_penalty_type:type,daily_penalty_value:penalty,max_interest_cap_percent:cap};
 const row={amount,due_date,status,late_fee,pre_settlement_snapshot:snapshot===null?null:JSON.parse(String(snapshot)),...settings};
 const expected=Number(await sqlQuote(args));
 expect(computeLateFee(row as any,new Date(String(at)))).toBe(expected);
 expect(botLateFee({...row,contracts:settings},String(at))).toBe(expected);
});
it.each(['2026-10-08T00:00:00Z','2026-10-08T02:59:59Z'])('SQL does not charge at UTC midnight: %s',async at=>{
 const args=quoteArgs();args[9]=at;expect(Number(await sqlQuote(args))).toBe(0);
});
it.each(['owner','collector'])('payment %s ignores the outer server timezone and restores it',async path=>{
 await db.exec(`SET TimeZone='Pacific/Kiritimati';UPDATE contract_installments SET due_date=((now() AT TIME ZONE 'America/Sao_Paulo')::date+time '12:00') AT TIME ZONE 'America/Sao_Paulo';`);
 const result=path==='owner'?await scalar(`SELECT pay_installment('${inst}',100,false)`):await scalar(`SELECT collector_register_payment('fictitious-collector','${inst}',100,'pix')`);
 expect(result.ok).toBe(true);expect(Number(await scalar('SELECT late_fee FROM contract_installments'))).toBe(0);
 expect(await scalar("SELECT current_setting('TimeZone')")).toBe('Pacific/Kiritimati');
});
it.each([['owner',.5],['collector',.5],['owner',-2],['collector',-2],['owner',0],['collector',0],['owner',null],['collector',null]])('payment %s agrees with the portal after a partial receipt at rate %s',async(path,rate)=>{
 await db.query('UPDATE contracts SET daily_interest_percent=$1,daily_penalty_type=\'fixed\',daily_penalty_value=1',[rate]);
 await db.exec('UPDATE contract_installments SET amount=201,paid_amount=40,paid_principal=30,paid_interest=10');
 const due=await scalar('SELECT due_date::text FROM contract_installments');
 const fee=computeLateFee({amount:201,due_date:due,daily_interest_percent:rate as number,daily_penalty_type:'fixed',daily_penalty_value:1});
 const result=path==='owner'?await scalar(`SELECT pay_installment('${inst}',$1::numeric,false)`,[201+fee])
   :await scalar(`SELECT collector_register_payment('fictitious-collector','${inst}',$1::numeric,'pix')`,[201+fee]);
 expect(result.ok).toBe(true);expect(Number(await scalar('SELECT late_fee FROM contract_installments'))).toBe(fee);
 expect(Number(await scalar('SELECT sum(amount) FROM transactions'))).toBe(161+fee);
});
it('updates the original base for partial receipts, ignoring global defaults',async()=>{
 await db.exec(`INSERT INTO settings(user_id,default_daily_interest) VALUES('${owner}',99);UPDATE contract_installments SET paid_amount=40,paid_interest=10,paid_principal=30;`);
 const result=await refresh();expect(result).toMatchObject({scanned:1,fees_updated:1,status_updated:1,client_notifications:1,owner_notifications:1,errors:[],next_cursor:null});
 expect(Number(await scalar('SELECT late_fee FROM contract_installments'))).toBe(4);
 expect(await scalar('SELECT metadata FROM client_notifications')).toMatchObject({amount:100,paid_amount:40,late_fee:4,total_due:64,days_overdue:1});
 expect(Number(await scalar('SELECT count(*) FROM transactions'))).toBe(0);expect(Number(await scalar('SELECT count(*) FROM profits'))).toBe(0);
 expect(await refresh()).toMatchObject({fees_updated:0,status_updated:0,client_notifications:0,owner_notifications:0});
});
it('stored floor, cap and frozen settlement are respected even on fees-only balances',async()=>{
 await db.exec("UPDATE contracts SET max_interest_cap_percent=10;UPDATE contract_installments SET paid_amount=100,late_fee=20");
 expect(await refresh()).toMatchObject({fees_updated:0,status_updated:1});expect(Number(await scalar('SELECT late_fee FROM contract_installments'))).toBe(20);
 await db.exec("UPDATE contract_installments SET paid_amount=0,late_fee=7,status='pending',pre_settlement_snapshot='{}'");
 await refresh();expect(Number(await scalar('SELECT late_fee FROM contract_installments'))).toBe(7);
});
it.each(['cancelled','completed','pending_signature','renegotiated'])('does not charge a %s contract',async status=>{
 if(status==='completed')await db.exec("UPDATE contract_installments SET status='cancelled'");
 await db.query('UPDATE contracts SET status=$1',[status]);
 expect(await refresh()).toMatchObject({scanned:0,fees_updated:0,status_updated:0,client_notifications:0,owner_notifications:0});
});
it.each(['user_id','client_id'])('does not charge a broken contract %s relationship',async column=>{
 await db.exec(`UPDATE contracts SET ${column}='${other}'`);expect(await refresh()).toMatchObject({scanned:0});
});
it('includes NULL open status, paginates past a batch and counts only real notification inserts',async()=>{
 await db.exec(`UPDATE contract_installments SET status=NULL;INSERT INTO contract_installments SELECT '${next}',user_id,client_id,contract_id,2,amount,due_date,status,paid_amount,late_fee,scheduled_interest,scheduled_principal,paid_principal,paid_interest,paid_fees,paid_at,payment_method,receipt_url,pre_settlement_snapshot FROM contract_installments;`);
 const first=await refresh(null,1);expect(first).toMatchObject({scanned:1,next_cursor:inst,client_notifications:1,owner_notifications:1});
 const second=await refresh(first.next_cursor,1);expect(second).toMatchObject({scanned:1,next_cursor:next,client_notifications:1,owner_notifications:0});
 expect(await refresh(second.next_cursor,1)).toMatchObject({scanned:0,next_cursor:null});
 await db.exec('UPDATE contract_installments SET late_fee=0');
 expect(await refresh()).toMatchObject({fees_updated:2,client_notifications:2,owner_notifications:0}); // Different alert type from first overdue transition.
 await db.exec('UPDATE contract_installments SET late_fee=0');
 expect(await refresh()).toMatchObject({fees_updated:2,client_notifications:0,owner_notifications:0});
 expect(await scalar("SELECT bool_and(dedupe_day=(now() AT TIME ZONE 'America/Sao_Paulo')::date) FROM client_notifications")).toBe(true);
});
it('notification failure rolls back the charge and reports failure instead of success',async()=>{
 await db.exec("ALTER TABLE client_notifications ADD CONSTRAINT fictional_failure CHECK(false)");
 try{const result=await refresh();expect(result).toMatchObject({fees_updated:0,status_updated:0,client_notifications:0,owner_notifications:0,errors:[{installment_id:inst,code:'23514'}]});
 expect(Number(await scalar('SELECT late_fee FROM contract_installments'))).toBe(0);expect(await scalar('SELECT status FROM contract_installments')).toBe('pending');
 }finally{await db.exec('ALTER TABLE client_notifications DROP CONSTRAINT fictional_failure');}
});
it('continues a batch after a malformed balance without manufacturing a fee or message',async()=>{
 // Reproduce a historical corrupt row; the new trigger rejects new ones.
 await db.exec(`ALTER TABLE contract_installments DISABLE TRIGGER trg_sync_paid_installment_status;
 INSERT INTO contract_installments SELECT '${next}',user_id,client_id,contract_id,2,amount,due_date,status,'NaN',late_fee,scheduled_interest,scheduled_principal,paid_principal,paid_interest,paid_fees,paid_at,payment_method,receipt_url,pre_settlement_snapshot FROM contract_installments;
 ALTER TABLE contract_installments ENABLE TRIGGER trg_sync_paid_installment_status;`);
 const result=await refresh();expect(result).toMatchObject({scanned:2,fees_updated:1,client_notifications:1,errors:[{installment_id:next,code:'22003'}]});
});
it.each(['amount','paid_amount','late_fee'])('a new nonfinite %s cannot be marked paid',async column=>{
 await expect(db.exec(`UPDATE contract_installments SET ${column}='NaN'`)).rejects.toThrow('invalid_installment_amount');
 expect(await scalar('SELECT status FROM contract_installments')).toBe('pending');
});
it('a base-only receipt retains collection while its fees remain',async()=>{
 await queue();await db.exec('UPDATE contract_installments SET late_fee=20,paid_amount=100');
 expect(await scalar('SELECT status FROM whatsapp_scheduled_messages')).toBe('pending');
});
it('closing the selected installment retains collection for another fee-only or NULL-status debt',async()=>{
 await queue();await db.exec(`INSERT INTO contract_installments SELECT '${next}',user_id,client_id,contract_id,2,amount,due_date,NULL,100,20,scheduled_interest,scheduled_principal,paid_principal,paid_interest,paid_fees,paid_at,payment_method,receipt_url,pre_settlement_snapshot FROM contract_installments;
 UPDATE contract_installments SET paid_amount=100,status='paid' WHERE id='${inst}';`);
 expect(await scalar('SELECT status FROM whatsapp_scheduled_messages')).toBe('pending');
});
it('settlement cancels only this owner’s collection, including jobs awaiting approval',async()=>{
 await queue();await db.exec(`INSERT INTO whatsapp_scheduled_messages(user_id,client_id,purpose,status) VALUES('${owner}','${owner}','collection','awaiting_approval'),('${owner}','${owner}','service_followup','pending'),('${other}','${owner}','collection','pending');
 UPDATE contract_installments SET paid_amount=100,status='paid';`);
 const rows=(await db.query<{purpose:string;user_id:string;status:string}>('SELECT purpose,user_id,status FROM whatsapp_scheduled_messages')).rows;
 expect(rows.filter(r=>r.user_id===owner&&r.purpose==='collection').map(r=>r.status)).toEqual(['cancelled','cancelled']);
 expect(rows.filter(r=>r.user_id===other||r.purpose==='service_followup').map(r=>r.status)).toEqual(['pending','pending']);
});
it('a provider delivery already started keeps its history when the balance is settled',async()=>{
 await queue();await db.exec("UPDATE whatsapp_scheduled_messages SET status='processing',delivery_started_at=now();UPDATE contract_installments SET paid_amount=100,status='paid'");
 expect(await scalar('SELECT status FROM whatsapp_scheduled_messages')).toBe('processing');
 expect(await scalar('SELECT error FROM whatsapp_scheduled_messages')).toBeNull();
});
it('keeps human discounts final and incremental cash unchanged',async()=>{
 await db.exec('UPDATE contract_installments SET late_fee=20,paid_amount=40,paid_interest=10,paid_principal=30');
 const result=await scalar(`SELECT pay_installment('${inst}',110,true,'pix',NULL,'fictitious-receipt',10)`);
 expect(result).toMatchObject({status:'paid',received:70,late_fee:10,fee_discount:10});
 expect(Number(await scalar('SELECT sum(amount) FROM transactions'))).toBe(70);
 expect(await refresh()).toMatchObject({scanned:0});
});
it('migration is idempotent and preserves cash rows, deadlines and global UTC',async()=>{
 await db.exec("UPDATE contract_installments SET paid_amount=40,paid_principal=30,paid_interest=10");
 const before=await scalar('SELECT to_jsonb(i) FROM contract_installments i');await db.exec(migration(calendar));
 expect(await scalar('SELECT to_jsonb(i) FROM contract_installments i')).toEqual(before);
 expect(await scalar("SELECT current_setting('TimeZone')")).toBe('UTC');
 const rows=(await db.query<{proname:string;proconfig:string[]}>('SELECT proname,proconfig FROM pg_proc WHERE pronamespace=\'public\'::regnamespace AND proname IN (\'pay_installment\',\'collector_register_payment\',\'reverse_installment_payment\',\'renew_installment_interest\',\'settle_percentage_installment\',\'sync_paid_installment_status\',\'confirm_whatsapp_receipt\',\'cancel_scheduled_charges_after_installment_change\')')).rows;
 expect(rows).toHaveLength(8);for(const row of rows)expect(row.proconfig).toContain('TimeZone=America/Sao_Paulo');
});
it('only the internal service can run the charge batch',async()=>{
 for(const role of ['anon','authenticated']){
  expect(await scalar("SELECT has_function_privilege($1,'refresh_installment_charges(uuid,integer)','execute')",[role])).toBe(false);
  await db.exec(`SET ROLE ${role}`);await expect(refresh()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 }
 expect(await scalar("SELECT has_function_privilege('service_role','refresh_installment_charges(uuid,integer)','execute')")).toBe(true);
});
async function queue(){await db.exec(`INSERT INTO whatsapp_scheduled_messages(user_id,client_id,purpose,status) VALUES('${owner}','${owner}','collection','pending')`);}
