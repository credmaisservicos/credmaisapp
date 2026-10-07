import { assertEquals,assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handlers } from './capture_serve.ts';
const owner='00000000-0000-4000-8000-000000000001',clientId='00000000-0000-4000-8000-000000000002';
const backend='https://bot-backend.test.invalid',provider='https://bot-provider.test.invalid',secret='isolated-test-secret';
for(const [k,v] of Object.entries({SUPABASE_URL:backend,SUPABASE_SERVICE_ROLE_KEY:'isolated-service',EVOLUTION_WEBHOOK_SECRET:secret,SITE_URL:'https://app.test.invalid'}))Deno.env.set(k,v);
Deno.env.delete('ANTHROPIC_API_KEY');Deno.env.delete('LOVABLE_API_KEY');
let calls:any[]=[],messages:any[]=[],reviews:any[]=[],jobs:any[]=[];
let settings:any,conversation:any,knownClient=true,failSettings=false,ownsLease=true,eventCompleted=false;
const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const rows=(v:any,req:Request)=>json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?v:(v?[v]:[]));
function reset(){
 calls=[];messages=[];reviews=[];jobs=[];knownClient=true;failSettings=false;ownsLease=true;eventCompleted=false;
 settings={user_id:owner,company_name:'Teste',bot_enabled:true,bot_auto_send:false,bot_auto_confirm_payment:true,bot_use_ai:false,bot_process_receipts:true,bot_process_audio:false,bot_work_days:['mon','tue','wed','thu','fri','sat','sun'],bot_business_start:'00:00',bot_business_end:'23:59',whatsapp_instance:'test',whatsapp_api_url:provider,whatsapp_api_key:'isolated-provider'};
 conversation={id:'conversation-test',user_id:owner,phone:'5511999999999',jid:'5511999999999@s.whatsapp.net',instance:'test',client_id:clientId,bot_paused:false,needs_human:false,blocked:false,unread_count:0};
}
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),u=new URL(req.url),raw=await req.clone().text();let body:any={};try{body=JSON.parse(raw||'{}');}catch{/* binary attachment */}
 calls.push({path:u.pathname,method:req.method,body,origin:u.origin});
 if(u.origin===provider){
   if(u.pathname.includes('getBase64FromMediaMessage'))return json({base64:btoa('isolated fictional receipt')});
   return json({key:{id:'provider-test'}});
 }
 if(u.origin!==backend)throw Error(`Unexpected external request: ${u.origin}`);
 if(u.pathname.startsWith('/storage/v1/object/uploads/'))return json({Key:'private-test'});
 const table=u.pathname.split('/').at(-1);
 if(u.pathname.includes('/rpc/')){
   if(table==='try_consume_rate_limit')return json({allowed:true,remaining:100});
   if(table==='system_find_clients_by_phone')return json(knownClient?[{id:clientId,user_id:owner,name:'Cliente fictício',phone:'11999999999',bot_memory:{service_menu_started:true}}]:[]);
   if(table==='begin_whatsapp_event')return json(!eventCompleted);
   if(table==='begin_whatsapp_response')return json(ownsLease);
   if(table==='system_pay_installment'||table==='system_renew_installment_interest')throw Error('Financial mutation forbidden in the webhook');
   if(table==='finish_whatsapp_event'){eventCompleted=body._success;return json(null);}
   return json(null);
 }
 if(table==='settings')return failSettings?json({message:'database unavailable'},503):rows(settings,req);
 if(table==='profiles')return rows({id:owner,is_admin:true,plan_tier:'completo',name:'Teste'},req);
 if(table==='whatsapp_instances')return json([]);
 if(table==='whatsapp_event_claims')return rows({status:eventCompleted?'completed':'failed'},req);
 if(table==='whatsapp_conversations'){
   if(req.method==='PATCH'){Object.assign(conversation,body);return new Response(null,{status:204});}
   return rows(conversation,req);
 }
 if(table==='clients')return rows({id:clientId,user_id:owner,name:'Cliente fictício',phone:'11999999999',bot_memory:{service_menu_started:true}},req);
 if(table==='whatsapp_messages'){
   if(req.method==='POST'){messages.push(body);return new Response(null,{status:201});}
   if(req.method==='PATCH'){const m=messages.find(m=>u.searchParams.get('wa_message_id')===`eq.${m.wa_message_id}`);if(m)Object.assign(m,body);return new Response(null,{status:204});}
   return json([]);
 }
 if(table==='whatsapp_scheduled_messages'){
   if(req.method==='POST'){if(!jobs.some(j=>j.source_key===body.source_key))jobs.push({id:`job-${jobs.length}`,attempts:0,...body});return new Response(null,{status:201});}
   if(req.method==='PATCH')return new Response(null,{status:204});
   return rows(jobs.find(j=>u.searchParams.get('source_key')===`eq.${j.source_key}`)||null,req);
 }
 if(table==='whatsapp_receipt_reviews'&&req.method==='POST'){reviews.push(body);return new Response(null,{status:201});}
 if(table==='contract_installments')return json([{id:'installment-test',user_id:owner,client_id:clientId,contract_id:'contract-test',amount:100,paid_amount:40,late_fee:0,status:'pending',due_date:'2099-01-01',installment_number:1,contracts:{status:'active',daily_interest_percent:4}}]);
 if(table==='contracts')return json([{id:'contract-test',status:'active',capital:90,total_amount:100,interest_rate:10,num_installments:1}]);
 if(req.method==='GET')return json([]);
 return new Response(null,{status:201});
};
await import('../whatsapp-webhook/index.ts');const webhook=handlers.at(-1)!;
async function invoke(message:any={conversation:'menu'},valid=true,id='event-test'){
 const response=await webhook(new Request('https://webhook.test.invalid/',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-secret':valid?secret:'wrong'},body:JSON.stringify({event:'MESSAGES_UPSERT',instance:'test',data:{key:{id,remoteJid:'5511999999999@s.whatsapp.net',fromMe:false},message}})}));
 return {response,body:await response.json()};
}
Deno.test('webhook denies invalid secret without processing incoming data',async()=>{reset();const {response}=await invoke(undefined,false);assertEquals(response.status,401);assertEquals(messages.length,0);assertEquals(jobs.length,0);});
Deno.test('disabled bot still preserves incoming messages in the inbox',async()=>{reset();settings.bot_enabled=false;const {response,body}=await invoke();assertEquals(response.status,200);assertEquals(body.status,'automation_unavailable');assertEquals(messages.length,1);assertEquals(jobs.length,0);});
Deno.test('human takeover is preserved even after a session timeout',async()=>{reset();conversation.needs_human=true;conversation.bot_paused=true;conversation.last_message_preview='Atendimento encerrado por falta de resposta. Quando precisar continuar, envie uma nova mensagem para abrir o menu novamente.';const {body}=await invoke();assertEquals(body.status,'paused');assert(conversation.bot_paused);assertEquals(jobs.length,0);});
Deno.test('manual approval mode queues a draft without sending to WhatsApp',async()=>{reset();const {response}=await invoke();assertEquals(response.status,200);assert(jobs.length>0);assert(jobs.every(j=>j.status==='awaiting_approval'));assertEquals(calls.filter(c=>c.path.includes('/message/send')).length,0);});
Deno.test('failed settings lookup is retryable and never reported as unknown instance',async()=>{reset();failSettings=true;const {response}=await invoke();assertEquals(response.status,500);assertEquals(messages.length,0);});
Deno.test('busy response lease keeps the received event retryable',async()=>{reset();ownsLease=false;const {response}=await invoke();assertEquals(response.status,503);assertEquals(eventCompleted,false);assertEquals(jobs.length,0);});
Deno.test('incoming receipt never mutates payments despite legacy auto-confirm setting',async()=>{reset();const {response}=await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante'}});assertEquals(response.status,200);assertEquals(reviews.length,1);assertEquals(reviews[0].status,'pending');assert(reviews[0].metadata.storage_path.startsWith(`${owner}/`));assert(conversation.needs_human);assertEquals(calls.filter(c=>/system_pay_installment|system_renew_installment_interest/.test(c.path)).length,0);});
Deno.test('paused conversations preserve private attachment for the human team',async()=>{reset();conversation.bot_paused=true;const {body}=await invoke({imageMessage:{mimetype:'image/png'}});assertEquals(body.status,'paused');assert(messages[0].metadata.storage_path.startsWith(`${owner}/`));assertEquals(jobs.length,0);});
Deno.test('disabled receipt recognition stores the file and routes it to humans',async()=>{reset();settings.bot_process_receipts=false;const {body}=await invoke({imageMessage:{mimetype:'image/png'}});assertEquals(body.status,'receipt_recognition_disabled');assert(conversation.needs_human);assertEquals(reviews.length,0);assert(messages[0].metadata.storage_path);});
Deno.test('new contact audio is preserved without calling an AI provider',async()=>{reset();knownClient=false;conversation.client_id=null;settings.bot_process_audio=true;const {body}=await invoke({audioMessage:{mimetype:'audio/ogg'}});assertEquals(body.status,'lead_attachment_received');assert(conversation.needs_human);assert(messages[0].metadata.storage_path);});
