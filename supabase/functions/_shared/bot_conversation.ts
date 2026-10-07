const normalize=(text:string)=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function conversationSignal(text:string){
 const t=normalize(text);
 if(/nao sou (?:eu|esse cliente|essa pessoa|o titular)|numero errado|pessoa errada|nao conheco (?:essa pessoa|esse cliente)|esse numero nao/.test(t))return 'identity_dispute';
 if(/nao devo|nao tenho (?:essa )?divida|nao contratei|nao reconheco.*(?:divida|emprestimo|contrato)|\b(?:fraude|golpe|procon|advogado)\b|cobranca (?:errada|indevida|duplicada)|valor.*(?:errado|incorreto|indevido)|ja paguei.*(?:cobrando|cobranca)|(?:cobrando|cobranca).*ja paguei/.test(t))return 'billing_dispute';
 if(/^(?:(?:muito )?obrigad[oa]|valeu|agradeco|brigad[oa]|bom atendimento)[.!\s]*$/.test(t))return 'thanks';
 if(/^(?:nao|nao obrigado|nao obrigada|agora nao|nao preciso|deixa pra depois)[.!\s]*$/.test(t))return 'decline';
 return null;
}

export function installmentReplyIntent(text:string):'payment'|'due_date'|'charges'|'balance'|'summary'{
 const t=normalize(text);
 if(/pix|chave|boleto|copia e cola|segunda via|2[ªa] via/.test(t))return 'payment';
 if(/multa|juros|encargos|por que.*(?:aument|valor)|pq.*(?:aument|valor)/.test(t))return 'charges';
 if(/quando|vence|vencimento|que dia|qual data/.test(t))return 'due_date';
 if(/quanto|saldo|qual.*valor|valor.*parcela/.test(t))return 'balance';
 if(/pagar|pagamento|^(?:sim|pode mandar|manda|envia|enviar|pode enviar)[.!?\s]*$/.test(t))return 'payment';
 return 'summary';
}

export function generalChargesQuestion(text:string){
 const t=normalize(text);
 return /(?:como (?:funciona|funcionam|calcula|calculam|e calculad)|o que (?:e|sao|significa))/.test(t)&&/multa|juros|encargos/.test(t)
   && !/parcela\s*(?:#|numero)?\s*\d|contrato\s+[a-z0-9-]{4}/.test(t);
}

export const GENERAL_CHARGES_REPLY='Os encargos de atraso seguem as taxas, multas e limites definidos no contrato. O saldo considera esses encargos e desconta os pagamentos já registrados. Para consultar uma parcela, informe o número dela. Se discordar da cobrança, a equipe pode conferir.';
export function clarificationReply(count:number){
 return count>=2?'Não consegui entender seu pedido com segurança. Encaminhei o atendimento para a equipe, que poderá ajudar por aqui.'
   :'Você quer consultar uma parcela, receber o PIX ou falar com a equipe? Pode escrever o que precisa, sem escolher um número do menu.';
}
