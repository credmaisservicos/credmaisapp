import {assert,assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {deliverBotJob} from '../_shared/bot_delivery.ts';
import {financialDay} from '../_shared/financial_calendar.ts';
const backend='https://birthday-backend.test.invalid',provider='https://birthday-provider.test.invalid';
const owner='00000000-0000-4000-8000-000000000001';
let calls:{url:URL;body:any}[]=[],context:any,job:any,convo:any,config:any,status=200,contextFailure=false;
const json=(data:unknown,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url),raw=await req.clone().text(),body=raw?JSON.parse(raw):{};calls.push({url,body});
 if(url.origin===provider)return json({key:{id:'birthday-provider-ack'}},status);
 if(url.origin!==backend)throw Error('Unmocked external request');
 if(url.pathname.endsWith('/birthday_message_context'))return contextFailure?json({message:'unavailable'},503):json(context);
 if(req.method==='PATCH'&&url.pathname.endsWith('/whatsapp_scheduled_messages')){Object.assign(job,body);return new Response(null,{status:204});}
 if(req.method!=='GET')return new Response(null,{status:201});
 if(url.pathname.endsWith('/whatsapp_conversations'))return json(convo);
 if(url.pathname.endsWith('/settings'))return json(config);
 if(url.pathname.endsWith('/profiles'))return json({is_admin:true,is_blocked:false,subscription_type:'lifetime',plan_tier:'completo'});
 throw Error('Unexpected database query');
};
const db=createClient(backend,'isolated-service-key');
function reset(){
 calls=[];status=200;contextFailure=false;Deno.env.delete('BOT_TEST_OWNER_ID');Deno.env.delete('BOT_TEST_RECIPIENT');
 config={bot_enabled:true,bot_auto_send:true,bot_send_birthday:true,whatsapp_api_url:provider,whatsapp_api_key:'isolated-provider-key',whatsapp_instance:'main'};
 convo={id:'convo-test',user_id:owner,client_id:'client-test',jid:'551187654321@s.whatsapp.net',instance:'main'};
 context={valid:true,user_id:owner,client_id:'client-test',phone:'5511987654321',text:'Feliz aniversário. Empresa da conta A'};
 job={id:'job-test',conversation_id:convo.id,user_id:owner,client_id:'client-test',purpose:'birthday',source_key:`birthday:client-test:${financialDay()}`,text:'Mensagem antiga',status:'processing',attempts:1};
}
const sends=()=>calls.filter(c=>c.url.origin===provider);
Deno.test('birthday worker uses current authorized client and tenant branding',async()=>{
 reset();assertEquals(await deliverBotJob(db,job),'sent');assertEquals(sends().length,1);assertEquals(sends()[0].body.text,context.text);assertEquals(sends()[0].body.number,'551187654321');
 assert(!calls.some(c=>c.url.pathname.includes('contract_installments')));
});
Deno.test('birthday manual mode waits for approval',async()=>{
 reset();config.bot_auto_send=false;assertEquals(await deliverBotJob(db,job),'approval_required');assertEquals(sends().length,0);
 job.approved_by=owner;assertEquals(await deliverBotJob(db,job),'sent');
});
for(const reason of ['birthdays_disabled','birthday_date_expired','birthday_client_changed']){
 Deno.test(`birthday ${reason} cancels even after approval`,async()=>{reset();job.approved_by=owner;context={valid:false,reason};assertEquals(await deliverBotJob(db,job),'cancelled');assertEquals(sends().length,0);});
}
for(const field of ['user_id','client_id','phone']){
 Deno.test(`birthday changed ${field} never reaches provider`,async()=>{reset();context[field]=field==='phone'?'5511888888888':'foreign';assertEquals(await deliverBotJob(db,job),'cancelled');assertEquals(sends().length,0);});
}
Deno.test('birthday context unavailable keeps the job retryable without sending',async()=>{reset();contextFailure=true;await deliverBotJob(db,job);assertEquals(job.status,'pending');assertEquals(sends().length,0);});
Deno.test('birthday provider timeout or server error retains uncertain outcome',async()=>{reset();status=503;assertEquals(await deliverBotJob(db,job),'uncertain');assertEquals(job.status,'uncertain');assertEquals(sends().length,1);assert(job.delivery_started_at);});
Deno.test('birthday test scope rejects another phone even with approval',async()=>{reset();job.approved_by=owner;Deno.env.set('BOT_TEST_OWNER_ID',owner);Deno.env.set('BOT_TEST_RECIPIENT','5511888888888');assertEquals(await deliverBotJob(db,job),'test_recipient_blocked');assertEquals(sends().length,0);Deno.env.delete('BOT_TEST_OWNER_ID');Deno.env.delete('BOT_TEST_RECIPIENT');});
