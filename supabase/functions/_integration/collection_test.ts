import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handlers } from './capture_serve.ts';
import { deliverBotJob } from '../_shared/bot_delivery.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { saoPauloDay } from '../_shared/bot_collection.ts';
const backend='https://collection.test.invalid',provider='https://provider.test.invalid',owner='00000000-0000-4000-8000-000000000001',client='client-test';
for(const [key,value] of Object.entries({SUPABASE_URL:backend,SUPABASE_SERVICE_ROLE_KEY:'test-service',CRON_SECRET:'test-cron'}))Deno.env.set(key,value);
for(const key of ['ANTHROPIC_API_KEY','LOVABLE_API_KEY','DEEPSEEK_API_KEY'])Deno.env.delete(key);
const calls:{url:URL;method:string;body:any}[]=[];
let jobs:any[]=[],promise=false,paused=false,policyFailure=false,cooldown=false,ledgerPayment=false;
let settings:any={};
const today=saoPauloDay();
const prior=new Date(`${today}T12:00:00Z`);prior.setUTCDate(prior.getUTCDate()-10);
const future=new Date(`${today}T12:00:00Z`);future.setUTCDate(future.getUTCDate()+3);
const rows=[{id:'late',client_id:client,contract_id:'contract',amount:100,paid_amount:40,late_fee:0,status:'overdue',due_date:prior.toISOString().slice(0,10),installment_number:1,contracts:{status:'active'}},
  {id:'future',client_id:client,contract_id:'contract',amount:100,paid_amount:0,late_fee:0,status:'pending',due_date:future.toISOString().slice(0,10),installment_number:2,contracts:{status:'active'}}];
