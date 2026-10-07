import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getCallerUser } from '../_shared/guard.ts';
import { resolveWhatsAppInstance } from '../_shared/bot_delivery.ts';
import {hasAIProvider} from '../_shared/anthropic.ts';
import {geminiConfigured} from '../_shared/gemini.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'};
serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  const user=await getCallerUser(req);
  if(!user)return new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers});
  try{
    const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const {data:settings,error}=await db.from('settings').select('*').eq('user_id',user.id).single();
    if(error)throw Error('settings_unavailable');
    const since=new Date(Date.now()-24*3600_000).toISOString();
    const [approval,uncertain,failed,lastIncoming,lastAccepted]=await Promise.all([
      db.from('whatsapp_scheduled_messages').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('status','awaiting_approval'),
      db.from('whatsapp_scheduled_messages').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('status','uncertain'),
      db.from('whatsapp_scheduled_messages').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('status','failed').gte('created_at',since),
      db.from('whatsapp_messages').select('created_at').eq('user_id',user.id).eq('direction','in').order('created_at',{ascending:false}).limit(1).maybeSingle(),
      db.from('whatsapp_scheduled_messages').select('sent_at').eq('user_id',user.id).eq('status','sent').order('sent_at',{ascending:false}).limit(1).maybeSingle(),
    ]);
    if([approval,uncertain,failed,lastIncoming,lastAccepted].some(r=>r.error))throw Error('health_unavailable');
    let connection='unavailable';
    try{
      const {instance,apiUrl,apiKey}=await resolveWhatsAppInstance(db,user.id,settings);
      const response=await fetch(`${apiUrl}/instance/connectionState/${encodeURIComponent(instance)}`,{headers:{apikey:apiKey},signal:AbortSignal.timeout(5_000)});
      if(response.ok){const data=await response.json();connection=(data?.instance?.state||data?.state)==='open'?'open':'disconnected';}
      else{await response.body?.cancel();connection='provider_error';}
    }catch{connection='unavailable';}
    return new Response(JSON.stringify({webhook_ready:!!Deno.env.get('EVOLUTION_WEBHOOK_SECRET'),cron_ready:!!Deno.env.get('CRON_SECRET'),
      ai_ready:hasAIProvider(user.id),audio_ready:geminiConfigured(user.id)||!!Deno.env.get('LOVABLE_API_KEY'),connection,
      pending_approval:approval.count||0,uncertain:uncertain.count||0,failed24h:failed.count||0,
      last_incoming:lastIncoming.data?.created_at||null,last_provider_accepted:lastAccepted.data?.sent_at||null}),{headers});
  }catch{return new Response(JSON.stringify({error:'health_unavailable'}),{status:503,headers});}
});
