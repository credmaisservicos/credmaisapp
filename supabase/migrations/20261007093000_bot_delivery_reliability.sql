BEGIN;
CREATE OR REPLACE FUNCTION public.bot_phone_key(_phone text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  WITH digits AS (SELECT regexp_replace(coalesce(_phone,''),'\D','','g') AS d),
  local AS (SELECT CASE WHEN length(d)>=12 AND left(d,2)='55' THEN substr(d,3) ELSE d END AS d FROM digits)
  SELECT CASE WHEN length(d) IN (10,11) THEN left(d,2)||':'||right(d,8) ELSE NULL END FROM local;
$$;
CREATE INDEX IF NOT EXISTS clients_bot_phone_idx ON public.clients(user_id,public.bot_phone_key(phone));
CREATE INDEX IF NOT EXISTS clients_bot_whatsapp_idx ON public.clients(user_id,public.bot_phone_key(whatsapp));
CREATE OR REPLACE FUNCTION public.system_find_clients_by_phone(_user_id uuid,_phone text)
RETURNS SETOF public.clients LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT c.* FROM public.clients c WHERE c.user_id=_user_id
    AND public.bot_phone_key(_phone) IS NOT NULL AND (
      public.bot_phone_key(c.phone)=public.bot_phone_key(_phone) OR public.bot_phone_key(c.whatsapp)=public.bot_phone_key(_phone)) ORDER BY c.id;
END; $$;

ALTER TABLE public.whatsapp_event_claims ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';
ALTER TABLE public.whatsapp_event_claims ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.whatsapp_event_claims ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_event_claims ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE public.whatsapp_event_claims ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;
ALTER TABLE public.whatsapp_response_windows ADD COLUMN IF NOT EXISTS lease_token uuid;
CREATE OR REPLACE FUNCTION public.begin_whatsapp_event(_user_id uuid,_instance text,_message_id text,_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  IF _lease_token IS NULL OR _user_id IS NULL OR nullif(_instance,'') IS NULL OR nullif(_message_id,'') IS NULL THEN RETURN false; END IF;
  INSERT INTO public.whatsapp_event_claims(user_id,instance,message_id,status,claimed_at,lease_token,attempts)
  VALUES (_user_id,_instance,_message_id,'processing',now(),_lease_token,1)
  ON CONFLICT(user_id,instance,message_id) DO UPDATE SET status='processing',claimed_at=now(),lease_token=_lease_token,attempts=whatsapp_event_claims.attempts+1
    WHERE whatsapp_event_claims.status IN ('received','failed') OR (whatsapp_event_claims.status='processing' AND whatsapp_event_claims.claimed_at<now()-interval '75 seconds');
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END; $$;
CREATE OR REPLACE FUNCTION public.save_whatsapp_event(_user_id uuid,_instance text,_message_id text,_payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.whatsapp_event_claims(user_id,instance,message_id,status,payload,attempts)
    VALUES(_user_id,_instance,_message_id,'received',_payload,0)
    ON CONFLICT(user_id,instance,message_id) DO UPDATE SET payload=EXCLUDED.payload WHERE whatsapp_event_claims.status<>'completed';
END; $$;
CREATE OR REPLACE FUNCTION public.claim_whatsapp_event_retries(_limit integer DEFAULT 5)
RETURNS SETOF public.whatsapp_event_claims LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT user_id,instance,message_id FROM public.whatsapp_event_claims WHERE payload IS NOT NULL AND attempts<10
      AND (status IN ('failed','received') OR (status='processing' AND claimed_at<now()-interval '75 seconds'))
      AND (last_retry_at IS NULL OR last_retry_at<now()-interval '1 minute')
    ORDER BY claimed_at FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(_limit,5))
  ) UPDATE public.whatsapp_event_claims e SET last_retry_at=now() FROM candidates c
    WHERE e.user_id=c.user_id AND e.instance=c.instance AND e.message_id=c.message_id RETURNING e.*;
END; $$;
CREATE OR REPLACE FUNCTION public.finish_whatsapp_event(_user_id uuid,_instance text,_message_id text,_lease_token uuid,_success boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.whatsapp_event_claims SET status=CASE WHEN _success THEN 'completed' ELSE 'failed' END,
    payload=CASE WHEN _success THEN NULL ELSE payload END
    WHERE user_id=_user_id AND instance=_instance AND message_id=_message_id AND lease_token=_lease_token;
END; $$;
CREATE OR REPLACE FUNCTION public.begin_whatsapp_response(_user_id uuid,_jid text,_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.whatsapp_response_windows(user_id,jid,claimed_until,updated_at,lease_token)
  VALUES(_user_id,_jid,now()+interval '75 seconds',now(),_lease_token)
  ON CONFLICT(user_id,jid) DO UPDATE SET claimed_until=EXCLUDED.claimed_until,updated_at=now(),lease_token=_lease_token
    WHERE whatsapp_response_windows.claimed_until<now();
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END; $$;
CREATE OR REPLACE FUNCTION public.finish_whatsapp_response(_user_id uuid,_jid text,_lease_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  DELETE FROM public.whatsapp_response_windows WHERE user_id=_user_id AND jid=_jid AND lease_token=_lease_token;
END; $$;

ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS source_key text;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS media_type text;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS delivery_started_at timestamptz;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS expected_amount numeric;
ALTER TABLE public.whatsapp_scheduled_messages ADD COLUMN IF NOT EXISTS installment_ids uuid[];
ALTER TABLE public.whatsapp_scheduled_messages DROP CONSTRAINT IF EXISTS whatsapp_scheduled_purpose_check;
ALTER TABLE public.whatsapp_scheduled_messages ADD CONSTRAINT whatsapp_scheduled_purpose_check
  CHECK(purpose IN ('manual','collection','service_followup','session_timeout','bot_reply','handoff_notice'));
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_scheduled_source_idx ON public.whatsapp_scheduled_messages(user_id,source_key);
CREATE OR REPLACE FUNCTION public.claim_due_whatsapp_messages(_limit integer DEFAULT 50)
RETURNS SETOF public.whatsapp_scheduled_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  -- Never resend a delivery whose provider outcome is unknown.
  UPDATE public.whatsapp_scheduled_messages SET status=CASE WHEN delivery_started_at IS NULL THEN 'pending' ELSE 'uncertain' END,
    error=CASE WHEN delivery_started_at IS NULL THEN 'worker_lease_expired' ELSE 'provider_outcome_unknown' END
    WHERE status='processing' AND claimed_at<now()-interval '2 minutes';
  RETURN QUERY WITH due AS (
    SELECT id FROM public.whatsapp_scheduled_messages WHERE status='pending' AND scheduled_for<=now()
    ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT greatest(1,least(coalesce(_limit,50),20))
  ) UPDATE public.whatsapp_scheduled_messages m SET status='processing',claimed_at=now(),attempts=m.attempts+1,error=NULL
    FROM due WHERE m.id=due.id RETURNING m.*;
END; $$;
CREATE OR REPLACE FUNCTION public.claim_whatsapp_job(_id uuid,_user_id uuid)
RETURNS SETOF public.whatsapp_scheduled_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY UPDATE public.whatsapp_scheduled_messages SET status='processing',claimed_at=now(),attempts=attempts+1
    WHERE id=_id AND user_id=_user_id AND status='pending' AND scheduled_for<=now() RETURNING *;
END; $$;

DO $permissions$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('system_find_clients_by_phone','begin_whatsapp_event','finish_whatsapp_event','save_whatsapp_event','claim_whatsapp_event_retries','begin_whatsapp_response','finish_whatsapp_response','claim_due_whatsapp_messages','claim_whatsapp_job')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',fn.proname,fn.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',fn.proname,fn.args);
  END LOOP;
END; $permissions$;
CREATE OR REPLACE FUNCTION public.bot_takeover_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.needs_human OR NEW.bot_paused THEN
    NEW.bot_paused:=true;
    IF NEW.needs_human THEN NEW.bot_status:='handoff'; END IF;
    UPDATE public.whatsapp_scheduled_messages SET status='cancelled',error='human_takeover'
      WHERE conversation_id=NEW.id AND user_id=NEW.user_id AND purpose NOT IN ('manual','handoff_notice')
        AND status IN ('pending','awaiting_approval') AND approved_by IS NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.bot_takeover_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bot_takeover_guard ON public.whatsapp_conversations;
CREATE TRIGGER bot_takeover_guard BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.bot_takeover_guard();
UPDATE public.whatsapp_conversations SET bot_paused=true,bot_status='handoff' WHERE needs_human=true AND bot_paused=false;
NOTIFY pgrst, 'reload schema';
COMMIT;
