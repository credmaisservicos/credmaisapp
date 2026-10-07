import {assert,assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {deliverBotJob} from '../_shared/bot_delivery.ts';
const backend='https://receipt-backend.test.invalid',provider='https://receipt-provider.test.invalid';
const owner='00000000-0000-4000-8000-000000000001',tx='00000000-0000-4000-8000-000000000003';
const calls:{url:URL;method:string;body:any}[]=[];
let config:any,convo:any,receipt:any,job:any,providerStatus:number,contextFailure:boolean,providerThrows:boolean;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url),raw=await req.clone().text(),body=raw?JSON.parse(raw):{};
 calls.push({url,method:req.method,body});
 if(url.origin===provider){if(providerThrows)throw new TypeError('Network lost after send');return json({key:{id:'provider-receipt-test'}},providerStatus);}
 if(url.origin!==backend)throw Error('Unmocked network request blocked');
 if(url.pathname==='/rest/v1/rpc/payment_receipt_context')return contextFailure?json({message:'unavailable'},503):json(receipt);
 if(req.method==='PATCH' && url.pathname==='/rest/v1/whatsapp_scheduled_messages'){Object.assign(job,body);return new Response(null,{status:204});}
 if(req.method!=='GET')return new Response(null,{status:201});
 const value=url.pathname==='/rest/v1/whatsapp_conversations'?convo:url.pathname==='/rest/v1/settings'?config:
   url.pathname==='/rest/v1/profiles'?{is_admin:true,plan_tier:'completo',subscription_type:'lifetime'}:null;
 if(!value)throw Error('Unexpected database query');return json(value);
};
const db=createClient(backend,'isolated-service-key');
function reset(){
 calls.length=0;providerStatus=200;contextFailure=providerThrows=false;
 Deno.env.delete('BOT_TEST_OWNER_ID');Deno.env.delete('BOT_TEST_RECIPIENT');
 config={bot_send_receipt:true,bot_enabled:true,bot_auto_send:true,whatsapp_api_url:provider,whatsapp_api_key:'isolated-key',whatsapp_instance:'main'};
 convo={id:'convo-test',user_id:owner,client_id:'client-test',jid:'551187654321@s.whatsapp.net',instance:'main',needs_human:true,bot_paused:true};
 receipt={valid:true,transaction_id:tx,user_id:owner,client_id:'client-test',installment_id:'inst-test',amount:30,phone:'5511987654321',text:'Confirmação de recebimento\nRegistramos R$ 30,00. Referência: '+tx};
 job={id:'job-test',conversation_id:convo.id,user_id:owner,client_id:'client-test',installment_id:'inst-test',payment_transaction_id:tx,
   source_key:'receipt:'+tx,purpose:'payment_receipt',text:'OLD WRONG TOTAL R$ 100,00',expected_amount:30,attempts:1,status:'processing'};
}
const sends=()=>calls.filter(c=>c.url.origin===provider);
const audits=()=>calls.filter(c=>c.url.pathname==='/rest/v1/audit_logs');
Deno.test('receipt worker: incremental cash and canonical text survive human handoff',async()=>{
 reset();assertEquals(await deliverBotJob(db,job),'sent');assertEquals(sends().length,1);
 assertEquals(sends()[0].body.text,receipt.text);assertEquals(sends()[0].body.number,'551187654321');
 assertEquals(audits()[0].body.details.amount,30);assertEquals(audits()[0].body.entity_id,tx);
 assertEquals(job.status,'sent');
 assert(!calls.some(c=>c.url.pathname.endsWith('/contract_installments')));
 assert(!calls.some(c=>c.url.pathname.endsWith('/whatsapp_conversations') && c.body.bot_paused===false));
});
for(const field of ['transaction_id','user_id','client_id','installment_id','phone','amount'] as const){
 Deno.test(`receipt worker: changed ${field} cancels even with human approval`,async()=>{
  reset();job.approved_by=owner;receipt[field]=field==='amount'?999:field==='phone'?'5511888888888':'foreign';
  assertEquals(await deliverBotJob(db,job),'cancelled');assertEquals(sends().length,0);assertEquals(audits().length,0);
 });
}
Deno.test('receipt worker: reversed or missing payment never confirms receipt',async()=>{
 reset();receipt={valid:false,reason:'payment_reversed'};assertEquals(await deliverBotJob(db,job),'cancelled');assertEquals(sends().length,0);
});
Deno.test('receipt worker: temporary cash lookup failure remains retryable',async()=>{
 reset();contextFailure=true;await deliverBotJob(db,job);assertEquals(job.status,'pending');assertEquals(sends().length,0);
});
Deno.test('receipt worker: disabling confirmations cancels an approved old job',async()=>{
 reset();config.bot_send_receipt=false;job.approved_by=owner;assertEquals(await deliverBotJob(db,job),'receipts_disabled');assertEquals(sends().length,0);
});
Deno.test('receipt worker: manual mode requires approval and approved confirmation remains canonical',async()=>{
 reset();config.bot_auto_send=false;assertEquals(await deliverBotJob(db,job),'approval_required');assertEquals(sends().length,0);
 job.approved_by=owner;assertEquals(await deliverBotJob(db,job),'sent');assertEquals(sends()[0].body.text,receipt.text);
});
Deno.test('receipt worker: HTTP 5xx is uncertain and never logged as receipt sent',async()=>{
 reset();providerStatus=503;assertEquals(await deliverBotJob(db,job),'uncertain');assertEquals(audits().length,0);assert(job.delivery_started_at);
});
Deno.test('receipt worker: network loss after dispatch preserves uncertain outcome',async()=>{
 reset();providerThrows=true;assertEquals(await deliverBotJob(db,job),'uncertain');assertEquals(audits().length,0);assertEquals(sends().length,1);
});
Deno.test('receipt worker: rejected provider request is failed, not receipt sent',async()=>{
 reset();providerStatus=400;assertEquals(await deliverBotJob(db,job),'failed');assertEquals(audits().length,0);
});
for(const jid of ['5511987654321@g.us','5511987654321@lid','5511987654321@broadcast']){
 Deno.test(`receipt worker: group or non-phone recipient ${jid} is blocked`,async()=>{
  reset();convo.jid=jid;assertEquals(await deliverBotJob(db,job),'cancelled');assertEquals(sends().length,0);
 });
}
Deno.test('receipt worker: test account allowlist also applies to manually approved receipts',async()=>{
 reset();job.approved_by=owner;Deno.env.set('BOT_TEST_OWNER_ID',owner);Deno.env.set('BOT_TEST_RECIPIENT','5511888888888');
 assertEquals(await deliverBotJob(db,job),'test_recipient_blocked');assertEquals(sends().length,0);
 Deno.env.delete('BOT_TEST_OWNER_ID');Deno.env.delete('BOT_TEST_RECIPIENT');
});
