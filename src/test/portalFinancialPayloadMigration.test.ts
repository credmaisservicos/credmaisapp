// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333', contract = '44444444-4444-4444-8444-444444444444', collector = '55555555-5555-4555-8555-555555555555';
const token = '66666666-6666-4666-8666-666666666666';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE clients(id uuid PRIMARY KEY,user_id uuid,name text,phone text,whatsapp text,cpf_cnpj text,email text,status text,address text,birth_date date);
    CREATE TABLE contracts(id uuid PRIMARY KEY,user_id uuid,client_id uuid,capital numeric,interest_rate numeric,num_installments int,installment_amount numeric,frequency text,start_date date,status text,total_amount numeric,total_interest numeric,payment_method text,created_at timestamptz,late_fee_percent numeric,daily_interest_percent numeric,max_interest_cap_percent numeric,daily_penalty_type text,daily_penalty_value numeric);
    CREATE TABLE contract_installments(id uuid PRIMARY KEY,user_id uuid,client_id uuid,contract_id uuid,installment_number int,amount numeric,due_date date,paid_at timestamptz,paid_amount numeric,late_fee numeric,status text,payment_method text,receipt_url text,pre_settlement_snapshot jsonb);
    CREATE TABLE portal_sessions(token uuid,client_id uuid,expires_at timestamptz);
    CREATE TABLE collector_tokens(id uuid,collector_id uuid,user_id uuid,token text,is_active boolean);
    CREATE TABLE collectors(id uuid PRIMARY KEY,name text,phone text,email text,city text,state text,created_at timestamptz,is_active boolean);
    CREATE TABLE collector_assignments(collector_id uuid,user_id uuid,client_id uuid);
    CREATE TABLE profiles(id uuid,name text,pix_key text,pix_key_type text,billing_message text);
    CREATE TABLE settings(user_id uuid,portal_title text,portal_subtitle text,portal_welcome_message text,portal_primary_color text,portal_contact_phone text,portal_contact_email text,portal_logo_url text,company_name text,company_logo_url text);
    INSERT INTO clients(id,user_id,name,status) VALUES('${client}','${owner}','Fictício','active');
    INSERT INTO contracts(id,user_id,client_id,status,created_at,daily_interest_percent,max_interest_cap_percent,daily_penalty_type,daily_penalty_value) VALUES('${contract}','${owner}','${client}','active',now(),1,50,'fixed',3);
    INSERT INTO contract_installments(id,user_id,client_id,contract_id,amount,paid_amount,status,pre_settlement_snapshot) VALUES('${owner}','${owner}','${client}','${contract}',100,40,'pending','{"private_audit":true}');
    INSERT INTO portal_sessions VALUES('${token}','${client}',now()+interval '1 day');
    INSERT INTO collectors(id,name,is_active) VALUES('${collector}','Fictício',true);
    INSERT INTO collector_tokens VALUES('${owner}','${collector}','${owner}','fictional-collector',true);
    INSERT INTO collector_assignments VALUES('${collector}','${owner}','${client}');
  `);
  await db.exec(readFileSync('supabase/migrations/20261007193000_portal_financial_payload.sql','utf8'));
}, 30_000);
afterAll(async () => { await db?.close(); });
async function payload(name: string, value: string) { const result = await db.query<{ data: any }>(`SELECT ${name}($1) AS data`, [value]); return result.rows[0].data; }
it('cliente e cobrador recebem multa fixa e indicação de snapshot, sem seu conteúdo privado', async () => {
  const customer = await payload('portal_login_by_token',token);
  const agent = await payload('collector_login_by_token','fictional-collector');
  const rows = [customer.contracts[0].installments[0],agent.clients[0].installments[0]];
  for (const row of rows) { expect(row).toMatchObject({daily_penalty_type:'fixed',daily_penalty_value:3,daily_interest_percent:1,max_interest_cap_percent:50,has_active_settlement:true,paid_amount:40}); expect(row).not.toHaveProperty('pre_settlement_snapshot'); }
  expect(customer.contracts[0]).toMatchObject({daily_penalty_type:'fixed',daily_penalty_value:3});
  expect(agent.clients[0].installments[0].contract_status).toBe('active');
});
it('token de cliente expirado ou desconhecido continua sem acesso', async () => {
  expect(await payload('portal_login_by_token',other)).toBeNull();
  await db.exec(`BEGIN; UPDATE portal_sessions SET expires_at=now()-interval '1 day';`);
  try { expect(await payload('portal_login_by_token',token)).toBeNull(); } finally { await db.exec('ROLLBACK'); }
});
it('desativar o cliente encerra o acesso por token existente', async () => {
  await db.exec("BEGIN; UPDATE clients SET status='inactive';");
  try { expect(await payload('portal_login_by_token',token)).toBeNull(); } finally { await db.exec('ROLLBACK'); }
});
it('cobrador ou token desativado continua sem acesso', async () => {
  for (const sql of ["UPDATE collectors SET is_active=false", "UPDATE collector_tokens SET is_active=false"]) {
    await db.exec('BEGIN;'+sql);
    try { expect(await payload('collector_login_by_token','fictional-collector')).toBeNull(); } finally { await db.exec('ROLLBACK'); }
  }
});
it('registros inconsistentes de outro dono não entram no payload público', async () => {
  await db.exec(`BEGIN; INSERT INTO contracts(id,user_id,client_id,created_at) VALUES('${other}','${other}','${client}',now()); INSERT INTO contract_installments(id,user_id,client_id,contract_id,status) VALUES('${other}','${other}','${client}','${contract}','pending'),('${token}','${owner}','${client}','${other}','pending');`);
  try {
    const customer = await payload('portal_login_by_token',token), agent = await payload('collector_login_by_token','fictional-collector');
    expect(customer.contracts).toHaveLength(1); expect(customer.contracts[0].installments).toHaveLength(1); expect(agent.clients[0].installments).toHaveLength(1);
    await db.exec(`UPDATE clients SET user_id='${other}'`);
    expect((await payload('collector_login_by_token','fictional-collector')).clients).toHaveLength(0);
  } finally { await db.exec('ROLLBACK'); }
});
