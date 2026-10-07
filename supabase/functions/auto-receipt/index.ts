import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { getCallerUser } from "../_shared/guard.ts";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const uuid=(value:unknown)=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='POST')return response({error:'method_not_allowed'},405);
  const user=await getCallerUser(req);
  if(!user)return response({error:'unauthorized'},401);
  try{
    const body=await req.json().catch(()=>null);
    if(!uuid(body?.transaction_id))return response({error:'transaction_id_required',message:'Selecione o recebimento registrado para solicitar a confirmação.'},400);
    // Forward the JWT: the database derives ownership itself.
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
      global:{headers:{Authorization:req.headers.get('Authorization')!}},
    });
    const {data,error}=await db.rpc('request_payment_receipt',{_transaction_id:body.transaction_id});
    if(error)return response({error:error.code==='P0002'?'payment_not_found':'receipt_queue_unavailable'},error.code==='P0002'?404:503);
    if(!data || typeof data.queued!=='boolean')return response({error:'receipt_queue_unavailable'},503);
    const sent=data.status==='sent';
    const message=sent?'Confirmação já aceita pelo provedor.':data.status==='uncertain'?'Entrega incerta. Confira o WhatsApp antes de qualquer novo envio.':
      ['failed','cancelled'].includes(data.status)?'Confirmação não será reenviada automaticamente.':data.queued?'Confirmação na fila de atendimento.':'Confirmação não agendada.';
    return response({...data,sent,message});
  }catch{return response({error:'receipt_queue_unavailable'},503);}
});
