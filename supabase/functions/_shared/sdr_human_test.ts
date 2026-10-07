import {assert,assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {decide,handleSimulatedReply,polishWithAI,type SdrContext} from './sdr.ts';

const context={lead:{id:'lead-test',user_id:'owner-test',name:'Cliente Teste',phone:'11999999999',cpf:'00000000000',amount_requested:1000,income_monthly:2000,purpose:'Capital de giro',term_months:6,stage:'qualifying',notes:{}},incomingText:'continue',companyName:'Empresa teste',settings:{},profile:{},history:[]} as SdrContext;
Deno.test('qualified loan requests go to humans instead of an automatic proposal',()=>{
  const decision=decide(context);
  assert(decision.needsHuman);assertEquals(decision.stage,'handoff');
  assertEquals((decision.updates.notes as any)?.last_simulation,undefined);
  assert(!decision.reply.includes('x de'));assert(!decision.reply.includes('Mudar prazo'));
});
Deno.test('legacy simulated leads cannot negotiate acceptance, price or term with the bot',()=>{
  for(const incomingText of ['ok','caro','em 10x','quero 4000','desconto']) {
    const decision=handleSimulatedReply({...context,incomingText});
    assert(decision.needsHuman);assertEquals(decision.stage,'handoff');assertEquals(decision.updates.term_months,undefined);
  }
});
Deno.test('out-of-range loan requests never elicit an automatic counterproposal',()=>{
 const decision=decide({...context,lead:{...context.lead,amount_requested:200000}});
 assert(decision.needsHuman);assertEquals(decision.stage,'handoff');
 assert(!decision.reply.includes('ajustar'));assertEquals(decision.updates.amount_requested,undefined);
});
Deno.test('SDR AI rewriting cannot introduce an installment negotiation',async()=>{
 const originalFetch=globalThis.fetch;
 const values={GEMINI_API_KEY:'isolated-test-key',GEMINI_ALLOWED_USER_IDS:'owner-test',GEMINI_MODEL:'gemini-test-model'};
 const saved=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)]));
 try {
  for(const [k,v] of Object.entries(values))Deno.env.set(k,v);
  globalThis.fetch=()=>Promise.resolve(new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'Posso dividir em 3 parcelas. Fechamos?'}]}}]}),{headers:{'Content-Type':'application/json'}}));
  const base='A equipe humana fará a análise da sua solicitação.';
  assertEquals(await polishWithAI(base,context,[]),base);
 }finally{
  globalThis.fetch=originalFetch;
  for(const [k,v] of Object.entries(saved))v===undefined?Deno.env.delete(k):Deno.env.set(k,v);
 }
});
