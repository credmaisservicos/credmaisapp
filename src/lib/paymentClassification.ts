import {createStore,get,update,promisifyRequest} from 'idb-keyval';
import {z} from 'zod';

const amount=z.number().finite().nonnegative().max(1e12).refine(v=>v===Number(v.toFixed(2)));
export const classificationInputSchema=z.object({
 installmentId:z.string().uuid(),transactionId:z.string().uuid(),version:z.string().regex(/^[a-f0-9]{32}$/),
 principal:amount,interest:amount,fees:amount,reason:z.string().trim().min(10).max(1000),
 evidence:z.string().trim().min(8).max(1000),confirmed:z.literal(true),
});
export type ClassificationInput=z.infer<typeof classificationInputSchema>;
const draftSchema=z.object({id:z.string().uuid(),ownerId:z.string().uuid(),input:classificationInputSchema});
export type ClassificationDraft=z.infer<typeof draftSchema>;
const store=createStore('credmais-payment-classification','pending');
const parseDraft=(value:unknown,owner:string)=>{
 const draft=draftSchema.parse(value);if(draft.ownerId!==owner)throw Error('classification_owner_mismatch');return draft;
};
export async function loadClassificationDraft(owner:string){
 const value=await get(owner,store);return value===undefined?null:parseDraft(value,owner);
}
export async function prepareClassificationDraft(owner:string,input:ClassificationInput){
 const candidate=draftSchema.parse({id:crypto.randomUUID(),ownerId:owner,input});let chosen=candidate;
 await update(owner,(value:unknown)=>{if(value!==undefined)chosen=parseDraft(value,owner);return chosen;},store);
 return {draft:chosen,created:chosen.id===candidate.id};
}
export async function clearClassificationDraft(draft:ClassificationDraft){
 await store('readwrite',objectStore=>{
  const request=objectStore.get(draft.ownerId);
  request.onsuccess=()=>{try{if(request.result!==undefined&&parseDraft(request.result,draft.ownerId).id===draft.id)objectStore.delete(draft.ownerId);}catch{objectStore.transaction.abort();}};
  return promisifyRequest(objectStore.transaction);
 });
}
export function classificationRpcArgs(draft:ClassificationDraft){
 const i=draft.input;return {_request_id:draft.id,_expected_owner:draft.ownerId,_transaction_id:i.transactionId,
  _expected_version:i.version,_principal:i.principal,_interest:i.interest,_fees:i.fees,_reason:i.reason,_evidence:i.evidence,_confirmed:i.confirmed};
}
export function parseClassificationResult(value:unknown,draft:ClassificationDraft,cancel=false){
 const result=z.object({ok:z.literal(true),request_id:z.string().uuid(),cancelled:z.boolean().optional(),replayed:z.boolean().optional()}).parse(value);
 if(result.request_id!==draft.id||(cancel?typeof result.cancelled!=='boolean':typeof result.replayed!=='boolean'))throw Error('classification_response_mismatch');
 return {applied:result.cancelled!==true};
}
export function parseClassificationAmount(value:string):number|null{
 const text=value.trim();
 if(text.includes(',')){
  if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(text))return null;
 }else if(!/^\d+(?:\.\d{1,2})?$/.test(text))return null;
 const result=Number(text.includes(',')?text.replaceAll('.','').replace(',','.'):text);
 return amount.safeParse(result).success?result:null;
}
export const classificationDetailSchema=z.object({
 version:z.string().regex(/^[a-f0-9]{32}$/),can_reconcile:z.boolean(),
 installment:z.object({id:z.string().uuid(),paid_amount:amount}),
 transactions:z.array(z.object({id:z.string().uuid(),amount:amount,date:z.string(),principal:amount,interest:amount,fees:amount,unallocated:amount})),
 history:z.array(z.object({request_id:z.string().uuid(),transaction_id:z.string().uuid(),reason:z.string(),evidence:z.string(),created_at:z.string()})),
});
