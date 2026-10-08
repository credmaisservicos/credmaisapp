// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
let db:PGlite;
const day="(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const scalar=async(sql:string,args:unknown[]=[])=>Object.values((await db.query(sql,args)).rows[0])[0] as any;
const queue=(client=owner,user=owner,allow=true)=>scalar(`SELECT enqueue_birthday_greeting($1::uuid,$2::uuid,${day},$3::boolean)`,[client,user,allow]);
const count=(table:string)=>scalar(`SELECT count(*)::integer FROM ${table}`);
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync('src/test/fixtures/financialDatabase.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/paymentReceiptDatabase.sql','utf8'));
 await db.exec("ALTER TABLE clients ADD birth_date date,ADD status text DEFAULT 'Ativo';CREATE VIEW settings_safe AS SELECT user_id,company_name FROM settings;");
 const reliability=readFileSync('supabase/migrations/20261007093000_bot_delivery_reliability.sql','utf8');
 await db.exec(reliability.slice(reliability.indexOf('CREATE OR REPLACE FUNCTION public.bot_phone_key'),reliability.indexOf('CREATE INDEX IF NOT EXISTS clients_bot_phone_idx')));
 await db.exec(readFileSync('supabase/migrations/20261008040000_birthday_outbox.sql','utf8'));
},30_000);
beforeEach(async()=>{await db.exec(`RESET ROLE;SET test.owner='${owner}';TRUNCATE birthday_occurrences,notifications,whatsapp_scheduled_messages,whatsapp_conversations,clients,settings;
 INSERT INTO clients(id,user_id,name,phone,birth_date) VALUES('${owner}','${owner}','Cliente fictício','11987654321',${day});
 INSERT INTO settings(user_id,company_name,bot_auto_send) VALUES('${owner}','Empresa A',false);`);});
afterAll(async()=>{await db?.close();});
it('não habilita aniversários nem envia mensagens em contas existentes',async()=>{
 expect((await queue()).reason).toBe('birthdays_disabled');await queue();
 expect(await count('notifications')).toBe(1);expect(await count('whatsapp_scheduled_messages')).toBe(0);
});
it('modo manual gera um único aviso e uma única mensagem aguardando aprovação',async()=>{
 await db.exec('UPDATE settings SET bot_send_birthday=true');const a=await queue(),b=await queue();
 expect(a.status).toBe('awaiting_approval');expect(b.duplicate).toBe(true);expect(b.job_id).toBe(a.job_id);
 expect(await count('notifications')).toBe(1);expect(await count('whatsapp_scheduled_messages')).toBe(1);
});
it('habilitar no mesmo dia não duplica aviso e permite gerar a mensagem',async()=>{
 await queue();await db.exec('UPDATE settings SET bot_send_birthday=true,bot_auto_send=true');
 expect((await queue()).status).toBe('pending');expect(await count('notifications')).toBe(1);
});
it('resultado incerto nunca vira novo envio pela repetição do cron',async()=>{
 await db.exec('UPDATE settings SET bot_send_birthday=true');await queue();
 await db.exec("UPDATE whatsapp_scheduled_messages SET status='uncertain',delivery_started_at=now()");
 expect((await queue()).status).toBe('uncertain');expect(await count('whatsapp_scheduled_messages')).toBe(1);
});
it('titular diferente não recebe aviso nem dados do cliente',async()=>{
 expect((await queue(owner,other)).queued).toBe(false);expect(await count('notifications')).toBe(0);
});
it('restrição de testes impede criar mensagem mesmo com automação ativada',async()=>{
 await db.exec('UPDATE settings SET bot_send_birthday=true,bot_auto_send=true');
 expect((await queue(owner,owner,false)).reason).toBe('test_recipient_blocked');expect(await count('whatsapp_scheduled_messages')).toBe(0);
});
it('telefone compartilhado por clientes da mesma conta bloqueia a mensagem',async()=>{
 await db.exec(`UPDATE settings SET bot_send_birthday=true;INSERT INTO clients(id,user_id,name,phone) VALUES('${other}','${owner}','Ambíguo','11987654321')`);
 expect((await queue()).reason).toBe('birthday_phone_ambiguous');expect(await count('whatsapp_scheduled_messages')).toBe(0);
});
it('o mesmo telefone em outra conta preserva isolamento e marca da empresa',async()=>{
 await db.exec(`UPDATE settings SET bot_send_birthday=true;INSERT INTO clients(id,user_id,name,phone,birth_date) VALUES('${other}','${other}','Outra conta','11987654321',${day});INSERT INTO settings(user_id,company_name,bot_send_birthday) VALUES('${other}','Empresa B',true)`);
 await queue();await queue(other,other);const {rows}=await db.query<any>('SELECT user_id,text FROM whatsapp_scheduled_messages ORDER BY user_id');
 expect(rows).toHaveLength(2);expect(rows[0].text).toContain('Empresa A');expect(rows[1].text).toContain('Empresa B');
});
it('desativação e mudança da data invalidam o contexto antes da entrega',async()=>{
 await db.exec('UPDATE settings SET bot_send_birthday=true');await queue();await db.exec('UPDATE settings SET bot_send_birthday=false');
 expect((await scalar(`SELECT birthday_message_context('${owner}','${owner}',${day})`)).reason).toBe('birthdays_disabled');
 expect((await scalar(`SELECT birthday_message_context('${owner}','${owner}',${day}-1)`)).reason).toBe('birthday_date_expired');
});
it('cliente inativo não recebe automação nem pode ter contexto aprovado',async()=>{
 await db.exec("UPDATE settings SET bot_send_birthday=true;UPDATE clients SET status='Inativo'");
 expect((await queue()).reason).toBe('birthday_client_inactive');expect(await count('whatsapp_scheduled_messages')).toBe(0);
});
it('somente service_role executa RPC e view segura mantém projeção sem segredos',async()=>{
 await db.exec('SET ROLE authenticated');await expect(queue()).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
 const {rows}=await db.query('SELECT * FROM settings_safe');expect(rows[0]).toEqual({user_id:owner,company_name:'Empresa A',bot_send_birthday:false});
});
