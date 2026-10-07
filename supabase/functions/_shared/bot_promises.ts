import {parsePaymentDate,extractPaymentAmount} from './payment_input.ts';
const normalize=(text:string)=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function promiseRequest(text:string,now=new Date()){
  const t=normalize(text);
  if(/cancelar|desmarcar|esquecer/.test(t)&&/promessa|previsao/.test(t))return {kind:/\bnao\b|\?|\btalvez\b/.test(t)?'human' as const:'cancel' as const,date:null,amount:null};
  if(/cancelar|estornar/.test(t)&&/pagamento|pix|transferencia/.test(t))return {kind:'human' as const,date:null,amount:null};
  if(/(?:qual|como|quando).*(?:previsao|promessa)|(?:previsao|promessa).*(?:registrada|salva|status)/.test(t))return {kind:'status' as const,date:null,amount:null};
  const payment=/\b(?:vou pagar|pagarei|pago|vou depositar|vou transferir|consigo pagar|posso pagar)\b/.exec(t);
  const changing=/\b(?:corrigir|nova previsao|na verdade|previsao.*(?:mudar|alterar)|(?:mudar|alterar).*previsao)\b/.test(t);
  if(!payment&&(!changing||!/previsao|promessa/.test(t)))return null;
  if(/\bnao\b.*(?:pagar|pago|pagarei|depositar|transferir)|\b(?:posso|poderia|se|talvez)\b|acho que|sera que|\?/.test(t))return {kind:'human' as const,date:null,amount:null};
  const portion=(payment?t.slice(payment.index+payment[0].length):t)
    .replace(/\b(?:primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima)\s+parcela\b/g,' ');
  const token=/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|hoje|amanha|semana que vem|proxima semana|(?:proxim[ao]\s+)?(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?|dia\s+\d{1,2})\b/.exec(portion);
  const due=/vence|vencimento|vencida/.exec(portion);
  return {kind:changing?'change' as const:'register' as const,date:token&&(!due||due.index>token.index)?parsePaymentDate(token[0],now):null,amount:extractPaymentAmount(text)};
}

export function claimsSavedPromise(text:string){
  const t=normalize(text);
  return /(?:registrei|registrad[oa]|atualizei|atualizad[oa]|cancelei|cancelad[oa]).*(?:previsao|promessa)|(?:previsao|promessa).*(?:registrad[oa]|salv[oa]|atualizad[oa]|cancelad[oa])/.test(t);
}

/** Payment calendar words must not be mistaken for ordinal installment numbers. */
export function forecastInstallmentText(text:string){
 return normalize(text).replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{4})?|dia\s+\d{1,2})\b/g,' ')
   .replace(/\b(?:proxim[ao]\s+)?(?:domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b(?!\s+(?:parcela|prestacao))/g,' ');
}
