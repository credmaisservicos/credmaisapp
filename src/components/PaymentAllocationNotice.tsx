import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';

const reviewSchema=z.object({
 allocation_review_count:z.number().int().nonnegative(),
 unallocated_received_total:z.number().finite().nonnegative(),
 overallocated_received_total:z.number().finite().nonnegative(),
 installments:z.array(z.object({id:z.string(),client_id:z.string().nullable(),installment_number:z.number().nullable(),received:z.number().finite(),allocated:z.number().finite(),classified_profit:z.number().finite().optional(),recorded_profit:z.number().finite().optional()})),
});
const money=(amount:number)=>amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function PaymentAllocationNotice(){
 const {user}=useAuth();
 const query=useQuery({
  queryKey:['payment-allocation-review',user?.id],enabled:!!user, retry:false,
  queryFn:async({signal})=>{
   const controller=new AbortController();const cancel=()=>controller.abort();
   if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(cancel,10_000);
   try{
    const {data,error}=await supabase.rpc('payment_allocation_review').abortSignal(controller.signal);
    if(error)throw error;
    return reviewSchema.parse(data);
   }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  },
 });
 if(!user)return null;
 if(query.isPending)return <p role="status" className="mt-3 text-xs text-muted-foreground">Conferindo a classificação dos recebimentos…</p>;
 if(query.error)return <div role="alert" className="mt-3 rounded-xl border border-border p-3 text-sm"><p>Não foi possível conferir a classificação dos recebimentos.</p><button type="button" className="mt-2 underline" onClick={()=>void query.refetch()}>Conferir novamente</button></div>;
 if(!query.data?.allocation_review_count)return null;
 const data=query.data;
 return <section aria-label="Conferência dos recebimentos" className="mt-3 rounded-xl border border-border bg-background/35 p-3 text-sm space-y-2">
  <p className="font-semibold">{data.allocation_review_count} parcela(s) com recebimentos para revisar</p>
  <p className="text-muted-foreground">Os valores recebidos estão preservados. A divisão entre capital, juros e encargos precisa de conferência humana; os totais de capital e lucro dependem dessa revisão.</p>
  {data.unallocated_received_total>0&&<p>Sem classificação: {money(data.unallocated_received_total)}</p>}
  {data.overallocated_received_total>0&&<p>Classificação acima do recebido: {money(data.overallocated_received_total)}</p>}
  <ul className="space-y-1">
   {data.installments.slice(0,10).map(row=><li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
    <div><span>Parcela {row.installment_number??'—'} · recebido {money(row.received)}</span>
     {row.classified_profit!==undefined&&row.recorded_profit!==undefined&&row.classified_profit!==row.recorded_profit&&<p className="text-xs text-muted-foreground">Lucro registrado: {money(row.recorded_profit)} · composição registrada: {money(row.classified_profit)}</p>}
    </div>
    {row.client_id&&<Link className="underline" to={`/clientes/${row.client_id}`}>Ver cliente</Link>}
   </li>)}
  </ul>
  {data.allocation_review_count>10&&<p className="text-xs text-muted-foreground">Mostrando os primeiros 10 registros.</p>}
 </section>;
}
