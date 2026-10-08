import { deliveryPolicy } from './bot_policy.ts';
import { botRows } from './bot_data.ts';
import { activeDebt, botBalance, BOT_CONTRACT_FIELDS } from './bot_finance.ts';
import { collectionSuppression, collectionPaymentAfter, pendingClientReceipt } from './bot_collection.ts';
import { samePhoneBR } from './agent_core.ts';
export const SESSION_TIMEOUT_MESSAGE = 'Atendimento encerrado por falta de resposta. Quando precisar continuar, envie uma nova mensagem para abrir o menu novamente.';
export async function resolveWhatsAppInstance(supabase: any, ownerId: string, settings: any, name?: string) {
  const instance = name || settings?.whatsapp_instance;
  if (!instance) throw new Error('whatsapp_not_configured');
  if (instance === settings?.whatsapp_instance) return { instance, apiUrl:String(settings.whatsapp_api_url || '').replace(/\/$/,''), apiKey:settings.whatsapp_api_key };
  const { data, error } = await supabase.from('whatsapp_instances').select('api_url,api_key')
    .eq('user_id',ownerId).eq('instance',instance).eq('is_active',true).maybeSingle();
  if (error || !data) throw new Error('whatsapp_instance_unavailable');
  return { instance, apiUrl:String(data.api_url || '').replace(/\/$/,''),apiKey:data.api_key };
}
export async function queueBotMessage(supabase: any, input: any) {
  const { error } = await supabase.from('whatsapp_scheduled_messages').upsert(input,
    { onConflict:'user_id,source_key',ignoreDuplicates:true });
  if (error) throw new Error('message_queue_unavailable');
  const { data, error: readError } = await supabase.from('whatsapp_scheduled_messages').select('*')
    .eq('user_id',input.user_id).eq('source_key',input.source_key).single();
  if (readError || !data) throw new Error('message_queue_unavailable');
  return data;
}
export async function deliverBotJob(supabase: any, job: any) {
  const update = async (values: any) => {
    const { error } = await supabase.from('whatsapp_scheduled_messages').update(values).eq('id',job.id).eq('user_id',job.user_id);
    if (error) throw new Error('delivery_state_unavailable');
  };
  let started = false,accepted = false;
  try {
    const { data: convo,error:ce } = await supabase.from('whatsapp_conversations').select('*').eq('id',job.conversation_id).eq('user_id',job.user_id).single();
    const { data: settings,error:se } = await supabase.from('settings').select('*').eq('user_id',job.user_id).single();
    const { data: profile,error:pe } = await supabase.from('profiles').select('is_admin,is_blocked,plan_tier,subscription_type,subscription_expires_at,trial_ends_at').eq('id',job.user_id).single();
    if (ce || se || pe) throw new Error('delivery_context_unavailable');
    if (job.purpose === 'birthday') {
      const day=String(job.source_key || '').split(':')[2];
      const {data: context,error}=await supabase.rpc('birthday_message_context',{
        _client_id:job.client_id,_user_id:job.user_id,_day:day || null,
      });
      if(error)throw Error('birthday_context_unavailable');
      if(!context?.valid || context.user_id!==job.user_id || context.client_id!==job.client_id
        || job.source_key!==`birthday:${job.client_id}:${day}` || (convo.client_id && convo.client_id!==job.client_id)
        || /@(?:g\.us|broadcast|lid)$/.test(convo.jid || '')
        || !samePhoneBR(convo.jid || convo.phone || '',context.phone || '') || !context.text || job.media_url) {
        await update({status:'cancelled',error:context?.reason || 'birthday_context_changed'});return 'cancelled';
      }
      job={...job,text:context.text};
    }
    if (job.purpose === 'payment_receipt') {
      const {data:receipt,error}=await supabase.rpc('payment_receipt_context',{
        _transaction_id:job.payment_transaction_id,_user_id:job.user_id,
      });
      if(error)throw new Error('receipt_context_unavailable');
      if(!receipt?.valid || receipt.user_id!==job.user_id || receipt.client_id!==job.client_id
        || receipt.installment_id!==job.installment_id || receipt.transaction_id!==job.payment_transaction_id
        || job.source_key!==`receipt:${receipt.transaction_id}` || Number(receipt.amount)!==Number(job.expected_amount)
        || (convo.client_id && convo.client_id!==receipt.client_id) || /@(?:g\.us|broadcast|lid)$/.test(convo.jid || '')
        || !samePhoneBR(convo.jid || convo.phone || '',receipt.phone || '') || !receipt.text || job.media_url) {
        await update({status:'cancelled',error:'receipt_payment_or_recipient_changed'});return 'cancelled';
      }
      // Always use canonical cash data, including after human approval.
      job={...job,text:receipt.text};
    }
    const reason = deliveryPolicy(settings,convo,profile,job);
    if (reason) {
      await update({status:reason==='approval_required'?'awaiting_approval':reason==='outside_business_hours'?'pending':'cancelled',
        error:reason,scheduled_for:reason==='outside_business_hours'?new Date(Date.now()+15*60_000).toISOString():job.scheduled_for});
      return reason;
    }
    if (job.purpose === 'collection' && job.client_id) {
      const suppression = await collectionSuppression(supabase, job.user_id, job.client_id, new Date(), !!job.approved_by);
      if (suppression) { await update({status:'cancelled',error:suppression}); return 'cancelled'; }
      if (settings.bot_stop_on_payment !== false && job.created_at && await collectionPaymentAfter(supabase,job.user_id,job.client_id,job.created_at)) {
        await update({status:'cancelled',error:'payment_received'});return 'cancelled';
      }
    }
    if(job.purpose==='service_followup' && job.client_id && await pendingClientReceipt(supabase,job.user_id,job.client_id)) {
      await update({status:'cancelled',error:'receipt_under_review'});return 'cancelled';
    }
    if (['collection','service_followup'].includes(job.purpose) && job.client_id) {
      const rows = await botRows(()=>supabase.from('contract_installments').select(`id,amount,paid_amount,late_fee,status,due_date,pre_settlement_snapshot,contracts(${BOT_CONTRACT_FIELDS})`)
        .eq('user_id',job.user_id).eq('client_id',job.client_id).not('status','in','("paid","cancelled")').order('id'));
      if (!rows.some(activeDebt)) { await update({status:'cancelled',error:'debt_no_longer_exists'});return 'cancelled'; }
      if(job.purpose==='collection' && job.expected_amount!=null) {
        const selected=rows.filter(r=>(job.installment_ids||[]).includes(r.id)&&activeDebt(r));
        const total=selected.reduce((sum,r)=>sum+botBalance(r),0);
        if(Math.abs(total-Number(job.expected_amount))>=0.01){await update({status:'cancelled',error:'amount_changed'});return 'cancelled';}
      }
    }
    if (job.purpose==='session_timeout') {
      const inactive = convo.last_message_from==='bot' && new Date(convo.last_message_at || 0).getTime()<=new Date(job.scheduled_for).getTime()-9*60_000;
      if (!inactive) { await update({status:'cancelled',error:'conversation_became_active'});return 'cancelled'; }
    }
    const {instance,apiUrl,apiKey} = await resolveWhatsAppInstance(supabase,job.user_id,settings,convo.instance);
    if (!apiUrl || !apiKey) throw new Error('whatsapp_not_configured');
    await update({delivery_started_at:new Date().toISOString()}); started=true;
    const number = String(convo.jid || convo.phone || '').replace(/\D/g,'');
    const endpoint = job.media_url ? job.media_type==='audio'?'sendWhatsAppAudio':'sendMedia' : 'sendText';
    const payload = job.media_url ? job.media_type==='audio' ? {number,audio:job.media_url} :
      {number,mediatype:job.media_type,media:job.media_url,caption:job.text} : {number,text:job.text,delay:500};
    const res = await fetch(`${apiUrl}/message/${endpoint}/${encodeURIComponent(instance)}`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:apiKey},body:JSON.stringify(payload),signal:AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      await update({status:res.status>=500?'uncertain':'failed',error:`send_failed_${res.status}`});
      return res.status>=500?'uncertain':'failed';
    }
    accepted=true;
    const result = await res.json().catch(()=>({}));
    await update({status:'sent',sent_at:new Date().toISOString(),provider_message_id:result?.key?.id || result?.messageId || null,error:null});
    const sender = job.purpose==='manual' || job.approved_by ? 'human':'bot';
    const { error:me } = await supabase.from('whatsapp_messages').insert({conversation_id:job.conversation_id,user_id:job.user_id,
      direction:'out',sender,message_type:job.media_type || 'text',content:job.text,media_url:job.media_url || null,
      metadata:{scheduled:true,job_id:job.id,provider_message_id:result?.key?.id || null}});
    const { error:ue } = await supabase.from('whatsapp_conversations').update({last_message_at:new Date().toISOString(),
      last_message_preview:job.text.slice(0,200),last_message_from:sender,updated_at:new Date().toISOString()}).eq('id',job.conversation_id).eq('user_id',job.user_id);
    if (me || ue) await supabase.from('bot_actions_log').insert({user_id:job.user_id,conversation_id:job.conversation_id,
      tool_name:'delivery_log_incomplete',success:false,error_message:'provider_accepted_log_incomplete',tool_input:{job_id:job.id}});
    if(job.purpose==='payment_receipt')await supabase.from('audit_logs').insert({
      user_id:job.user_id,action:'receipt_sent',entity_type:'payment_receipt',entity_id:job.payment_transaction_id,
      details:{job_id:job.id,amount:Number(job.expected_amount),provider_message_id:result?.key?.id || result?.messageId || null,provider_accepted:true},
    });
    if (job.purpose==='bot_reply') {
      const { data: current } = await supabase.from('whatsapp_conversations').select('bot_paused,needs_human').eq('id',job.conversation_id).eq('user_id',job.user_id).single();
      if (current && !current.bot_paused && !current.needs_human) {
        await supabase.from('whatsapp_scheduled_messages').update({status:'cancelled',error:'session_timer_replaced'}).eq('conversation_id',job.conversation_id).eq('purpose','session_timeout').in('status',['pending','awaiting_approval']);
        await queueBotMessage(supabase,{user_id:job.user_id,conversation_id:job.conversation_id,text:SESSION_TIMEOUT_MESSAGE,
          purpose:'session_timeout',status:'pending',scheduled_for:new Date(Date.now()+10*60_000).toISOString(),source_key:`timeout:${job.id}`});
      }
    }
    return 'sent';
  } catch {
    if(accepted) return 'sent';
    try { await update({status:started?'uncertain':job.attempts>=3?'failed':'pending',error:started?'provider_outcome_unknown':'delivery_context_unavailable',
      scheduled_for:new Date(Date.now()+60_000).toISOString()}); } catch { /* expired lease handles a lost database */ }
    return started?'uncertain':'failed';
  }
}
