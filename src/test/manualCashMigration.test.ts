// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',request='33333333-3333-4333-8333-333333333333';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();for(const fixture of ['financialDatabase','paymentReceiptDatabase','walletCashDatabase'])await db.exec(readFileSync(`src/test/fixtures/${fixture}.sql`,'utf8'));
 await db.exec(`CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users VALUES('${owner}'),('${other}');`);
 await db.exec("ALTER TABLE expenses ADD fee_amount numeric DEFAULT 2,ADD receipt_url text,ADD created_at timestamptz DEFAULT now();");
 await db.exec(readFileSync('supabase/migrations/20261008010000_manual_cash_operations.sql','utf8'));
 await db.exec('GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;');
},30_000);
beforeEach(async()=>{await db.exec(`RESET ROLE;SET TimeZone='UTC';SET test.owner='${owner}';TRUNCATE manual_cash_operations,expenses,transactions;`);});
afterAll(async()=>{await db?.close();});
const scalar=async(q:string,args:unknown[]=[])=>Object.values((await db.query(q,args)).rows[0])[0] as any;
const op=(operation='capital_injection',overrides:Record<string,unknown>={})=>{
 const input={request,owner,operation,amount:50.25,description:'Caixa fictício',date:'2026-10-07T12:00:00Z',category:null,entry:null,expected:null,...overrides};
 return scalar('SELECT apply_manual_cash_operation($1::uuid,$2::uuid,$3,$4::numeric,$5,$6::timestamptz,$7,$8::uuid,$9::jsonb)',Object.values(input));
};
const cancel=(id=request,uid=owner)=>scalar('SELECT cancel_manual_cash_operation($1::uuid,$2::uuid)',[id,uid]);
const count=(table:string)=>scalar('SELECT count(*)::int FROM '+table);
const snapshot=(id:string)=>scalar('SELECT to_jsonb(e) FROM expenses e WHERE id=$1::uuid',[id]);
for(const kind of ['capital_injection','capital_withdrawal','expense_create'])it(`grava ${kind} uma vez e reconhece uma resposta perdida`,async()=>{
 const first=await op(kind),second=await op(kind);
 expect(first).toMatchObject({ok:true,replayed:false,current_state:'applied'});expect(second).toEqual({...first,replayed:true});
 expect(await count(kind==='expense_create'?'expenses':'transactions')).toBe(1);expect(await count('manual_cash_operations')).toBe(1);
});
it('tentativas novas com dados iguais continuam sendo operações distintas',async()=>{
 await op();await op('capital_injection',{request:'44444444-4444-4444-8444-444444444444'});expect(await count('transactions')).toBe(2);
});
it('reusar identidade com outro valor ou operação não altera caixa',async()=>{
 await op();await expect(op('capital_injection',{amount:51})).rejects.toThrow('manual_cash_request_conflict');
 await expect(op('capital_withdrawal')).rejects.toThrow('manual_cash_request_conflict');expect(await count('transactions')).toBe(1);
});
it('normaliza espaços e a representação do instante antes de comparar uma tentativa',async()=>{
 await op('expense_create',{description:' Caixa fictício ',category:' Operacional '});
 expect(await op('expense_create',{date:'2026-10-07T09:00:00-03:00',category:'Operacional'})).toMatchObject({replayed:true});
});
it('encerrar um envio não recebido impede a chegada tardia de criar caixa',async()=>{
 expect(await cancel()).toEqual({ok:true,cancelled:true});expect(await cancel()).toEqual({ok:true,cancelled:true});
 await expect(op()).rejects.toThrow('manual_cash_cancelled');expect(await count('transactions')).toBe(0);
});
it('encerrar após gravação confirma a operação e não estorna dinheiro',async()=>{
 const first=await op();expect(await cancel()).toEqual({...first,replayed:true,cancelled:false});expect(await count('transactions')).toBe(1);
});
it('repetir criação após exclusão não ressuscita o gasto',async()=>{
 const first=await op('expense_create');await db.query('DELETE FROM expenses WHERE id=$1',[first.entry_id]);
 expect(await op('expense_create')).toMatchObject({entry_id:first.entry_id,replayed:true,current_state:'deleted'});expect(await count('expenses')).toBe(0);
});
it('repetir criação após alteração informa mudança sem sobrescrever o gasto',async()=>{
 const first=await op('expense_create');await db.query('UPDATE expenses SET amount=70 WHERE id=$1',[first.entry_id]);
 expect(await op('expense_create')).toMatchObject({replayed:true,current_state:'changed'});expect((await snapshot(first.entry_id)).amount).toBe(70);
});
it('alteração de gasto é auditada, repetível e preserva colunas fora do formulário',async()=>{
 const first=await op('expense_create'),before=await snapshot(first.entry_id);
 const args={request:'44444444-4444-4444-8444-444444444444',entry:first.entry_id,expected:before,amount:80};
 expect(await op('expense_update',args)).toMatchObject({current_state:'applied',replayed:false});
 expect(await op('expense_update',args)).toMatchObject({replayed:true});
 const journal=await scalar('SELECT to_jsonb(m) FROM manual_cash_operations m WHERE request_id=$1',[args.request]);
 expect(journal.before_row).toEqual(before);expect(journal.after_row.amount).toBe(80);expect(await count('expenses')).toBe(1);
 expect(journal.after_row.fee_amount).toBe(before.fee_amount);expect(journal.after_row.created_at).toBe(before.created_at);expect(journal.after_row.receipt_url).toBe(before.receipt_url);
});
it('uma edição antiga não desfaz a alteração feita depois',async()=>{
 const first=await op('expense_create'),before=await snapshot(first.entry_id);
 const args={request:'44444444-4444-4444-8444-444444444444',entry:first.entry_id,expected:before,amount:80};
 await op('expense_update',args);await db.query('UPDATE expenses SET description=$2 WHERE id=$1',[first.entry_id,'Mudança posterior']);
 expect(await op('expense_update',args)).toMatchObject({current_state:'changed'});expect((await snapshot(first.entry_id)).description).toBe('Mudança posterior');
});
it('recusa edição e exclusão de um gasto que mudou desde a abertura',async()=>{
 const first=await op('expense_create'),before=await snapshot(first.entry_id);await db.query('UPDATE expenses SET amount=99 WHERE id=$1',[first.entry_id]);
 for(const kind of ['expense_update','expense_delete'])await expect(op(kind,{request:'44444444-4444-4444-8444-444444444444',entry:first.entry_id,expected:before,
  ...(kind==='expense_delete'?{amount:null,description:null,date:null}:{})})).rejects.toThrow('manual_cash_changed');
 expect(await count('manual_cash_operations')).toBe(1);expect((await snapshot(first.entry_id)).amount).toBe(99);
});
it('exclusão do gasto confirma somente a operação aplicada e é repetível',async()=>{
 const first=await op('expense_create'),before=await snapshot(first.entry_id);
 const args={request:'44444444-4444-4444-8444-444444444444',entry:first.entry_id,expected:before,amount:null,description:null,date:null};
 expect(await op('expense_delete',args)).toMatchObject({current_state:'deleted',replayed:false});
 expect(await op('expense_delete',args)).toMatchObject({current_state:'deleted',replayed:true});expect(await count('expenses')).toBe(0);
});
it('remove somente capital manual do próprio titular, sem apagar pagamento',async()=>{
 const first=await op();const args={request:'44444444-4444-4444-8444-444444444444',entry:first.entry_id,amount:null,description:null,date:null};
 expect(await op('capital_delete',args)).toMatchObject({current_state:'deleted'});expect(await op('capital_delete',args)).toMatchObject({replayed:true});
 await db.query("INSERT INTO transactions(id,user_id,type,amount) VALUES($1,$2,'payment',40)",[first.entry_id,owner]);
 expect(await op('capital_delete',args)).toMatchObject({current_state:'changed'});expect(await count('transactions')).toBe(1);
 await expect(op('capital_delete',{...args,request:'55555555-5555-4555-8555-555555555555'})).rejects.toThrow('manual_cash_not_found');
});
it('uma exclusão de item inexistente não confirma sucesso nem cria auditoria',async()=>{
 await expect(op('capital_delete',{entry:owner,amount:null,description:null,date:null})).rejects.toThrow('manual_cash_not_found');expect(await count('manual_cash_operations')).toBe(0);
});
it('uma falha na auditoria reverte o lançamento na mesma transação',async()=>{
 await db.exec("CREATE FUNCTION reject_manual_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit_failure';END$$;CREATE TRIGGER fail_audit BEFORE INSERT ON manual_cash_operations FOR EACH ROW EXECUTE FUNCTION reject_manual_audit();");
 try{await expect(op()).rejects.toThrow('audit_failure');expect(await count('transactions')).toBe(0);}finally{await db.exec('DROP TRIGGER fail_audit ON manual_cash_operations;DROP FUNCTION reject_manual_audit();');}
});
it('anon, serviço e acesso direto à auditoria não têm permissão',async()=>{
 for(const role of ['anon','service_role'])expect(await scalar("SELECT has_function_privilege($1,'apply_manual_cash_operation(uuid,uuid,text,numeric,text,timestamptz,text,uuid,jsonb)','execute')",[role])).toBe(false);
 for(const action of ['SELECT','INSERT','UPDATE','DELETE'])expect(await scalar("SELECT has_table_privilege('authenticated','manual_cash_operations',$1)",[action])).toBe(false);
 await db.exec('SET ROLE authenticated');expect(await op()).toMatchObject({ok:true});await expect(db.query('SELECT * FROM manual_cash_operations')).rejects.toThrow('permission denied');
});
it('a troca de conta durante o envio não grava para o novo titular',async()=>{
 await db.exec(`SET test.owner='${other}'`);await expect(op()).rejects.toThrow('auth_required');await expect(cancel()).rejects.toThrow('auth_required');expect(await count('transactions')).toBe(0);
});
it('dois donos podem usar a mesma identidade sem alcançar os dados alheios',async()=>{
 const first=await op('expense_create');await db.exec(`SET test.owner='${other}'`);
 expect(await cancel(request,other)).toEqual({ok:true,cancelled:true});
 await expect(op('expense_delete',{owner:other,entry:first.entry_id,expected:{...(await snapshot(first.entry_id)),user_id:other},amount:null,description:null,date:null})).rejects.toThrow('manual_cash_cancelled');
 expect(await count('expenses')).toBe(1);
});
it('alvo de outro titular não pode ser excluído ou editado por uma operação nova',async()=>{
 const first=await op('expense_create'),before=await snapshot(first.entry_id);await db.exec(`SET test.owner='${other}'`);
 await expect(op('expense_update',{owner:other,request:'44444444-4444-4444-8444-444444444444',entry:first.entry_id,expected:{...before,user_id:other}})).rejects.toThrow('manual_cash_not_found');
 expect((await snapshot(first.entry_id)).amount).toBe(50.25);expect(await count('manual_cash_operations')).toBe(1);
});
for(const amount of [0,-1,'NaN','Infinity','-Infinity','0.001','1.005','90071992547409.92'])it(`recusa dinheiro inválido ${amount} sem efeito financeiro`,async()=>{
 await expect(op('expense_create',{amount})).rejects.toThrow('invalid_manual_cash_values');expect(await count('expenses')).toBe(0);expect(await count('manual_cash_operations')).toBe(0);
});
for(const invalid of [{description:'   '},{description:'x'.repeat(501)},{category:'x'.repeat(101)},{date:'infinity'},{date:'10000-01-01Z'},{request:null}])it(`recusa entrada inválida ${Object.keys(invalid)[0]}`,async()=>{
 await expect(op('expense_create',invalid)).rejects.toThrow();expect(await count('expenses')).toBe(0);
});
