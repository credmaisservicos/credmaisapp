// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
let db:PGlite;
const migration=readFileSync('supabase/migrations/20261008030000_secure_rate_limit_rpc.sql','utf8');
const quota=async(key:string,capacity=1,refill=1/86400)=>{
 const result=await db.query<{value:{allowed:boolean;remaining:number;retry_after_ms:number}}>('SELECT public.try_consume_rate_limit($1,$2,$3)AS value',[key,capacity,refill]);return result.rows[0].value;
};
beforeAll(async()=>{
 db=new PGlite();await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;');
 await db.exec(migration);
},30000);
afterAll(async()=>{await db.close();});
describe('quota persistente exclusiva das funções de servidor',()=>{
 for(const role of ['anon','authenticated'])it(`${role} não pode consumir ou modificar quota`,async()=>{
  const rights=await db.query<{fn:boolean;table:boolean}>(`SELECT has_function_privilege('${role}','try_consume_rate_limit(text,double precision,double precision)','execute')AS fn,has_table_privilege('${role}','rate_limit_hits','SELECT,INSERT,UPDATE,DELETE')AS table`);
  expect(rights.rows[0]).toEqual({fn:false,table:false});
  await db.exec(`SET ROLE ${role}`);
  try{
   await expect(quota('unauthorized-'+role)).rejects.toThrow(/permission denied/);
   await expect(db.exec("INSERT INTO rate_limit_hits VALUES('forged',1,now())")).rejects.toThrow(/permission denied/);
  }finally{await db.exec('RESET ROLE');}
 });
 it('service role mantém a quota compartilhada e não permite repetição imediata',async()=>{
  await db.exec('SET ROLE service_role');
  try{
   expect(await quota('welcome-email:synthetic')).toEqual({allowed:true,remaining:0,retry_after_ms:0});
   const second=await quota('welcome-email:synthetic');expect(second.allowed).toBe(false);expect(second.retry_after_ms).toBeGreaterThan(86300000);
  }finally{await db.exec('RESET ROLE');}
 });
 it('outra chave conserva sua própria capacidade',async()=>{
  expect((await quota('other-key',2)).remaining).toBe(1);expect((await quota('other-key',2)).allowed).toBe(true);expect((await quota('other-key',2)).allowed).toBe(false);
 });
 it('o refill usa tempo comprovado e limita tokens à capacidade',async()=>{
  await quota('refilled',2,1);await db.exec("UPDATE rate_limit_hits SET updated_at=clock_timestamp()-interval '100 seconds'WHERE key='refilled'");
  expect(await quota('refilled',2,1)).toEqual({allowed:true,remaining:1,retry_after_ms:0});
 });
 for(const [label,key,capacity,refill]of[
  ['empty','',1,1],['long','x'.repeat(513),1,1],['negative-capacity','bad',-1,1],['zero-refill','bad',1,0],
  ['NaN-capacity','bad','NaN',1],['infinite-refill','bad',1,'Infinity'],['missing','bad',null,1],
 ]as const)it(`validação ${label} não altera quotas`,async()=>{
  const before=await db.query('SELECT *FROM rate_limit_hits ORDER BY key');
  await expect(db.query('SELECT try_consume_rate_limit($1,$2,$3)',[key,capacity,refill])).rejects.toThrow(/invalid_rate_limit/);
  expect((await db.query('SELECT *FROM rate_limit_hits ORDER BY key')).rows).toEqual(before.rows);
 });
 it('estado não finito existente falha fechado e não apaga a quota',async()=>{
  await db.exec("INSERT INTO rate_limit_hits VALUES('corrupt','NaN',now())");await expect(quota('corrupt')).rejects.toThrow(/invalid_rate_limit_state/);
  expect((await db.query<{tokens:string}>("SELECT tokens::text FROM rate_limit_hits WHERE key='corrupt'")).rows[0].tokens).toBe('NaN');
 });
 it('aplicar novamente não reinicia quotas nem reabre acesso público',async()=>{
  const before=await db.query('SELECT *FROM rate_limit_hits ORDER BY key');await db.exec(migration);
  expect((await db.query('SELECT *FROM rate_limit_hits ORDER BY key')).rows).toEqual(before.rows);
  expect((await db.query<{allowed:boolean}>("SELECT has_function_privilege('anon','try_consume_rate_limit(text,double precision,double precision)','execute')AS allowed")).rows[0].allowed).toBe(false);
 });
});
