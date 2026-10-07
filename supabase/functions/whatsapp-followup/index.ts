import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkSharedSecret } from "../_shared/guard.ts";
import { queueBotMessage } from "../_shared/bot_delivery.ts";
const headers={"Access-Control-Allow-Origin":"*","Content-Type":"application/json"};
serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers});
  if(!checkSharedSecret(req,"CRON_SECRET"))return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try{
    const {data:conversations,error}=await db.rpc("claim_whatsapp_followups",{_limit:20});
    if(error)throw Error("followup_claim_unavailable");
    let queued=0;
    for(const c of conversations||[]){
      const {data:settings,error}=await db.from("settings").select("bot_enabled,bot_auto_send").eq("user_id",c.user_id).single();
      if(error)throw Error("settings_unavailable");
      if(!settings.bot_enabled)continue;
      await queueBotMessage(db,{user_id:c.user_id,conversation_id:c.id,client_id:c.client_id,
        text:"Olá! Precisa de mais alguma ajuda com o atendimento?",purpose:"service_followup",
        status:settings.bot_auto_send===true?"pending":"awaiting_approval",scheduled_for:new Date().toISOString(),source_key:`followup:${c.id}:${c.last_message_at}`});
      const {error:updateError}=await db.from("whatsapp_conversations").update({followup_sent_at:new Date().toISOString(),followup_claimed_at:null}).eq("id",c.id).eq("user_id",c.user_id);
      if(updateError)throw Error("followup_state_unavailable");queued++;
    }
    return new Response(JSON.stringify({queued}),{headers});
  }catch{return new Response(JSON.stringify({error:"followup_unavailable"}),{status:503,headers});}
});
