BEGIN;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS bot_send_birthday boolean NOT NULL DEFAULT false;
ALTER TABLE public.whatsapp_scheduled_messages DROP CONSTRAINT IF EXISTS whatsapp_scheduled_purpose_check;
ALTER TABLE public.whatsapp_scheduled_messages ADD CONSTRAINT whatsapp_scheduled_purpose_check
 CHECK(purpose IN ('manual','collection','service_followup','session_timeout','bot_reply','handoff_notice','payment_receipt','birthday'));
CREATE TABLE IF NOT EXISTS public.birthday_occurrences (
 user_id uuid NOT NULL, client_id uuid NOT NULL, financial_day date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,client_id,financial_day)
);
ALTER TABLE public.birthday_occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS birthday_occurrences_owner ON public.birthday_occurrences;
CREATE POLICY birthday_occurrences_owner ON public.birthday_occurrences FOR SELECT TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON public.birthday_occurrences FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.birthday_occurrences TO authenticated;
GRANT ALL ON public.birthday_occurrences TO service_role;
CREATE OR REPLACE FUNCTION public.birthday_message_context(_client_id uuid,_user_id uuid,_day date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $context$
DECLARE cli public.clients%rowtype; cfg public.settings%rowtype; target_phone text;
BEGIN
 IF _day IS DISTINCT FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RETURN jsonb_build_object('valid',false,'reason','birthday_date_expired'); END IF;
 SELECT * INTO cli FROM public.clients WHERE id=_client_id AND user_id=_user_id;
 SELECT * INTO cfg FROM public.settings WHERE user_id=_user_id;
 IF cli.id IS NULL OR cli.birth_date IS NULL OR to_char(cli.birth_date::date,'MM-DD')<>to_char(_day,'MM-DD') THEN RETURN jsonb_build_object('valid',false,'reason','birthday_client_changed'); END IF;
 IF lower(coalesce(cli.status,'')) NOT IN ('ativo','active') THEN RETURN jsonb_build_object('valid',false,'reason','birthday_client_inactive'); END IF;
 IF cfg.bot_send_birthday IS DISTINCT FROM true THEN RETURN jsonb_build_object('valid',false,'reason','birthdays_disabled'); END IF;
 target_phone:=regexp_replace(coalesce(nullif(btrim(cli.whatsapp),''),cli.phone,''),'\D','','g');
 IF length(target_phone) IN (10,11) THEN target_phone:='55'||target_phone; END IF;
 IF target_phone !~ '^55[1-9][0-9][0-9]{8,9}$' OR public.bot_phone_key(target_phone) IS NULL THEN RETURN jsonb_build_object('valid',false,'reason','birthday_phone_invalid'); END IF;
 IF EXISTS(SELECT 1 FROM public.clients c WHERE c.user_id=_user_id AND c.id<>_client_id AND
  (public.bot_phone_key(c.phone)=public.bot_phone_key(target_phone) OR public.bot_phone_key(c.whatsapp)=public.bot_phone_key(target_phone))) THEN RETURN jsonb_build_object('valid',false,'reason','birthday_phone_ambiguous'); END IF;
 RETURN jsonb_build_object('valid',true,'user_id',_user_id,'client_id',_client_id,'phone',target_phone,
  'text','Olá, '||coalesce(nullif(cli.name,''),'cliente')||E'! Feliz aniversário. Desejamos um ótimo dia.\n\n'||coalesce(nullif(btrim(cfg.company_name),''),'Equipe'));
END; $context$;
REVOKE ALL ON FUNCTION public.birthday_message_context(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.birthday_message_context(uuid,uuid,date) TO service_role;
ALTER FUNCTION public.birthday_message_context(uuid,uuid,date) OWNER TO postgres;
CREATE OR REPLACE FUNCTION public.enqueue_birthday_greeting(_client_id uuid,_user_id uuid,_day date,_allow_message boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $enqueue$
DECLARE cli public.clients%rowtype; cfg public.settings%rowtype; convo public.whatsapp_conversations%rowtype;
 job public.whatsapp_scheduled_messages%rowtype; context jsonb; inserted integer; source text;
BEGIN
 IF _day IS DISTINCT FROM (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RETURN jsonb_build_object('queued',false,'reason','birthday_date_expired'); END IF;
 SELECT * INTO cli FROM public.clients WHERE id=_client_id AND user_id=_user_id;
 IF cli.id IS NULL OR cli.birth_date IS NULL OR to_char(cli.birth_date::date,'MM-DD')<>to_char(_day,'MM-DD') THEN RETURN jsonb_build_object('queued',false,'reason','birthday_client_changed'); END IF;
 source:='birthday:'||_client_id::text||':'||_day::text;
 PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text||':'||source,0));
 INSERT INTO public.birthday_occurrences(user_id,client_id,financial_day) VALUES(_user_id,_client_id,_day) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=1 THEN INSERT INTO public.notifications(user_id,message,type,"from",link)
  VALUES(_user_id,'Hoje é aniversário de '||coalesce(cli.name,'cliente')||'.','birthday','Sistema','/clientes/'||cli.id::text); END IF;
 IF _allow_message IS DISTINCT FROM true THEN RETURN jsonb_build_object('queued',false,'notified',inserted=1,'reason','test_recipient_blocked'); END IF;
 SELECT * INTO job FROM public.whatsapp_scheduled_messages WHERE user_id=_user_id AND source_key=source;
 IF job.id IS NOT NULL THEN RETURN jsonb_build_object('queued',true,'duplicate',true,'job_id',job.id,'status',job.status); END IF;
 context:=public.birthday_message_context(_client_id,_user_id,_day);
 IF (context->>'valid')::boolean IS DISTINCT FROM true THEN RETURN jsonb_build_object('queued',false,'notified',inserted=1,'reason',context->>'reason'); END IF;
 SELECT * INTO cfg FROM public.settings WHERE user_id=_user_id;
 IF nullif(btrim(cfg.whatsapp_instance),'') IS NULL THEN RETURN jsonb_build_object('queued',false,'reason','whatsapp_not_configured'); END IF;
 SELECT * INTO convo FROM public.whatsapp_conversations WHERE user_id=_user_id AND public.bot_phone_key(jid)=public.bot_phone_key(context->>'phone')
  AND (client_id IS NULL OR client_id=_client_id) AND jid !~ '@(g\.us|broadcast|lid)$'
  ORDER BY (client_id=_client_id) DESC NULLS LAST,updated_at DESC,id LIMIT 1;
 IF convo.id IS NULL THEN
  INSERT INTO public.whatsapp_conversations(user_id,client_id,phone,jid,instance,contact_name)
   VALUES(_user_id,_client_id,context->>'phone',(context->>'phone')||'@s.whatsapp.net',cfg.whatsapp_instance,cli.name) ON CONFLICT(user_id,phone) DO NOTHING;
  SELECT * INTO convo FROM public.whatsapp_conversations WHERE user_id=_user_id AND phone=context->>'phone';
 END IF;
 IF convo.id IS NULL OR convo.blocked OR (convo.client_id IS NOT NULL AND convo.client_id<>_client_id) OR convo.jid ~ '@(g\.us|broadcast|lid)$'
  OR public.bot_phone_key(convo.jid) IS DISTINCT FROM public.bot_phone_key(context->>'phone') THEN RETURN jsonb_build_object('queued',false,'reason','birthday_recipient_unavailable'); END IF;
 INSERT INTO public.whatsapp_scheduled_messages(user_id,client_id,conversation_id,purpose,source_key,text,scheduled_for,status)
 VALUES(_user_id,_client_id,convo.id,'birthday',source,context->>'text',now(),CASE WHEN cfg.bot_enabled AND cfg.bot_auto_send THEN 'pending' ELSE 'awaiting_approval' END) RETURNING * INTO job;
 RETURN jsonb_build_object('queued',true,'duplicate',false,'job_id',job.id,'status',job.status,'notified',inserted=1);
END; $enqueue$;
REVOKE ALL ON FUNCTION public.enqueue_birthday_greeting(uuid,uuid,date,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_birthday_greeting(uuid,uuid,date,boolean) TO service_role;
ALTER FUNCTION public.enqueue_birthday_greeting(uuid,uuid,date,boolean) OWNER TO postgres;
DO $view$ DECLARE definition text; BEGIN
 IF to_regclass('public.settings_safe') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='settings_safe' AND column_name='bot_send_birthday') THEN
  definition:=rtrim(pg_get_viewdef('public.settings_safe'::regclass,true),E';\n ');
  EXECUTE 'CREATE OR REPLACE VIEW public.settings_safe WITH (security_invoker=true) AS SELECT legacy.*,s.bot_send_birthday FROM ('||definition||') legacy JOIN public.settings s ON s.user_id=legacy.user_id';
 END IF;
END; $view$;
NOTIFY pgrst,'reload schema';
COMMIT;
