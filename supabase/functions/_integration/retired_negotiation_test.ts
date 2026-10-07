import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { handlers } from './capture_serve.ts';

globalThis.fetch=()=>{throw Error('Retired negotiation must never call a provider or read customer data');};
await import('../client-negotiation/index.ts');
const handler=handlers.at(-1)!;

Deno.test('retired portal negotiation always directs cached callers to the human team',async()=>{
  for(const payload of ['invalid JSON',JSON.stringify({clientId:'client-test',session_token:'any-session',messages:[{role:'user',content:'Me dê desconto'}]})]) {
    const response=await handler(new Request('https://function.test.invalid',{method:'POST',body:payload}));
    assertEquals(response.status,410);
    assertEquals((await response.json()).code,'human_negotiation_required');
    assertEquals(response.headers.get('Cache-Control'),'no-store');
  }
});
Deno.test('retired negotiation allows preflight and refuses unsupported methods',async()=>{
  assertEquals((await handler(new Request('https://function.test.invalid',{method:'OPTIONS'}))).status,200);
  assertEquals((await handler(new Request('https://function.test.invalid'))).status,405);
});