const json=(data:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
globalThis.fetch=async(input,init)=>{
  const req=new Request(input,init),url=new URL(req.url),text=await req.clone().text(),body=text?JSON.parse(text):{};
  calls.push({url,method:req.method,body});
  if(url.origin===provider){if(req.method==='GET')return json({instance:{state:'open'}});return json({key:{id:'provider-id'}});}
  if(url.origin!==backend)throw Error('Unmocked network denied');
  const table=url.pathname.split('/').at(-1)!;
  if(url.pathname.includes('/rpc/'))return json(table==='expire_payment_promises'?0:true);
  if(req.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Range':'*/0'}});
  if(table==='whatsapp_scheduled_messages'){
    if(req.method==='POST'){const found=jobs.find(j=>j.source_key===body.source_key);if(!found)jobs.push({id:'job-test',attempts:1,created_at:new Date().toISOString(),...body});return new Response(null,{status:201});}
    if(req.method==='PATCH'){for(const job of jobs)if(!url.searchParams.get('id') || url.searchParams.get('id')===`eq.${job.id}`)Object.assign(job,body);return new Response(null,{status:204});}
    let found=jobs;
    for(const key of ['source_key','status']){const filter=url.searchParams.get(key);if(filter?.startsWith('eq.'))found=found.filter(j=>j[key]===filter.slice(3));}
    return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?found[0] || null:found);
  }
  if(req.method!=='GET')return new Response(null,{status:201});
  let data:any[]=[];
  if(table==='settings')data=[settings];
  else if(table==='profiles')data=[{id:owner,plan_tier:'completo',subscription_type:'lifetime',name:'Empresa teste'}];
  else if(table==='clients')data=[{id:client,name:'Cliente fictício',whatsapp:'11999999999',credit_score:100}];
  else if(table==='contract_installments')data=rows;
  else if(table==='payment_promises'){
    if(policyFailure)return json({message:'Database unavailable'},503);
    data=promise?[{id:'promise',client_id:client,status:'open',promised_for:today}]:[];
  }
  else if(table==='transactions')data=ledgerPayment?[{id:'partial-payment'}]:[];
  else if(table==='audit_logs')data=cooldown?[{id:'audit',created_at:new Date().toISOString(),details:{message_preview:'old'}}]:[];
  else if(table==='whatsapp_conversations'){
    if(url.searchParams.has('or'))data=paused?[{id:'conversation',jid:'5511999999999@s.whatsapp.net'}]:[];
    else if(url.searchParams.has('id') || url.searchParams.has('phone'))data=[{id:'conversation',client_id:client,instance:'main',jid:'5511999999999@s.whatsapp.net'}];
  }
  return json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?data[0] || null:data);
};
await import('../auto-collection/index.ts');const collection=handlers.at(-1)!;
const db=createClient(backend,'test-service');
function reset(){
  calls.length=0;jobs=[];promise=paused=policyFailure=cooldown=ledgerPayment=false;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const part=(key:string)=>Number(parts.find(p=>p.type===key)?.value);
  settings={user_id:owner,bot_enabled:true,bot_auto_send:true,bot_use_ai:false,bot_work_days:['mon','tue','wed','thu','fri','sat','sun'],bot_send_hour:part('hour'),bot_send_minute:part('minute'),bot_escalation_rules:[{days:1,template:'',channel:'whatsapp'},{days:-3,template:'',channel:'whatsapp'}],bot_stop_on_payment:true,whatsapp_api_url:provider,whatsapp_api_key:'test-key',whatsapp_instance:'main'};
}
const invoke=()=>collection(new Request('https://function.test.invalid/',{method:'POST',headers:{'x-cron-secret':'test-cron'}}));
Deno.test('collection HTTP: partial debt excludes future installments and only queues',async()=>{
  reset();const res=await invoke();assertEquals(res.status,200);assertEquals(jobs.length,1);assertEquals(jobs[0].expected_amount,60);assertEquals(jobs[0].installment_ids,['late']);assert(jobs[0].text.includes('Total a pagar: R$ 60.00'));assert(!calls.some(c=>c.url.origin===provider&&c.method==='POST'));
});
Deno.test('collection HTTP: overlapping runs do not queue a second charge',async()=>{
  reset();await Promise.all([invoke(),invoke()]);assertEquals(jobs.length,1);
});
Deno.test('collection HTTP: manual mode queues for approval',async()=>{
  reset();settings.bot_auto_send=false;await invoke();assertEquals(jobs[0].status,'awaiting_approval');
});
Deno.test('collection HTTP: old uncertain delivery prevents a new automatic charge',async()=>{
  reset();jobs.push({id:'uncertain-old',source_key:'prior-day',user_id:owner,client_id:client,purpose:'collection',status:'uncertain',created_at:'2020-01-01T00:00:00Z'});
  await invoke();assertEquals(jobs.length,1);assertEquals(jobs[0].status,'uncertain');
});
Deno.test('collection HTTP: promise due today suspends generic charges',async()=>{
  reset();promise=true;assertEquals((await invoke()).status,200);assertEquals(jobs.length,0);
});
Deno.test('collection HTTP: human takeover prevents a charge',async()=>{
  reset();paused=true;await invoke();assertEquals(jobs.length,0);
});
Deno.test('collection HTTP: read failure never means no agreement',async()=>{
  reset();policyFailure=true;assertEquals((await invoke()).status,500);assertEquals(jobs.length,0);
});
Deno.test('queued charge: new agreement cancels before provider send',async()=>{
  reset();await invoke();promise=true;assertEquals(await deliverBotJob(db,jobs[0]),'cancelled');assertEquals(jobs[0].error,'payment_promise_active');assert(!calls.some(c=>c.url.origin===provider&&c.method==='POST'));
  const read=calls.find(c=>c.url.pathname.endsWith('/payment_promises')&&c.url.searchParams.has('client_id'))!;assertEquals(read.url.searchParams.get('user_id'),`eq.${owner}`);assertEquals(read.url.searchParams.get('client_id'),`eq.${client}`);
});
Deno.test('queued charge: human takeover in another client conversation cancels',async()=>{
  reset();await invoke();paused=true;assertEquals(await deliverBotJob(db,jobs[0]),'cancelled');assert(!calls.some(c=>c.url.origin===provider&&c.method==='POST'));
});
Deno.test('queued charge: agreement lookup failure leaves job retryable without sending',async()=>{
  reset();await invoke();policyFailure=true;await deliverBotJob(db,jobs[0]);assertEquals(jobs[0].status,'pending');assert(!calls.some(c=>c.url.origin===provider&&c.method==='POST'));
});
Deno.test('queued charge: partial payment after scheduling cancels even on another installment',async()=>{
  reset();await invoke();ledgerPayment=true;assertEquals(await deliverBotJob(db,jobs[0]),'cancelled');assertEquals(jobs[0].error,'payment_received');assert(!calls.some(c=>c.url.origin===provider&&c.method==='POST'));
});
