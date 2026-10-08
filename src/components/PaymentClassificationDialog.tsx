import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {classificationDetailSchema,classificationInputSchema,parseClassificationAmount} from '@/lib/paymentClassification';
import type {usePaymentClassification} from '@/hooks/usePaymentClassification';
type Operation=ReturnType<typeof usePaymentClassification>;
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const number=(value:number)=>value.toFixed(2).replace('.',',');
export default function PaymentClassificationDialog({owner,installmentId,operation,onClose}:{owner:string;installmentId:string;operation:Operation;onClose:()=>void}){
 const query=useQuery({queryKey:['payment-classification',owner,installmentId],retry:false,queryFn:async({signal})=>{
  const controller=new AbortController(),cancel=()=>controller.abort();
  if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,10_000);
  try{
   const {data,error}=await supabase.rpc('payment_classification_detail',{_installment_id:installmentId}).abortSignal(controller.signal);
   if(error)throw error;const result=classificationDetailSchema.parse(data);
   if(result.installment.id!==installmentId)throw Error('classification_response_mismatch');return result;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
 }});
 const [transactionId,setTransactionId]=useState(''),[reviewedVersion,setReviewedVersion]=useState(''),[principal,setPrincipal]=useState('0,00'),[interest,setInterest]=useState('0,00'),[fees,setFees]=useState('0,00');
 const [reason,setReason]=useState(''),[evidence,setEvidence]=useState(''),[confirmed,setConfirmed]=useState(false);
 const data=query.data,receipt=data?.transactions.find(row=>row.id===transactionId);
 const amounts=[principal,interest,fees].map(parseClassificationAmount);
 const sum=amounts.every(v=>v!==null)?amounts.reduce<number>((total,v)=>total+Math.round(v!*100),0):null;
 const changed=!!transactionId&&!!data&&reviewedVersion!==data.version;
 const input=data&&receipt?classificationInputSchema.safeParse({installmentId,transactionId,version:reviewedVersion,
  principal:amounts[0],interest:amounts[1],fees:amounts[2],reason,evidence,confirmed}):null;
 const pending=operation.pending,locked=operation.busy||!!pending;
 const choose=(id:string)=>{
  setTransactionId(id);setReviewedVersion(data?.version||'');setConfirmed(false);const row=data?.transactions.find(item=>item.id===id);
  if(row){setPrincipal(number(row.principal));setInterest(number(row.interest));setFees(number(row.fees));}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!operation.busy)onClose();}}><DialogContent className="sm:max-w-xl">
  <DialogHeader><DialogTitle>Conferir recebimentos</DialogTitle><DialogDescription>Confira o extrato ou comprovante antes de dividir o valor recebido entre capital, juros e encargos.</DialogDescription></DialogHeader>
  {pending?<div className="space-y-3">
   <p role="status">Existe uma tentativa pendente. Verifique o resultado antes de editar a classificação.</p>
   <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Capital</dt><dd>{money(pending.input.principal)}</dd><dt>Juros</dt><dd>{money(pending.input.interest)}</dd><dt>Encargos</dt><dd>{money(pending.input.fees)}</dd></dl>
   <p className="text-sm break-words">Documento: {pending.input.evidence}</p>
   <div className="flex flex-col gap-2 sm:flex-row"><Button disabled={operation.busy} onClick={()=>void operation.run()}>Verificar e concluir</Button><Button variant="outline" disabled={operation.busy} onClick={()=>void operation.cancel()}>Encerrar tentativa</Button></div>
   <p className="text-xs text-muted-foreground">Encerrar confirma se o envio anterior foi aplicado e bloqueia uma tentativa que ainda não chegou ao servidor.</p>
  </div>:query.isPending?<p role="status">Carregando recebimentos…</p>:query.error?<div role="alert"><p>Não foi possível carregar os recebimentos.</p><Button variant="outline" onClick={()=>void query.refetch()}>Carregar novamente</Button></div>:data&&<>
   <p className="text-sm">Total registrado na parcela: <strong>{money(data.installment.paid_amount)}</strong></p>
   {!data.can_reconcile?<p role="alert" className="rounded-lg border p-3 text-sm">O total dos lançamentos não corresponde ao recebido na parcela. Confira o extrato e os eventos de caixa antes de classificar. Nenhum recebimento será criado por esta conferência.</p>:<form className="space-y-4" onSubmit={event=>{event.preventDefault();if(!changed&&input?.success&&sum===Math.round(receipt!.amount*100))void operation.run(input.data);}}>
    <div className="space-y-2"><Label htmlFor="classification-receipt">Recebimento</Label><select id="classification-receipt" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={transactionId} disabled={locked} onChange={event=>choose(event.target.value)}><option value="">Selecione o lançamento</option>{data.transactions.map(row=><option key={row.id} value={row.id}>{money(row.amount)} · {new Date(row.date).toLocaleDateString('pt-BR')}</option>)}</select></div>
    {receipt&&<p className="text-sm">Valor recebido: <strong>{money(receipt.amount)}</strong>. Valor e data serão preservados.</p>}
    {changed&&<div role="alert" className="space-y-2 rounded-lg border p-3 text-sm"><p>Os recebimentos mudaram durante a conferência. Atualize os valores e confirme o documento novamente.</p><Button type="button" variant="outline" onClick={()=>choose(transactionId)} disabled={locked}>Atualizar conferência</Button></div>}
    <div className="grid gap-3 sm:grid-cols-3">{([['Capital',principal,setPrincipal],['Juros',interest,setInterest],['Encargos',fees,setFees]] as const).map(([label,value,setValue],index)=><div key={label} className="space-y-2"><Label htmlFor={`classification-amount-${index}`}>{label}</Label><Input id={`classification-amount-${index}`} inputMode="decimal" value={value} disabled={locked||!receipt} onChange={event=>{setValue(event.target.value);setConfirmed(false);}}/></div>)}</div>
    {receipt&&<p role="status" className="text-sm">{sum===null?'Informe valores com até duas casas decimais.':`Total classificado: ${money(sum/100)}${sum!==Math.round(receipt.amount*100)?' — deve ser igual ao recebimento.':''}`}</p>}
    <div className="space-y-2"><Label htmlFor="classification-reason">Motivo da correção</Label><Input id="classification-reason" maxLength={1000} value={reason} disabled={locked} onChange={event=>{setReason(event.target.value);setConfirmed(false);}} placeholder="Descreva a conferência realizada"/></div>
    <div className="space-y-2"><Label htmlFor="classification-evidence">Referência do extrato ou comprovante</Label><Input id="classification-evidence" maxLength={1000} value={evidence} disabled={locked} onChange={event=>{setEvidence(event.target.value);setConfirmed(false);}} placeholder="Documento, identificação e data"/></div>
    <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-foreground" checked={confirmed} disabled={locked} onChange={event=>setConfirmed(event.target.checked)}/><span>Conferi o documento e confirmo esta composição do recebimento.</span></label>
    {operation.storageError&&<p role="alert" className="text-sm">Permita o armazenamento do navegador para preservar o envio em caso de falha de conexão.</p>}
    <Button type="submit" className="w-full sm:w-auto" disabled={locked||changed||!operation.ready||!input?.success||!receipt||sum!==Math.round(receipt.amount*100)}>Salvar classificação</Button>
   </form>}
   {data.history.length>0&&<details className="border-t pt-3 text-sm"><summary className="cursor-pointer min-h-11">Histórico da conferência</summary><ul className="space-y-3">{data.history.map(row=><li key={row.request_id} className="break-words"><p>{new Date(row.created_at).toLocaleString('pt-BR')}</p><p>{row.reason}</p><p className="text-muted-foreground">Documento: {row.evidence}</p></li>)}</ul></details>}
  </>}
 </DialogContent></Dialog>;
}
