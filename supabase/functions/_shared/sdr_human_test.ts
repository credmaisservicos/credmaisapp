import {assert,assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {decide,handleSimulatedReply,type SdrContext} from './sdr.ts';

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
