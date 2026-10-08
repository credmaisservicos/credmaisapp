import {useQuery} from '@tanstack/react-query';
import {lazy,Suspense,useState} from 'react';
import {Link} from 'react-router-dom';
import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {usePaymentClassification} from '@/hooks/usePaymentClassification';
const PaymentClassificationDialog=lazy(()=>import('@/components/PaymentClassificationDialog'));

const reviewSchema=z.object({
 allocation_review_count:z.number().int().nonnegative(),
 unallocated_received_total:z.number().finite().nonnegative(),
 overallocated_received_total:z.number().finite().nonnegative(),
 installments:z.array(z.object({id:z.string(),client_id:z.string().nullable(),installment_number:z.number().nullable(),received:z.number().finite(),allocated:z.number().finite(),classified_profit:z.number().finite().optional(),recorded_profit:z.number().finite().optional()})),
});
const money=(amount:number)=>amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function PaymentAllocationNotice(){
 const {user}=useAuth();
 return user?<OwnedPaymentAllocationNotice key={user.id} owner={user.id}/>:null;
}
function OwnedPaymentAllocationNotice({owner}:{owner:string}){
 const [selected,setSelected]=useState<string|null>(null);
 const operation=usePaymentClassification(owner,()=>setSelected(null));
 return <>
  {operation.pending&&<div className="mt-3 rounded-xl border p-3 text-sm"><p>Uma classificação aguarda confirmação.</p><button type="button" className="mt-2 min-h-11 underline" onClick={()=>setSelected(operation.pending!.input.installmentId)}>Verificar classificação pendente</button></div>}
  <AllocationReview owner={owner} onSelect={setSelected}/>
  {selected&&<Suspense fallback={<p role="status">Abrindo conferência…</p>}><PaymentClassificationDialog key={selected} owner={owner} installmentId={selected} operation={operation} onClose={()=>setSelected(null)}/></Suspense>}
 </>;
}
function AllocationReview({owner,onSelect}:{owner:string;onSelect:(id:string)=>void}){
 const query=useQuery({
  queryKey:['payment-allocation-review',owner],retry:false,
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
    <div className="flex flex-wrap items-center gap-3"><button type="button" className="min-h-11 underline" onClick={()=>onSelect(row.id)}>Conferir recebimentos</button>{row.client_id&&<Link className="min-h-11 inline-flex items-center underline" to={`/clientes/${row.client_id}`}>Ver cliente</Link>}</div>
   </li>)}
  </ul>
  {data.allocation_review_count>10&&<p className="text-xs text-muted-foreground">Mostrando os primeiros 10 registros.</p>}
 </section>;
}
