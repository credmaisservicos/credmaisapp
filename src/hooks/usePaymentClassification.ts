import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useToast} from '@/hooks/use-toast';
import {loadClassificationDraft,prepareClassificationDraft,clearClassificationDraft,classificationRpcArgs,parseClassificationResult,
 classificationInputSchema,type ClassificationInput,type ClassificationDraft} from '@/lib/paymentClassification';

export function usePaymentClassification(owner:string,onApplied:()=>void){
 const qc=useQueryClient(),{toast}=useToast();
 const [pending,setPending]=useState<ClassificationDraft|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[storageError,setStorageError]=useState(false);
 const active=useRef(owner),running=useRef(false),applied=useRef(onApplied);active.current=owner;applied.current=onApplied;
 useEffect(()=>{
  let alive=true;active.current=owner;setPending(null);setReady(false);setStorageError(false);setBusy(false);
  void loadClassificationDraft(owner).then(value=>{if(alive)setPending(value);}).catch(()=>{if(alive)setStorageError(true);}).finally(()=>{if(alive)setReady(true);});
  return ()=>{alive=false;active.current='';};
 },[owner]);
 const run=async(input?:ClassificationInput,cancel=false)=>{
  if(!ready||running.current||!owner)return;
  if(input&&!classificationInputSchema.safeParse(input).success)return;
  const id=owner;running.current=true;setBusy(true);let draft:ClassificationDraft|null=null,sent=false;
  try{
   if(input){const prepared=await prepareClassificationDraft(id,input);draft=prepared.draft;
    if(active.current===id)setPending(draft);
    if(!prepared.created)throw Error('classification_pending');
   }else draft=await loadClassificationDraft(id);
   if(!draft||active.current!==id)return;
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
   let value:unknown;
   try{
    sent=true;const response=cancel
     ?await supabase.rpc('cancel_payment_classification',{_request_id:draft.id,_expected_owner:id}).abortSignal(controller.signal)
     :await supabase.rpc('reclassify_payment_receipt',classificationRpcArgs(draft)).abortSignal(controller.signal);
    if(response.error)throw response.error;value=response.data;
   }finally{clearTimeout(timer);}
   const result=parseClassificationResult(value,draft,cancel);
   await clearClassificationDraft(draft);
   if(active.current!==id)return;
   setPending(null);setStorageError(false);
   toast({title:result.applied?'Classificação confirmada':'Tentativa encerrada',description:result.applied?'Valor e data do recebimento preservados.':'Este envio não alterou a classificação. Você pode revisar os dados.'});
   applied.current();
  }catch(error){
   if(active.current!==id)return;
   const message=(error as {message?:string})?.message;
   if(!sent&&message!=='classification_pending')setStorageError(true);
   toast({title:sent?'Classificação ainda não confirmada':message==='classification_pending'?'Há uma tentativa pendente':'Classificação não enviada',
    description:message==='classification_changed'?'Os dados mudaram. Encerre a tentativa pendente e abra uma nova conferência.':sent||message==='classification_pending'
     ?'Verifique a tentativa anterior ou encerre o envio antes de editar. O encerramento confirma se ela já foi aplicada.'
     :'Permita o armazenamento do navegador para guardar a tentativa com segurança.',variant:'destructive'});
  }finally{
   if(sent)for(const key of [['payment-classification',id],['payment-allocation-review',id],['carteira-cash-report',id],['financial-analytics',id],['dashboard-data'],['hoje',id],['analises-data',id]])void qc.invalidateQueries({queryKey:key});
   if(sent)void qc.invalidateQueries({predicate:query=>['client-installments','client-transactions','client-profits'].includes(String(query.queryKey[0]))&&query.queryKey[2]===id});
   running.current=false;if(active.current===id)setBusy(false);
  }
 };
 return {pending,busy,ready,storageError,run,cancel:()=>run(undefined,true)};
}
