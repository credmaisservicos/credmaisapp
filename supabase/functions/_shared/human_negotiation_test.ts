import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {requestsHumanNegotiation} from './human_negotiation.ts';

Deno.test('negotiation requests always require a human, including renewal and small discounts',()=>{
  for(const text of ['Quero negociar','renegociação','quero um acordo','dá 1% de desconto','tem descontinho?', 'abater multa','reduzir os juros','tirar a multa','mudar o vencimento','mais prazo','parcelar a dívida','dividir o saldo','faz por 400','pago só 60','não consigo pagar','quero pagar só os juros','renovar o contrato']) {
    assertEquals(requestsHumanNegotiation(text),true,text);
  }
});
Deno.test('ordinary balance, payment and loan inquiries remain available to the bot',()=>{
  for(const text of ['Quero saber das minhas parcelas','qual o valor dos juros?','paguei a parcela','vou pagar amanhã','mande o PIX','portal','qual a taxa?','desconto em folha','quero empréstimo consignado','']) {
    assertEquals(requestsHumanNegotiation(text),false,text);
  }
});
