import {assertEquals,assert} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {handlers} from './capture_serve.ts';
const backend='https://charges.test.invalid',secret='only-for-isolated-charge-tests';
Deno.env.set('SUPABASE_URL',backend);Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','isolated-service-key');Deno.env.set('CRON_SECRET',secret);
const cursor='00000000-0000-4000-8000-000000000001';
const batch=(overrides:Record<string,unknown>={})=>({scanned:0,fees_updated:0,status_updated:0,client_notifications:0,owner_notifications:0,next_cursor:null,errors:[],...overrides});
let replies:any[]=[],calls:{body:any;method:string;url:string}[]=[],unavailable=false;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url);
 if(url.origin!==backend||url.pathname!=='/rest/v1/rpc/refresh_installment_charges'||request.method!=='POST')throw Error('Unmocked network denied');
 assertEquals(request.headers.get('apikey'),'isolated-service-key');
 calls.push({body:await request.json(),method:request.method,url:url.pathname});
 if(unavailable)return new Response(JSON.stringify({message:'Unavailable'}),{status:503,headers:{'Content-Type':'application/json'}});
 return new Response(JSON.stringify(replies.shift()),{headers:{'Content-Type':'application/json'}});
};
await import('../auto-late-fees/index.ts');const handler=handlers.at(-1)!;
const reset=()=>{calls=[];replies=[batch()];unavailable=false;};
const invoke=(authorized=true,method='POST')=>handler(new Request('https://edge.test.invalid/auto-late-fees',{method,headers:authorized?{'x-cron-secret':secret}:{}}));
Deno.test('charges HTTP: unauthenticated requests never reach the database',async()=>{
 reset();assertEquals((await invoke(false)).status,401);assertEquals(calls.length,0);
});
Deno.test('charges HTTP: only a valid internal secret may execute GET or POST',async()=>{
 reset();Deno.env.delete('CRON_SECRET');try{assertEquals((await invoke()).status,401);}finally{Deno.env.set('CRON_SECRET',secret);}
 assertEquals(calls.length,0);assertEquals((await invoke(true,'DELETE')).status,405);
 assertEquals(calls.length,0);assertEquals((await invoke(true,'GET')).status,200);assertEquals(calls.length,1);
});
Deno.test('charges HTTP: empty batch reports actual zeros without REST writes or external sends',async()=>{
 reset();const response=await invoke();assertEquals(response.status,200);assertEquals(await response.json(),batchTotals());
 assertEquals(calls,[{body:{_after_id:null,_limit:250},method:'POST',url:'/rest/v1/rpc/refresh_installment_charges'}]);
});
Deno.test('charges HTTP: follows every batch cursor and sums actual counters',async()=>{
 reset();replies=[batch({scanned:250,fees_updated:200,status_updated:50,client_notifications:190,owner_notifications:2,next_cursor:cursor}),batch({scanned:17,fees_updated:3,client_notifications:0})];
 const response=await invoke();assertEquals(response.status,200);assertEquals(await response.json(),{scanned:267,fees_updated:203,status_updated:50,client_notifications:190,owner_notifications:2,errors:[]});
 assertEquals(calls.map(c=>c.body._after_id),[null,cursor]);
});
Deno.test('charges HTTP: partial failures remain visible and do not masquerade as success',async()=>{
 reset();replies=[batch({scanned:2,fees_updated:1,errors:[{installment_id:cursor,code:'22003'}]})];
 const response=await invoke();assertEquals(response.status,500);assertEquals((await response.json()).errors,[{installment_id:cursor,code:'22003'}]);
});
Deno.test('charges HTTP: database failure returns an error without fallback table updates',async()=>{
 reset();unavailable=true;const response=await invoke();assertEquals(response.status,500);assertEquals((await response.json()).error,'charge_refresh_failed');assertEquals(calls.length,1);
});
for(const invalid of [null,batch({scanned:-1}),batch({scanned:251}),batch({fees_updated:'1'}),batch({errors:null}),batch({next_cursor:'bad'}),batch({next_cursor:cursor,scanned:1}),batch({next_cursor:undefined})]){
 Deno.test(`charges HTTP: refuses invalid batch ${JSON.stringify(invalid)}`,async()=>{
  reset();replies=[invalid];const response=await invoke();assertEquals(response.status,500);assertEquals((await response.json()).error,'charge_refresh_failed');assertEquals(calls.length,1);
 });
}
Deno.test('charges HTTP: a repeated cursor cannot create an endless refresh loop',async()=>{
 reset();replies=[batch({scanned:250,next_cursor:cursor}),batch({scanned:250,next_cursor:cursor})];
 const response=await invoke();assertEquals(response.status,500);assertEquals(calls.length,2);assert((await response.json()).error);
});
function batchTotals(){return {scanned:0,fees_updated:0,status_updated:0,client_notifications:0,owner_notifications:0,errors:[]};}
