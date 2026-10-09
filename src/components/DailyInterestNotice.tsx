import {dailyRateOf} from '@/lib/lateFee';

/** Describe the existing calculation without changing any contract or debt. */
export function DailyInterestNotice({value,id}:{value?:number|string|null;id?:string}) {
 const rate=dailyRateOf({amount:0,due_date:null,daily_interest_percent:value});
 const label=rate.toLocaleString('pt-BR',{maximumFractionDigits:8});
 const fallback=!Number.isFinite(Number(value))||Number(value||0)===0;
 return <p id={id} role="note" className="mt-2 text-xs text-muted-foreground">
  {fallback
   ?`Na regra atual, 0 ou vazio usa ${label}% de juros ao dia. Isso não desativa os juros de atraso. A multa configurada é adicional.`
   :`Juros de atraso usados no cálculo: ${label}% ao dia, compostos, além da multa configurada.`}
 </p>;
}
