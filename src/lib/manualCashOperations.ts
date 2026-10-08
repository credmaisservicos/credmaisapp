import {createStore,get,update,promisifyRequest} from 'idb-keyval';
import {z} from 'zod';
import type {Json} from '@/integrations/supabase/types';
export const manualCashInputSchema=z.object({
 operation:z.enum(['capital_injection','capital_withdrawal','expense_create','expense_update','expense_delete','capital_delete']),
 amount:z.number().finite().positive().max(90071992547409.91).refine(v=>v===Number(v.toFixed(2))).nullable().default(null),
 description:z.string().trim().min(1).max(500).nullable().default(null),
 date:z.string().datetime({offset:true}).nullable().default(null),category:z.string().trim().max(100).nullable().default(null),
 entryId:z.string().uuid().nullable().default(null),expected:z.record(z.unknown()).nullable().default(null),
});
export type ManualCashInput=z.input<typeof manualCashInputSchema>;
const draftSchema=z.object({id:z.string().uuid(),ownerId:z.string().uuid(),input:manualCashInputSchema,createdAt:z.string().datetime()});
export type ManualCashDraft=z.infer<typeof draftSchema>;
const resultSchema=z.object({ok:z.literal(true),entry_id:z.string().uuid(),operation:manualCashInputSchema.shape.operation,
 replayed:z.boolean(),current_state:z.enum(['applied','changed','deleted'])});
export type ManualCashResult=z.infer<typeof resultSchema>;
const store=createStore('credmais-manual-cash','pending');
function parseDraft(value:unknown,owner:string){const draft=draftSchema.parse(value);if(draft.ownerId!==owner)throw Error('manual_cash_owner_mismatch');return draft;}
export async function loadManualCashDraft(owner:string):Promise<ManualCashDraft|null>{
 const value=await get(owner,store);return value===undefined?null:parseDraft(value,owner);
}
export async function prepareManualCashDraft(owner:string,input:ManualCashInput){
 const candidate=draftSchema.parse({id:crypto.randomUUID(),ownerId:owner,input,createdAt:new Date().toISOString()});
 let chosen=candidate;
 // IndexedDB read/write transactions serialize preparations across tabs.
 await update(owner,(value:unknown)=>{if(value!==undefined)chosen=parseDraft(value,owner);return chosen;},store);
 return {draft:chosen,created:chosen.id===candidate.id};
}
export async function clearManualCashDraft(draft:ManualCashDraft){
 await store('readwrite',objectStore=>{
  const request=objectStore.get(draft.ownerId);
  request.onsuccess=()=>{try{if(request.result!==undefined&&parseDraft(request.result,draft.ownerId).id===draft.id)objectStore.delete(draft.ownerId);}catch{objectStore.transaction.abort();}};
  return promisifyRequest(objectStore.transaction);
 });
}
export function manualCashRpcArgs(draft:ManualCashDraft){
 const i=draft.input;
 return {_request_id:draft.id,_expected_owner:draft.ownerId,_operation:i.operation,_amount:i.amount,
  _description:i.description,_date:i.date,_category:i.category||null,_entry_id:i.entryId,_expected:i.expected as Json};
}
export function parseManualCashResult(value:unknown,draft:ManualCashDraft){
 const result=resultSchema.parse(value);if(result.operation!==draft.input.operation)throw Error('manual_cash_response_mismatch');return result;
}
export function parseManualCashCancellation(value:unknown,draft:ManualCashDraft){
 const cancelled=z.object({ok:z.literal(true),cancelled:z.literal(true)}).safeParse(value);
 if(cancelled.success)return null;
 z.object({cancelled:z.literal(false)}).parse(value);return parseManualCashResult(value,draft);
}
// Definitive failures can be settled only by the server's cancellation gate:
// a rejected retry alone does not disprove a previously committed attempt.
export function manualCashDefinitelyRejected(error:unknown){
 const code=(error as {code?:string})?.code;
 return ['22023','22003','22P02','42501','P0002','40001','23514','23503','23502'].includes(code||'');
}
