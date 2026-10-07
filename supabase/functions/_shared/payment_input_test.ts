import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { parsePaymentAmount, extractPaymentAmount, parsePaymentDate } from './payment_input.ts';

Deno.test('payment amounts accept centavos, Brazilian grouping and decimal point',()=>{
  for(const [input,expected] of [['1.234,56',1234.56],['R$ 1.000,00',1000],['100.50',100.5],['20,5',20.5],['1.000',1000],['0',0],[' 10 ',10]] as const)assertEquals(parsePaymentAmount(input),expected);
});
Deno.test('invalid payment input is rejected without silently changing the amount',()=>{
  for(const input of ['',null,'-10','10,333','12.34,56','1,234.56','1e3','10 reais','Infinity','9007199254740999'])assertEquals(parsePaymentAmount(input),null);
});
Deno.test('promise amount extraction preserves decimal point and thousands',()=>{
  for(const [text,expected] of [['pago R$ 1.234,56 amanhã',1234.56],['consigo pagar 100.50',100.5],['pagar só 20,50',20.5],['pago 1.000,00.',1000],['pago 0',null],['pago 10,333',null],['pago 15/10',null],['pago 2026-10-15',null],['sexta dia 15',null]] as const)assertEquals(extractPaymentAmount(text),expected);
});
Deno.test('promise dates use the São Paulo calendar even across UTC midnight',()=>{
  const now=new Date('2026-10-08T01:30:00Z');
  assertEquals(parsePaymentDate('pago hoje',now),'2026-10-07');
  assertEquals(parsePaymentDate('pago amanhã',now),'2026-10-08');
  assertEquals(parsePaymentDate('dia 7',now),'2026-10-07');
  assertEquals(parsePaymentDate('quarta-feira',now),'2026-10-07');
  assertEquals(parsePaymentDate('próxima quarta-feira',now),'2026-10-14');
});
Deno.test('explicit promise dates reject past dates and impossible calendar days',()=>{
  const now=new Date('2026-10-07T18:00:00Z');
  for(const text of ['31/11/2026','29/02/2027','06/10/2026','2026-10-06','dia 32','qual meu saldo'])assertEquals(parsePaymentDate(text,now),null);
  assertEquals(parsePaymentDate('15/10',now),'2026-10-15');
  assertEquals(parsePaymentDate('dia 6',now),'2026-11-06');
  assertEquals(parsePaymentDate('2026-12-01',now),'2026-12-01');
  assertEquals(parsePaymentDate('29/02/2028',now),'2028-02-29');
  assertEquals(parsePaymentDate('dia 1',new Date('2026-12-31T18:00:00Z')),'2027-01-01');
});
