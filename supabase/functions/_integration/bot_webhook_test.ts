import { assertEquals,assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handlers } from './capture_serve.ts';
const owner='00000000-0000-4000-8000-000000000001',clientId='00000000-0000-4000-8000-000000000002';
const backend='https://bot-backend.test.invalid',provider='https://bot-provider.test.invalid',secret='isolated-test-secret';
for(const [k,v] of Object.entries({SUPABASE_URL:backend,SUPABASE_SERVICE_ROLE_KEY:'isolated-service',EVOLUTION_WEBHOOK_SECRET:secret,SITE_URL:'https://app.test.invalid'}))Deno.env.set(k,v);
Deno.env.delete('ANTHROPIC_API_KEY');Deno.env.delete('LOVABLE_API_KEY');
let calls:any[]=[],messages:any[]=[],reviews:any[]=[],jobs:any[]=[];
let settings:any,conversation:any,knownClient=true,failSettings=false,ownsLease=true,eventCompleted=false,failHandoff=false;
let geminiReply:any;
let geminiTranscript:string|null=null;
let testCase=0;
let lead:any=null;
let clientMemory:string,installment:any,contract:any,failPromise=false,failCancel=false,failContract=false,failReview=false,failMemory=false,geminiStatus=200,portalReceipt=false;
let additionalInstallments:any[]=[],additionalContracts:any[]=[];
let profilePix:string|null;
let failPromiseLink=false;
const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
const rows=(v:any,req:Request)=>json(req.headers.get('Accept')?.includes('vnd.pgrst.object')?v:(v?[v]:[]));
function reset(){
 calls=[];messages=[];reviews=[];jobs=[];knownClient=true;failSettings=false;ownsLease=true;eventCompleted=false;failHandoff=false;
 lead=null;
 geminiTranscript=null;
 additionalInstallments=[];additionalContracts=[];
 profilePix='pix@example.test';
 failPromiseLink=false;
 geminiReply={reply:'Posso orientar sobre suas parcelas e encaminhar pedidos para a equipe.',intent:'duvida',needs_human:false};
 clientMemory=JSON.stringify({service_menu_started:true});failPromise=false;failCancel=false;failContract=false;failReview=false;failMemory=false;geminiStatus=200;portalReceipt=false;
 installment={id:'installment-test',user_id:owner,client_id:clientId,contract_id:'contract-test',amount:100,paid_amount:40,late_fee:0,scheduled_interest:10,status:'pending',due_date:'2099-01-01',installment_number:1,contracts:{status:'active',daily_interest_percent:4}};
 contract={id:'contract-test',user_id:owner,client_id:clientId,status:'active',capital:90,total_amount:100,total_interest:10,interest_rate:10,num_installments:1,loan_mode:'fixed'};
 settings={user_id:owner,company_name:'Teste',bot_enabled:true,bot_auto_send:false,bot_auto_confirm_payment:true,bot_use_ai:false,bot_process_receipts:true,bot_process_audio:false,bot_work_days:['mon','tue','wed','thu','fri','sat','sun'],bot_business_start:'00:00',bot_business_end:'23:59',whatsapp_instance:'test',whatsapp_api_url:provider,whatsapp_api_key:'isolated-provider'};
 conversation={id:'conversation-test',user_id:owner,phone:'5511999999999',jid:'5511999999999@s.whatsapp.net',instance:'test',client_id:clientId,bot_paused:false,needs_human:false,blocked:false,unread_count:0};
 // Each scenario has its own instance, including the production per-JID limiter.
 settings.whatsapp_instance=`test-${++testCase}`;conversation.instance=settings.whatsapp_instance;
}
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),u=new URL(req.url),raw=await req.clone().text();let body:any={};try{body=JSON.parse(raw||'{}');}catch{/* binary attachment */}
 calls.push({path:u.pathname,method:req.method,body,origin:u.origin,query:Object.fromEntries(u.searchParams)});
 if(u.origin==='https://generativelanguage.googleapis.com')return geminiStatus===200
   ? json({candidates:[{finishReason:'STOP',content:{parts:[{text:geminiTranscript!==null&&body.contents?.some((c:any)=>c.parts?.some((p:any)=>p.inlineData?.mimeType?.startsWith('audio/')))?geminiTranscript:JSON.stringify(geminiReply)}]}}]})
   : json({error:{message:'isolated-provider-error'}},geminiStatus);
 if(u.origin===provider){
   if(u.pathname.includes('getBase64FromMediaMessage'))return json({base64:btoa(body.message?.message?.audioMessage?'x'.repeat(600):'isolated fictional receipt')});
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
 if(table==='profiles')return rows({id:owner,is_admin:true,plan_tier:'completo',name:'Teste',pix_key:profilePix},req);
 if(table==='whatsapp_instances')return json([]);
 if(table==='portal_sessions'&&req.method==='POST')return rows({token:'isolated-portal-session'},req);
 if(table==='leads'&&lead){if(req.method==='PATCH'){Object.assign(lead,body);return new Response(null,{status:204});}return rows(lead,req);}
 if(table==='whatsapp_event_claims')return rows({status:eventCompleted?'completed':'failed'},req);
 if(table==='whatsapp_conversations'){
   if(req.method==='PATCH'){if(failHandoff&&body.needs_human)return json({message:'Unavailable'},503);Object.assign(conversation,body);return new Response(null,{status:204});}
   return rows(conversation,req);
 }
 if(table==='clients'){if(req.method==='PATCH'&&body.bot_memory){if(failMemory)return json({message:'Unavailable'},503);clientMemory=body.bot_memory;}return rows({id:clientId,user_id:owner,name:'Cliente fictício',phone:'11999999999',bot_memory:clientMemory},req);}
 if(table==='payment_promises'&&req.method==='PATCH')return failCancel||(failPromiseLink&&body.installment_id)?json({message:'Unavailable'},503):new Response(null,{status:204});
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
 if(table==='contract_installments'){
   if(u.searchParams.get('receipt_review_status')==='eq.pending')return json(portalReceipt?[{id:installment.id}]:[]);
   const data=[installment,...additionalInstallments].filter(row=>['id','user_id','client_id','contract_id'].every(key=>!u.searchParams.has(key)||u.searchParams.get(key)===`eq.${row[key]}`))
     .filter(row=>!u.searchParams.get('status')?.startsWith('not.in')||!['paid','cancelled'].includes(row.status))
     .sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id.localeCompare(b.id));
   return req.headers.get('Accept')?.includes('vnd.pgrst.object')?json(data[0]||null):json(data);
 }
 if(table==='contracts'){
   if(failContract)return json({message:'Unavailable'},503);
   const data=[contract,...additionalContracts].filter(row=>['id','user_id','client_id'].every(key=>!u.searchParams.has(key)||u.searchParams.get(key)===`eq.${row[key]}`));
   return req.headers.get('Accept')?.includes('vnd.pgrst.object')?json(data[0]||null):json(data);
 }
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
Deno.test('qualified lead takeover pauses automation before acknowledging human analysis',async()=>{
 reset();knownClient=false;conversation.client_id=null;
 lead={id:'lead-test',user_id:owner,name:'Contato Teste',phone:'11999999999',cpf:'00000000000',amount_requested:1000,income_monthly:2000,purpose:'Capital de giro',stage:'qualifying',notes:{service_menu_stage:'main'}};
 const {response}=await invoke({conversation:'continue'});
 assertEquals(response.status,200);assert(conversation.needs_human&&conversation.bot_paused);assertEquals(lead.stage,'handoff');
 assert(jobs.length>0);assert(jobs.every(j=>j.purpose==='handoff_notice'));assert(!jobs.some(j=>/Aprovado\?|Fecha\?|parcela ≈/.test(j.text)));
});
Deno.test('failed qualified lead takeover remains retryable without a human acknowledgement',async()=>{
 reset();knownClient=false;conversation.client_id=null;failHandoff=true;
 lead={id:'lead-test',user_id:owner,name:'Contato Teste',phone:'11999999999',cpf:'00000000000',amount_requested:1000,income_monthly:2000,purpose:'Capital de giro',stage:'qualifying',notes:{service_menu_stage:'main'}};
 const {response}=await invoke({conversation:'continue'});
 assertEquals(response.status,500);assertEquals(jobs.length,0);assert(!eventCompleted);
});
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
 assertEquals(response.status,200);assertEquals(body.status,'installment_list');assertEquals(body.count,1);
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

