/** Accept Brazilian grouping and either decimal separator, without guessing invalid input. */
export function parsePaymentAmount(value: unknown): number | null {
  const raw = String(value ?? '').trim().replace(/^R\$\s*/i, '');
  let normalized: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw)) normalized=raw.replace(/\./g,'').replace(',','.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(raw)) normalized=raw.replace(',','.');
  else return null;
  const amount=Number(normalized),cents=Math.round(amount*100);
  return Number.isFinite(amount) && Number.isSafeInteger(cents) ? cents/100 : null;
}

export function extractPaymentAmount(text: string): number | null {
  const currency=/r\$\s*(\d[\d.,]*\d|\d)/i.exec(text || '');
  const match=currency || /(?:pagar(?:\s+s[oó])?\s+|pago\s+|consigo\s+(?:pagar|dar)\s+)(\d[\d.,]*\d|\d)/i.exec(text || '');
  if(match&&!currency&&/^(?:[/-]\d|[ªºa]|\s*(?:parcelas?|presta[cç][aã]o|presta[cç][oõ]es)\b)/i.test(text.slice(match.index+match[0].length)))return null;
  const amount=match ? parsePaymentAmount(match[1]) : null;
  return amount!=null && amount>0 ? amount : null;
}

/** Calendar arithmetic is independent of the server's timezone and time of day. */
export function parsePaymentDate(text: string, now=new Date()): string | null {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const part=(type:string)=>parts.find(p=>p.type===type)!.value;
  const today=`${part('year')}-${part('month')}-${part('day')}`;
  const base=new Date(`${today}T12:00:00Z`);
  const normalized=String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const explicit=/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/.exec(normalized);
  const iso=/\b(\d{4})-(\d{2})-(\d{2})\b/.exec(normalized);
  const calendar=(year:number,month:number,day:number)=>{
    const value=new Date(Date.UTC(year,month-1,day,12));
    if(value.getUTCFullYear()!==year || value.getUTCMonth()!==month-1 || value.getUTCDate()!==day)return null;
    const date=value.toISOString().slice(0,10);return date>=today?date:null;
  };
  if(iso)return calendar(Number(iso[1]),Number(iso[2]),Number(iso[3]));
  if(explicit)return calendar(Number(explicit[3] || base.getUTCFullYear()),Number(explicit[2]),Number(explicit[1]));
  if(/\bhoje\b/.test(normalized))return today;
  if(/\bamanha\b/.test(normalized))base.setUTCDate(base.getUTCDate()+1);
  else if(/\bsemana que vem\b|\bproxima semana\b/.test(normalized))base.setUTCDate(base.getUTCDate()+7);
  else {
    const weekdays:Record<string,number>={domingo:0,segunda:1,terca:2,quarta:3,quinta:4,sexta:5,sabado:6};
    const dayName=Object.keys(weekdays).find(day=>new RegExp(`\\b${day}(?:-feira)?\\b`).test(normalized));
    if(dayName){let delta=(weekdays[dayName]-base.getUTCDay()+7)%7;if(delta===0 && /\bproxim[ao]\b/.test(normalized))delta=7;base.setUTCDate(base.getUTCDate()+delta);}
    else {
      const dayMatch=/\bdia\s+(\d{1,2})\b/.exec(normalized);if(!dayMatch)return null;
      const day=Number(dayMatch[1]);let month=base.getUTCMonth()+1,year=base.getUTCFullYear();
      if(day<base.getUTCDate()){month++;if(month===13){month=1;year++;}}
      return calendar(year,month,day);
    }
  }
  return base.toISOString().slice(0,10);
}
