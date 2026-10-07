import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCallerUser } from "../_shared/guard.ts";
import { consume } from "../_shared/rate_limit.ts";
import { queueBotMessage, deliverBotJob } from "../_shared/bot_delivery.ts";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Content-Type":"application/json"};
const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers});
  const user=await getCallerUser(req);
  if(!user)return response({error:"unauthorized"},401);
  try{
    const rate=await consume({key:`whatsapp-send:${user.id}`,capacity:30,refillPerSec:0.5});
    if(!rate.allowed)return response({error:"rate_limited"},429);
    const body=await req.json().catch(()=>null);
    if(!body?.conversation_id)return response({error:"missing_conversation"},400);
    const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:convo,error:ce}=await supabase.from("whatsapp_conversations").select("*").eq("id",body.conversation_id).eq("user_id",user.id).single();
    if(ce||!convo)return response({error:"conversation_not_found"},404);
    if(body.action==="mark_resolved"){
      const {error}=await supabase.from("whatsapp_conversations").update({needs_human:false,unread_count:0,updated_at:new Date().toISOString()}).eq("id",convo.id).eq("user_id",user.id);
      if(error)throw Error("resolve_persist_failed");return response({ok:true,resolved:true});
    }
    if(convo.blocked)return response({error:"conversation_blocked"},409);
    if(["approve_job","reject_job"].includes(body.action)){
      const {data:job,error}=await supabase.from("whatsapp_scheduled_messages").select("*").eq("id",body.job_id).eq("user_id",user.id).eq("conversation_id",convo.id).single();
      if(error||!job)return response({error:"job_not_found"},404);
      if(job.status!=="awaiting_approval")return response({error:"job_not_awaiting_approval"},409);
      const {error:ue}=await supabase.from("whatsapp_scheduled_messages").update({status:body.action==="approve_job"?"pending":"cancelled",approved_by:body.action==="approve_job"?user.id:null,error:body.action==="reject_job"?"operator_rejected":null,scheduled_for:new Date().toISOString()}).eq("id",job.id).eq("user_id",user.id).eq("status","awaiting_approval");
      if(ue)throw Error("approval_persist_failed");return response({ok:true,approved:body.action==="approve_job"});
    }
    let text=typeof body.text==="string"?body.text.trim():"";
    if(body.action==="send_pix"){
      const {data:profile,error}=await supabase.from("profiles").select("pix_key,pix_key_type").eq("id",user.id).single();
      if(error||!profile?.pix_key)return response({error:"pix_not_configured"},409);
      text=`Segue a chave PIX:\n\n${profile.pix_key} (${profile.pix_key_type||"PIX"}).\nApós o pagamento, envie o comprovante para conferência.`;
    }else if(body.action==="send_receipt_request")text="Pode enviar o comprovante para conferência do pagamento?";
    else if(body.action)return response({error:"invalid_action"},400);
    const media=body.media_url&&body.media_type;
    if(media){
      if(!["image","document","audio"].includes(body.media_type))return response({error:"invalid_media"},400);
      const url=new URL(body.media_url);if(url.protocol!=="https:"||url.username||url.password)return response({error:"invalid_media_url"},400);
    }
    if(!text&&!media)return response({error:"missing_content"},400);
    if(text.length>12000)return response({error:"content_too_long"},400);
    const when=body.schedule_for?new Date(body.schedule_for):new Date();
    if(!Number.isFinite(when.getTime())||when.getTime()<Date.now()-60000)return response({error:"invalid_schedule"},400);
    const requestId=body.request_id||crypto.randomUUID();
    if(typeof requestId!=="string"||!/^[-a-zA-Z0-9]{1,80}$/.test(requestId))return response({error:"invalid_request_id"},400);
    const job=await queueBotMessage(supabase,{user_id:user.id,conversation_id:convo.id,client_id:convo.client_id||null,
      text:text||body.caption||"",media_url:media?body.media_url:null,media_type:media?body.media_type:null,
      purpose:"manual",status:"pending",scheduled_for:when.toISOString(),source_key:`manual:${requestId}`});
    if(body.schedule_for)return response({ok:true,scheduled:true});
    if(job.status==="sent")return response({ok:true,duplicate:true});
    if(["uncertain","failed"].includes(job.status))return response({error:job.status==="uncertain"?"provider_outcome_unknown":"send_failed",job_id:job.id},502);
    const {data:claimed,error}=await supabase.rpc("claim_whatsapp_job",{_id:job.id,_user_id:user.id});
    if(error)throw Error("job_claim_unavailable");
    if(!claimed?.[0])return response({ok:true,queued:true});
    const result=await deliverBotJob(supabase,claimed[0]);
    if(result!=="sent")return response({error:result==="uncertain"?"provider_outcome_unknown":"send_failed",job_id:job.id},502);
    const {error:ue}=await supabase.from("whatsapp_conversations").update({needs_human:false,bot_paused:true,updated_at:new Date().toISOString()}).eq("id",convo.id).eq("user_id",user.id);
    if(ue)return response({ok:true,warning:"conversation_update_pending"});
    return response({ok:true});
  }catch{return response({error:"send_unavailable"},503);}
});
