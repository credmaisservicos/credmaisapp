BEGIN;
-- One receipt per cash movement. No historical backfill or automatic resend.
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS payment_transaction_id uuid;
ALTER TABLE public.whatsapp_scheduled_messages DROP CONSTRAINT IF EXISTS whatsapp_scheduled_purpose_check;
ALTER TABLE public.whatsapp_scheduled_messages ADD CONSTRAINT whatsapp_scheduled_purpose_check
  CHECK(purpose IN ('manual','collection','service_followup','session_timeout','bot_reply','handoff_notice','payment_receipt'));
CREATE INDEX IF NOT EXISTS whatsapp_receipt_transaction_idx ON public.whatsapp_scheduled_messages(payment_transaction_id)
  WHERE payment_transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.payment_receipt_context(_transaction_id uuid,_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
SET TimeZone='America/Sao_Paulo' AS $context$
DECLARE tx public.transactions%rowtype; inst public.contract_installments%rowtype;
  cli public.clients%rowtype; ctr public.contracts%rowtype; receipt_phone text; company text; message text;
BEGIN
  SELECT * INTO tx FROM public.transactions WHERE id=_transaction_id AND user_id=_user_id;
  IF tx.id IS NULL OR tx.type IS DISTINCT FROM 'payment' OR tx.amount IS NULL
    OR tx.amount::text IN ('NaN','Infinity','-Infinity') OR round(tx.amount,2)<=0
    OR tx.amount<>round(tx.amount,2) OR tx.amount>90071992547409.91
    OR tx.date IS NULL OR NOT isfinite(tx.date) THEN
    RETURN jsonb_build_object('valid',false,'reason','payment_not_found');
  END IF;
  SELECT * INTO inst FROM public.contract_installments WHERE id=tx.installment_id
    AND user_id=tx.user_id AND client_id=tx.client_id AND contract_id=tx.contract_id;
  SELECT * INTO ctr FROM public.contracts WHERE id=tx.contract_id AND user_id=tx.user_id AND client_id=tx.client_id;
  SELECT * INTO cli FROM public.clients WHERE id=tx.client_id AND user_id=tx.user_id;
  IF inst.id IS NULL OR ctr.id IS NULL OR cli.id IS NULL OR inst.status='cancelled' OR ctr.status IN ('cancelled','canceled') THEN
    RETURN jsonb_build_object('valid',false,'reason','payment_context_invalid');
  END IF;
  -- Human renewal cash does not mark the original installment paid.
  IF coalesce(tx.category,'')<>'interest_renewal' AND (inst.paid_amount IS NULL
    OR inst.paid_amount::text IN ('NaN','Infinity','-Infinity') OR round(inst.paid_amount,2)<round(tx.amount,2)) THEN
    RETURN jsonb_build_object('valid',false,'reason','payment_reversed');
  END IF;
  receipt_phone:=regexp_replace(coalesce(nullif(btrim(cli.whatsapp),''),cli.phone,''),'\D','','g');
  IF length(receipt_phone) IN (10,11) THEN receipt_phone:='55'||receipt_phone; END IF;
  IF receipt_phone !~ '^55[1-9][0-9][0-9]{8,9}$' OR public.bot_phone_key(receipt_phone) IS NULL THEN
    RETURN jsonb_build_object('valid',false,'reason','client_phone_invalid');
  END IF;
  IF EXISTS(SELECT 1 FROM public.clients c WHERE c.user_id=tx.user_id AND c.id<>cli.id
    AND (public.bot_phone_key(c.whatsapp)=public.bot_phone_key(receipt_phone) OR public.bot_phone_key(c.phone)=public.bot_phone_key(receipt_phone))) THEN
    RETURN jsonb_build_object('valid',false,'reason','client_phone_ambiguous');
  END IF;
  SELECT coalesce(nullif(btrim(company_name),''),'CredMais') INTO company FROM public.settings WHERE user_id=tx.user_id;
  message:='Confirmação de recebimento'||E'\n\nOlá, '||coalesce(nullif(cli.name,''),'cliente')||E'.\n'
    ||'Registramos o recebimento de R$ '||replace(to_char(round(tx.amount,2),'FM999999999999990.00'),'.',',')
    ||' referente à parcela '||coalesce(inst.installment_number::text,'?')||'/'||coalesce(ctr.num_installments::text,'?')||E'.\n'
    ||'Data do recebimento: '||to_char(tx.date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')||E'.\n'
    ||CASE WHEN tx.category='interest_renewal' THEN E'Recebimento de juros registrado pelo responsável.\n' ELSE '' END
    ||'Referência: '||tx.id::text||E'\n'||coalesce(company,'CredMais');
  RETURN jsonb_build_object('valid',true,'transaction_id',tx.id,'user_id',tx.user_id,'client_id',cli.id,'contract_id',ctr.id,
    'installment_id',inst.id,'amount',round(tx.amount,2),'phone',receipt_phone,'text',message);
END;
$context$;
REVOKE ALL ON FUNCTION public.payment_receipt_context(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.payment_receipt_context(uuid,uuid) TO service_role;
ALTER FUNCTION public.payment_receipt_context(uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.enqueue_payment_receipt(_transaction_id uuid,_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $enqueue$
DECLARE context jsonb; config public.settings%rowtype; convo public.whatsapp_conversations%rowtype;
  job public.whatsapp_scheduled_messages%rowtype; existing boolean:=false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payment-receipt:'||_transaction_id::text,0));
  SELECT * INTO job FROM public.whatsapp_scheduled_messages WHERE user_id=_user_id AND source_key='receipt:'||_transaction_id::text;
  IF job.id IS NOT NULL THEN RETURN jsonb_build_object('queued',true,'duplicate',true,'job_id',job.id,'status',job.status); END IF;
  SELECT * INTO config FROM public.settings WHERE user_id=_user_id;
  IF config.bot_send_receipt IS DISTINCT FROM true THEN RETURN jsonb_build_object('queued',false,'reason','receipts_disabled'); END IF;
  context:=public.payment_receipt_context(_transaction_id,_user_id);
  IF (context->>'valid')::boolean IS DISTINCT FROM true THEN RETURN jsonb_build_object('queued',false,'reason',context->>'reason'); END IF;
  IF nullif(btrim(config.whatsapp_instance),'') IS NULL THEN RETURN jsonb_build_object('queued',false,'reason','whatsapp_not_configured'); END IF;
  -- Keep an identified conversation's canonical provider JID (optional ninth digit).
  SELECT * INTO convo FROM public.whatsapp_conversations WHERE user_id=_user_id
    AND public.bot_phone_key(jid)=public.bot_phone_key(context->>'phone')
    AND (client_id IS NULL OR client_id=(context->>'client_id')::uuid) AND jid !~ '@(g\.us|broadcast|lid)$'
    ORDER BY (client_id=(context->>'client_id')::uuid) DESC NULLS LAST,updated_at DESC,id LIMIT 1;
  IF convo.id IS NULL THEN
    INSERT INTO public.whatsapp_conversations(user_id,client_id,phone,jid,instance,contact_name)
    VALUES(_user_id,(context->>'client_id')::uuid,context->>'phone',(context->>'phone')||'@s.whatsapp.net',config.whatsapp_instance,
      (SELECT name FROM public.clients WHERE id=(context->>'client_id')::uuid AND user_id=_user_id))
    ON CONFLICT(user_id,phone) DO NOTHING;
    SELECT * INTO convo FROM public.whatsapp_conversations WHERE user_id=_user_id AND phone=context->>'phone';
  END IF;
  IF convo.id IS NULL OR convo.blocked OR (convo.client_id IS NOT NULL AND convo.client_id<>(context->>'client_id')::uuid)
    OR convo.jid ~ '@(g\.us|broadcast|lid)$' OR public.bot_phone_key(convo.jid) IS DISTINCT FROM public.bot_phone_key(context->>'phone') THEN
    RETURN jsonb_build_object('queued',false,'reason','receipt_recipient_unavailable');
  END IF;
  INSERT INTO public.whatsapp_scheduled_messages(user_id,client_id,conversation_id,installment_id,payment_transaction_id,
    purpose,source_key,text,scheduled_for,status,expected_amount)
  VALUES(_user_id,(context->>'client_id')::uuid,convo.id,(context->>'installment_id')::uuid,_transaction_id,
    'payment_receipt','receipt:'||_transaction_id::text,context->>'text',now(),
    CASE WHEN config.bot_enabled AND config.bot_auto_send THEN 'pending' ELSE 'awaiting_approval' END,(context->>'amount')::numeric)
  ON CONFLICT(user_id,source_key) DO NOTHING RETURNING * INTO job;
  IF job.id IS NULL THEN existing:=true;
    SELECT * INTO job FROM public.whatsapp_scheduled_messages WHERE user_id=_user_id AND source_key='receipt:'||_transaction_id::text;
  END IF;
  RETURN jsonb_build_object('queued',true,'duplicate',existing,'job_id',job.id,'status',job.status);
END;
$enqueue$;
REVOKE ALL ON FUNCTION public.enqueue_payment_receipt(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.enqueue_payment_receipt(uuid,uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.request_payment_receipt(_transaction_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $request$
DECLARE uid uuid:=auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=_transaction_id AND user_id=uid) THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE='P0002';
  END IF;
  RETURN public.enqueue_payment_receipt(_transaction_id,uid);
END;
$request$;
REVOKE ALL ON FUNCTION public.request_payment_receipt(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.request_payment_receipt(uuid) TO authenticated;
ALTER FUNCTION public.request_payment_receipt(uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.queue_registered_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $trigger$
BEGIN
  IF NEW.type='payment' AND NEW.installment_id IS NOT NULL AND NEW.amount>0 AND NEW.amount::text NOT IN ('NaN','Infinity','-Infinity') THEN
    PERFORM public.enqueue_payment_receipt(NEW.id,NEW.user_id);
  END IF;
  RETURN NEW;
END;
$trigger$;
REVOKE ALL ON FUNCTION public.queue_registered_payment_receipt() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.queue_registered_payment_receipt() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_queue_registered_payment_receipt ON public.transactions;
CREATE TRIGGER trg_queue_registered_payment_receipt AFTER INSERT ON public.transactions FOR EACH ROW
  EXECUTE FUNCTION public.queue_registered_payment_receipt();

CREATE OR REPLACE FUNCTION public.cancel_changed_payment_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $cancel$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.amount,NEW.type,NEW.category,NEW.user_id,NEW.client_id,NEW.contract_id,NEW.installment_id,NEW.date)
    IS NOT DISTINCT FROM ROW(OLD.amount,OLD.type,OLD.category,OLD.user_id,OLD.client_id,OLD.contract_id,OLD.installment_id,OLD.date) THEN RETURN NEW; END IF;
  UPDATE public.whatsapp_scheduled_messages SET status='cancelled',error='payment_changed_or_reversed'
    WHERE user_id=OLD.user_id AND payment_transaction_id=OLD.id AND purpose='payment_receipt'
      AND status IN ('pending','processing','awaiting_approval') AND delivery_started_at IS NULL;
  RETURN OLD;
END;
$cancel$;
REVOKE ALL ON FUNCTION public.cancel_changed_payment_receipt() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.cancel_changed_payment_receipt() OWNER TO postgres;
DROP TRIGGER IF EXISTS trg_cancel_changed_payment_receipt ON public.transactions;
CREATE TRIGGER trg_cancel_changed_payment_receipt AFTER DELETE OR UPDATE OF amount,type,category,user_id,client_id,contract_id,installment_id,date
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.cancel_changed_payment_receipt();

-- A cash confirmation does not restart automated negotiation or reminders.
CREATE OR REPLACE FUNCTION public.bot_takeover_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $takeover$
BEGIN
  IF NEW.needs_human OR NEW.bot_paused THEN
    NEW.bot_paused:=true;
    IF NEW.needs_human THEN NEW.bot_status:='handoff'; END IF;
    UPDATE public.whatsapp_scheduled_messages SET status='cancelled',error='human_takeover'
      WHERE conversation_id=NEW.id AND user_id=NEW.user_id AND purpose NOT IN ('manual','handoff_notice','payment_receipt')
        AND status IN ('pending','awaiting_approval') AND approved_by IS NULL;
  END IF;
  RETURN NEW;
END;
$takeover$;
REVOKE ALL ON FUNCTION public.bot_takeover_guard() FROM PUBLIC,anon,authenticated;

-- Status alone does not prove cash. Retire the obsolete URL/JWT HTTP trigger.
CREATE OR REPLACE FUNCTION public.notify_installment_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $legacy$
BEGIN RETURN NEW; END;
$legacy$;
REVOKE ALL ON FUNCTION public.notify_installment_paid() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
