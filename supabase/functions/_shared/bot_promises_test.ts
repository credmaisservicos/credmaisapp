import {assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {promiseRequest,claimsSavedPromise,forecastInstallmentText} from './bot_promises.ts';
import {parseInstallmentReference} from './bot_installment_context.ts';
import {parseMemory,mergeMemory,serializeMemory,MAX_BYTES} from './memory.ts';
const now=new Date('2026-10-07T18:00:00Z');
for(const text of ['não vou pagar amanhã','posso pagar amanhã?','vou pagar amanhã?','talvez pago amanhã','se consigo pagar amanhã','acho que pago amanhã','não cancelar minha previsão','cancelar pagamento','estornar pix']){
 Deno.test(`forecast requires a definite customer statement: ${text}`,()=>assertEquals(promiseRequest(text,now)?.kind,'human'));
}
for(const [text,date,amount] of [
 ['vou pagar a segunda parcela amanhã','2026-10-08',null],
 ['pago 2 parcelas amanhã','2026-10-08',null],
 ['vou pagar a parcela 2 R$ 20,50 amanhã','2026-10-08',20.5],
 ['a parcela vence 15/10, vou pagar amanhã','2026-10-08',null],
 ['vou pagar amanhã a parcela que vence 15/10','2026-10-08',null],
 ['vou pagar a parcela que vence 15/10 amanhã',null,null],
 ['vou pagar 31/11/2026',null,null],
 ['vou pagar 06/10/2026',null,null],
 ['vou pagar hoje','2026-10-07',null],
] as const)Deno.test(`payment forecast parses the payment date and amount: ${text}`,()=>{
 const result=promiseRequest(text,now);assertEquals(result?.kind,'register');assertEquals(result?.date,date);assertEquals(result?.amount,amount);
});
Deno.test('unrelated corrections do not become payment forecasts',()=>assertEquals(promiseRequest('na verdade meu nome é Gustavo',now),null));
Deno.test('weekdays do not silently select a numbered installment',()=>{
 assertEquals(parseInstallmentReference(forecastInstallmentText('vou pagar sexta'))?.number,undefined);
 assertEquals(parseInstallmentReference(forecastInstallmentText('vou pagar a segunda parcela sexta'))?.number,2);
});
Deno.test('forecast status and explicit cancellation remain distinct',()=>{
 assertEquals(promiseRequest('qual minha previsão registrada?',now)?.kind,'status');
 assertEquals(promiseRequest('cancelar previsão de pagamento',now)?.kind,'cancel');
 assertEquals(promiseRequest('na verdade vou pagar amanhã',now)?.kind,'change');
});
Deno.test('AI claims about forecast writes are detectable',()=>{
 for(const text of ['Registrei sua previsão','Sua promessa foi salva','Cancelei a previsão','Atualizei sua promessa'])assertEquals(claimsSavedPromise(text),true);
 assertEquals(claimsSavedPromise('Informe a data da previsão'),false);
});
Deno.test('pending forecast date and amount survive compaction and cannot be replaced by AI',()=>{
 const state={pending_promise_kind:'register',pending_promise_date:'2026-10-08',pending_promise_set_at:now.toISOString(),pending_promise_amount:20.5};
 const memory=parseMemory(JSON.stringify({...state,fatos:['x'.repeat(20000)]}));
 const serialized=serializeMemory(mergeMemory(memory,{pending_promise_kind:'change',pending_promise_date:'2099-01-01',pending_promise_amount:999},'2026-10-07'));
 assertEquals(serialized.length<=MAX_BYTES,true);
 const next=parseMemory(serialized);for(const [key,value] of Object.entries(state))assertEquals(next[key],value);
 const invalid=parseMemory(JSON.stringify({pending_promise_kind:'unsafe',pending_promise_date:{},pending_promise_amount:-1}));
 for(const key of ['pending_promise_kind','pending_promise_date','pending_promise_amount'])assertEquals(invalid[key],undefined);
});
