import { assertEquals,assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handlers } from './capture_serve.ts';
const owner='00000000-0000-4000-8000-000000000001',clientId='00000000-0000-4000-8000-000000000002';
const backend='https://bot-backend.test.invalid',provider='https://bot-provider.test.invalid',secret='isolated-test-secret';
for(const [k,v] of Object.entries({SUPABASE_URL:backend,SUPABASE_SERVICE_ROLE_KEY:'isolated-service',EVOLUTION_WEBHOOK_SECRET:secret,SITE_URL:'https://app.test.invalid'}))Deno.env.set(k,v);
Deno.env.delete('ANTHROPIC_API_KEY');Deno.env.delete('LOVABLE_API_KEY');
let calls:any[]=[],messages:any[]=[],reviews:any[]=[],jobs:any[]=[];
let settings:any,conversation:any,knownClient=true,failSettings=false,ownsLease=true,eventCompleted=false,failHandoff=false;
let geminiReply:any;
let testCase=0;
let clientMemory:string,installment:any,contract:any,failPromise=false,failCancel=false,failContract=false,failReview=false,failMemory=false,geminiStatus=200,portalReceipt=false;
const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const rows=(v:any,req:Request)=>json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?v:(v?[v]:[]));
function reset(){
 calls=[];messages=[];reviews=[];jobs=[];knownClient=true;failSettings=false;ownsLease=true;eventCompleted=false;failHandoff=false;
 geminiReply={reply:'Posso orientar sobre suas parcelas e encaminhar pedidos para a equipe.',intent:'duvida',needs_human:false};
 clientMemory=JSON.stringify({service_menu_started:true});failPromise=false;failCancel=false;failContract=false;failReview=false;failMemory=false;geminiStatus=200;portalReceipt=false;
 installment={id:'installment-test',user_id:owner,client_id:clientId,contract_id:'contract-test',amount:100,paid_amount:40,late_fee:0,scheduled_interest:10,status:'pending',due_date:'2099-01-01',installment_number:1,contracts:{status:'active',daily_interest_percent:4}};
 contract={id:'contract-test',status:'active',capital:90,total_amount:100,total_interest:10,interest_rate:10,num_installments:1,loan_mode:'fixed'};
 settings={user_id:owner,company_name:'Teste',bot_enabled:true,bot_auto_send:false,bot_auto_confirm_payment:true,bot_use_ai:false,bot_process_receipts:true,bot_process_audio:false,bot_work_days:['mon','tue','wed','thu','fri','sat','sun'],bot_business_start:'00:00',bot_business_end:'23:59',whatsapp_instance:'test',whatsapp_api_url:provider,whatsapp_api_key:'isolated-provider'};
 conversation={id:'conversation-test',user_id:owner,phone:'5511999999999',jid:'5511999999999@s.whatsapp.net',instance:'test',client_id:clientId,bot_paused:false,needs_human:false,blocked:false,unread_count:0};
 // Each scenario has its own instance, including the production per-JID limiter.
 settings.whatsapp_instance=`test-${++testCase}`;conversation.instance=settings.whatsapp_instance;
}
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),u=new URL(req.url),raw=await req.clone().text();let body:any={};try{body=JSON.parse(raw||'{}');}catch{/* binary attachment */}
 calls.push({path:u.pathname,method:req.method,body,origin:u.origin,query:Object.fromEntries(u.searchParams)});
 if(u.origin==='https://generativelanguage.googleapis.com')return geminiStatus===200
   ? json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(geminiReply)}]}}]})
   : json({error:{message:'isolated-provider-error'}},geminiStatus);
 if(u.origin===provider){
   if(u.pathname.includes('getBase64FromMediaMessage'))return json({base64:btoa('isolated fictional receipt')});
   return json({key:{id:'provider-test'}});
 }
 if(u.origin!==backend)throw Error(`Unexpected external request: ${u.origin}`);
 if(u.pathname.startsWith('/storage/v1/object/uploads/'))return json({Key:'private-test'});
 const table=u.pathname.split('/').at(-1);
 if(u.pathname.includes('/rpc/')){
   if(table==='try_consume_rate_limit')return json({allowed:true,remaining:100});
   if(table==='system_find_clients_by_phone')return json(knownClient?[{id:clientId,user_id:owner,name:'Cliente fictício',phone:'11999999999',bot_memory:clientMemory}]:[]);
   if(table==='begin_whatsapp_event')return json(!eventCompleted);
   if(table==='begin_whatsapp_response')return json(ownsLease);
   if(table==='system_pay_installment'||table==='system_renew_installment_interest')throw Error('Financial mutation forbidden in the webhook');
   if(table==='finish_whatsapp_event'){eventCompleted=body._success;return json(null);}
   return json(null);
 }
 if(table==='settings')return failSettings?json({message:'database unavailable'},503):rows(settings,req);
 if(table==='profiles')return rows({id:owner,is_admin:true,plan_tier:'completo',name:'Teste',pix_key:'pix@example.test'},req);
 if(table==='whatsapp_instances')return json([]);
 if(table==='whatsapp_event_claims')return rows({status:eventCompleted?'completed':'failed'},req);
 if(table==='whatsapp_conversations'){
   if(req.method==='PATCH'){if(failHandoff&&body.needs_human)return json({message:'Unavailable'},503);Object.assign(conversation,body);return new Response(null,{status:204});}
   return rows(conversation,req);
 }
 if(table==='clients'){if(req.method==='PATCH'&&body.bot_memory){if(failMemory)return json({message:'Unavailable'},503);clientMemory=body.bot_memory;}return rows({id:clientId,user_id:owner,name:'Cliente fictício',phone:'11999999999',bot_memory:clientMemory},req);}
 if(table==='payment_promises'&&req.method==='PATCH')return failCancel?json({message:'Unavailable'},503):new Response(null,{status:204});
 if(table==='audit_logs'&&req.method==='POST'&&['promise_to_pay','payment_promise_changed'].includes(body.action)&&failPromise)return json({message:'Unavailable'},503);
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
 if(table==='whatsapp_receipt_reviews'&&req.method==='GET'&&failReview)return json({message:'Unavailable'},503);
 if(table==='contract_installments')return json(u.searchParams.get('receipt_review_status')==='eq.pending'?(portalReceipt?[{id:installment.id}]:[]):[installment]);
 if(table==='contracts')return failContract?json({message:'Unavailable'},503):rows(contract,req);
 if(req.method==='GET')return json([]);
 return new Response(null,{status:201});
};
await import('../whatsapp-webhook/index.ts');const webhook=handlers.at(-1)!;
async function invoke(message:any={conversation:'menu'},valid=true,id='event-test',remoteJid='5511999999999@s.whatsapp.net'){
 const response=await webhook(new Request('https://webhook.test.invalid/',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-secret':valid?secret:'wrong'},body:JSON.stringify({event:'MESSAGES_UPSERT',instance:settings.whatsapp_instance,data:{key:{id,remoteJid,fromMe:false},message}})}));
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

Deno.test('interest-only requests require a human even when a renewal amount is calculable',async()=>{
 reset();installment.paid_amount=0;installment.scheduled_interest=23.45;contract.capital=1000;contract.loan_mode='price';
 const {response,body}=await invoke({conversation:'quero pagar só juros'});
 assertEquals(response.status,200);assertEquals(body.status,'human_handoff');assert(conversation.bot_paused);
 assert(jobs.some(j=>j.text.includes('somente por uma pessoa')));assertEquals(JSON.parse(clientMemory).pending_payment_amount,undefined);
 assertEquals(calls.filter(c=>c.path.endsWith('/contracts')).length,0);
});
Deno.test('partial installments route interest-only requests to a human without offering a renewal',async()=>{
 reset();const {body}=await invoke({conversation:'pagar só juros'});assertEquals(body.status,'human_handoff');assert(conversation.needs_human);assertEquals(JSON.parse(clientMemory).pending_payment_kind,undefined);
});
Deno.test('failed negotiation handoff retries without pretending that a human was notified',async()=>{
 reset();failHandoff=true;const {response}=await invoke({conversation:'pagar só juros'});assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);
});
Deno.test('partial payment proposals require a human without generating a negotiated PIX',async()=>{
 reset();const {body}=await invoke({conversation:'consigo pagar 20.50'});assertEquals(body.status,'human_handoff');assert(conversation.bot_paused);
 assert(jobs.every(j=>!j.text.includes('PIX')));assertEquals(JSON.parse(clientMemory).pending_payment_kind,undefined);
});
Deno.test('promise cancellation closes the owner-scoped operational promise before acknowledging',async()=>{
 reset();const {body}=await invoke({conversation:'cancelar promessa de pagamento'});assertEquals(body.status,'promise_cancelled');
 const update=calls.find(c=>c.path.endsWith('/payment_promises')&&c.method==='PATCH');assertEquals(update.body,{status:'cancelled'});assertEquals(update.query.user_id,`eq.${owner}`);assertEquals(update.query.client_id,`eq.${clientId}`);assertEquals(update.query.status,'eq.open');
});
Deno.test('failed promise cancellation remains retryable without a false acknowledgement',async()=>{
 reset();failCancel=true;const {response}=await invoke({conversation:'cancelar promessa de pagamento'});assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);
});
Deno.test('new promises materialize the operational amount before the reply',async()=>{
 reset();const {body}=await invoke({conversation:'pago R$ 20.50 amanhã'});assertEquals(body.status,'promise_registered');
 const audit=calls.find(c=>c.body.action==='promise_to_pay');assertEquals(audit.body.details.promise_amount,20.5);assertEquals(audit.body.user_id,owner);assert(jobs.some(j=>j.text.includes('20,50')));
});
Deno.test('changed promise failure does not tell the customer the date was saved',async()=>{
 reset();failPromise=true;const {response}=await invoke({conversation:'na verdade vou pagar amanhã'});assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);
});
Deno.test('receipt status lookup failure never says that no receipt was received',async()=>{
 reset();failReview=true;const {response}=await invoke({conversation:'qual o status do comprovante'});assertEquals(response.status,500);assertEquals(jobs.length,0);
});
Deno.test('receipt uploaded through the portal is reported as pending without claiming a payment',async()=>{
 reset();portalReceipt=true;const {response,body}=await invoke({conversation:'qual o status do comprovante'});
 assertEquals(response.status,200);assertEquals(body.review_status,'pending');
 assert(jobs.some(j=>j.text.includes('continua em análise')));assert(jobs.every(j=>!j.text.includes('baixa foi registrada')));
 assertEquals(calls.filter(c=>/system_pay_installment/.test(c.path)).length,0);
});
Deno.test('loan menu preserves the selected stage across messages',async()=>{
 reset();const first=await invoke({conversation:'1'});assertEquals(first.body.status,'loan_type_menu');assertEquals(JSON.parse(clientMemory).service_menu_stage,'loan_type');
 eventCompleted=false;const second=await invoke({conversation:'2'},true,'second-event');assertEquals(second.body.status,'loan_documents');assertEquals(JSON.parse(clientMemory).loan_profile,'clt');assertEquals(JSON.parse(clientMemory).service_menu_stage,'documents');
});
for (const stage of ['loan_type','documents'])Deno.test(`parcel inquiry interrupts ${stage} without restarting the loan application`,async()=>{
 reset();clientMemory=JSON.stringify({service_menu_started:true,service_menu_stage:stage,loan_profile:'clt'});
 const {response,body}=await invoke({conversation:'Quero saber das minhas parcelas'});
 assertEquals(response.status,200);assertEquals(body.status,'menu_choice');assertEquals(body.choice,'2');
 assertEquals(JSON.parse(clientMemory).service_menu_stage,'main');
 assert(jobs.some(j=>j.text.includes('60,00')));assert(jobs.every(j=>!j.text.includes('Não consegui identificar a modalidade')));
});
Deno.test('human request interrupts loan profile selection and pauses automation',async()=>{
 reset();clientMemory=JSON.stringify({service_menu_started:true,service_menu_stage:'loan_type'});
 const {body}=await invoke({conversation:'quero falar com um atendente'});
 assertEquals(body.status,'human_handoff');assert(conversation.needs_human);assert(conversation.bot_paused);
});
Deno.test('known client menu has only one numeric-choice instruction',async()=>{
 reset();const {response}=await invoke({conversation:'menu'});assertEquals(response.status,200);
 assertEquals(jobs.map(j=>j.text).join('\n').split('Escolha uma opção respondendo com o número:').length-1,1);
});
for(const scenario of ['allowed','other-owner','quota'])Deno.test(`Gemini webhook: ${scenario} preserves tenant scope and manual delivery`,async()=>{
 reset();settings.bot_use_ai=true;
 const vars=['GEMINI_API_KEY','GEMINI_ALLOWED_USER_IDS'];const previous=vars.map(k=>Deno.env.get(k));
 Deno.env.set(vars[0],'isolated-gemini-key');Deno.env.set(vars[1],scenario==='other-owner'?'different-owner':owner);
 if(scenario==='quota')geminiStatus=429;
 try{
  const {response}=await invoke({conversation:'Gostaria de entender melhor minha situação específica antes de decidir.'});
  assertEquals(response.status,200);assert(jobs.length>0);assert(jobs.every(j=>j.status==='awaiting_approval'));
  assertEquals(calls.filter(c=>c.origin==='https://generativelanguage.googleapis.com').length,scenario==='other-owner'?0:1);
  assertEquals(calls.filter(c=>c.path.includes('/message/send')).length,0);
  if(scenario==='allowed')assert(jobs.some(j=>j.text.includes('Posso orientar')));
  else assert(calls.some(c=>c.body.tool_name==='local_ai_fallback'));
 }finally{vars.forEach((k,i)=>previous[i]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[i]!));}
});
for(const scenario of ['small-discount','negotiation-intent','unsolicited-offer'])Deno.test(`AI cannot negotiate even when the model returns ${scenario}`,async()=>{
 reset();settings.bot_use_ai=true;
 const keys=['GEMINI_API_KEY','GEMINI_ALLOWED_USER_IDS'],before=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],'isolated-gemini-key');Deno.env.set(keys[1],owner);
 geminiReply={reply:scenario==='unsolicited-offer'?'Posso dividir em 3 parcelas.':'Condição especial aprovada.',intent:scenario==='negotiation-intent'?'negociacao':'duvida',desconto_pct:scenario==='small-discount'?1:0,needs_human:false};
 try {
  const {response}=await invoke({conversation:'Gostaria de entender melhor minha situação específica antes de decidir.'});
  assertEquals(response.status,200);assert(conversation.needs_human);assert(conversation.bot_paused);
  assert(jobs.some(j=>j.text.includes('somente por uma pessoa')));
  assert(jobs.every(j=>!j.text.includes('Condição especial aprovada')&&!j.text.includes('dividir em 3')));
  assertEquals(calls.filter(c=>/system_pay_installment|system_renew_installment_interest/.test(c.path)).length,0);
 } finally {keys.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}
});
Deno.test('test recipient restriction records other incoming messages without replying or generating an AI draft',async()=>{
 reset();const keys=['BOT_TEST_OWNER_ID','BOT_TEST_RECIPIENT'],before=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],owner);Deno.env.set(keys[1],'5511999999999');
 try{
  const {response,body}=await invoke({conversation:'Olá'},true,'other-test-contact','5511888888888@s.whatsapp.net');
  assertEquals(response.status,200);assertEquals(body.status,'test_recipient_ignored');assertEquals(messages.length,1);assertEquals(jobs.length,0);
  assertEquals(calls.filter(c=>c.path.includes('/message/send')||c.origin==='https://generativelanguage.googleapis.com').length,0);
 }finally{keys.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}
});
Deno.test('failed loan menu state remains retryable without pretending to advance',async()=>{
 reset();failMemory=true;const {response}=await invoke({conversation:'1'});assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);assertEquals(JSON.parse(clientMemory).service_menu_stage,undefined);
});
Deno.test('receipt after negotiation handoff stays with humans without automated renewal',async()=>{
 reset();installment.paid_amount=0;installment.scheduled_interest=23.45;
 await invoke({conversation:'pagar só juros'});eventCompleted=false;
 const {response}=await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante'}},true,'receipt-after-quote');
 assertEquals(response.status,200);assertEquals(reviews.length,0);assert(conversation.bot_paused);assert(messages.at(-1).metadata.storage_path);
 assertEquals(calls.filter(c=>/system_pay_installment|system_renew_installment_interest/.test(c.path)).length,0);
});
for(const known of [true,false])for(const stage of ['main','loan_type','documents']) {
 Deno.test(`negotiation before menus or AI: ${known?'client':'unknown contact'} at ${stage} goes to humans`,async()=>{
  reset();knownClient=known;if(!known)conversation.client_id=null;
  clientMemory=JSON.stringify({service_menu_started:true,service_menu_stage:stage});settings.bot_use_ai=true;
  const {response,body}=await invoke({conversation:'quero 1% de desconto na parcela 1'});
  assertEquals(response.status,200);assertEquals(body.status,'human_handoff');assertEquals(body.reason,'negotiation');assert(conversation.bot_paused&&conversation.needs_human);
  assert(jobs.some(j=>j.text.includes('somente por uma pessoa')));
  assertEquals(calls.filter(c=>c.origin==='https://generativelanguage.googleapis.com'||/system_pay_installment|system_renew_installment_interest/.test(c.path)).length,0);
  assert(calls.some(c=>c.path.endsWith('/notifications')&&c.method==='POST'));
 });
}
for(const scenario of ['expired','unrelated','future'])Deno.test(`receipt ignores ${scenario} payment context`,async()=>{
 reset();clientMemory=JSON.stringify({service_menu_started:true,pending_payment_kind:'interest_only',pending_payment_amount:23.45,pending_payment_installment_id:scenario==='unrelated'?'another-installment':installment.id,pending_payment_set_at:new Date(Date.now()+(scenario==='expired'?-72:scenario==='future'?24:-1)*3600_000).toISOString()});
 const {response}=await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante'}});assertEquals(response.status,200);assertEquals(reviews[0].metadata.payment_kind,'payment');assertEquals(reviews[0].amount,0);
});
