import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useToast} from '@/hooks/use-toast';
import {loadManualCashDraft,prepareManualCashDraft,clearManualCashDraft,manualCashRpcArgs,parseManualCashResult,parseManualCashCancellation,manualCashDefinitelyRejected,manualCashInputSchema,
 type ManualCashInput,type ManualCashDraft,type ManualCashResult} from '@/lib/manualCashOperations';
const titles={capital_injection:'Aporte registrado',capital_withdrawal:'Retirada registrada',expense_create:'Gasto registrado',expense_update:'Gasto atualizado',expense_delete:'Gasto excluído',capital_delete:'Lançamento removido'};
export function useManualCashOperation(owner:string|undefined,onApplied:()=>void){
 const qc=useQueryClient(),{toast}=useToast();
 const [pending,setPending]=useState<ManualCashDraft|null>(null),[busy,setBusy]=useState(false),[ready,setReady]=useState(false),[storageError,setStorageError]=useState(false);
 const active=useRef(owner),running=useRef(false),applied=useRef(onApplied);active.current=owner;applied.current=onApplied;
 useEffect(()=>{
  let alive=true;setPending(null);setReady(false);setStorageError(false);setBusy(false);
  if(!owner)return;
  void loadManualCashDraft(owner).then(draft=>{if(alive)setPending(draft);}).catch(()=>{if(alive)setStorageError(true);}).finally(()=>{if(alive)setReady(true);});
  return ()=>{alive=false;};
 },[owner]);
 const invalidate=(id:string)=>{
  for(const key of [['carteira-cash-report',id],['gastos-data',id],['dashboard-data'],['hoje',id],['analises-data',id],['financial-analytics',id],['payment-allocation-review',id]])void qc.invalidateQueries({queryKey:key});
 };
 const settle=async(draft:ManualCashDraft,result:ManualCashResult|null)=>{
  await clearManualCashDraft(draft);
  if(active.current!==draft.ownerId)return;
  setPending(null);setStorageError(false);
  if(!result){toast({title:'Tentativa encerrada',description:'Este envio não criou um lançamento. Você pode revisar os dados.'});return;}
  applied.current();
  const changed=result.current_state==='changed'||(result.current_state==='deleted'&&!['expense_delete','capital_delete'].includes(result.operation));
  toast(changed?{title:'Tentativa anterior confirmada',description:'O lançamento foi alterado ou removido depois. Confira o histórico; nenhum novo lançamento foi criado.'}:{title:titles[result.operation]});
 };
 const cancelDraft=async(draft:ManualCashDraft)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{const {data,error}=await supabase.rpc('cancel_manual_cash_operation',{_request_id:draft.id,_expected_owner:draft.ownerId}).abortSignal(controller.signal);
   if(error)throw error;return parseManualCashCancellation(data,draft);
  }finally{clearTimeout(timer);}
 };
 const run=async(input?:ManualCashInput,cancel=false):Promise<ManualCashResult|null>=>{
  if(!owner||!ready||running.current)return null;
  if(input&&!manualCashInputSchema.safeParse(input).success){toast({title:'Dados inválidos',description:'Confira a data, a descrição e o valor com até duas casas decimais.',variant:'destructive'});return null;}
  const id=owner;running.current=true;setBusy(true);let draft:ManualCashDraft|null=null,sent=false;
  try{
   if(input){const prepared=await prepareManualCashDraft(id,input);draft=prepared.draft;
    if(active.current===id)setPending(draft);
    if(!prepared.created){if(active.current===id)toast({title:'Há uma tentativa pendente',description:'Verifique e conclua a tentativa anterior antes de registrar outra.',variant:'destructive'});return null;}
   }else draft=await loadManualCashDraft(id);
   if(!draft){if(active.current===id)setPending(null);return null;}
   if(active.current!==id)return null;
   if(cancel){sent=true;const result=await cancelDraft(draft);await settle(draft,result);return result;}
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
   let value:unknown;
   try{sent=true;const {data,error}=await supabase.rpc('apply_manual_cash_operation',manualCashRpcArgs(draft)).abortSignal(controller.signal);if(error)throw error;value=data;}finally{clearTimeout(timer);}
   const result=parseManualCashResult(value,draft);
   await settle(draft,result);
   return result;
  }catch(error){
   const rejected=sent&&(manualCashDefinitelyRejected(error)||(error as {message?:string})?.message==='manual_cash_cancelled');
   if(rejected&&draft){
    try{
     const result=await cancelDraft(draft);await settle(draft,result);
     if(!result&&active.current===id)toast({title:'Lançamento não aplicado',description:(error as {message?:string})?.message==='manual_cash_changed'?'O gasto mudou desde que foi aberto. Atualize a lista e revise os dados.':'Confira os dados antes de tentar novamente.',variant:'destructive'});
     return result;
    }catch{ /* Keep the original intent if cancellation is unconfirmed. */ }
   }
   if(active.current===id){
    if(!sent){setStorageError(true);toast({title:'Lançamento não enviado',description:'Não foi possível guardar a tentativa com segurança. Permita o armazenamento do navegador e tente novamente.',variant:'destructive'});}
    else toast({title:'Não foi possível confirmar o lançamento',description:'A tentativa foi preservada. Use “Verificar e concluir” antes de registrar outro lançamento.',variant:'destructive'});
   }
   return null;
  }finally{if(sent)invalidate(id);running.current=false;if(active.current===id)setBusy(false);}
 };
 return {pending,busy,ready,storageError,run,cancel:()=>run(undefined,true)};
}
