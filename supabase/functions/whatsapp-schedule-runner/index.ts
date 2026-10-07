import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { checkSharedSecret } from "../_shared/guard.ts";
import { deliverBotJob } from "../_shared/bot_delivery.ts";
import { alertPlatformAdmins } from "../_shared/operations.ts";
const headers = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Content-Type":"application/json"};
serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, {headers});
  if (!checkSharedSecret(req, "CRON_SECRET")) return new Response(JSON.stringify({error:"unauthorized"}), {status:401,headers});
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const retryWork = (async()=>{
      const {data:events,error}=await supabase.rpc("claim_whatsapp_event_retries",{_limit:5});
      if(error)throw Error("inbox_queue_unavailable");
      const outcomes=await Promise.allSettled((events||[]).map(async(event:any)=>{
        const response=await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook`,{
          method:"POST",headers:{"Content-Type":"application/json","x-webhook-secret":Deno.env.get("EVOLUTION_WEBHOOK_SECRET")!,
            apikey:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,Authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`},
          body:JSON.stringify(event.payload),signal:AbortSignal.timeout(48_000),
        });await response.body?.cancel();
        if(!response.ok)throw Error('inbox_retry_failed');
      }));
      return outcomes.some(r=>r.status==='rejected');
    })().catch(()=>true);
    const {data:jobs,error} = await supabase.rpc("claim_due_whatsapp_messages", {_limit:20});
    if (error) throw Error("queue_unavailable");
    const results: string[] = [];
    const groups=new Map<string,any[]>();
    for(const job of jobs||[]){const list=groups.get(job.conversation_id)||[];list.push(job);groups.set(job.conversation_id,list);}
    const batches=[...groups.values()];
    const deadline=Date.now()+48_000;
    for(let i=0;i<batches.length;i+=5)await Promise.all(batches.slice(i,i+5).map(async group=>{
      group.sort((a,b)=>new Date(a.scheduled_for).getTime()-new Date(b.scheduled_for).getTime());
      for(const job of group){
        if(Date.now()+13_000>deadline){
          await supabase.from('whatsapp_scheduled_messages').update({status:'pending',error:'worker_budget_deferred'}).eq('id',job.id).eq('status','processing').is('delivery_started_at',null);
          continue;
        }
        results.push(await deliverBotJob(supabase,job));
      }
    }));
    const sent = results.filter(x=>x==="sent").length, failed = results.filter(x=>["failed","uncertain"].includes(x)).length;
    if (failed) await alertPlatformAdmins(supabase,"whatsapp-delivery",`${failed} entrega(s) precisam de conferência. Consulte a fila de atendimento.`);
    if(await retryWork)await alertPlatformAdmins(supabase,'whatsapp-inbox-retry','Há mensagens recebidas aguardando nova tentativa de processamento.');
    return new Response(JSON.stringify({processed:jobs?.length||0,sent,failed}), {headers});
  } catch { return new Response(JSON.stringify({error:"queue_unavailable"}), {status:503,headers}); }
});
