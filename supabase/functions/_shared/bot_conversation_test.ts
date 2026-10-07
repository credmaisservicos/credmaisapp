import {assertEquals,assert} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {conversationSignal,installmentReplyIntent,generalChargesQuestion,clarificationReply} from './bot_conversation.ts';

Deno.test('courtesies do not swallow a following payment request',()=>{
 for(const text of ['obrigado','Obrigada!','valeu','muito obrigado'])assertEquals(conversationSignal(text),'thanks');
 for(const text of ['obrigado manda o PIX','valeu qual valor','não obrigado mas quero parcela 2'])assertEquals(conversationSignal(text),null);
});
Deno.test('identity and disputed debt are classified before payment language',()=>{
 for(const text of ['não sou o titular da parcela 2','número errado','esse número não é dele'])assertEquals(conversationSignal(text),'identity_dispute');
 for(const text of ['valor da cobrança errado','cobrança indevida','não devo','já paguei e continuam cobrando','não contratei esse empréstimo','suspeito de fraude'])assertEquals(conversationSignal(text),'billing_dispute');
});
Deno.test('declining a suggestion is neither payment consent nor a negotiation',()=>{
 for(const text of ['não','agora não','não obrigado'])assertEquals(conversationSignal(text),'decline');
 assertEquals(conversationSignal('não consigo pagar'),null);
});
Deno.test('installment questions answer their topic without unsolicited payment codes',()=>{
 for(const [text,intent] of [['quando vence?','due_date'],['quanto preciso pagar?','balance'],['qual valor da parcela 2?','balance'],['qual multa da parcela 2?','charges'],['PIX parcela 2','payment'],['pode mandar','payment'],['parcela 2','summary']] as const)assertEquals(installmentReplyIntent(text),intent);
});
Deno.test('general charge explanations do not pretend to calculate a specific installment',()=>{
 for(const text of ['como funciona a multa?','o que são encargos?','como é calculado o juros?'])assert(generalChargesQuestion(text));
 assertEquals(generalChargesQuestion('como calcula multa parcela 2?'),false);
 assertEquals(generalChargesQuestion('qual multa da parcela 2?'),false);
});
Deno.test('repeated clarification has a human exit without pretending to understand',()=>{
 assert(!/entendi|encaminhei/i.test(clarificationReply(1)));
 assert(/encaminhei/i.test(clarificationReply(2)));
});
