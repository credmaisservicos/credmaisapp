export interface InstallmentReference {
  number?: number;
  contract?: string;
  date?: string;
  day?: number;
  order?: 'next' | 'last' | 'oldest';
  option?: number;
  context?: boolean;
  list?: boolean;
  invalid?: boolean;
}

export const PAYMENT_CONTEXT_MS = 48 * 3600_000;
const normalize = (text:string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function freshPaymentContext(setAt:unknown,now=Date.now()) {
  const age=now-new Date(String(setAt || '')).getTime();
  return Number.isFinite(age)&&age>=0&&age<PAYMENT_CONTEXT_MS;
}

/** Only interprets selection; never derives an amount from customer text. */
export function parseInstallmentReference(text:string,memory:any={},now=Date.now()):InstallmentReference|null {
  const t=normalize(text);
  if(/comprovante|paguei|transferi|depositado/.test(t))return null;
  if(/emprestimo|credito|renda|documento/.test(t))return null;
  const choices=Array.isArray(memory.installment_choice_ids)&&memory.installment_choice_ids.length>0&&freshPaymentContext(memory.installment_choice_set_at,now);
  const shortSelection=(choices||freshPaymentContext(memory.pending_payment_set_at,now))
    && /^(?:e\s+)?(?:a\s+)?(?:primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava|nona|decima(?: primeira| segunda)?|ultima|proxima)[.!?\s]*$/.test(t);
  const option=/^(?:escolher|opcao)\s+(\d{1,2})[.!]?$/i.exec(t) || (choices?/^(\d{1,2})[.)\s]*$/.exec(t):null);
  if(option)return {option:Number(option[1])};
  const contract=/contrato\s*(?:numero\s*|n[ºo]\s*|#\s*)?([a-z0-9][a-z0-9-]{3,35})\b/.exec(t)?.[1];
  const number=/(?:parcela|prestacao)\s*(?:numero\s*|n[ºo]\s*|#\s*)?(\d{1,4})\b/.exec(t)
    || /\b(\d{1,4})[ªºa]\s*(?:parcela|prestacao)\b/.exec(t)
    || /#\s*(\d{1,4})\b/.exec(t);
  let selectedNumber=number?Number(number[1]):undefined;
  const ordinals=['primeira','segunda','terceira','quarta','quinta','sexta','setima','oitava','nona','decima','decima primeira','decima segunda'];
  if(!number&&(/parcela|prestacao|pix|pagar/.test(t)||shortSelection)&&!/mais antiga|mais atrasada|primeira atrasada|(?:segunda|2[ªa])\s+via/.test(t)) {
    for(let index=ordinals.length-1;index>=0;index--)if(new RegExp(`\\b${ordinals[index]}\\b`).test(t)){selectedNumber=index+1;break;}
  }
  const fullDate=/(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  const shortDate=!fullDate?/(?:vence|vencimento|dia|parcela).*?\b(\d{1,2})\/(\d{1,2})(?!\/\d)/.exec(t):null;
  const dated=fullDate||shortDate;
  const dayOnly=!dated?/(?:vence|vencimento|parcela).*?\bdia\s+(\d{1,2})\b/.exec(t):null;
  const paymentTopic=shortSelection||/parcela|prestacao|pix|pagar|saldo|valor|vencimento|vence|multa|juros|encargos|atrasada/.test(t)
    || /^(?:e\s+)?(?:quanto(?: falta| resta)?|quando|que dia|qual data|qual vencimento)[.!?\s]*$/.test(t);
  const order=paymentTopic&&/ultima|ultimo/.test(t)?'last':paymentTopic&&/proxima|proximo/.test(t)?'next':paymentTopic&&/mais antiga|mais atrasada/.test(t)?'oldest':undefined;
  if(selectedNumber!==undefined||contract||((dated||dayOnly)&&paymentTopic)) {
    let date:string|undefined;
    let invalid=selectedNumber!==undefined&&selectedNumber<1;
    if(dated) {
      const year=fullDate?fullDate[3]:null,month=dated[2].padStart(2,'0'),day=dated[1].padStart(2,'0');
      const checkYear=year || '2000';
      const check=`${checkYear}-${month}-${day}`;
      const value=new Date(`${check}T12:00:00Z`);
      invalid ||= !Number.isFinite(value.getTime())||value.toISOString().slice(0,10)!==check;
      date=year?check:`${month}-${day}`;
    }
    if(dayOnly)invalid ||= Number(dayOnly[1])<1||Number(dayOnly[1])>31;
    return {number:selectedNumber,contract,date,day:dayOnly?Number(dayOnly[1]):undefined,invalid,order};
  }
  if(paymentTopic&&/ultima|ultimo/.test(t))return {order:'last'};
  if(paymentTopic&&/proxima|proximo/.test(t))return {order:'next'};
  if(paymentTopic&&/mais antiga|mais atrasada|primeira atrasada/.test(t))return {order:'oldest'};
  if(t==='2'&&!['loan_type','documents'].includes(memory.service_menu_stage))return {list:true};
  if(/(?:consultar|ver|quais|minhas|listar|abertas?).*parc|parcelas.*aberta|extrato|meu.?debito|em atraso|atrasadas/.test(t))return {list:true};
  if(paymentTopic||(/^(?:sim|isso|essa|esta|a mesma|pode mandar|manda|envia|enviar)[.!?\s]*$/.test(t)&&memory.pending_payment_installment_id))return {context:true};
  return null;
}

/** Rows must already be scoped to the verified owner/client and active debt. */
export function resolveInstallmentReference<T extends {id:string;contract_id:string|null;installment_number:number;due_date:string}>(
  rows:T[],reference:InstallmentReference,memory:any,today:string,now=Date.now(),
):T[] {
  if(reference.invalid)return [];
  const sorted=[...rows].sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.id.localeCompare(b.id));
  if(reference.list)return sorted;
  if(reference.option!==undefined) {
    if(!freshPaymentContext(memory.installment_choice_set_at,now))return [];
    const id=memory.installment_choice_ids?.[reference.option-1];
    return typeof id==='string'?sorted.filter(row=>row.id===id):[];
  }
  let matches=sorted.filter(row=>(reference.number===undefined||row.installment_number===reference.number)
    &&(!reference.contract||String(row.contract_id || '').toLowerCase().startsWith(reference.contract))
    &&(!reference.date||row.due_date===reference.date||row.due_date.slice(5)===reference.date)
    &&(reference.day===undefined||Number(row.due_date.slice(8,10))===reference.day));
  if(reference.order==='last') {
    const last=new Map<string|null,T>();
    for(const row of matches)if(!last.has(row.contract_id)||row.installment_number>last.get(row.contract_id)!.installment_number)last.set(row.contract_id,row);
    return [...last.values()];
  }
  if(reference.order==='next'||reference.order==='oldest') {
    matches=matches.filter(row=>reference.order==='next'?row.due_date>=today:row.due_date<today);
    return matches.filter(row=>row.due_date===matches[0]?.due_date);
  }
  if(reference.context&&memory.pending_payment_installment_id) {
    if(!freshPaymentContext(memory.pending_payment_set_at,now))return [];
    return matches.filter(row=>row.id===memory.pending_payment_installment_id);
  }
  return matches;
}