async function turn(text:string,id:string){eventCompleted=false;return await invoke({conversation:text},true,id);}
function addParcel(number:number,overrides:any={}){
 const row={...installment,id:`installment-${number}`,installment_number:number,amount:250,paid_amount:50,due_date:`2099-0${number}-01`,...overrides};
 if(row.contract_id!==contract.id&&!additionalContracts.some(c=>c.id===row.contract_id))additionalContracts.push({...contract,id:row.contract_id});
 additionalInstallments.push(row);return row;
}
function paymentQuote(){return JSON.parse(clientMemory);}
function pixAmount(){
 const code=jobs.map(j=>j.text).join('\n').match(/`(000201[^`]+)`/)?.[1];
 assert(code,'Expected a contractual PIX code');
 for(let offset=0;offset<code.length;){
  const tag=code.slice(offset,offset+2),length=Number(code.slice(offset+2,offset+4));
  assert(Number.isFinite(length)&&length>0);const value=code.slice(offset+4,offset+4+length);
  if(tag==='54')return Number(value);offset+=4+length;
 }
 throw Error('Missing PIX amount');
}
Deno.test('first specific installment inquiry is answered before the welcome menu',async()=>{
 reset();clientMemory='{}';addParcel(2);
 const {body}=await turn('PIX da parcela 2','first-specific');
 assertEquals(body.status,'installment_selected');assertEquals(body.installment_id,'installment-2');
 assertEquals(paymentQuote().pending_payment_installment_id,'installment-2');assertEquals(pixAmount(),200);
 assert(jobs.every(j=>!j.text.includes('Escolha uma opção respondendo com o número:')));
});
Deno.test('immediate changes and short followups preserve the actual installment rather than menu cooldown',async()=>{
 reset();addParcel(2);addParcel(3,{amount:300,paid_amount:100});
 for(const [text,id,expected] of [['parcela 2','select-2','installment-2'],['parcela 3','select-3','installment-3'],['manda o PIX','follow-pix','installment-3'],['quando vence?','follow-date','installment-3']] as const){
  jobs=[];const {body}=await turn(text,id);assertEquals(body.status,'installment_selected');assertEquals(body.installment_id,expected);assertEquals(paymentQuote().pending_payment_installment_id,expected);
  if(text.includes('PIX'))assertEquals(pixAmount(),200);else assert(jobs.every(j=>!j.text.includes('000201')));
 }
 assert(jobs.some(j=>j.text.includes('01/03/2099')));
});
Deno.test('duplicate installment numbers require a choice and keep that contract on followups',async()=>{
 reset();addParcel(2);const other=addParcel(2,{id:'other-contract-2',contract_id:'bbbb2222',amount:500,paid_amount:20});
 const first=await turn('parcela 2','duplicate-number');assertEquals(first.body.status,'installment_ambiguous');
 assertEquals(paymentQuote().pending_payment_installment_id,'');assert(jobs.every(j=>!j.text.includes('000201')));
 jobs=[];const second=await turn('escolher 2','choose-contract');assertEquals(second.body.installment_id,other.id);assertEquals(paymentQuote().pending_payment_amount,480);
 jobs=[];const third=await turn('qual o valor?','same-contract');assertEquals(third.body.installment_id,other.id);assert(jobs.every(j=>!j.text.includes('000201')));
 jobs=[];await turn('PIX','pix-same-contract');assertEquals(pixAmount(),480);
});
Deno.test('last installment belongs to the requested contract and never completes earlier debt',async()=>{
 reset();addParcel(2);addParcel(3);addParcel(2,{id:'last-other',contract_id:'bbbb2222'});
 assertEquals((await turn('última parcela','last-ambiguous')).body.status,'installment_ambiguous');
 const chosen=await turn('última parcela contrato contract-test','last-contract');assertEquals(chosen.body.installment_id,'installment-3');
 assertEquals(installment.paid_amount,40);assertEquals(contract.status,'active');
 assertEquals(calls.filter(c=>/system_pay_installment|system_renew_installment_interest/.test(c.path)).length,0);
});
Deno.test('next installment excludes overdue debt and date selection handles future installments',async()=>{
 reset();installment.due_date='2026-01-01';installment.contracts={status:'active',daily_interest_percent:0.1,max_interest_cap_percent:10};addParcel(2);addParcel(3);
 assertEquals((await turn('próxima parcela','next')).body.installment_id,'installment-2');
 assertEquals((await turn('parcela vencimento 01/03/2099','by-date')).body.installment_id,'installment-3');
 assertEquals((await turn('e a segunda?','ordinal-followup')).body.installment_id,'installment-2');
});
for(const scenario of ['paid','cancelled','closed-contract','foreign-owner','foreign-client'])Deno.test(`installment selector ignores ${scenario} records`,async()=>{
 reset();const row=addParcel(2);
 if(scenario==='paid'||scenario==='cancelled')row.status=scenario;
 if(scenario==='closed-contract')row.contracts={status:'completed'};
 if(scenario==='foreign-owner')row.user_id='other-owner';
 if(scenario==='foreign-client')row.client_id='other-client';
 const {body}=await turn('PIX parcela 2','invalid-scope');assertEquals(body.status,'installment_not_found');
 assert(jobs.every(j=>!j.text.includes('000201')));assertEquals(paymentQuote().pending_payment_installment_id,'');
});
for(const scenario of ['expired','paid-after-selection','invalid-date'])Deno.test(`a ${scenario} selection never redirects PIX to a different debt`,async()=>{
 reset();const row=addParcel(2);await turn('parcela 2','initial-selection');
 if(scenario==='expired')clientMemory=JSON.stringify({...paymentQuote(),pending_payment_set_at:new Date(Date.now()-72*3600_000).toISOString()});
 if(scenario==='paid-after-selection'){row.status='paid';row.paid_amount=250;}
 jobs=[];const {body}=await turn(scenario==='invalid-date'?'parcela 31/02/2099':'pix','stale-followup');
 assertEquals(body.status,'installment_not_found');assert(jobs.every(j=>!j.text.includes('000201')));
});
Deno.test('failed selection persistence is retryable without sending an unsaved payment quote',async()=>{
 reset();failMemory=true;const {response}=await turn('parcela 1','fail-selection');
 assertEquals(response.status,500);assertEquals(eventCompleted,false);assertEquals(jobs.length,0);assertEquals(paymentQuote().pending_payment_installment_id,undefined);
});
Deno.test('unquoted receipt with unknown amount is never attached to the oldest installment',async()=>{
 reset();addParcel(2);await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante'}});
 assertEquals(reviews[0].installment_id,null);assertEquals(reviews[0].amount,0);assertEquals(reviews[0].metadata.quoted_amount,null);
 assertEquals(reviews[0].status,'pending');assert(conversation.needs_human);
});
Deno.test('receipt keeps the selected installment but never invents the amount received from the quote',async()=>{
 reset();addParcel(2);await turn('parcela 2','receipt-selection');eventCompleted=false;
 await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante'}},true,'quoted-receipt');
 assertEquals(reviews[0].installment_id,'installment-2');assertEquals(reviews[0].amount,0);assertEquals(reviews[0].metadata.quoted_amount,200);
 assertEquals(reviews[0].metadata.payment_kind,'payment');assertEquals(reviews[0].status,'pending');
 assertEquals(calls.filter(c=>/system_pay_installment|system_renew_installment_interest/.test(c.path)).length,0);
});
Deno.test('explicit receipt installment overrides the previous quote without copying its amount',async()=>{
 reset();addParcel(2);await turn('parcela 2','prior-quote');eventCompleted=false;
 await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante parcela 1'}},true,'explicit-receipt');
 assertEquals(reviews[0].installment_id,installment.id);assertEquals(reviews[0].metadata.quoted_amount,null);assertEquals(reviews[0].amount,0);
});
Deno.test('ambiguous explicit receipt reference awaits a human without guessing either contract',async()=>{
 reset();addParcel(2);addParcel(2,{id:'duplicate-receipt',contract_id:'bbbb2222'});
 await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante parcela 2'}});
 assertEquals(reviews[0].installment_id,null);assertEquals(reviews[0].status,'pending');
});
for(const stage of ['loan_type','documents'])Deno.test(`receipt caption exits ${stage} without becoming a loan document or a menu choice`,async()=>{
 reset();clientMemory=JSON.stringify({service_menu_started:true,service_menu_stage:stage});
 const {response}=await invoke({imageMessage:{mimetype:'image/png',caption:'comprovante parcela 1'}});
 assertEquals(response.status,200);assertEquals(reviews[0].installment_id,installment.id);assertEquals(reviews[0].status,'pending');
 assert(conversation.bot_paused);assert(jobs.every(j=>!j.text.includes('000201')));
});
Deno.test('missing PIX key routes the selected installment to humans without generating a code',async()=>{
 reset();profilePix=null;const {body}=await turn('PIX parcela 1','missing-pix');
 assertEquals(body.status,'installment_selected');assert(conversation.needs_human&&conversation.bot_paused);
 assert(jobs.every(j=>!j.text.includes('000201')));assert(jobs.some(j=>j.text.includes('chave PIX ainda não')));
});
Deno.test('transcribed audio selects a specific installment and preserves it for written followups',async()=>{
 reset();addParcel(2);addParcel(3);settings.bot_process_audio=true;
 const keys=['GEMINI_API_KEY','GEMINI_ALLOWED_USER_IDS'],before=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],'isolated-gemini-key');Deno.env.set(keys[1],owner);
 try{
  geminiTranscript='quero o PIX da parcela 2';
  const first=await invoke({audioMessage:{mimetype:'audio/ogg'}},true,'audio-select-2');
  assertEquals(first.body.status,'installment_selected');assertEquals(first.body.installment_id,'installment-2');
  assert(messages[0].metadata.transcribed);assertEquals(paymentQuote().pending_payment_installment_id,'installment-2');
  const second=await turn('qual o valor?','written-after-audio');assertEquals(second.body.installment_id,'installment-2');
  geminiTranscript='e a terceira?';eventCompleted=false;
  const third=await invoke({audioMessage:{mimetype:'audio/ogg'}},true,'audio-select-3');assertEquals(third.body.installment_id,'installment-3');
  assertEquals(calls.filter(c=>c.origin==='https://generativelanguage.googleapis.com').length,2);
  assertEquals(calls.filter(c=>c.path.includes('/message/send')).length,0);
 }finally{keys.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}
});
for(const command of ['pare bot, parcela 1','quero falar com um atendente sobre a parcela 1'])Deno.test(`human control precedes a payment query and the first welcome: ${command}`,async()=>{
 reset();clientMemory='{}';const {body}=await turn(command,'human-control');
 assertEquals(body.status,command.startsWith('pare')?'stopped':'human_handoff');assert(conversation.needs_human&&conversation.bot_paused);
 assert(jobs.every(j=>!j.text.includes('000201')&&!j.text.includes('Escolha uma opção respondendo com o número:')));
});
Deno.test('starting a loan flow clears the previous installment and does not treat its confirmation as PIX consent',async()=>{
 reset();addParcel(2);await turn('parcela 2','payment-before-loan');
 await turn('1','loan-after-payment');assertEquals(paymentQuote().pending_payment_installment_id,'');
 jobs=[];const {body}=await turn('sim','loan-confirmation');assertEquals(body.status,'loan_type_invalid');assert(jobs.every(j=>!j.text.includes('000201')));
});
for(const explicit of [true,false])Deno.test(`promise follows ${explicit?'explicit':'previously selected'} installment without changing its due date`,async()=>{
 reset();const row=addParcel(2);if(!explicit)await turn('parcela 2','promise-context');
 const {body}=await turn(explicit?'vou pagar parcela 2 amanhã':'vou pagar amanhã','selected-promise');assertEquals(body.status,'promise_registered');
 const update=calls.find(c=>c.path.endsWith('/payment_promises')&&c.method==='PATCH'&&c.body.installment_id);
 assertEquals(update.body,{installment_id:row.id,contract_id:row.contract_id,promised_amount:200});assertEquals(update.query.user_id,`eq.${owner}`);assertEquals(update.query.client_id,`eq.${clientId}`);assertEquals(update.query.status,'eq.open');assertEquals(update.query.source,'eq.bot');assertEquals(update.query.promised_for,`eq.${body.promise_date}`);
 assertEquals(row.due_date,'2099-02-01');assertEquals(calls.filter(c=>c.path.endsWith('/contract_installments')&&c.method==='PATCH').length,0);
 assertEquals(paymentQuote().pending_payment_installment_id,row.id);assertEquals((await turn('pix','pix-after-promise')).body.installment_id,row.id);
});
Deno.test('ambiguous promised installment asks for a contract before recording a payment forecast',async()=>{
 reset();addParcel(2);addParcel(2,{id:'promise-other',contract_id:'bbbb2222'});
 const {body}=await turn('vou pagar parcela 2 amanhã','ambiguous-promise');assertEquals(body.status,'installment_ambiguous');
 assertEquals(calls.filter(c=>['promise_to_pay','payment_promise_changed'].includes(c.body.action)).length,0);assert(jobs.every(j=>!j.text.includes('Registrei')));
});
Deno.test('failed promise context linkage remains retryable without acknowledging the wrong installment',async()=>{
 reset();addParcel(2);await turn('parcela 2','promise-before-failure');jobs=[];failPromiseLink=true;
 const {response}=await turn('vou pagar amanhã','failed-promise-link');assertEquals(response.status,500);assertEquals(eventCompleted,false);assertEquals(jobs.length,0);
});
for(const c of [
 {name:'future without fees',days:-10,rate:0.1,penalty:0,type:'percentage',paid:40,stored:0,cap:0,expected:60},
 {name:'due today with fixed penalty configured',days:0,rate:4,penalty:5,type:'fixed',paid:40,stored:0,cap:0,expected:60},
 {name:'partial with percentage penalty',days:3,rate:0.1,penalty:2,type:'percentage',paid:40,stored:0,cap:0,expected:66.3},
 {name:'partial with fixed daily penalty',days:2,rate:0.1,penalty:5,type:'fixed',paid:40,stored:0,cap:0,expected:70.2},
 {name:'capped late charges',days:30,rate:4,penalty:2,type:'percentage',paid:40,stored:0,cap:10,expected:70},
 {name:'only unpaid fees remain',days:0,rate:0.1,penalty:0,type:'percentage',paid:110,stored:20,cap:0,expected:10},
])Deno.test(`payment reply and encoded PIX agree: ${c.name}`,async()=>{
 reset();installment.paid_amount=c.paid;installment.late_fee=c.stored;
 installment.due_date=new Date(Date.now()-c.days*86400000).toISOString().slice(0,10);
 installment.contracts={status:'active',daily_interest_percent:c.rate,daily_penalty_value:c.penalty,daily_penalty_type:c.type,max_interest_cap_percent:c.cap};
 const {body}=await turn('PIX parcela 1','financial-case');assertEquals(body.status,'installment_selected');
 assertEquals(paymentQuote().pending_payment_amount,c.expected);assertEquals(pixAmount(),c.expected);
 assert(jobs.every(j=>j.status==='awaiting_approval'));assertEquals(calls.filter(c=>c.path.includes('/message/send')).length,0);
});

for(const [text,intent] of [['quando vence a parcela 1?','due_date'],['quanto preciso pagar da parcela 1?','balance'],['qual a multa da parcela 1?','charges']] as const)Deno.test(`conversation answers ${intent} without unsolicited PIX`,async()=>{
 reset();const {body}=await turn(text,'topic-specific');assertEquals(body.reply_intent,intent);
 assert(jobs.every(j=>!j.text.includes('000201')&&!j.text.includes('Chave PIX')));
 if(intent==='due_date')assert(jobs.every(j=>!j.text.includes('Já recebido')));
 assertEquals(paymentQuote().pending_payment_installment_id,installment.id);
});
for(const text of ['obrigado','valeu','agora não'])Deno.test(`courtesy preserves financial context without restarting the menu: ${text}`,async()=>{
 reset();await turn('PIX parcela 1','before-courtesy');jobs=[];
 const {body}=await turn(text,'courtesy');assertEquals(body.status,'courtesy_reply');assertEquals(paymentQuote().pending_payment_installment_id,installment.id);
 assert(jobs.every(j=>!j.text.includes('000201')&&!j.text.includes('Menu')));assertEquals(conversation.bot_paused,false);
});
for(const text of ['número errado da parcela 1','valor da parcela 1 errado','já paguei e vocês estão cobrando'])Deno.test(`dispute pauses before sending any debt or payment info: ${text}`,async()=>{
 reset();const {body}=await turn(text,'dispute');assertEquals(body.status,'human_handoff');assert(conversation.bot_paused&&conversation.needs_human);
 assert(jobs.every(j=>!j.text.includes('000201')&&!j.text.includes('60,00')));
 assertEquals(calls.filter(c=>c.path.endsWith('/contract_installments')).length,0);
});
Deno.test('total balance is an explicit list request rather than the previously selected installment',async()=>{
 reset();addParcel(2);await turn('parcela 2','selected-before-total');jobs=[];
 const {body}=await turn('qual saldo total?','total-all');assertEquals(body.status,'installment_list');assertEquals(body.count,2);
 assert(jobs.some(j=>j.text.includes('260,00')&&j.text.includes('inclui parcelas futuras')));assert(jobs.every(j=>!j.text.includes('000201')));
});
Deno.test('general charge question explains rules without guessing a parcel or sending PIX',async()=>{
 reset();addParcel(2);clientMemory='{}';const {body}=await turn('como funciona a multa?','explain-charge');assertEquals(body.status,'charges_explanation');
 assert(jobs.every(j=>!j.text.includes('000201')&&!j.text.includes('Encontrei mais de uma')));
});
Deno.test('first portal request is answered directly without an introductory menu',async()=>{
 reset();clientMemory='{}';const {response,body}=await turn('portal','first-portal');assertEquals(response.status,200);assertEquals(body.choice,'portal');
 assert(jobs.some(j=>j.text.includes('/portal?t=')));assert(jobs.every(j=>!j.text.includes('Escolha uma opção respondendo com o número:')));
});
Deno.test('greeting never promises to send PIX or asks the customer to settle automatically',async()=>{
 reset();installment.due_date='2026-01-01';installment.contracts={status:'active',daily_interest_percent:0.1,max_interest_cap_percent:10};
 await turn('oi','greeting');assert(jobs.every(j=>!j.text.includes('quitar')&&!j.text.includes('Vou te enviar o PIX')));
});
Deno.test('two unclear requests route to humans instead of an endless clarification loop',async()=>{
 reset();await turn('asdfgh','unclear-first');assertEquals(paymentQuote().clarification_count,1);assertEquals(conversation.bot_paused,false);
 jobs=[];await turn('qwerty','unclear-second');assertEquals(paymentQuote().clarification_count,2);assert(conversation.bot_paused&&conversation.needs_human);
 assert(jobs.some(j=>j.text.includes('Não consegui entender')));assert(jobs.every(j=>!j.text.includes('entendi')));
});
Deno.test('failed clarification handoff does not pretend that a human was notified',async()=>{
 reset();clientMemory=JSON.stringify({service_menu_started:true,clarification_count:1});failHandoff=true;
 const {response}=await turn('asdfgh','unclear-failed');assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);
});
Deno.test('AI clarification also offers a human exit after two attempts',async()=>{
 reset();settings.bot_use_ai=true;geminiReply={reply:'Pode explicar melhor?',intent:'duvida',needs_human:false,requires_clarification:true};
 const keys=['GEMINI_API_KEY','GEMINI_ALLOWED_USER_IDS'],before=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],'isolated-gemini-key');Deno.env.set(keys[1],owner);
 try{
   await turn('Não sei como explicar isso aqui.','ai-clarify-first');assertEquals(paymentQuote().clarification_count,1);assertEquals(conversation.bot_paused,false);
   await turn('Ainda não consegui explicar minha situação.','ai-clarify-second');assert(conversation.needs_human&&conversation.bot_paused);assertEquals(paymentQuote().clarification_count,2);
 }finally{keys.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}
});
Deno.test('numeric human choice never claims a handoff when persistence fails',async()=>{
 reset();failHandoff=true;const {response}=await turn('5','numeric-human-failed');assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);
});
Deno.test('menu state failure does not queue an introductory message with unsaved context',async()=>{
 reset();clientMemory='{}';failMemory=true;const {response}=await turn('oi','first-menu-failed');assertEquals(response.status,500);assertEquals(jobs.length,0);assertEquals(eventCompleted,false);
});
