import {assertEquals,assert} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {handlers} from './capture_serve.ts';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const backend='https://recipient-backend.test.invalid',allowed='5533984123591',secret='isolated-cron-secret';
let calls:Array<{url:URL;body:any}>=[],recipient=allowed,caller=owner,providerStatus=200;
for(const [key,value] of Object.entries({SUPABASE_URL:backend,SUPABASE_SERVICE_ROLE_KEY:'isolated-service-key',SUPABASE_ANON_KEY:'isolated-anon-key',CRON_SECRET:secret,BOT_TEST_OWNER_ID:owner,BOT_TEST_RECIPIENT:allowed}))Deno.env.set(key,value);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url),text=await request.clone().text(),body=text?JSON.parse(text):{};calls.push({url,body});
 if(url.origin===backend){
  if(url.pathname==='/auth/v1/user')return json({id:caller});
  if(url.pathname==='/rest/v1/profiles')return json({is_admin:true,is_blocked:false,subscription_type:'lifetime',plan_tier:'completo'});
  if(url.pathname==='/rest/v1/rpc/try_consume_rate_limit')return json({allowed:true,remaining:100,retry_after_ms:0});
  if(url.pathname==='/rest/v1/settings')return json({whatsapp_api_url:'https://recipient-provider.test.invalid',whatsapp_api_key:'isolated-provider-key',whatsapp_instance:'isolated-instance'});
  if(url.pathname==='/rest/v1/whatsapp_instances')return json(null);
  if(url.pathname==='/rest/v1/clients')return json([{id:'fictional-client',user_id:caller,name:'Fictício',phone:recipient,birth_date:new Date().toISOString().slice(0,10)}]);
  if(url.pathname==='/rest/v1/rpc/enqueue_birthday_greeting')return providerStatus===503?json({message:'queue unavailable'},503):json(body._allow_message?{queued:true,duplicate:false}:{queued:false,reason:'test_recipient_blocked'});
  if(url.pathname==='/rest/v1/notifications')return json(null,201);
 }
 if(url.origin==='https://recipient-provider.test.invalid')return json({key:{id:'fictional-message'}},providerStatus);
 throw Error(`Unexpected synthetic HTTP: ${url.origin}${url.pathname}`);
};
await import('../auto-birthday/index.ts');const birthday=handlers.at(-1)!;
await import('../evolution-api/index.ts');const evolution=handlers.at(-1)!;
const providers=()=>calls.filter(c=>c.url.origin==='https://recipient-provider.test.invalid');
const reset=()=>{calls=[];recipient=allowed;caller=owner;providerStatus=200;};
const birth=()=>birthday(new Request('https://function.test.invalid',{method:'POST',headers:{'x-cron-secret':secret}}));
const send=()=>evolution(new Request('https://function.test.invalid',{method:'POST',headers:{Authorization:'Bearer isolated-token','Content-Type':'application/json'},body:JSON.stringify({action:'send_message',instanceName:'isolated-instance',data:{phone:recipient,message:'Mensagem fictícia'}})}));
for(const invalid of ['5511999999999','5533984123591@g.us','']){
 Deno.test(`test sender restriction rejects direct Evolution recipient ${invalid||'empty'}`,async()=>{reset();recipient=invalid;assertEquals((await send()).status,403);assertEquals(providers().length,0);});
}
Deno.test('direct Evolution permits only the selected test number',async()=>{reset();assertEquals((await send()).status,200);assertEquals(providers().length,1);assertEquals(providers()[0].body.number,allowed);});
Deno.test('ordinary account remains unaffected by the selected test account restriction',async()=>{reset();caller=other;recipient='5511999999999';assertEquals((await send()).status,200);assertEquals(providers().length,1);});
Deno.test('birthday job skips the test account recipient outside its scope',async()=>{reset();recipient='5511999999999';const result=await birth();assertEquals(result.status,200);assertEquals((await result.json()).sent,0);assertEquals(providers().length,0);});
Deno.test('birthday cron queues the authorized number without contacting provider',async()=>{reset();const result=await birth();const body=await result.json();assertEquals(body.queued,1);assertEquals(body.sent,0);assertEquals(providers().length,0);assertEquals(calls.find(c=>c.url.pathname.endsWith('/enqueue_birthday_greeting'))?.body._allow_message,true);});
Deno.test('birthday cron does not acknowledge a failed durable queue',async()=>{reset();providerStatus=503;const result=await birth();assertEquals(result.status,503);assertEquals(providers().length,0);});
Deno.test('unsigned birthday cron cannot reach any recipient',async()=>{reset();assertEquals((await birthday(new Request('https://function.test.invalid',{method:'POST'}))).status,401);assertEquals(calls.length,0);assert(providers().length===0);});
