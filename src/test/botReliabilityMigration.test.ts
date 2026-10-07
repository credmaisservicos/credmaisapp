// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { beforeAll,beforeEach,afterAll,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
const owner='00000000-0000-0000-0000-000000000001', other='00000000-0000-0000-0000-000000000002';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=(name:string)=>readFileSync(`supabase/migrations/${name}`,'utf8');
let db:PGlite;
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT '${owner}'::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('test.auth_role',true),''),'service_role')$$;
    CREATE TABLE clients(id uuid PRIMARY KEY,user_id uuid,phone text,whatsapp text);INSERT INTO clients VALUES('${owner}','${owner}','11912345678',NULL),('${other}','${other}','21912345678',NULL);
    CREATE TABLE contracts(id uuid PRIMARY KEY,user_id uuid,client_id uuid,status text,signature_status text DEFAULT 'not_required',daily_interest_percent numeric DEFAULT 4,
      daily_penalty_value numeric DEFAULT 0,daily_penalty_type text DEFAULT 'percentage',max_interest_cap_percent numeric DEFAULT 0,
      capital numeric DEFAULT 90,total_interest numeric DEFAULT 10,total_amount numeric DEFAULT 100,loan_mode text DEFAULT 'fixed',interest_rate numeric DEFAULT 10,
      grace_periods integer DEFAULT 0,num_installments integer DEFAULT 1,installment_amount numeric DEFAULT 100);
    CREATE TABLE contract_installments(id uuid PRIMARY KEY,contract_id uuid REFERENCES contracts(id) ON DELETE CASCADE,user_id uuid,client_id uuid,installment_number integer,
      amount numeric,due_date date,status text,paid_amount numeric DEFAULT 0,late_fee numeric DEFAULT 0,scheduled_interest numeric DEFAULT 10,scheduled_principal numeric DEFAULT 90,
      paid_fees numeric DEFAULT 0,paid_interest numeric DEFAULT 0,paid_principal numeric DEFAULT 0,paid_at timestamptz,payment_method text,receipt_url text,pre_settlement_snapshot jsonb);
    CREATE TABLE transactions(user_id uuid,amount numeric,type text,category text,description text,client_id uuid,contract_id uuid,installment_id uuid,
      principal_amount numeric,interest_amount numeric,fee_amount numeric,source_key text);
    CREATE TABLE profits(user_id uuid,amount numeric,description text,client_id uuid,installment_id uuid);
    CREATE TABLE settings(user_id uuid,bot_auto_confirm_payment boolean);
    CREATE TABLE whatsapp_receipt_reviews(id uuid PRIMARY KEY,user_id uuid,client_id uuid,installment_id uuid,amount numeric,status text DEFAULT 'pending',metadata jsonb DEFAULT '{}',reviewed_at timestamptz,reviewed_by uuid);
    CREATE TABLE whatsapp_event_claims(user_id uuid,instance text,message_id text,claimed_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,instance,message_id));
    CREATE TABLE whatsapp_response_windows(user_id uuid,jid text,claimed_until timestamptz,updated_at timestamptz,PRIMARY KEY(user_id,jid));
    CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,user_id uuid,bot_paused boolean DEFAULT false,needs_human boolean DEFAULT false,bot_status text);
    CREATE TABLE whatsapp_scheduled_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid,user_id uuid,text text,status text DEFAULT 'pending',
      scheduled_for timestamptz DEFAULT now(),claimed_at timestamptz,attempts integer DEFAULT 0,error text,purpose text DEFAULT 'manual',sent_at timestamptz,created_at timestamptz DEFAULT now(),client_id uuid,installment_id uuid);`);
  for(const name of ['20260905110000_contract_lifecycle.sql','20260922130000_dynamic_late_fee_tracks_settlement.sql','20261005120000_renew_interest_uses_scheduled_breakdown.sql','20261006120000_guard_contract_completion.sql','20261007093000_bot_delivery_reliability.sql','20261007100000_receipt_review_partial_payments.sql'])await db.exec(migration(name));
},30_000);
beforeEach(async()=>{await db.exec('RESET ROLE;SET test.auth_role=service_role;TRUNCATE contracts,transactions,profits,whatsapp_event_claims,whatsapp_response_windows,whatsapp_scheduled_messages,whatsapp_conversations,whatsapp_receipt_reviews CASCADE;');});
afterAll(async()=>{await db?.close();});
async function scalar(query:string,args:any[]=[]){return Object.values((await db.query(query,args)).rows[0])[0];}
async function seed(paid=0,fee=0){
  await db.query("INSERT INTO contracts(id,user_id,client_id,status) VALUES($1,$2,$2,'active')",[id(10),owner]);
  await db.query("INSERT INTO contract_installments(id,contract_id,user_id,client_id,installment_number,amount,due_date,status,paid_amount,late_fee) VALUES($1,$2,$3,$3,1,100,current_date+30,'pending',$4,$5)",[id(11),id(10),owner,paid,fee]);
  await db.query('INSERT INTO whatsapp_receipt_reviews(id,user_id,client_id,installment_id,amount) VALUES($1,$2,$2,$3,20)',[id(12),owner,id(11)]);
}
const confirm=(amount:number,date:string|null=null)=>scalar('SELECT confirm_whatsapp_receipt($1::uuid,$2::numeric,$3::date)',[id(12),amount,date]);
it('blocks anonymous and authenticated users from worker claims',async()=>{
  for(const role of ['anon','authenticated']){
    expect(await scalar("SELECT has_function_privilege($1,'public.claim_due_whatsapp_messages(integer)','EXECUTE')",[role])).toBe(false);
    await db.exec(`SET ROLE ${role}`);
    await expect(db.query('SELECT * FROM claim_due_whatsapp_messages(20)')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET test.auth_role=authenticated');
  await expect(db.query('SELECT * FROM claim_due_whatsapp_messages(20)')).rejects.toThrow(/service_role_required/);
});
it('phone lookup includes owner and area code',async()=>{
  expect((await db.query('SELECT id FROM system_find_clients_by_phone($1,$2)',[owner,'+55 11 91234-5678'])).rows).toEqual([{id:owner}]);
  expect((await db.query('SELECT id FROM system_find_clients_by_phone($1,$2)',[owner,'+55 21 91234-5678'])).rows).toHaveLength(0);
});
it('failed inbound events can retry without completed events replaying',async()=>{
  await db.query("SELECT save_whatsapp_event($1,'test','event','{}')",[owner]);
  expect(await scalar("SELECT begin_whatsapp_event($1,'test','event',$2)",[owner,id(20)])).toBe(true);
  expect(await scalar("SELECT begin_whatsapp_event($1,'test','event',$2)",[owner,id(21)])).toBe(false);
  await db.query("SELECT finish_whatsapp_event($1,'test','event',$2,false)",[owner,id(20)]);
  expect(await scalar("SELECT begin_whatsapp_event($1,'test','event',$2)",[owner,id(21)])).toBe(true);
  await db.query("SELECT finish_whatsapp_event($1,'test','event',$2,true)",[owner,id(20)]);
  expect(await scalar("SELECT status FROM whatsapp_event_claims")).toBe('processing');
  await db.query("SELECT finish_whatsapp_event($1,'test','event',$2,true)",[owner,id(21)]);
  expect(await scalar("SELECT begin_whatsapp_event($1,'test','event',$2)",[owner,id(22)])).toBe(false);
  expect(await scalar('SELECT payload FROM whatsapp_event_claims')).toBeNull();
});
it('response lease excludes concurrent fragments and releases only its token',async()=>{
  expect(await scalar("SELECT begin_whatsapp_response($1,'scope',$2)",[owner,id(20)])).toBe(true);
  await db.query("SELECT finish_whatsapp_response($1,'scope',$2)",[owner,id(21)]);
  expect(await scalar("SELECT begin_whatsapp_response($1,'scope',$2)",[owner,id(21)])).toBe(false);
  await db.query("SELECT finish_whatsapp_response($1,'scope',$2)",[owner,id(20)]);
  expect(await scalar("SELECT begin_whatsapp_response($1,'scope',$2)",[owner,id(21)])).toBe(true);
});
it('reclaims only jobs whose provider send never started',async()=>{
  await db.query("INSERT INTO whatsapp_scheduled_messages(id,user_id,status,claimed_at,delivery_started_at) VALUES($1,$3,'processing',now()-interval '3 minutes',NULL),($2,$3,'processing',now()-interval '3 minutes',now()-interval '3 minutes')",[id(20),id(21),owner]);
  const claimed=await db.query('SELECT id FROM claim_due_whatsapp_messages(20)');
  expect(claimed.rows).toEqual([{id:id(20)}]);
  expect(await scalar('SELECT status FROM whatsapp_scheduled_messages WHERE id=$1',[id(21)])).toBe('uncertain');
});
it('human takeover cancels automation while preserving manual and approved jobs',async()=>{
  await db.query('INSERT INTO whatsapp_conversations(id,user_id) VALUES($1,$2)',[id(30),owner]);
  for(const [n,purpose,approved] of [[31,'bot_reply',null],[32,'manual',null],[33,'collection',owner]] as const)await db.query('INSERT INTO whatsapp_scheduled_messages(id,conversation_id,user_id,purpose,approved_by) VALUES($1,$2,$3,$4,$5)',[id(n),id(30),owner,purpose,approved]);
  await db.query('UPDATE whatsapp_conversations SET needs_human=true WHERE id=$1',[id(30)]);
  expect(await scalar('SELECT bot_paused FROM whatsapp_conversations')).toBe(true);
  expect((await db.query<{status:string}>('SELECT status FROM whatsapp_scheduled_messages ORDER BY id')).rows.map(r=>r.status)).toEqual(['cancelled','pending','pending']);
});
it('reviewed partial receipt adds newly received money to the previous total',async()=>{
  await seed(40);await confirm(20);
  expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(60);
  expect(Number(await scalar('SELECT amount FROM transactions'))).toBe(20);
  await confirm(20);expect((await db.query('SELECT * FROM transactions')).rows).toHaveLength(1);
});
it('fee-only outstanding debt stays open until the fee is actually received',async()=>{
  await seed(100,20);await confirm(10);
  expect(await scalar('SELECT status FROM contract_installments')).toBe('pending');
  expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(110);
});
it('overpayment rolls back financial changes and preserves pending review',async()=>{
  await seed(40);await expect(confirm(61)).rejects.toThrow(/payment_exceeds_open_balance/);
  expect(Number(await scalar('SELECT paid_amount FROM contract_installments'))).toBe(40);
  expect((await db.query('SELECT * FROM transactions')).rows).toHaveLength(0);
  expect(await scalar('SELECT status FROM whatsapp_receipt_reviews')).toBe('pending');
});
it('rejects a review belonging to another owner',async()=>{
  await seed();await db.query('UPDATE whatsapp_receipt_reviews SET user_id=$1',[other]);
  await expect(confirm(20)).rejects.toThrow(/receipt_review_not_found/);
  expect((await db.query('SELECT * FROM transactions')).rows).toHaveLength(0);
});
it('interest renewal requires a future due date and matching bank amount',async()=>{
  await seed();await db.exec(`UPDATE whatsapp_receipt_reviews SET metadata='{"payment_kind":"interest_only"}'`);
  await expect(confirm(10)).rejects.toThrow(/future_renewal_due_date_required/);
  const date=String(await scalar("SELECT (current_date+60)::text"));
  await expect(confirm(11,date)).rejects.toThrow(/renewal_amount_mismatch/);
  expect((await db.query('SELECT * FROM transactions')).rows).toHaveLength(0);
  await confirm(10,date);
  expect(await scalar('SELECT due_date::text FROM contract_installments')).toBe(date);
  expect(await scalar('SELECT status FROM contract_installments')).toBe('pending');
  expect(Number(await scalar('SELECT amount FROM transactions'))).toBe(10);
});
