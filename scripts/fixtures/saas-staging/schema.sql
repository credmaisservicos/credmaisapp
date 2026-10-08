-- SCHEMA ONLY. Synthetic CI environment; never restore into production.
-- Snapshot 2026-10-08; external service defaults replaced with .invalid.
--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'operator',
    'viewer'
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: activate_signed_contract(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_signed_contract() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.signature_status = 'signed' AND OLD.signature_status IS DISTINCT FROM 'signed'
     AND NEW.status = 'pending_signature' THEN
    NEW.status := 'active';
    NEW.lifecycle_stage := 'active';
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: admin_set_user_admin(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_user_admin(_target_user_id uuid, _make_admin boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF _target_user_id = auth.uid() AND NOT _make_admin THEN
    RAISE EXCEPTION 'Você não pode remover sua própria permissão de administrador';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target_user_id) THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;

  UPDATE public.profiles
     SET is_admin = _make_admin
   WHERE id = _target_user_id;

  IF _make_admin THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_target_user_id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
     WHERE user_id = _target_user_id
       AND role = 'admin'::public.app_role;
  END IF;
END;
$$;


--
-- Name: allocate_installment_receipt(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_installment_receipt(_received numeric, _old_paid numeric, _old_principal numeric, _old_interest numeric, _old_fees numeric, _base numeric, _fees numeric, _scheduled_interest numeric) RETURNS TABLE(principal_amount numeric, interest_amount numeric, fee_amount numeric, unallocated_amount numeric, review_required boolean)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
 old_principal numeric := coalesce(_old_principal,0);
 old_interest numeric := coalesce(_old_interest,0);
 old_fees numeric := coalesce(_old_fees,0);
 interest_due numeric := least(greatest(0,coalesce(_base,0)),greatest(0,coalesce(_scheduled_interest,_base,0)));
BEGIN
 IF _received IS NULL OR _received <= 0 OR _received::text IN ('NaN','Infinity','-Infinity') THEN
   RAISE EXCEPTION 'invalid_payment_amount';
 END IF;
 -- Dados antigos sem composição não permitem inferir o lucro recebido.
 -- Preserva seus componentes e lança o novo dinheiro como pendente de revisão.
 review_required := round(coalesce(_old_paid,0),2) <> round(old_principal+old_interest+old_fees,2)
   OR least(old_principal,old_interest,old_fees)<0
   OR old_interest > interest_due OR old_fees > greatest(0,coalesce(_fees,0));
 IF review_required THEN
   principal_amount:=0; interest_amount:=0; fee_amount:=0; unallocated_amount:=_received;
 ELSE
   fee_amount:=round(least(_received,greatest(0,coalesce(_fees,0)-old_fees)),2);
   interest_amount:=round(least(_received-fee_amount,greatest(0,interest_due-old_interest)),2);
   principal_amount:=round(_received-fee_amount-interest_amount,2);
   unallocated_amount:=0;
 END IF;
 RETURN NEXT;
END;
$$;


--
-- Name: apply_manual_cash_operation(uuid, uuid, text, numeric, text, timestamp with time zone, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_manual_cash_operation(_request_id uuid, _expected_owner uuid, _operation text, _amount numeric DEFAULT NULL::numeric, _description text DEFAULT NULL::text, _date timestamp with time zone DEFAULT NULL::timestamp with time zone, _category text DEFAULT NULL::text, _entry_id uuid DEFAULT NULL::uuid, _expected jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE uid uuid:=auth.uid(); payload jsonb; prior public.manual_cash_operations%ROWTYPE;
  expense public.expenses%ROWTYPE; capital public.transactions%ROWTYPE;
  target uuid; before_value jsonb; after_value jsonb; current_value jsonb; state text;
BEGIN
  IF uid IS NULL OR _expected_owner IS DISTINCT FROM uid THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF _request_id IS NULL OR _operation IS NULL OR _operation NOT IN
    ('capital_injection','capital_withdrawal','expense_create','expense_update','expense_delete','capital_delete') THEN
    RAISE EXCEPTION 'invalid_manual_cash_operation' USING ERRCODE='22023';
  END IF;
  IF _operation IN ('capital_injection','capital_withdrawal','expense_create','expense_update') THEN
    IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity') OR _amount<=0
      OR _amount>90071992547409.91 OR _amount<>round(_amount,2)
      OR nullif(btrim(_description),'') IS NULL OR length(btrim(_description))>500
      OR _date IS NULL OR NOT isfinite(_date) OR extract(year FROM _date) NOT BETWEEN 1 AND 9999
      OR length(coalesce(btrim(_category),''))>100 THEN
      RAISE EXCEPTION 'invalid_manual_cash_values' USING ERRCODE='22023';
    END IF;
  ELSIF _amount IS NOT NULL OR _description IS NOT NULL OR _date IS NOT NULL OR _category IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_manual_cash_values' USING ERRCODE='22023';
  END IF;
  IF _operation IN ('expense_update','expense_delete','capital_delete') THEN
    IF _entry_id IS NULL THEN RAISE EXCEPTION 'invalid_manual_cash_target' USING ERRCODE='22023'; END IF;
  ELSIF _entry_id IS NOT NULL OR _expected IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_manual_cash_target' USING ERRCODE='22023';
  END IF;
  IF _operation IN ('expense_update','expense_delete') THEN
    IF _expected IS NULL OR jsonb_typeof(_expected)<>'object' OR _expected->>'id' IS DISTINCT FROM _entry_id::text
      OR _expected->>'user_id' IS DISTINCT FROM uid::text THEN
      RAISE EXCEPTION 'invalid_manual_cash_expected' USING ERRCODE='22023';
    END IF;
    _expected:=to_jsonb(jsonb_populate_record(NULL::public.expenses,_expected));
  ELSIF _expected IS NOT NULL THEN RAISE EXCEPTION 'invalid_manual_cash_expected' USING ERRCODE='22023';
  END IF;
  payload:=jsonb_build_object('operation',_operation,'amount',_amount,'description',btrim(_description),'date',_date,
    'category',nullif(btrim(_category),''),'entry_id',_entry_id,'expected',_expected);
  -- Same owner/request is serialized even when the HTTP response was lost.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':'||_request_id::text,0));
  SELECT * INTO prior FROM public.manual_cash_operations WHERE user_id=uid AND request_id=_request_id;
  IF FOUND THEN
    IF prior.operation='cancelled' THEN RAISE EXCEPTION 'manual_cash_cancelled' USING ERRCODE='P0001'; END IF;
    IF prior.request_payload<>payload THEN RAISE EXCEPTION 'manual_cash_request_conflict' USING ERRCODE='23505'; END IF;
    IF _operation LIKE 'expense_%' THEN SELECT to_jsonb(e) INTO current_value FROM public.expenses e WHERE id=prior.entry_id AND user_id=uid;
    ELSE SELECT to_jsonb(t) INTO current_value FROM public.transactions t WHERE id=prior.entry_id AND user_id=uid; END IF;
    state:=CASE WHEN current_value IS NULL THEN 'deleted' WHEN current_value=prior.after_row THEN 'applied' ELSE 'changed' END;
    RETURN jsonb_build_object('ok',true,'entry_id',prior.entry_id,'operation',_operation,'replayed',true,'current_state',state);
  END IF;
  IF _operation IN ('capital_injection','capital_withdrawal') THEN
    INSERT INTO public.transactions(user_id,type,amount,description,date,category,source_key)
      VALUES(uid,_operation,_amount,btrim(_description),_date,
        CASE WHEN _operation='capital_injection' THEN 'Aporte de capital' ELSE 'Retirada de capital' END,'manual-cash:'||_request_id::text)
      RETURNING * INTO capital;
    target:=capital.id;after_value:=to_jsonb(capital);
  ELSIF _operation='expense_create' THEN
    INSERT INTO public.expenses(user_id,amount,description,date,category)
      VALUES(uid,_amount,btrim(_description),_date,nullif(btrim(_category),'')) RETURNING * INTO expense;
    target:=expense.id;after_value:=to_jsonb(expense);
  ELSIF _operation IN ('expense_update','expense_delete') THEN
    SELECT * INTO expense FROM public.expenses WHERE id=_entry_id AND user_id=uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'manual_cash_not_found' USING ERRCODE='P0002'; END IF;
    before_value:=to_jsonb(expense);
    IF before_value<>_expected THEN RAISE EXCEPTION 'manual_cash_changed' USING ERRCODE='40001'; END IF;
    target:=expense.id;
    IF _operation='expense_delete' THEN DELETE FROM public.expenses WHERE id=target AND user_id=uid;
    ELSE UPDATE public.expenses SET amount=_amount,description=btrim(_description),date=_date,category=nullif(btrim(_category),'')
      WHERE id=target AND user_id=uid RETURNING * INTO expense;after_value:=to_jsonb(expense); END IF;
  ELSE
    SELECT * INTO capital FROM public.transactions WHERE id=_entry_id AND user_id=uid
      AND type IN ('capital_injection','capital_withdrawal') AND contract_id IS NULL AND installment_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'manual_cash_not_found' USING ERRCODE='P0002'; END IF;
    target:=capital.id;before_value:=to_jsonb(capital);
    DELETE FROM public.transactions WHERE id=target AND user_id=uid;
  END IF;
  INSERT INTO public.manual_cash_operations(user_id,request_id,operation,request_payload,entry_id,before_row,after_row)
    VALUES(uid,_request_id,_operation,payload,target,before_value,after_value);
  RETURN jsonb_build_object('ok',true,'entry_id',target,'operation',_operation,'replayed',false,
    'current_state',CASE WHEN after_value IS NULL THEN 'deleted' ELSE 'applied' END);
END;
$$;


--
-- Name: approve_whatsapp_receipt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_whatsapp_receipt(_review_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE received numeric;
BEGIN
  SELECT amount INTO received FROM public.whatsapp_receipt_reviews WHERE id=_review_id AND user_id=auth.uid();
  RETURN public.confirm_whatsapp_receipt(_review_id,received);
END; $$;


--
-- Name: audit_contract_lifecycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_contract_lifecycle() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contract_events(contract_id, client_id, user_id, event_type, to_stage, metadata)
    VALUES (NEW.id, NEW.client_id, NEW.user_id, 'created', NEW.lifecycle_stage,
      jsonb_build_object('status', NEW.status, 'signature_status', NEW.signature_status));
  ELSIF OLD.lifecycle_stage IS DISTINCT FROM NEW.lifecycle_stage OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.contract_events(contract_id, client_id, user_id, event_type, from_stage, to_stage, metadata)
    VALUES (NEW.id, NEW.client_id, NEW.user_id, 'stage_changed', OLD.lifecycle_stage, NEW.lifecycle_stage,
      jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: begin_whatsapp_event(uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: begin_whatsapp_response(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.begin_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE affected integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.whatsapp_response_windows(user_id,jid,claimed_until,updated_at,lease_token)
  VALUES(_user_id,_jid,now()+interval '75 seconds',now(),_lease_token)
  ON CONFLICT(user_id,jid) DO UPDATE SET claimed_until=EXCLUDED.claimed_until,updated_at=now(),lease_token=_lease_token
    WHERE whatsapp_response_windows.claimed_until<now();
  GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected=1;
END; $$;


--
-- Name: bot_phone_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bot_phone_key(_phone text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  WITH digits AS (SELECT regexp_replace(coalesce(_phone,''),'\D','','g') AS d),
  local AS (SELECT CASE WHEN length(d)>=12 AND left(d,2)='55' THEN substr(d,3) ELSE d END AS d FROM digits)
  SELECT CASE WHEN length(d) IN (10,11) THEN left(d,2)||':'||right(d,8) ELSE NULL END FROM local;
$$;


--
-- Name: bot_takeover_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bot_takeover_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
$$;


--
-- Name: can_access_chat_topic(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_chat_topic(_topic text, _user_id uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  raw text;
  tid uuid;
BEGIN
  IF _user_id IS NULL OR _topic IS NULL THEN
    RETURN false;
  END IF;

  IF _topic LIKE 'chat-msgs-%' THEN
    raw := substring(_topic from 11);
    BEGIN
      tid := raw::uuid;
    EXCEPTION WHEN others THEN
      RETURN false;
    END;
    RETURN public.is_channel_member(tid, _user_id)
        OR public.is_dm_participant(tid, _user_id);
  END IF;

  RETURN false;
END;
$$;


--
-- Name: cancel_changed_payment_receipt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_changed_payment_receipt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.amount,NEW.type,NEW.category,NEW.user_id,NEW.client_id,NEW.contract_id,NEW.installment_id,NEW.date)
    IS NOT DISTINCT FROM ROW(OLD.amount,OLD.type,OLD.category,OLD.user_id,OLD.client_id,OLD.contract_id,OLD.installment_id,OLD.date) THEN RETURN NEW; END IF;
  UPDATE public.whatsapp_scheduled_messages SET status='cancelled',error='payment_changed_or_reversed'
    WHERE user_id=OLD.user_id AND payment_transaction_id=OLD.id AND purpose='payment_receipt'
      AND status IN ('pending','processing','awaiting_approval') AND delivery_started_at IS NULL;
  RETURN OLD;
END;
$$;


--
-- Name: cancel_manual_cash_operation(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_manual_cash_operation(_request_id uuid, _expected_owner uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'UTC'
    AS $$
DECLARE uid uuid:=auth.uid(); prior public.manual_cash_operations%ROWTYPE; current_value jsonb; state text;
BEGIN
 IF uid IS NULL OR uid IS DISTINCT FROM _expected_owner THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
 IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_manual_cash_operation' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':'||_request_id::text,0));
 SELECT * INTO prior FROM public.manual_cash_operations WHERE user_id=uid AND request_id=_request_id;
 IF NOT FOUND THEN
  INSERT INTO public.manual_cash_operations(user_id,request_id,operation,request_payload)VALUES(uid,_request_id,'cancelled','{}');
  RETURN jsonb_build_object('ok',true,'cancelled',true);
 END IF;
 IF prior.operation='cancelled' THEN RETURN jsonb_build_object('ok',true,'cancelled',true); END IF;
 IF prior.operation LIKE 'expense_%' THEN SELECT to_jsonb(e) INTO current_value FROM public.expenses e WHERE id=prior.entry_id AND user_id=uid;
 ELSE SELECT to_jsonb(t) INTO current_value FROM public.transactions t WHERE id=prior.entry_id AND user_id=uid; END IF;
 state:=CASE WHEN current_value IS NULL THEN 'deleted' WHEN current_value=prior.after_row THEN 'applied' ELSE 'changed' END;
 RETURN jsonb_build_object('ok',true,'cancelled',false,'entry_id',prior.entry_id,'operation',prior.operation,'replayed',true,'current_state',state);
END;
$$;


--
-- Name: cancel_scheduled_charges_after_installment_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_scheduled_charges_after_installment_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
BEGIN
  IF NEW.status IN ('paid','cancelled') AND NOT EXISTS (
    SELECT 1 FROM public.contract_installments i
    JOIN public.contracts c ON c.id = i.contract_id AND c.user_id = i.user_id
      AND c.client_id = i.client_id
    WHERE i.client_id = NEW.client_id AND i.user_id = NEW.user_id
      AND coalesce(i.status,'pending') NOT IN ('paid','cancelled')
      AND c.status IN ('active','overdue')
      AND greatest(0, coalesce(i.amount,0)) + public.quote_installment_late_fee(
        i.amount,i.due_date,i.status,i.late_fee,i.pre_settlement_snapshot,
        c.daily_interest_percent,c.daily_penalty_type,c.daily_penalty_value,
        c.max_interest_cap_percent) - greatest(0, coalesce(i.paid_amount,0)) > 0.009
  ) THEN
    UPDATE public.whatsapp_scheduled_messages SET status = 'cancelled', error = 'debt_settled'
    WHERE client_id = NEW.client_id AND user_id = NEW.user_id AND purpose = 'collection'
      AND status IN ('pending','processing','awaiting_approval') AND delivery_started_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: claim_collection_dispatch(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_collection_dispatch(_user_id uuid, _client_id uuid, _channel text, _bucket timestamp with time zone) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE inserted_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF _channel NOT IN ('whatsapp', 'email') THEN RETURN false; END IF;
  INSERT INTO public.collection_dispatch_claims(user_id, client_id, channel, claim_bucket)
  VALUES (_user_id, _client_id, _channel, date_trunc('hour', _bucket))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: whatsapp_scheduled_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_scheduled_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    text text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    purpose text DEFAULT 'manual'::text NOT NULL,
    client_id uuid,
    installment_id uuid,
    source_key text,
    media_url text,
    media_type text,
    delivery_started_at timestamp with time zone,
    provider_message_id text,
    approved_by uuid,
    expected_amount numeric,
    installment_ids uuid[],
    payment_transaction_id uuid,
    CONSTRAINT whatsapp_scheduled_purpose_check CHECK ((purpose = ANY (ARRAY['manual'::text, 'collection'::text, 'service_followup'::text, 'session_timeout'::text, 'bot_reply'::text, 'handoff_notice'::text, 'payment_receipt'::text])))
);


--
-- Name: claim_due_whatsapp_messages(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_due_whatsapp_messages(_limit integer DEFAULT 50) RETURNS SETOF public.whatsapp_scheduled_messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: claim_whatsapp_event(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_whatsapp_event(_user_id uuid, _instance text, _message_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE inserted_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL OR nullif(btrim(_instance),'') IS NULL OR nullif(btrim(_message_id),'') IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.whatsapp_event_claims(user_id,instance,message_id)
  VALUES (_user_id,btrim(_instance),btrim(_message_id))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;


--
-- Name: whatsapp_event_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_event_claims (
    user_id uuid NOT NULL,
    instance text NOT NULL,
    message_id text NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    lease_token uuid,
    attempts integer DEFAULT 0 NOT NULL,
    payload jsonb,
    last_retry_at timestamp with time zone
);


--
-- Name: claim_whatsapp_event_retries(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_whatsapp_event_retries(_limit integer DEFAULT 5) RETURNS SETOF public.whatsapp_event_claims
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: whatsapp_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid,
    phone text NOT NULL,
    jid text NOT NULL,
    instance text,
    contact_name text,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_preview text,
    last_message_from text,
    unread_count integer DEFAULT 0 NOT NULL,
    bot_paused boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    needs_human boolean DEFAULT false NOT NULL,
    blocked boolean DEFAULT false NOT NULL,
    followup_sent_at timestamp with time zone,
    last_human_handoff_at timestamp with time zone,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    last_intent text,
    bot_status text DEFAULT 'active'::text NOT NULL,
    human_takeover_at timestamp with time zone,
    human_takeover_reason text,
    agent_state text DEFAULT 'UNKNOWN'::text NOT NULL,
    agent_state_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    agent_state_updated_at timestamp with time zone,
    followup_claimed_at timestamp with time zone
);

ALTER TABLE ONLY public.whatsapp_conversations REPLICA IDENTITY FULL;


--
-- Name: claim_whatsapp_followups(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_whatsapp_followups(_limit integer DEFAULT 50) RETURNS SETOF public.whatsapp_conversations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.whatsapp_conversations
    WHERE last_message_from = 'client'
      AND bot_paused = false AND blocked = false AND needs_human = false
      AND followup_sent_at IS NULL
      AND last_message_at BETWEEN now() - interval '48 hours' AND now() - interval '6 hours'
      AND (followup_claimed_at IS NULL OR followup_claimed_at < now() - interval '15 minutes')
    ORDER BY last_message_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(_limit, 50), 100))
  )
  UPDATE public.whatsapp_conversations c
     SET followup_claimed_at = now()
    FROM candidates
   WHERE c.id = candidates.id
  RETURNING c.*;
END;
$$;


--
-- Name: claim_whatsapp_job(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_whatsapp_job(_id uuid, _user_id uuid) RETURNS SETOF public.whatsapp_scheduled_messages
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY UPDATE public.whatsapp_scheduled_messages SET status='processing',claimed_at=now(),attempts=attempts+1
    WHERE id=_id AND user_id=_user_id AND status='pending' AND scheduled_for<=now() RETURNING *;
END; $$;


--
-- Name: claim_whatsapp_response_window(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_whatsapp_response_window(_user_id uuid, _jid text, _seconds integer DEFAULT 8) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE affected integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.whatsapp_response_windows(user_id,jid,claimed_until,updated_at)
  VALUES (_user_id,_jid,now()+make_interval(secs=>greatest(3,least(_seconds,30))),now())
  ON CONFLICT (user_id,jid) DO UPDATE SET claimed_until=EXCLUDED.claimed_until,updated_at=now()
  WHERE public.whatsapp_response_windows.claimed_until < now();
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected=1;
END; $$;


--
-- Name: close_business_operation(uuid, text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.close_business_operation(_operation_id uuid, _action text, _data jsonb, _request_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE uid uuid:=auth.uid(); op business_operations%rowtype; received numeric; refund numeric;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  SELECT * INTO op FROM business_operations WHERE id=_operation_id AND user_id=uid FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  IF _action='cancel' THEN
    IF op.status='cancelled' THEN RETURN; END IF;
    IF op.returned_at IS NOT NULL THEN RAISE EXCEPTION 'Locação já encerrada'; END IF;
    SELECT coalesce(sum(amount),0) INTO received FROM business_payments WHERE operation_id=op.id AND kind IN ('receipt','down_payment');
    IF received>0 THEN INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,op.id,'refund',received,coalesce(_data->>'method','pix'),_request_id); END IF;
    refund:=op.deposit-op.deposit_returned;
    IF refund>0 THEN INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,op.id,'deposit_refund',refund,coalesce(_data->>'method','pix'),gen_random_uuid()); END IF;
    UPDATE business_receivables SET status='cancelled' WHERE operation_id=op.id;
    UPDATE business_operations SET status='cancelled',deposit_returned=deposit,notes=notes||E'\nCancelamento: '||coalesce(_data->>'notes','') WHERE id=op.id;
  ELSIF _action='return' THEN
    IF op.kind<>'rental' OR op.status='cancelled' THEN RAISE EXCEPTION 'Locação inválida'; END IF;
    IF op.returned_at IS NOT NULL THEN RETURN; END IF;
    IF (_data->>'odometer')::numeric IS NULL OR (_data->>'odometer')::numeric<coalesce((op.details->>'odometer')::numeric,0) THEN RAISE EXCEPTION 'Quilometragem final inválida'; END IF;
    refund:=op.deposit-op.deposit_returned;
    IF refund>0 THEN INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,op.id,'deposit_refund',refund,coalesce(_data->>'method','pix'),_request_id); END IF;
    UPDATE business_operations SET status='completed',returned_at=now(),deposit_returned=deposit,details=details||jsonb_build_object('return',_data) WHERE id=op.id;
  ELSE RAISE EXCEPTION 'Ação inválida'; END IF;
  UPDATE business_assets SET status='available' WHERE id=op.asset_id AND user_id=uid;
  INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(uid,_action,'business_operation',op.id,_data);
END $$;


--
-- Name: collector_login_by_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collector_login_by_token(_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tok       public.collector_tokens%rowtype;
  _collector public.collectors%rowtype;
  _owner     jsonb;
  _branding  jsonb;
  _clientes  jsonb;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN RETURN NULL; END IF;

  SELECT * INTO _tok
    FROM public.collector_tokens
   WHERE token = btrim(_token) AND is_active
   LIMIT 1;
  IF _tok.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _collector FROM public.collectors WHERE id = _tok.collector_id;
  -- Cobrador desativado perde o acesso mesmo com token ainda ativo.
  IF _collector.id IS NULL OR _collector.is_active IS NOT TRUE THEN RETURN NULL; END IF;

  -- Só os clientes atribuídos a ESTE cobrador, com as parcelas de cada um.
  SELECT coalesce(jsonb_agg(payload ORDER BY payload->>'name'), '[]'::jsonb)
  INTO _clientes
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'whatsapp', c.whatsapp,
      'cpf_cnpj', c.cpf_cnpj, 'email', c.email, 'status', c.status, 'address', c.address,
      'installments', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id, 'installment_number', i.installment_number, 'amount', i.amount,
          'due_date', i.due_date, 'status', i.status, 'paid_at', i.paid_at,
          'paid_amount', i.paid_amount, 'late_fee', i.late_fee,
          'payment_method', i.payment_method, 'receipt_url', i.receipt_url,
          'contract_id', i.contract_id,
          'contract_status', ct.status,
          'has_active_settlement', i.pre_settlement_snapshot IS NOT NULL,
          'daily_interest_percent', ct.daily_interest_percent,
          'max_interest_cap_percent', ct.max_interest_cap_percent,
          'daily_penalty_type', ct.daily_penalty_type,
          'daily_penalty_value', ct.daily_penalty_value
        ) ORDER BY i.due_date ASC)
        FROM public.contract_installments i
        JOIN public.contracts ct ON ct.id = i.contract_id AND ct.user_id = _tok.user_id AND ct.client_id = c.id
        WHERE i.client_id = c.id AND i.user_id = _tok.user_id
      ), '[]'::jsonb)
    ) AS payload
    FROM public.collector_assignments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.collector_id = _tok.collector_id AND a.user_id = _tok.user_id AND c.user_id = _tok.user_id
  ) t;

  SELECT jsonb_build_object('name', p.name, 'pix_key', p.pix_key,
                            'pix_key_type', p.pix_key_type, 'billing_message', p.billing_message)
    INTO _owner FROM public.profiles p WHERE p.id = _tok.user_id;

  SELECT jsonb_build_object('company_name', s.company_name, 'company_logo_url', s.company_logo_url,
                            'portal_primary_color', s.portal_primary_color)
    INTO _branding FROM public.settings s WHERE s.user_id = _tok.user_id LIMIT 1;

  RETURN jsonb_build_object(
    'collector', jsonb_build_object(
      'id', _collector.id, 'name', _collector.name, 'phone', _collector.phone,
      'email', _collector.email, 'city', _collector.city, 'state', _collector.state,
      'created_at', _collector.created_at
    ),
    'owner_id', _tok.user_id,
    'owner', coalesce(_owner, '{}'::jsonb),
    'branding', coalesce(_branding, '{}'::jsonb),
    'clients', _clientes
  );
END;
$$;


--
-- Name: collector_register_payment(text, uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text DEFAULT 'dinheiro'::text, _receipt_url text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE
  _tok public.collector_tokens%rowtype; _collector public.collectors%rowtype;
  _inst public.contract_installments%rowtype; _prev numeric; _new numeric;
  _allocation record;
  _new_principal numeric; _new_interest numeric; _new_fees numeric; _remaining integer;
  _daily_rate numeric; _cap_percent numeric;
  _live_fee numeric; _expected_total numeric;
  _penalty_type text; _penalty_value numeric; _contract_status text;
BEGIN
  SELECT * INTO _tok FROM public.collector_tokens
  WHERE token = btrim(coalesce(_token,'')) AND is_active LIMIT 1;
  IF _tok.id IS NULL THEN RAISE EXCEPTION 'token_invalido'; END IF;
  SELECT * INTO _collector FROM public.collectors WHERE id = _tok.collector_id;
  IF _collector.id IS NULL OR NOT _collector.is_active THEN RAISE EXCEPTION 'cobrador_inativo'; END IF;
  SELECT * INTO _inst FROM public.contract_installments WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL THEN RAISE EXCEPTION 'parcela_nao_encontrada'; END IF;
  IF _inst.user_id IS DISTINCT FROM _tok.user_id THEN RAISE EXCEPTION 'parcela_de_outro_credor'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.collector_assignments a
    WHERE a.collector_id = _tok.collector_id AND a.client_id = _inst.client_id
      AND a.user_id = _tok.user_id) THEN RAISE EXCEPTION 'cliente_nao_atribuido'; END IF;
  IF _inst.status = 'cancelled' THEN RAISE EXCEPTION 'parcela_cancelada'; END IF;
  IF _inst.status = 'paid' THEN RETURN jsonb_build_object('ok', true, 'already_paid', true, 'new_money', 0); END IF;
  SELECT c.daily_interest_percent, c.max_interest_cap_percent,
    c.daily_penalty_type, c.daily_penalty_value, c.status
    INTO _daily_rate, _cap_percent, _penalty_type, _penalty_value, _contract_status
  FROM public.contracts c
  WHERE c.id = _inst.contract_id AND c.user_id = _tok.user_id AND c.client_id = _inst.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrato_nao_encontrado'; END IF;
  IF _contract_status IN ('cancelled','canceled') THEN RAISE EXCEPTION 'contrato_cancelado'; END IF;
  _live_fee := public.quote_installment_late_fee(
    _inst.amount,_inst.due_date,_inst.status,_inst.late_fee,_inst.pre_settlement_snapshot,
    _daily_rate,_penalty_type,_penalty_value,_cap_percent);
  IF _paid_total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'valor_de_quitacao_invalido'; END IF;
  _prev := round(coalesce(_inst.paid_amount,0)::numeric,2);
  _paid_total := round(coalesce(_paid_total,0)::numeric,2);
  _expected_total := round((_inst.amount + _live_fee)::numeric, 2);
  IF _paid_total <= _prev OR abs(_paid_total - _expected_total) > 0.005 THEN
    RAISE EXCEPTION 'valor_de_quitacao_invalido';
  END IF;
  IF _method IS NULL OR _method NOT IN ('pix', 'dinheiro', 'transferencia') THEN RAISE EXCEPTION 'metodo_invalido'; END IF;
  IF _receipt_url IS NOT NULL AND length(_receipt_url) > 2048 THEN RAISE EXCEPTION 'comprovante_invalido'; END IF;
  _new := _paid_total - _prev;
  SELECT * INTO _allocation FROM public.allocate_installment_receipt(
    _new, _prev, _inst.paid_principal, _inst.paid_interest, _inst.paid_fees,
    _inst.amount, _live_fee, _inst.scheduled_interest);
  _new_principal := _allocation.principal_amount;
  _new_interest := _allocation.interest_amount;
  _new_fees := _allocation.fee_amount;
  UPDATE public.contract_installments SET paid_amount=_paid_total,
    paid_principal=coalesce(_inst.paid_principal,0)+_new_principal,
    paid_interest=coalesce(_inst.paid_interest,0)+_new_interest,
    paid_fees=coalesce(_inst.paid_fees,0)+_new_fees,
    late_fee=_live_fee, payment_method=_method,
    receipt_url=coalesce(_receipt_url,receipt_url), status='paid', paid_at=now()
  WHERE id=_installment_id;
  IF _new_interest+_new_fees > 0 THEN
    INSERT INTO public.profits(user_id,amount,description,client_id,installment_id)
    VALUES(_tok.user_id,_new_interest+_new_fees,'Juros e encargos parcela #'||_inst.installment_number,
      _inst.client_id,_installment_id)
    ON CONFLICT (installment_id) WHERE installment_id IS NOT NULL
    DO UPDATE SET amount=public.profits.amount+excluded.amount
      WHERE public.profits.user_id=_tok.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'profit_owner_mismatch'; END IF;
  END IF;
  INSERT INTO public.transactions(user_id,amount,type,category,description,client_id,contract_id,
    installment_id,principal_amount,interest_amount,fee_amount,unallocated_amount)
  VALUES(_tok.user_id,_new,'payment','installment_payment',
    'Pagamento parcela #'||_inst.installment_number||' recebido por '||_collector.name,
    _inst.client_id,_inst.contract_id,_installment_id,greatest(0,_new_principal),
    greatest(0,_new_interest),greatest(0,_new_fees),_allocation.unallocated_amount);
  INSERT INTO public.collection_attempts(user_id,client_id,contract_id,installment_id,channel,message_preview)
  VALUES(_tok.user_id,_inst.client_id,_inst.contract_id,_installment_id,'manual',
    'Pagamento de '||_new::text||' via '||coalesce(_method,'-')||' por '||_collector.name);
  SELECT count(*) INTO _remaining FROM public.contract_installments
  WHERE contract_id=_inst.contract_id AND user_id=_tok.user_id
    AND (status IS NULL OR status NOT IN ('paid', 'cancelled'));
  IF _remaining=0 THEN UPDATE public.contracts SET status='completed' WHERE id=_inst.contract_id; END IF;
  RETURN jsonb_build_object('ok',true,'new_money',_new,'principal',_new_principal,
    'interest',_new_interest,'fees',_new_fees,
    'allocation_pending_review',_allocation.review_required,'unallocated_amount',_allocation.unallocated_amount);
END;
$$;


--
-- Name: confirm_whatsapp_receipt(uuid, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.confirm_whatsapp_receipt(_review_id uuid, _received_amount numeric, _next_due_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE review public.whatsapp_receipt_reviews%rowtype; inst public.contract_installments%rowtype; result jsonb; remaining numeric; received numeric; allocations jsonb:='[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO review FROM public.whatsapp_receipt_reviews WHERE id=_review_id AND user_id=auth.uid() FOR UPDATE;
  IF review.id IS NULL THEN RAISE EXCEPTION 'receipt_review_not_found'; END IF;
  IF review.status='approved' THEN RETURN jsonb_build_object('ok',true,'already_approved',true); END IF;
  IF review.status<>'pending' THEN RAISE EXCEPTION 'receipt_review_not_pending'; END IF;
  IF _received_amount IS NULL OR _received_amount<=0 THEN RAISE EXCEPTION 'received_amount_required'; END IF;
  SELECT * INTO inst FROM public.contract_installments WHERE id=review.installment_id AND user_id=auth.uid() AND client_id=review.client_id FOR UPDATE;
  IF inst.id IS NULL OR inst.status IN ('paid','cancelled') THEN RAISE EXCEPTION 'installment_not_open'; END IF;
  IF review.metadata->>'payment_kind'='interest_only' THEN
    IF _next_due_date IS NULL OR _next_due_date<=greatest(current_date,inst.due_date) THEN RAISE EXCEPTION 'future_renewal_due_date_required'; END IF;
    IF coalesce(inst.paid_amount,0)>0 THEN RAISE EXCEPTION 'partial_payment_requires_manual_reconciliation'; END IF;
    result:=public.renew_installment_interest(inst.id,_next_due_date,'pix','Comprovante conferido '||review.id::text,NULL);
    IF abs(round(_received_amount,2)-coalesce((result->>'amount')::numeric,0))>=0.01 THEN RAISE EXCEPTION 'renewal_amount_mismatch'; END IF;
    UPDATE public.whatsapp_receipt_reviews SET amount=round(_received_amount,2),status='approved',reviewed_at=now(),reviewed_by=auth.uid(),
      metadata=coalesce(metadata,'{}')||jsonb_build_object('next_due_date',_next_due_date) WHERE id=review.id;
    RETURN jsonb_build_object('ok',true,'review_id',review.id,'renewal',result);
  END IF;
  remaining:=round(_received_amount,2);
  FOR inst IN SELECT i.* FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id AND c.user_id=auth.uid()
    WHERE i.user_id=auth.uid() AND i.client_id=review.client_id AND i.status NOT IN ('paid','cancelled') AND c.status IN ('active','overdue')
    ORDER BY CASE WHEN i.id=review.installment_id THEN 0 ELSE 1 END,i.due_date,i.id FOR UPDATE OF i
  LOOP
    EXIT WHEN remaining<0.01;
    result:=public.pay_installment(inst.id,coalesce(inst.paid_amount,0)+remaining,false,'pix',NULL,'wa-reviewed:'||review.id::text||':'||inst.id::text);
    received:=coalesce((result->>'received')::numeric,0);
    IF received<=0 THEN RAISE EXCEPTION 'payment_allocation_unavailable'; END IF;
    remaining:=round(remaining-received,2);
    allocations:=allocations||jsonb_build_array(result);
  END LOOP;
  IF remaining>=0.01 THEN RAISE EXCEPTION 'payment_exceeds_open_balance'; END IF;
  UPDATE public.whatsapp_receipt_reviews SET amount=round(_received_amount,2),status='approved',reviewed_at=now(),reviewed_by=auth.uid() WHERE id=review.id;
  RETURN jsonb_build_object('ok',true,'review_id',review.id,'allocations',allocations);
END; $$;


--
-- Name: contract_has_unsettled_installments(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.contract_has_unsettled_installments(_contract_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contract_installments i
    WHERE i.contract_id = _contract_id
      AND i.status IS DISTINCT FROM 'cancelled'
      AND (
        i.status IS DISTINCT FROM 'paid'
        OR round(greatest(0, coalesce(i.paid_amount, 0)), 2)
           < round(greatest(0, coalesce(i.amount, 0))
                   + greatest(0, coalesce(i.late_fee, 0)), 2)
      )
  );
$$;


--
-- Name: convert_whatsapp_lead_to_client(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_whatsapp_lead_to_client(_lead_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _lead public.leads%rowtype;
  _client_id uuid;
  _phone_digits text;
  _cpf_digits text;
  _created boolean := false;
BEGIN
  SELECT * INTO _lead FROM public.leads
  WHERE id = _lead_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitacao nao encontrada ou sem permissao'; END IF;
  IF _lead.converted_client_id IS NOT NULL THEN
    RETURN jsonb_build_object('client_id', _lead.converted_client_id, 'created', false, 'already_converted', true);
  END IF;

  _phone_digits := regexp_replace(coalesce(_lead.phone, ''), '\D', '', 'g');
  _cpf_digits := regexp_replace(coalesce(_lead.cpf, ''), '\D', '', 'g');
  SELECT id INTO _client_id FROM public.clients
  WHERE user_id = auth.uid() AND (
    (_cpf_digits <> '' AND regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = _cpf_digits)
    OR (_phone_digits <> '' AND (regexp_replace(coalesce(phone, ''), '\D', '', 'g') = _phone_digits OR regexp_replace(coalesce(whatsapp, ''), '\D', '', 'g') = _phone_digits))
  ) ORDER BY created_at LIMIT 1;

  IF _client_id IS NULL THEN
    INSERT INTO public.clients (user_id, name, phone, whatsapp, cpf_cnpj, email, credit_score, documents, status, client_type)
    VALUES (auth.uid(), coalesce(nullif(btrim(_lead.name), ''), 'Cliente ' || coalesce(nullif(_lead.phone, ''), 'sem nome')),
      nullif(_lead.phone, ''), nullif(_lead.phone, ''), nullif(_lead.cpf, ''), nullif(_lead.email, ''),
      greatest(0, least(100, coalesce(_lead.score, 0))), coalesce(_lead.notes->'docs', '{}'::jsonb), 'active', 'loan')
    RETURNING id INTO _client_id;
    _created := true;
  ELSE
    UPDATE public.clients SET
      phone = coalesce(nullif(phone, ''), nullif(_lead.phone, '')),
      whatsapp = coalesce(nullif(whatsapp, ''), nullif(_lead.phone, '')),
      cpf_cnpj = coalesce(nullif(cpf_cnpj, ''), nullif(_lead.cpf, '')),
      email = coalesce(nullif(email, ''), nullif(_lead.email, '')),
      documents = CASE WHEN coalesce(documents, '{}'::jsonb) = '{}'::jsonb THEN coalesce(_lead.notes->'docs', '{}'::jsonb) ELSE documents END
    WHERE id = _client_id AND user_id = auth.uid();
  END IF;

  UPDATE public.leads SET converted_client_id = _client_id, stage = 'converted', updated_at = now()
  WHERE id = _lead.id AND user_id = auth.uid();
  UPDATE public.whatsapp_conversations SET client_id = _client_id, updated_at = now()
  WHERE user_id = auth.uid() AND _phone_digits <> '' AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = _phone_digits;
  RETURN jsonb_build_object('client_id', _client_id, 'created', _created, 'already_converted', false);
END;
$$;


--
-- Name: create_business_operation(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_business_operation(_data jsonb, _request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE uid uuid:=auth.uid(); asset business_assets%rowtype; result uuid; total numeric; entry numeric; deposit numeric;
  start_at date; end_at date; due date; billing text; rate numeric; count integer; n integer; cents bigint; part bigint; remaining bigint; op_kind text;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Identificação da operação obrigatória'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM business_operations WHERE user_id=uid AND request_id=_request_id; IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM clients WHERE id=(_data->>'client_id')::uuid AND user_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  SELECT * INTO asset FROM business_assets WHERE id=(_data->>'asset_id')::uuid AND user_id=uid FOR UPDATE;
  IF asset.id IS NULL OR asset.status<>'available' THEN RAISE EXCEPTION 'Bem indisponível para esta operação'; END IF;
  op_kind:=_data->>'kind'; billing:=coalesce(_data->>'billing','monthly');
  start_at:=(_data->>'start_date')::date; due:=coalesce((_data->>'first_due')::date,start_at);
  IF start_at IS NULL OR due<start_at OR billing NOT IN ('daily','weekly','monthly') THEN RAISE EXCEPTION 'Datas ou frequência inválidas'; END IF;
  entry:=round(coalesce((_data->>'down_payment')::numeric,0),2); deposit:=round(coalesce((_data->>'deposit')::numeric,0),2);
  IF op_kind='sale' THEN
    IF asset.kind<>'phone' THEN RAISE EXCEPTION 'Selecione um celular disponível'; END IF;
    total:=round((_data->>'total')::numeric,2);count:=(_data->>'installments')::integer;rate:=0;deposit:=0;
  ELSIF op_kind='rental' THEN
    IF asset.kind NOT IN ('car','motorcycle') THEN RAISE EXCEPTION 'Selecione um veículo disponível'; END IF;
    end_at:=(_data->>'end_date')::date;rate:=round((_data->>'rate')::numeric,2);count:=0;due:=start_at;
    IF end_at IS NULL OR end_at<=start_at OR end_at>start_at+interval '5 years' OR rate IS NULL OR rate<=0 THEN RAISE EXCEPTION 'Informe período de locação e valor válidos'; END IF;
    WHILE due<end_at LOOP
      count:=count+1;
      due:=CASE billing WHEN 'daily' THEN start_at+count WHEN 'weekly' THEN start_at+7*count ELSE (start_at+make_interval(months=>count))::date END;
    END LOOP;
    total:=rate*count;entry:=0;
  ELSE RAISE EXCEPTION 'Operação inválida'; END IF;
  IF total IS NULL OR total<=0 OR total>999999999 OR entry<0 OR entry>total OR deposit<0 OR count IS NULL OR count<1 OR count>366 THEN RAISE EXCEPTION 'Confira valores e quantidade de parcelas (máximo 366)'; END IF;
  remaining:=round((total-entry)*100)::bigint;
  IF remaining>0 AND remaining<count THEN RAISE EXCEPTION 'Valor insuficiente para dividir em parcelas'; END IF;
  INSERT INTO business_operations(user_id,client_id,asset_id,kind,total,down_payment,deposit,start_date,end_date,billing,rate,notes,details,request_id)
  VALUES(uid,(_data->>'client_id')::uuid,asset.id,op_kind,total,entry,deposit,start_at,end_at,billing,rate,coalesce(_data->>'notes',''),coalesce(_data->'details','{}'),_request_id) RETURNING id INTO result;
  IF remaining>0 THEN
    FOR n IN 1..count LOOP
      cents:=remaining/count+CASE WHEN n<=remaining%count THEN 1 ELSE 0 END;
      due:=CASE billing WHEN 'daily' THEN coalesce((_data->>'first_due')::date,start_at)+(n-1) WHEN 'weekly' THEN coalesce((_data->>'first_due')::date,start_at)+7*(n-1) ELSE (coalesce((_data->>'first_due')::date,start_at)+make_interval(months=>n-1))::date END;
      IF op_kind='rental' THEN due:=CASE billing WHEN 'daily' THEN start_at+n-1 WHEN 'weekly' THEN start_at+7*(n-1) ELSE (start_at+make_interval(months=>n-1))::date END; END IF;
      INSERT INTO business_receivables(user_id,operation_id,number,amount,due_date) VALUES(uid,result,n,cents/100.0,due);
    END LOOP;
  END IF;
  IF entry>0 THEN
    INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,result,'down_payment',entry,coalesce(_data->>'method','pix'),gen_random_uuid());
  END IF;
  IF deposit>0 THEN
    INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,result,'deposit',deposit,coalesce(_data->>'method','pix'),gen_random_uuid());
  END IF;
  UPDATE business_assets SET status=CASE WHEN op_kind='sale' THEN 'sold' ELSE 'rented' END WHERE id=asset.id;
  IF op_kind='sale' AND remaining=0 THEN UPDATE business_operations SET status='completed' WHERE id=result; END IF;
  INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(uid,'create','business_operation',result,jsonb_build_object('kind',op_kind,'total',total));
  RETURN result;
END $$;


--
-- Name: create_client_contract(uuid, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _cid uuid := coalesce(_client_id, gen_random_uuid());
  _contract_id uuid := gen_random_uuid();
  _created_client boolean := _client_id IS NULL;
  _count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF jsonb_typeof(_installments) <> 'array' OR jsonb_array_length(_installments) = 0 THEN
    RAISE EXCEPTION 'installments_required';
  END IF;

  IF _created_client THEN
    INSERT INTO public.clients
      (id, user_id, name, email, phone, whatsapp, cpf_cnpj, birth_date,
       client_type, status, avatar_url, address)
    VALUES
      (_cid, auth.uid(), nullif(btrim(_client->>'name'), ''), nullif(btrim(_client->>'email'), ''),
       nullif(btrim(_client->>'phone'), ''), nullif(btrim(_client->>'whatsapp'), ''),
       nullif(btrim(_client->>'cpf_cnpj'), ''), nullif(_client->>'birth_date', '')::date,
       coalesce(nullif(_client->>'client_type', ''), 'loan'),
       coalesce(nullif(_client->>'status', ''), 'Ativo'), nullif(_client->>'avatar_url', ''),
       _client->'address');
  ELSIF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = _cid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'client_not_found';
  END IF;

  INSERT INTO public.contracts
    (id, user_id, client_id, capital, interest_rate, num_installments,
     installment_amount, frequency, start_date, late_fee_percent,
     daily_interest_percent, total_amount, total_interest, status, notes,
     loan_mode, grace_periods, grace_days, payment_method, auto_renew,
     early_payment_discount_percent, max_interest_cap_percent, guarantee_type,
     guarantee_description, guarantor_name, guarantor_cpf, guarantor_phone,
     attachments, investor_loan_id, signature_status, signature_token)
  VALUES
    (_contract_id, auth.uid(), _cid, (_contract->>'capital')::numeric,
     (_contract->>'interest_rate')::numeric, (_contract->>'num_installments')::integer,
     (_contract->>'installment_amount')::numeric, _contract->>'frequency',
     (_contract->>'start_date')::timestamptz, coalesce((_contract->>'late_fee_percent')::numeric, 0),
     coalesce((_contract->>'daily_interest_percent')::numeric, 0),
     (_contract->>'total_amount')::numeric, (_contract->>'total_interest')::numeric,
     coalesce(_contract->>'status', 'active'), nullif(_contract->>'notes', ''),
     nullif(_contract->>'loan_mode', ''), coalesce((_contract->>'grace_periods')::integer, 0),
     coalesce((_contract->>'grace_days')::integer, 0), nullif(_contract->>'payment_method', ''),
     coalesce((_contract->>'auto_renew')::boolean, false),
     coalesce((_contract->>'early_payment_discount_percent')::numeric, 0),
     nullif(_contract->>'max_interest_cap_percent', '')::numeric,
     nullif(_contract->>'guarantee_type', ''), nullif(_contract->>'guarantee_description', ''),
     nullif(_contract->>'guarantor_name', ''), nullif(_contract->>'guarantor_cpf', ''),
     nullif(_contract->>'guarantor_phone', ''), coalesce(_contract->'attachments', '[]'::jsonb),
     nullif(_contract->>'investor_loan_id', '')::uuid,
     coalesce(_contract->>'signature_status', 'not_required'),
     nullif(_contract->>'signature_token', '')::text);

  INSERT INTO public.contract_installments
    (user_id, contract_id, client_id, installment_number, amount, due_date, status)
  SELECT auth.uid(), _contract_id, _cid, x.installment_number, x.amount, x.due_date, 'pending'
  FROM jsonb_to_recordset(_installments) AS x(
    installment_number integer,
    amount numeric,
    due_date timestamptz
  );

  GET DIAGNOSTICS _count = ROW_COUNT;
  IF _count <> (_contract->>'num_installments')::integer THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  RETURN jsonb_build_object('client_id', _cid, 'contract_id', _contract_id, 'installment_count', _count);
END;
$$;


--
-- Name: create_client_contract_with_collateral(uuid, jsonb, jsonb, jsonb, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_client_contract_with_collateral(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb, _collateral jsonb, _request_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE result jsonb; previous loan_collateral%rowtype;
BEGIN
  IF auth.uid() IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||_request_id::text,0));
  SELECT * INTO previous FROM loan_collateral WHERE user_id=auth.uid() AND request_id=_request_id;
  IF previous.id IS NOT NULL THEN RETURN jsonb_build_object('client_id',previous.client_id,'contract_id',previous.contract_id,'installment_count',(SELECT count(*) FROM contract_installments WHERE contract_id=previous.contract_id)); END IF;
  result:=public.create_client_contract(_client_id,_client,_contract,_installments);
  PERFORM public.save_loan_collateral((result->>'contract_id')::uuid,_collateral,_request_id);
  RETURN result;
END $$;


--
-- Name: delete_client_cascade(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_client_cascade(_client_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  client_row public.clients%ROWTYPE;
  contract_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT * INTO client_row
  FROM public.clients
  WHERE id = _client_id AND user_id = uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  -- Contracts are removed through the same guarded function used by the detail page.
  FOR contract_id IN
    SELECT id FROM public.contracts WHERE client_id = _client_id AND user_id = uid FOR UPDATE
  LOOP
    PERFORM public.delete_contract_atomically(contract_id);
  END LOOP;

  DELETE FROM public.business_payments
  WHERE user_id = uid AND operation_id IN (
    SELECT id FROM public.business_operations WHERE client_id = _client_id AND user_id = uid
  );
  DELETE FROM public.business_receivables
  WHERE user_id = uid AND operation_id IN (
    SELECT id FROM public.business_operations WHERE client_id = _client_id AND user_id = uid
  );
  DELETE FROM public.business_operations
  WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.loan_collateral WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.client_notifications WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.client_tokens WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.portal_sessions WHERE client_id = _client_id;
  DELETE FROM public.collector_assignments WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.collection_attempts WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.profits WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.transactions WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.whatsapp_conversations WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.bot_actions_log WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.leads WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.rentals WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.clients WHERE id = _client_id AND user_id = uid;
END;
$$;


--
-- Name: delete_contract_atomically(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_contract_atomically(_contract_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  uid uuid := auth.uid();
  contract_row public.contracts%ROWTYPE;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT * INTO contract_row
  FROM public.contracts
  WHERE id = _contract_id AND user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  IF to_regclass('public.contract_installments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='client_notifications' AND column_name='contract_id') THEN
      EXECUTE 'DELETE FROM public.client_notifications WHERE user_id = $1 AND contract_id = $2' USING uid, _contract_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='collection_attempts' AND column_name='contract_id') THEN
      EXECUTE 'DELETE FROM public.collection_attempts WHERE user_id = $1 AND contract_id = $2' USING uid, _contract_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profits' AND column_name='contract_id') THEN
      EXECUTE 'DELETE FROM public.profits WHERE user_id = $1 AND contract_id = $2' USING uid, _contract_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='contract_id') THEN
      EXECUTE 'DELETE FROM public.transactions WHERE user_id = $1 AND contract_id = $2' USING uid, _contract_id;
    END IF;
    IF to_regclass('public.loan_collateral') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='loan_collateral' AND column_name='contract_id') THEN
      EXECUTE 'DELETE FROM public.loan_collateral WHERE user_id = $1 AND contract_id = $2' USING uid, _contract_id;
    END IF;
    DELETE FROM public.contract_installments WHERE user_id = uid AND contract_id = _contract_id;
  END IF;

  DELETE FROM public.contracts WHERE user_id = uid AND id = _contract_id;
END;
$_$;


--
-- Name: enqueue_payment_receipt(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_payment_receipt(_transaction_id uuid, _user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
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
$_$;


--
-- Name: expire_payment_promises(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_payment_promises(_reference_date date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _count integer;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.payment_promises
     SET status = 'broken', broken_at = now()
   WHERE status = 'open'
     AND promised_for < _reference_date
     AND (auth.role() = 'service_role' OR user_id = auth.uid());
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;


--
-- Name: financial_analytics_report(date, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.financial_analytics_report(_from date DEFAULT NULL::date, _to date DEFAULT NULL::date, _expected_owner uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE uid uuid:=auth.uid(); today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; result jsonb; wallet jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
 IF _expected_owner IS NOT NULL AND _expected_owner<>uid THEN RAISE EXCEPTION 'financial_owner_changed' USING ERRCODE='42501'; END IF;
 IF (_from IS NULL)<>(_to IS NULL) OR _from>_to OR (_from IS NOT NULL AND (NOT isfinite(_from) OR NOT isfinite(_to) OR _to-_from>3660)) THEN
  RAISE EXCEPTION 'invalid_financial_period' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.transactions WHERE user_id=uid)>50000 THEN RAISE EXCEPTION 'financial_event_limit' USING ERRCODE='54000'; END IF;
 wallet:=public.wallet_cash_report(NULL,'',0,1);
 WITH raw AS MATERIALIZED (
  SELECT t.*,round(amount,2) AS cash,CASE WHEN date IS NOT NULL AND isfinite(date) THEN (date AT TIME ZONE 'America/Sao_Paulo')::date ELSE NULL END AS day,
   CASE WHEN least(principal_amount,interest_amount,fee_amount,unallocated_amount)>=0
    AND principal_amount::text NOT IN ('NaN','Infinity','-Infinity') AND interest_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND fee_amount::text NOT IN ('NaN','Infinity','-Infinity') AND unallocated_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND round(principal_amount,2)+round(interest_amount,2)+round(fee_amount,2)+round(unallocated_amount,2)<=round(amount,2) THEN true ELSE false END AS classified
  FROM public.transactions t WHERE user_id=uid AND amount>0 AND type IN ('payment','partial_payment','loan','loan_disbursement')
   AND (date IS NULL OR NOT isfinite(date) OR (date AT TIME ZONE 'America/Sao_Paulo')::date<=today)
 ), receipts AS MATERIALIZED (
  SELECT id,contract_id,client_id,installment_id,CASE WHEN day IS NOT NULL THEN date ELSE NULL END AS date,day,coalesce(description,'Recebimento') AS description,category,cash AS amount,
   coalesce((SELECT name FROM public.clients c WHERE c.id=raw.client_id AND c.user_id=uid),'Recebimento registrado') AS client_name,
   CASE WHEN classified THEN round(principal_amount,2) ELSE 0 END AS principal,
   CASE WHEN classified THEN round(interest_amount,2) ELSE 0 END AS interest,
   CASE WHEN classified THEN round(fee_amount,2) ELSE 0 END AS fees,
   CASE WHEN classified THEN greatest(0,cash-round(principal_amount,2)-round(interest_amount,2)-round(fee_amount,2)) ELSE cash END AS unclassified
  FROM raw WHERE type IN ('payment','partial_payment')
 ), disbursements AS MATERIALIZED (
  SELECT id,contract_id,client_id,CASE WHEN day IS NOT NULL THEN date ELSE NULL END AS date,day,cash AS amount FROM raw WHERE type IN ('loan','loan_disbursement')
 ), expenses AS MATERIALIZED (
  SELECT 'expense:'||id::text AS id,description,category,round(amount,2) amount,date,(date AT TIME ZONE 'America/Sao_Paulo')::date AS day
  FROM public.expenses WHERE user_id=uid AND amount>0 AND date IS NOT NULL AND isfinite(date) AND (date AT TIME ZONE 'America/Sao_Paulo')::date<=today
  UNION ALL
  SELECT 'transaction:'||id::text,description,coalesce(category,'Pagamento a investidor'),round(amount,2),date,(date AT TIME ZONE 'America/Sao_Paulo')::date
  FROM public.transactions WHERE user_id=uid AND type='expense' AND amount>0 AND date IS NOT NULL AND isfinite(date) AND (date AT TIME ZONE 'America/Sao_Paulo')::date<=today
 ), capital AS (
  SELECT c.id AS contract_id,coalesce(d.amount,0) AS disbursed,coalesce(r.amount,0) AS returned,
   greatest(0,coalesce(d.amount,0)-coalesce(r.amount,0)) AS outstanding
  FROM public.contracts c
  LEFT JOIN (SELECT contract_id,sum(amount) amount FROM disbursements GROUP BY contract_id) d ON d.contract_id=c.id
  LEFT JOIN (SELECT contract_id,sum(principal) amount FROM receipts GROUP BY contract_id) r ON r.contract_id=c.id
  WHERE c.user_id=uid
 ), period_receipts AS (SELECT * FROM receipts WHERE _from IS NULL OR day BETWEEN _from AND _to)
 SELECT jsonb_build_object('wallet',wallet,
  'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY date DESC,id) FROM period_receipts r),'[]'::jsonb),
  'disbursements',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY date DESC,id) FROM disbursements d WHERE _from IS NULL OR day BETWEEN _from AND _to),'[]'::jsonb),
  'expenses',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY date DESC,id) FROM expenses e WHERE _from IS NULL OR day BETWEEN _from AND _to),'[]'::jsonb),
  'capital',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM capital c),'[]'::jsonb),
  'warnings',jsonb_build_object('contracts_without_disbursement',(SELECT count(*) FROM capital WHERE disbursed=0),
   'unlinked_principal',(SELECT coalesce(sum(principal),0) FROM receipts WHERE contract_id IS NULL))) INTO result;
 RETURN result;
END;
$$;


--
-- Name: finish_whatsapp_event(uuid, text, text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid, _success boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  UPDATE public.whatsapp_event_claims SET status=CASE WHEN _success THEN 'completed' ELSE 'failed' END,
    payload=CASE WHEN _success THEN NULL ELSE payload END
    WHERE user_id=_user_id AND instance=_instance AND message_id=_message_id AND lease_token=_lease_token;
END; $$;


--
-- Name: finish_whatsapp_response(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.finish_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  DELETE FROM public.whatsapp_response_windows WHERE user_id=_user_id AND jid=_jid AND lease_token=_lease_token;
END; $$;


--
-- Name: fulfill_payment_promises_on_installment_paid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfill_payment_promises_on_installment_paid() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    UPDATE public.payment_promises
       SET status = 'fulfilled', fulfilled_at = now()
     WHERE installment_id = NEW.id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: get_ativo_passivo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ativo_passivo() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'ativo_capital', COALESCE((
      SELECT SUM(c.capital)
      FROM public.contracts c
      WHERE c.user_id = auth.uid() AND c.status = 'active'
    ), 0),
    'ativo_a_receber', COALESCE((
      SELECT SUM(i.amount - COALESCE(i.paid_amount,0))
      FROM public.contract_installments i
      WHERE i.user_id = auth.uid() AND i.status <> 'paid'
    ), 0),
    'passivo_captado', COALESCE((
      SELECT SUM(l.principal)
      FROM public.investor_loans l
      WHERE l.user_id = auth.uid() AND l.status <> 'paid'
    ), 0),
    'passivo_a_pagar', COALESCE((
      SELECT SUM(l.total_due - COALESCE(l.paid_amount,0))
      FROM public.investor_loans l
      WHERE l.user_id = auth.uid() AND l.status <> 'paid'
    ), 0),
    'alocado_capital', COALESCE((
      SELECT SUM(c.capital)
      FROM public.contracts c
      WHERE c.user_id = auth.uid()
        AND c.status = 'active'
        AND c.investor_loan_id IS NOT NULL
    ), 0)
  )
$$;


--
-- Name: get_or_create_dm_thread(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_or_create_dm_thread(_other_user uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  me UUID := auth.uid();
  ua UUID;
  ub UUID;
  tid UUID;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF me = _other_user THEN RAISE EXCEPTION 'cannot DM yourself'; END IF;
  IF me < _other_user THEN ua := me; ub := _other_user; ELSE ua := _other_user; ub := me; END IF;
  SELECT id INTO tid FROM public.chat_dm_threads WHERE user_a = ua AND user_b = ub;
  IF tid IS NULL THEN
    INSERT INTO public.chat_dm_threads (user_a, user_b) VALUES (ua, ub) RETURNING id INTO tid;
  END IF;
  RETURN tid;
END;
$$;


--
-- Name: get_signup_checkout_url(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_signup_checkout_url() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT CASE
    WHEN COALESCE(
           (SELECT ps.allow_new_registrations FROM public.platform_settings ps WHERE ps.id LIMIT 1),
           true
         )
    THEN COALESCE(
      (SELECT NULLIF(btrim(ps.checkout_url), '')
         FROM public.platform_settings ps
        WHERE ps.id
        LIMIT 1),
      (SELECT NULLIF(btrim(s.mercadopago_checkout_url), '')
         FROM public.settings s
        WHERE NULLIF(btrim(s.mercadopago_checkout_url), '') IS NOT NULL
        ORDER BY s.created_at ASC
        LIMIT 1)
    )
    ELSE NULL   -- cadastro fechado pelo dono do app
  END
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', 'Usuário'),
        NEW.email,
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$;


--
-- Name: handle_new_user_trial(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_trial() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Sem trial automático. O acesso exige assinatura ativa, concedida pelo
  -- webhook do Mercado Pago após a confirmação do pagamento.
  NEW.trial_ends_at := NULL;
  NEW.subscription_expires_at := NULL;
  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user_with_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_with_settings() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', 'Usuário'),
        NEW.email,
        NEW.raw_user_meta_data->>'avatar_url'
    );
    
    INSERT INTO public.settings (user_id)
    VALUES (NEW.id);
    
    RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: increment_goal_amount(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_goal_amount(_goal_id uuid, _delta numeric) RETURNS numeric
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _current numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _delta IS NULL OR _delta::text IN ('NaN', 'Infinity', '-Infinity') OR round(_delta, 2) = 0 THEN
    RAISE EXCEPTION 'invalid_delta';
  END IF;

  SELECT current_amount INTO _current
  FROM public.goals
  WHERE id = _goal_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'goal_not_found'; END IF;

  _current := greatest(0, round((coalesce(_current, 0) + _delta)::numeric, 2));
  UPDATE public.goals SET current_amount = _current
  WHERE id = _goal_id AND user_id = auth.uid();
  RETURN _current;
END;
$$;


--
-- Name: investor_portal_login(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.investor_portal_login(_token uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _investor public.investors%rowtype;
  _loans jsonb;
  _branding jsonb;
  _owner jsonb;
BEGIN
  IF _token IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _investor FROM public.investors
   WHERE access_token = _token AND status = 'active'
   LIMIT 1;
  IF _investor.id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(row_payload ORDER BY (row_payload->>'due_date') ASC), '[]'::jsonb)
    INTO _loans
  FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'principal', l.principal,
      'interest_rate', l.interest_rate,
      'total_due', l.total_due,
      'paid_amount', l.paid_amount,
      'start_date', l.start_date,
      'due_date', l.due_date,
      'frequency', l.frequency,
      'status', l.status,
      'payment_method', l.payment_method,
      'paid_at', l.paid_at,
      'notes', l.notes,
      'created_at', l.created_at,
      'payments', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'amount', p.amount, 'paid_at', p.paid_at,
          'method', p.method, 'receipt_url', p.receipt_url, 'notes', p.notes
        ) ORDER BY p.paid_at DESC)
        FROM public.investor_payments p WHERE p.loan_id = l.id
      ), '[]'::jsonb)
    ) AS row_payload
    FROM public.investor_loans l
    WHERE l.investor_id = _investor.id
  ) x;

  SELECT jsonb_build_object('name', p.name, 'pix_key', p.pix_key, 'pix_key_type', p.pix_key_type)
    INTO _owner
    FROM public.profiles p WHERE p.id = _investor.user_id;

  SELECT jsonb_build_object(
    'portal_title', s.portal_title,
    'portal_primary_color', s.portal_primary_color,
    'portal_contact_phone', s.portal_contact_phone,
    'portal_contact_email', s.portal_contact_email,
    'portal_logo_url', s.portal_logo_url,
    'company_name', s.company_name,
    'company_logo_url', s.company_logo_url
  ) INTO _branding FROM public.settings s WHERE s.user_id = _investor.user_id LIMIT 1;

  RETURN jsonb_build_object(
    'investor', jsonb_build_object(
      'id', _investor.id, 'name', _investor.name, 'email', _investor.email,
      'phone', _investor.phone, 'whatsapp', _investor.whatsapp,
      'cpf_cnpj', _investor.cpf_cnpj, 'avatar_url', _investor.avatar_url,
      'status', _investor.status
    ),
    'loans', _loans,
    'owner', coalesce(_owner, '{}'::jsonb),
    'branding', coalesce(_branding, '{}'::jsonb)
  );
END; $$;


--
-- Name: investor_regenerate_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.investor_regenerate_token(_investor_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _owner uuid;
  _new uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id INTO _owner FROM public.investors WHERE id = _investor_id;
  IF _owner IS NULL OR _owner <> auth.uid() THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  UPDATE public.investors SET access_token = _new, updated_at = now() WHERE id = _investor_id;
  RETURN _new;
END; $$;


--
-- Name: is_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT true FROM public.user_roles WHERE user_id = _user_id AND role = 'admin' LIMIT 1),
    (SELECT is_admin = true FROM public.profiles WHERE id = _user_id),
    false
  )
$$;


--
-- Name: is_channel_member(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_channel_member(_channel_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members
    WHERE channel_id = _channel_id AND user_id = _user_id
  )
$$;


--
-- Name: is_dm_participant(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_dm_participant(_thread_id uuid, _user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_dm_threads
    WHERE id = _thread_id AND (user_a = _user_id OR user_b = _user_id)
  )
$$;


--
-- Name: leads_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leads_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


--
-- Name: list_public_profiles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.list_public_profiles() RETURNS TABLE(id uuid, name text, avatar_url text, is_admin boolean, is_chat_blocked boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id, p.name, p.avatar_url, p.is_admin, p.is_chat_blocked
    FROM public.profiles p
   WHERE
     -- quem é admin continua vendo todos, para dar suporte
     EXISTS (SELECT 1 FROM public.profiles eu WHERE eu.id = auth.uid() AND eu.is_admin)
     -- os demais: só a si mesmos e os admins
     OR p.id = auth.uid()
     OR p.is_admin
$$;


--
-- Name: mark_installment_collected(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_installment_collected() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.installment_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only outbound collection channels mark "cobrado"
  IF NEW.channel IN ('whatsapp','email','sms','pix_copy','manual') THEN
    UPDATE public.contract_installments
    SET
      collection_status = 'cobrado',
      last_collected_at = COALESCE(NEW.created_at, now()),
      last_collected_channel = NEW.channel,
      collection_count = COALESCE(collection_count, 0) + 1
    WHERE id = NEW.installment_id
      AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: materialize_payment_promise_from_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.materialize_payment_promise_from_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _promised_for date;
  _installment record;
  _amount numeric;
  _selected uuid;
  _source text;
BEGIN
  IF NEW.entity_type <> 'whatsapp_bot' OR NEW.action NOT IN ('promise_to_pay','payment_promise_changed') OR NEW.entity_id IS NULL THEN RETURN NEW; END IF;
  _selected := nullif(NEW.details->>'installment_id','')::uuid;
  BEGIN
    _promised_for := nullif(NEW.details->>'promise_date','')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    IF _selected IS NOT NULL THEN RAISE EXCEPTION 'promise_date_invalid'; END IF;
    RETURN NEW;
  END;
  IF _promised_for IS NULL THEN
    IF _selected IS NOT NULL THEN RAISE EXCEPTION 'promise_date_invalid'; END IF;
    RETURN NEW;
  END IF;
  _amount := nullif(NEW.details->>'promise_amount','')::numeric;
  IF nullif(NEW.details->>'installment_id','') IS NOT NULL AND _amount <= 0 THEN RAISE EXCEPTION 'promise_amount_invalid'; END IF;
  IF _amount IS NOT NULL AND _amount <= 0 THEN _amount := NULL; END IF;
  IF _selected IS NOT NULL THEN
    SELECT i.id,i.contract_id,greatest(0,i.amount+coalesce(i.late_fee,0)-coalesce(i.paid_amount,0)) AS outstanding
      INTO _installment FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id
      WHERE i.id=_selected AND i.user_id=NEW.user_id AND i.client_id=NEW.entity_id
        AND c.user_id=NEW.user_id AND c.client_id=NEW.entity_id
        AND i.status NOT IN ('paid','cancelled') AND c.status IN ('active','overdue')
      FOR UPDATE OF i;
    IF NOT FOUND THEN RAISE EXCEPTION 'promise_installment_unavailable'; END IF;
    IF _promised_for < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'promise_date_invalid'; END IF;
    IF coalesce(_amount,_installment.outstanding,0)<=0 THEN RAISE EXCEPTION 'promise_amount_invalid'; END IF;
  ELSE
    -- Compatibility for older audit producers. The current webhook always passes the selected ID.
    SELECT i.id,i.contract_id,greatest(0,i.amount+coalesce(i.late_fee,0)-coalesce(i.paid_amount,0)) AS outstanding
      INTO _installment FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id
      WHERE i.user_id=NEW.user_id AND i.client_id=NEW.entity_id
        AND c.user_id=NEW.user_id AND c.client_id=NEW.entity_id
        AND i.status NOT IN ('paid','cancelled') AND c.status IN ('active','overdue')
        AND i.amount+coalesce(i.late_fee,0)-coalesce(i.paid_amount,0)>0.009
      ORDER BY i.due_date,i.installment_number LIMIT 1 FOR UPDATE OF i;
  END IF;
  SELECT source INTO _source FROM public.payment_promises
    WHERE user_id=NEW.user_id AND client_id=NEW.entity_id AND status='open' FOR UPDATE;
  IF FOUND AND _source<>'bot' THEN RAISE EXCEPTION 'promise_human_owned'; END IF;
  UPDATE public.payment_promises SET promised_for=_promised_for,
    promised_amount=coalesce(_amount,promised_amount,_installment.outstanding),
    installment_id=coalesce(_installment.id,installment_id),contract_id=coalesce(_installment.contract_id,contract_id),
    source='bot',notes=left(coalesce(NEW.details->>'message',notes),1000)
    WHERE user_id=NEW.user_id AND client_id=NEW.entity_id AND status='open' AND source='bot';
  IF NOT FOUND THEN
    INSERT INTO public.payment_promises(user_id,client_id,contract_id,installment_id,promised_amount,promised_for,source,notes)
      VALUES(NEW.user_id,NEW.entity_id,_installment.contract_id,_installment.id,coalesce(_amount,_installment.outstanding),_promised_for,'bot',left(coalesce(NEW.details->>'message',''),1000));
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: normalize_contract_lifecycle(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_contract_lifecycle() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'completed'
     AND public.contract_has_unsettled_installments(NEW.id) THEN
    IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('active', 'overdue', 'completed') THEN
      NEW.status := OLD.status;
      NEW.lifecycle_stage := OLD.lifecycle_stage;
    ELSE
      NEW.status := 'active';
      NEW.lifecycle_stage := 'active';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending_signature' THEN
    NEW.lifecycle_stage := 'proposed';
  ELSIF NEW.status = 'completed' THEN
    NEW.lifecycle_stage := 'completed';
  ELSIF NEW.status = 'renegotiated' THEN
    NEW.lifecycle_stage := 'renegotiated';
  ELSIF NEW.status IN ('cancelled', 'canceled') THEN
    NEW.lifecycle_stage := 'cancelled';
  ELSIF NEW.status = 'active' AND NEW.lifecycle_stage IN ('draft', 'proposed', 'approved', 'signed', 'disbursed', 'completed') THEN
    NEW.lifecycle_stage := 'active';
    NEW.activated_at := coalesce(NEW.activated_at, now());
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: normalize_interest_renewal_profit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_interest_renewal_profit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ begin if new.description ilike 'Juros de renova%' then new.installment_id := null; end if; return new; end $$;


--
-- Name: notify_installment_paid(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_installment_paid() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN RETURN NEW; END;
$$;


--
-- Name: pay_client_balance(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_client_balance(_client_id uuid, _amount numeric, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE uid uuid:=auth.uid(); inst public.contract_installments%ROWTYPE; remaining numeric:=round(greatest(0,coalesce(_amount,0)),2); payment jsonb; received numeric; paid_count integer:=0; partial_count integer:=0; allocations jsonb:='[]'::jsonb; BEGIN IF uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF; IF _client_id IS NULL OR remaining<=0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF; IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id=_client_id AND user_id=uid) THEN RAISE EXCEPTION 'client_not_found'; END IF; FOR inst IN SELECT ci.* FROM public.contract_installments ci JOIN public.contracts c ON c.id=ci.contract_id AND c.user_id=ci.user_id WHERE ci.user_id=uid AND ci.client_id=_client_id AND ci.status NOT IN ('paid','cancelled') AND c.status IN ('active','overdue') ORDER BY ci.due_date NULLS FIRST,ci.installment_number NULLS FIRST,ci.id FOR UPDATE OF ci LOOP EXIT WHEN remaining<=0; payment:=public.pay_installment(inst.id,round(greatest(0,coalesce(inst.paid_amount,0))+remaining,2),false,_method,_receipt_url,NULL,0); received:=round(greatest(0,coalesce((payment->>'received')::numeric,0)),2); IF received<=0 THEN CONTINUE; END IF; remaining:=round(remaining-received,2); IF payment->>'status'='paid' THEN paid_count:=paid_count+1; ELSE partial_count:=partial_count+1; END IF; allocations:=allocations||jsonb_build_array(jsonb_build_object('installment_id',inst.id,'installment_number',inst.installment_number,'amount',received,'paid',payment->>'status'='paid')); END LOOP; RETURN jsonb_build_object('ok',true,'paid_installments',paid_count,'partial_installments',partial_count,'unallocated',remaining,'allocations',allocations); END; $$;


--
-- Name: pay_installment(uuid, numeric, boolean, text, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean DEFAULT true, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text, _source_key text DEFAULT NULL::text, _fee_discount numeric DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE
  uid uuid := auth.uid();
  inst public.contract_installments%ROWTYPE;
  contract_row public.contracts%ROWTYPE;
  total_due numeric;
  old_paid numeric;
  new_paid numeric;
  received numeric;
  effective_late_fee numeric;
  applied_fee_discount numeric;
  base_amount numeric;
  allocation record;
  old_fee numeric;
  old_interest numeric;
  old_principal numeric;
  fee_delta numeric;
  interest_delta numeric;
  principal_delta numeric;
  next_status text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF _installment_id IS NULL THEN RAISE EXCEPTION 'installment_required'; END IF;
  IF _paid_total::text IN ('NaN','Infinity','-Infinity') OR _fee_discount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  IF COALESCE(_paid_total, 0) < 0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  SELECT * INTO inst
  FROM public.contract_installments
  WHERE id = _installment_id AND user_id = uid
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  SELECT * INTO contract_row
  FROM public.contracts
  WHERE id = inst.contract_id AND user_id = uid AND client_id = inst.client_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF contract_row.status IN ('cancelled', 'canceled') THEN RAISE EXCEPTION 'contract_closed'; END IF;
  IF inst.status = 'cancelled' THEN RAISE EXCEPTION 'installment_closed'; END IF;
  old_paid := round(greatest(0, coalesce(inst.paid_amount, 0)), 2);
  IF NULLIF(trim(_source_key), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transactions WHERE user_id=uid AND source_key=trim(_source_key)
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM public.transactions
      WHERE user_id=uid AND source_key=trim(_source_key) AND installment_id=inst.id) THEN
      RAISE EXCEPTION 'payment_source_conflict';
    END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'installment_id',inst.id,
      'paid_total',old_paid,'status',inst.status);
  END IF;
  IF inst.status = 'paid' THEN
    RETURN jsonb_build_object('ok',true,'idempotent',true,'installment_id',inst.id,
      'paid_total',old_paid,'status',inst.status);
  END IF;
  base_amount := greatest(0, coalesce(inst.amount, 0));
  effective_late_fee := public.quote_installment_late_fee(
    inst.amount,inst.due_date,inst.status,inst.late_fee,inst.pre_settlement_snapshot,
    contract_row.daily_interest_percent,contract_row.daily_penalty_type,
    contract_row.daily_penalty_value,contract_row.max_interest_cap_percent);
  applied_fee_discount := CASE WHEN _mark_paid
    THEN least(greatest(0, coalesce(_fee_discount, 0)), effective_late_fee)
    ELSE 0
  END;
  IF applied_fee_discount > greatest(0, effective_late_fee - coalesce(inst.paid_fees,0)) THEN
    RAISE EXCEPTION 'fee_discount_exceeds_unpaid_fees';
  END IF;
  effective_late_fee := round(effective_late_fee - applied_fee_discount, 2);
  total_due := round(base_amount + effective_late_fee, 2);
  new_paid := round(least(total_due, greatest(old_paid, COALESCE(_paid_total, 0))), 2);
  received := round(greatest(0, new_paid - old_paid), 2);
  IF received <= 0 THEN RAISE EXCEPTION 'payment_below_installment_balance'; END IF;
  old_fee := coalesce(inst.paid_fees, 0);
  old_interest := coalesce(inst.paid_interest, 0);
  old_principal := coalesce(inst.paid_principal, 0);
  SELECT * INTO allocation FROM public.allocate_installment_receipt(
    received, old_paid, old_principal, old_interest, old_fee,
    base_amount, effective_late_fee, inst.scheduled_interest);
  fee_delta := allocation.fee_amount;
  interest_delta := allocation.interest_amount;
  principal_delta := allocation.principal_amount;
  next_status := CASE
    WHEN new_paid + 0.005 >= total_due THEN 'paid'
    ELSE CASE WHEN inst.due_date < current_date THEN 'overdue' ELSE 'pending' END
  END;
  UPDATE public.contract_installments
  SET late_fee = effective_late_fee,
      paid_amount = new_paid,
      paid_fees = old_fee + fee_delta,
      paid_interest = old_interest + interest_delta,
      paid_principal = old_principal + principal_delta,
      status = next_status,
      paid_at = CASE WHEN next_status = 'paid' THEN COALESCE(inst.paid_at, now()) ELSE inst.paid_at END,
      payment_method = COALESCE(NULLIF(_method, ''), payment_method),
      receipt_url = COALESCE(_receipt_url, receipt_url)
  WHERE id = inst.id AND user_id = uid;
  INSERT INTO public.transactions (
    user_id, amount, type, category, description, client_id, contract_id,
    installment_id, principal_amount, interest_amount, fee_amount, source_key, unallocated_amount
  ) VALUES (
    uid, received, 'payment', 'loan_payment',
    CASE WHEN next_status = 'paid' THEN 'Pagamento da parcela #' ELSE 'Pagamento parcial da parcela #' END
      || COALESCE(inst.installment_number::text, '-'),
    inst.client_id, inst.contract_id, inst.id,
    principal_delta, interest_delta, fee_delta, NULLIF(trim(_source_key), ''), allocation.unallocated_amount
  );
  IF interest_delta + fee_delta > 0 THEN
    INSERT INTO public.profits (user_id, amount, description, client_id, installment_id)
    VALUES (uid, interest_delta + fee_delta,
      'Juros e encargos da parcela #' || COALESCE(inst.installment_number::text, '-'),
      inst.client_id, inst.id)
    ON CONFLICT (installment_id) WHERE installment_id IS NOT NULL
    DO UPDATE SET amount = public.profits.amount + EXCLUDED.amount
      WHERE public.profits.user_id = uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'profit_owner_mismatch'; END IF;
  END IF;
  IF next_status = 'paid' AND NOT EXISTS (
    SELECT 1 FROM public.contract_installments
    WHERE contract_id = inst.contract_id AND user_id = uid
      AND (status IS NULL OR status NOT IN ('paid', 'cancelled'))
  ) THEN
    UPDATE public.contracts
    SET status = 'completed'
    WHERE id = inst.contract_id AND user_id = uid;
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'installment_id', inst.id,
    'paid_total', new_paid,
    'received', received,
    'late_fee', effective_late_fee,
    'fee_discount', applied_fee_discount,
    'remaining', greatest(0, round(total_due - new_paid, 2)),
    'allocation_pending_review', allocation.review_required,
    'unallocated_amount', allocation.unallocated_amount,
    'status', next_status
  );
END;
$$;


--
-- Name: pay_installment_waiving_fees(uuid, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_installment_waiving_fees(_installment_id uuid, _paid_total numeric, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _inst public.contract_installments%rowtype;
  _contract public.contracts%rowtype;
  _caller uuid := auth.uid();
  _prev_paid numeric;
  _new_money numeric;
  _interest numeric := 0;
  _waived numeric;
  _remaining integer;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO _inst FROM public.contract_installments
  WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  IF _inst.user_id <> _caller THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF _inst.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true,
      'new_money', 0, 'interest', 0, 'waived_fee', 0);
  END IF;

  _prev_paid := round(COALESCE(_inst.paid_amount, 0)::numeric, 2);
  _paid_total := round(COALESCE(_paid_total, 0)::numeric, 2);
  _waived := round(COALESCE(_inst.late_fee, 0)::numeric, 2);

  -- Perdoar os encargos quita o valor original, nunca menos que ele.
  IF abs(_paid_total - round(_inst.amount::numeric, 2)) > 0.005 THEN
    RAISE EXCEPTION 'invalid_waived_payment_total';
  END IF;
  IF _paid_total < _prev_paid THEN RAISE EXCEPTION 'paid_total_cannot_decrease'; END IF;
  _new_money := round((_paid_total - _prev_paid)::numeric, 2);

  UPDATE public.contract_installments
  SET late_fee = 0, paid_amount = _paid_total, payment_method = _method,
      receipt_url = COALESCE(_receipt_url, receipt_url),
      receipt_review_status = CASE
        WHEN COALESCE(_receipt_url, receipt_url) IS NOT NULL THEN 'approved'
        ELSE receipt_review_status END,
      status = 'paid', paid_at = now()
  WHERE id = _installment_id;

  SELECT * INTO _contract FROM public.contracts WHERE id = _inst.contract_id;
  IF _contract.id IS NOT NULL AND COALESCE(_contract.total_amount, 0) > 0 THEN
    _interest := round((_inst.amount * (_contract.total_interest / _contract.total_amount))::numeric, 2);
  END IF;
  IF _interest > 0 AND NOT EXISTS (
    SELECT 1 FROM public.profits WHERE installment_id = _installment_id
  ) THEN
    INSERT INTO public.profits (user_id, amount, description, client_id, installment_id)
    VALUES (_caller, _interest, 'Juros parcela #' || _inst.installment_number,
      _inst.client_id, _installment_id);
  END IF;

  IF _new_money > 0 THEN
    INSERT INTO public.transactions
      (user_id, amount, type, description, client_id, contract_id, installment_id)
    VALUES (_caller, _new_money, 'payment',
      'Pagamento sem encargos parcela #' || _inst.installment_number,
      _inst.client_id, _inst.contract_id, _installment_id);
  END IF;

  SELECT count(*) INTO _remaining FROM public.contract_installments
  WHERE contract_id = _inst.contract_id AND status <> 'paid';
  IF _remaining = 0 THEN
    UPDATE public.contracts SET status = 'completed'
    WHERE id = _inst.contract_id AND user_id = _caller;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_money', _new_money,
    'interest', _interest, 'waived_fee', _waived);
END;
$$;


--
-- Name: payment_allocation_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_allocation_review() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE uid uuid := auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
 WITH review AS (
   SELECT i.id,i.client_id,i.contract_id,i.installment_number,i.status,
     round(coalesce(i.paid_amount,0),2) AS received,
     round(coalesce(i.paid_principal,0)+coalesce(i.paid_interest,0)+coalesce(i.paid_fees,0),2) AS allocated,
     round(coalesce(i.paid_interest,0)+coalesce(i.paid_fees,0),2) AS classified_profit,
     round(coalesce((SELECT sum(p.amount) FROM public.profits p
       WHERE p.installment_id=i.id AND p.user_id=uid),0),2) AS recorded_profit
   FROM public.contract_installments i WHERE i.user_id=uid AND coalesce(i.paid_amount,0)>0
 ), anomalies AS (SELECT * FROM review WHERE received<>allocated OR classified_profit<>recorded_profit)
 SELECT jsonb_build_object(
   'allocation_review_count',(SELECT count(*) FROM anomalies),
   'unallocated_received_total',(SELECT coalesce(sum(greatest(0,received-allocated)),0) FROM anomalies),
   'overallocated_received_total',(SELECT coalesce(sum(greatest(0,allocated-received)),0) FROM anomalies),
   'installments',(SELECT coalesce(jsonb_agg(to_jsonb(items)),'[]'::jsonb)
      FROM (SELECT * FROM anomalies ORDER BY CASE WHEN status='paid' THEN 1 ELSE 0 END,id LIMIT 100) items)
 ) INTO result;
 RETURN result;
END;
$$;


--
-- Name: payment_receipt_context(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.payment_receipt_context(_transaction_id uuid, _user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $_$
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
$_$;


--
-- Name: platform_settings_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_settings_touch() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.id         := true;      -- ignora qualquer tentativa de criar 2ª linha
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;


--
-- Name: portal_client_login(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_client_login(_cpf text, _birth_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _clean_cpf text := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g');
  _client_id uuid;
  _matches integer;
  _token uuid;
  _rate jsonb;
BEGIN
  IF length(_clean_cpf) <> 11 THEN RETURN NULL; END IF;

  _rate := public.try_consume_rate_limit('portal-login:' || md5(_clean_cpf), 8, 8.0 / 900.0);
  IF NOT coalesce((_rate->>'allowed')::boolean, false) THEN RETURN NULL; END IF;

  SELECT count(*), min(id::text)::uuid
    INTO _matches, _client_id
  FROM public.clients
  WHERE regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = _clean_cpf
    AND lower(coalesce(status, 'ativo')) IN ('ativo', 'active');

  IF _matches <> 1 OR _client_id IS NULL THEN RETURN NULL; END IF;

  DELETE FROM public.portal_sessions WHERE client_id = _client_id AND expires_at < now();
  INSERT INTO public.portal_sessions (client_id) VALUES (_client_id) RETURNING token INTO _token;
  RETURN public.portal_login_by_token(_token);
END;
$$;


--
-- Name: portal_client_login_for_owner(text, date, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_client_login_for_owner(_cpf text, _birth_date date, _owner_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _clean_cpf text := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g');
  _client_id uuid;
  _matches integer;
  _token uuid;
  _rate jsonb;
BEGIN
  IF length(_clean_cpf) <> 11 OR _owner_id IS NULL THEN RETURN NULL; END IF;

  _rate := public.try_consume_rate_limit('portal-login:' || md5(_owner_id::text || _clean_cpf), 8, 8.0 / 900.0);
  IF NOT coalesce((_rate->>'allowed')::boolean, false) THEN RETURN NULL; END IF;

  SELECT count(*), min(id::text)::uuid
    INTO _matches, _client_id
  FROM public.clients
  WHERE user_id = _owner_id
    AND regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = _clean_cpf
    AND lower(coalesce(status, 'ativo')) IN ('ativo', 'active');

  IF _matches <> 1 OR _client_id IS NULL THEN RETURN NULL; END IF;

  DELETE FROM public.portal_sessions WHERE client_id = _client_id AND expires_at < now();
  INSERT INTO public.portal_sessions (client_id) VALUES (_client_id) RETURNING token INTO _token;
  RETURN public.portal_login_by_token(_token);
END;
$$;


--
-- Name: portal_client_mark_notifications_read(text, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_client_mark_notifications_read(_cpf text, _ids uuid[] DEFAULT NULL::uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _clean text := regexp_replace(coalesce(_cpf,''), '\D', '', 'g');
  _client_id uuid; _n int;
BEGIN
  IF length(_clean) < 11 THEN RETURN 0; END IF;
  SELECT id INTO _client_id FROM public.clients
   WHERE regexp_replace(coalesce(cpf_cnpj,''), '\D','','g') = _clean
   ORDER BY created_at DESC LIMIT 1;
  IF _client_id IS NULL THEN RETURN 0; END IF;

  UPDATE public.client_notifications
     SET is_read = true
   WHERE client_id = _client_id AND is_read = false
     AND (_ids IS NULL OR id = ANY(_ids));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;


--
-- Name: portal_client_notifications(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_client_notifications(_cpf text, _limit integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _clean text := regexp_replace(coalesce(_cpf,''), '\D', '', 'g');
  _client_id uuid;
  _rows jsonb;
BEGIN
  IF length(_clean) < 11 THEN RETURN '[]'::jsonb; END IF;
  SELECT id INTO _client_id FROM public.clients
   WHERE regexp_replace(coalesce(cpf_cnpj,''), '\D','','g') = _clean
   ORDER BY created_at DESC LIMIT 1;
  IF _client_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb)
    INTO _rows
  FROM (
    SELECT id, type, title, message, metadata, is_read, created_at, contract_id, installment_id
      FROM public.client_notifications
     WHERE client_id = _client_id
     ORDER BY created_at DESC
     LIMIT greatest(1, least(coalesce(_limit,30), 100))
  ) n;
  RETURN _rows;
END; $$;


--
-- Name: portal_contract_signatures(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_contract_signatures(_session_token uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _client_id uuid; _result jsonb;
BEGIN
  SELECT client_id INTO _client_id FROM public.portal_sessions
  WHERE token = _session_token AND expires_at > now();
  IF _client_id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'signature_status', c.signature_status,
    'signed_at', c.signed_at, 'signer_name', c.signer_name
  ) ORDER BY c.created_at DESC), '[]'::jsonb)
  INTO _result FROM public.contracts c WHERE c.client_id = _client_id;
  RETURN _result;
END;
$$;


--
-- Name: portal_login_by_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_login_by_token(_token uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _client_id uuid;
  _client public.clients%rowtype;
  _contracts jsonb;
  _owner jsonb;
  _branding jsonb;
BEGIN
  IF _token IS NULL THEN RETURN NULL; END IF;

  SELECT client_id INTO _client_id
    FROM public.portal_sessions
   WHERE token = _token AND expires_at > now()
   LIMIT 1;

  IF _client_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _client FROM public.clients WHERE id = _client_id;
  IF _client.id IS NULL OR lower(coalesce(_client.status, 'ativo')) NOT IN ('ativo', 'active') THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(contract_payload ORDER BY (contract_payload->>'created_at')::timestamptz DESC), '[]'::jsonb)
  INTO _contracts
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'capital', c.capital, 'interest_rate', c.interest_rate,
      'num_installments', c.num_installments, 'installment_amount', c.installment_amount,
      'frequency', c.frequency, 'start_date', c.start_date, 'status', c.status,
      'total_amount', c.total_amount, 'total_interest', c.total_interest,
      'payment_method', c.payment_method, 'created_at', c.created_at,
      'late_fee_percent', c.late_fee_percent,
      'daily_interest_percent', c.daily_interest_percent,
      'max_interest_cap_percent', c.max_interest_cap_percent,
          'daily_penalty_type', c.daily_penalty_type,
          'daily_penalty_value', c.daily_penalty_value,
      'installments', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id, 'installment_number', i.installment_number, 'amount', i.amount,
          'due_date', i.due_date, 'paid_at', i.paid_at, 'paid_amount', i.paid_amount,
          'late_fee', i.late_fee, 'status', i.status, 'payment_method', i.payment_method,
          'receipt_url', i.receipt_url,
          'has_active_settlement', i.pre_settlement_snapshot IS NOT NULL,
          'late_fee_percent', c.late_fee_percent,
          'daily_interest_percent', c.daily_interest_percent,
          'max_interest_cap_percent', c.max_interest_cap_percent,
          'daily_penalty_type', c.daily_penalty_type,
          'daily_penalty_value', c.daily_penalty_value
        ) ORDER BY i.installment_number ASC, i.due_date ASC)
        FROM public.contract_installments i
        WHERE i.contract_id = c.id AND i.client_id = _client.id AND i.user_id = _client.user_id
      ), '[]'::jsonb)
    ) AS contract_payload
    FROM public.contracts c WHERE c.client_id = _client.id AND c.user_id = _client.user_id
  ) payload;

  SELECT jsonb_build_object('name', p.name, 'pix_key', p.pix_key, 'pix_key_type', p.pix_key_type)
  INTO _owner FROM public.profiles p WHERE p.id = _client.user_id;

  SELECT jsonb_build_object(
    'portal_title', s.portal_title, 'portal_subtitle', s.portal_subtitle,
    'portal_welcome_message', s.portal_welcome_message, 'portal_primary_color', s.portal_primary_color,
    'portal_contact_phone', s.portal_contact_phone, 'portal_contact_email', s.portal_contact_email,
    'portal_logo_url', s.portal_logo_url, 'company_name', s.company_name, 'company_logo_url', s.company_logo_url
  ) INTO _branding FROM public.settings s WHERE s.user_id = _client.user_id LIMIT 1;

  RETURN jsonb_build_object(
    'client', jsonb_build_object(
      'id', _client.id, 'name', _client.name, 'email', _client.email,
      'phone', _client.phone, 'whatsapp', _client.whatsapp,
      'cpf_cnpj', _client.cpf_cnpj, 'status', _client.status, 'birth_date', _client.birth_date
    ),
    'contracts', _contracts,
    'owner', coalesce(_owner, '{}'::jsonb),
    'branding', coalesce(_branding, '{}'::jsonb),
    'session_token', _token
  );
END;
$$;


--
-- Name: portal_lookup_creditor_contact(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_lookup_creditor_contact(_cpf text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _clean_cpf text := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g');
  _owner_id uuid;
  _out jsonb;
BEGIN
  IF length(_clean_cpf) < 11 THEN RETURN NULL; END IF;

  SELECT c.user_id INTO _owner_id
  FROM public.clients c
  WHERE regexp_replace(coalesce(c.cpf_cnpj, ''), '\D', '', 'g') = _clean_cpf
  ORDER BY c.created_at DESC LIMIT 1;

  IF _owner_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'company_name', s.company_name,
    'portal_contact_phone', s.portal_contact_phone,
    'portal_contact_email', s.portal_contact_email
  ) INTO _out
  FROM public.settings s WHERE s.user_id = _owner_id LIMIT 1;

  RETURN coalesce(_out, '{}'::jsonb);
END;
$$;


--
-- Name: portal_lookup_creditor_contact(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_lookup_creditor_contact(_cpf text, _birth_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _clean_cpf text := regexp_replace(coalesce(_cpf, ''), '\D', '', 'g');
  _owner_id uuid;
  _matches integer;
  _out jsonb;
BEGIN
  IF length(_clean_cpf) <> 11 THEN RETURN NULL; END IF;

  SELECT count(*), min(user_id::text)::uuid
    INTO _matches, _owner_id
  FROM public.clients
  WHERE regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = _clean_cpf
    AND lower(coalesce(status, 'ativo')) IN ('ativo', 'active');

  IF _matches <> 1 OR _owner_id IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'company_name', s.company_name,
    'portal_contact_phone', s.portal_contact_phone,
    'portal_contact_email', s.portal_contact_email
  ) INTO _out
  FROM public.settings s WHERE s.user_id = _owner_id LIMIT 1;

  RETURN coalesce(_out, '{}'::jsonb);
END;
$$;


--
-- Name: portal_mark_notifications_read_by_token(uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_mark_notifications_read_by_token(_token uuid, _ids uuid[] DEFAULT NULL::uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _client_id uuid; _n int;
BEGIN
  SELECT client_id INTO _client_id FROM public.portal_sessions
   WHERE token = _token AND expires_at > now();
  IF _client_id IS NULL THEN RETURN 0; END IF;

  UPDATE public.client_notifications
     SET is_read = true
   WHERE client_id = _client_id AND is_read = false
     AND (_ids IS NULL OR id = ANY(_ids));
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;


--
-- Name: portal_notifications_by_token(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_notifications_by_token(_token uuid, _limit integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _client_id uuid; _rows jsonb;
BEGIN
  SELECT client_id INTO _client_id FROM public.portal_sessions
   WHERE token = _token AND expires_at > now();
  IF _client_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb)
    INTO _rows
  FROM (
    SELECT id, type, title, message, metadata, is_read, created_at, contract_id, installment_id
      FROM public.client_notifications
     WHERE client_id = _client_id
     ORDER BY created_at DESC
     LIMIT greatest(1, least(coalesce(_limit,30), 100))
  ) n;
  RETURN _rows;
END; $$;


--
-- Name: portal_sign_contract(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.portal_sign_contract(_session_token uuid, _contract_id uuid, _signer_name text, _cpf_confirmation text, _user_agent text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE _client public.clients%rowtype; _contract public.contracts%rowtype; _cpf text;
BEGIN
  SELECT c.* INTO _client
  FROM public.portal_sessions s JOIN public.clients c ON c.id = s.client_id
  WHERE s.token = _session_token AND s.expires_at > now();
  IF _client.id IS NULL THEN RAISE EXCEPTION 'portal_session_invalid'; END IF;

  SELECT * INTO _contract FROM public.contracts
  WHERE id = _contract_id AND client_id = _client.id FOR UPDATE;
  IF _contract.id IS NULL THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF coalesce(_contract.signature_status, 'not_required') = 'not_required' THEN RAISE EXCEPTION 'signature_not_required'; END IF;
  IF _contract.signature_status = 'signed' THEN
    RETURN jsonb_build_object('ok', true, 'already_signed', true, 'signed_at', _contract.signed_at);
  END IF;

  _cpf := regexp_replace(coalesce(_cpf_confirmation, ''), '\D', '', 'g');
  IF _cpf <> regexp_replace(coalesce(_client.cpf_cnpj, ''), '\D', '', 'g') THEN RAISE EXCEPTION 'cpf_mismatch'; END IF;
  IF length(trim(coalesce(_signer_name, ''))) < 3 THEN RAISE EXCEPTION 'invalid_signer_name'; END IF;

  UPDATE public.contracts SET
    signature_status = 'signed', signed_at = now(), signer_name = trim(_signer_name),
    signer_cpf = _cpf, signature_user_agent = left(_user_agent, 500),
    signature_url = '/portal-cliente', updated_at = now()
  WHERE id = _contract.id;

  INSERT INTO public.contract_signature_events
    (contract_id, client_id, user_id, signer_name, signer_cpf, user_agent)
  VALUES (_contract.id, _client.id, _client.user_id, trim(_signer_name), _cpf, left(_user_agent, 500));

  RETURN jsonb_build_object('ok', true, 'signed_at', now());
END;
$$;


--
-- Name: protect_profile_admin_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_profile_admin_columns() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _is_service_role boolean := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
BEGIN
  IF _is_service_role THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    NEW.is_admin := OLD.is_admin;
    NEW.is_blocked := COALESCE(OLD.is_blocked, false);
    NEW.is_chat_blocked := COALESCE(OLD.is_chat_blocked, false);
    NEW.trial_ends_at := OLD.trial_ends_at;
    NEW.subscription_expires_at := OLD.subscription_expires_at;
    NEW.subscription_type := OLD.subscription_type;
    NEW.plan_tier := OLD.plan_tier;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: queue_registered_payment_receipt(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.queue_registered_payment_receipt() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.type='payment' AND NEW.installment_id IS NOT NULL AND NEW.amount>0 AND NEW.amount::text NOT IN ('NaN','Infinity','-Infinity') THEN
    PERFORM public.enqueue_payment_receipt(NEW.id,NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: quote_installment_late_fee(numeric, timestamp with time zone, text, numeric, jsonb, numeric, text, numeric, numeric, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quote_installment_late_fee(_amount numeric, _due_date timestamp with time zone, _status text, _stored numeric, _snapshot jsonb, _rate numeric, _penalty_type text, _penalty_value numeric, _cap numeric, _at timestamp with time zone DEFAULT now()) RETURNS numeric
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  days integer;
  base numeric := greatest(0, coalesce(_amount, 0));
  stored numeric := greatest(0, coalesce(_stored, 0));
  rate numeric := greatest(0, coalesce(nullif(_rate, 0), 4));
  penalty numeric := greatest(0, coalesce(_penalty_value, 0));
  fee numeric;
BEGIN
  IF coalesce(_amount::text, '') IN ('NaN','Infinity','-Infinity')
    OR coalesce(_stored::text, '') IN ('NaN','Infinity','-Infinity')
    OR coalesce(_rate::text, '') IN ('NaN','Infinity','-Infinity')
    OR coalesce(_penalty_value::text, '') IN ('NaN','Infinity','-Infinity')
    OR coalesce(_cap::text, '') IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'financial_charge_unavailable' USING ERRCODE = '22003';
  END IF;
  IF _status IN ('paid','cancelled') OR _snapshot IS NOT NULL THEN RETURN stored; END IF;
  days := greatest(0, (_at AT TIME ZONE 'America/Sao_Paulo')::date
                    - (_due_date AT TIME ZONE 'America/Sao_Paulo')::date);
  IF base = 0 OR days = 0 OR _due_date IS NULL THEN RETURN stored; END IF;
  fee := round(base * (power(1 + rate / 100, days) - 1)
    + CASE WHEN _penalty_type = 'fixed' THEN penalty * days
      ELSE base * penalty / 100 * days END, 2);
  IF _cap > 0 THEN fee := least(fee, round(base * _cap / 100, 2)); END IF;
  RETURN greatest(stored, fee);
END;
$$;


--
-- Name: receive_business_payment(uuid, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.receive_business_payment(_receivable_id uuid, _amount numeric, _method text, _request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE uid uuid:=auth.uid(); r business_receivables%rowtype; op business_operations%rowtype; result uuid;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação e identificação obrigatórias'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM business_payments WHERE user_id=uid AND request_id=_request_id;IF result IS NOT NULL THEN RETURN result;END IF;
  SELECT o.* INTO op FROM business_operations o JOIN business_receivables r ON r.operation_id=o.id WHERE r.id=_receivable_id AND o.user_id=uid FOR UPDATE OF o;
  IF op.id IS NULL OR op.status='cancelled' THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  SELECT * INTO r FROM business_receivables WHERE id=_receivable_id AND user_id=uid FOR UPDATE;
  IF r.status<>'pending' OR _amount IS NULL OR _amount<=0 OR round(_amount,2)<>_amount OR _amount>r.amount-r.paid_amount THEN RAISE EXCEPTION 'Pagamento deve ser maior que zero e não exceder o saldo'; END IF;
  INSERT INTO business_payments(user_id,operation_id,receivable_id,kind,amount,method,request_id) VALUES(uid,r.operation_id,r.id,'receipt',_amount,_method,_request_id) RETURNING id INTO result;
  UPDATE business_receivables SET paid_amount=paid_amount+_amount,status=CASE WHEN paid_amount+_amount=amount THEN 'paid' ELSE 'pending' END WHERE id=r.id;
  IF op.kind='sale' AND NOT EXISTS(SELECT 1 FROM business_receivables WHERE operation_id=op.id AND status='pending') THEN UPDATE business_operations SET status='completed' WHERE id=op.id; END IF;
  RETURN result;
END $$;


--
-- Name: record_business_ledger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_business_ledger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE op business_operations%rowtype;
BEGIN
  SELECT * INTO op FROM business_operations WHERE id=NEW.operation_id;
  INSERT INTO transactions(user_id,client_id,type,category,description,amount,date)
  VALUES(NEW.user_id,op.client_id,CASE WHEN NEW.kind IN ('deposit_refund','refund') THEN 'business_refund' WHEN NEW.kind='deposit' THEN 'security_deposit' ELSE 'business_income' END,
  CASE WHEN NEW.kind IN ('deposit','deposit_refund') THEN 'Caução' WHEN op.kind='sale' THEN 'Venda de celular' ELSE 'Locação de veículo' END,
  CASE NEW.kind WHEN 'deposit' THEN 'Caução recebida' WHEN 'deposit_refund' THEN 'Caução devolvida' WHEN 'refund' THEN 'Estorno de operação' ELSE 'Recebimento de operação' END||' · '||op.id::text,NEW.amount,NEW.created_at);
  RETURN NEW;
END $$;


--
-- Name: record_contract_disbursement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_contract_disbursement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _cash numeric;
BEGIN
  -- RenegociaÃ§Ã£o carrega saldo anterior, mas sÃ³ o capital adicional Ã© uma
  -- nova saÃ­da de caixa. O marcador Ã© produzido pelo fluxo atÃ´mico do app.
  _cash := CASE
    WHEN coalesce(NEW.notes, '') LIKE 'RenegociaÃ§Ã£o do contrato%'
      THEN coalesce(
        nullif(substring(NEW.notes from '\[cash_disbursed:([0-9]+(\.[0-9]+)?)\]'), '')::numeric,
        0
      )
    ELSE round(coalesce(NEW.capital, 0)::numeric, 2)
  END;

  IF _cash <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.transactions
    (user_id, type, category, description, amount, date, contract_id, client_id, source_key)
  VALUES
    (NEW.user_id, 'loan_disbursement', 'loan_disbursement', 'EmprÃ©stimo liberado',
     round(_cash, 2), coalesce(NEW.created_at, now()), NEW.id, NEW.client_id,
     'loan-disbursement:' || NEW.id::text)
  ON CONFLICT (user_id, source_key) WHERE source_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION record_contract_disbursement(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_contract_disbursement() IS 'Registra a saÃ­da de caixa de contratos novos sem modificar o histÃ³rico anterior.';


--
-- Name: refresh_installment_charges(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_installment_charges(_after_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 250) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $_$
DECLARE
  row_data record;
  fee numeric; balance numeric; new_status text;
  last_id uuid; scanned integer := 0; fees_updated integer := 0;
  status_updated integer := 0; client_count integer := 0; owner_count integer := 0;
  inserted integer; owner_id uuid; owners uuid[] := ARRAY[]::uuid[];
  errors jsonb := '[]'::jsonb;
  batch_limit integer := greatest(1, least(500, coalesce(_limit,250)));
BEGIN
  FOR row_data IN
    SELECT i.*, c.daily_interest_percent AS charge_rate,
      c.daily_penalty_type AS charge_penalty_type,
      c.daily_penalty_value AS charge_penalty_value,
      c.max_interest_cap_percent AS charge_cap
    FROM public.contract_installments i
    JOIN public.contracts c ON c.id = i.contract_id AND c.user_id = i.user_id
      AND c.client_id = i.client_id
    WHERE coalesce(i.status,'pending') NOT IN ('paid','cancelled')
      AND c.status IN ('active','overdue') AND i.due_date < current_date::timestamptz
      AND (_after_id IS NULL OR i.id > _after_id)
    ORDER BY i.id LIMIT batch_limit FOR UPDATE OF i,c SKIP LOCKED
  LOOP
    scanned := scanned + 1; last_id := row_data.id;
    BEGIN
      IF coalesce(row_data.paid_amount::text,'') IN ('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'financial_charge_unavailable' USING ERRCODE = '22003';
      END IF;
      fee := public.quote_installment_late_fee(row_data.amount,row_data.due_date,
        row_data.status,row_data.late_fee,row_data.pre_settlement_snapshot,
        row_data.charge_rate,row_data.charge_penalty_type,row_data.charge_penalty_value,
        row_data.charge_cap);
      balance := round(greatest(0,coalesce(row_data.amount,0)) + fee
        - greatest(0,coalesce(row_data.paid_amount,0)),2);
      IF balance <= 0 THEN CONTINUE; END IF;
      new_status := CASE WHEN coalesce(row_data.status,'pending') = 'pending'
        THEN 'overdue' ELSE row_data.status END;
      IF fee - coalesce(row_data.late_fee,0) < 0.01
        AND new_status IS NOT DISTINCT FROM row_data.status THEN CONTINUE; END IF;
      UPDATE public.contract_installments SET late_fee = fee, status = new_status
        WHERE id = row_data.id AND user_id = row_data.user_id;
      INSERT INTO public.client_notifications(client_id,user_id,contract_id,
        installment_id,type,title,message,metadata,dedupe_day)
      VALUES(row_data.client_id,row_data.user_id,row_data.contract_id,row_data.id,
        CASE WHEN new_status IS DISTINCT FROM row_data.status THEN 'installment_overdue'
          ELSE 'late_fee_updated' END,
        'Parcela ' || coalesce(row_data.installment_number::text,'') || ' em atraso',
        'Vencimento em ' || to_char(row_data.due_date AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY')
          || '. Saldo atual: R$ ' || replace(balance::text,'.',','),
        jsonb_build_object('installment_number',row_data.installment_number,
          'amount',row_data.amount,'paid_amount',row_data.paid_amount,
          'due_date',row_data.due_date,'days_overdue',current_date - row_data.due_date::date,
          'late_fee',fee,'total_due',balance), current_date)
      ON CONFLICT(installment_id,type,dedupe_day) DO NOTHING;
      GET DIAGNOSTICS inserted = ROW_COUNT;
      client_count := client_count + inserted;
      IF fee - coalesce(row_data.late_fee,0) >= 0.01 THEN fees_updated := fees_updated + 1; END IF;
      IF new_status IS DISTINCT FROM row_data.status THEN status_updated := status_updated + 1; END IF;
      owners := array_append(owners,row_data.user_id);
    EXCEPTION WHEN OTHERS THEN
      -- Roll back the row and its notification together; report the SQLSTATE.
      errors := errors || jsonb_build_array(jsonb_build_object('installment_id',row_data.id,'code',SQLSTATE));
    END;
  END LOOP;
  FOR owner_id IN SELECT DISTINCT v FROM unnest(owners) v ORDER BY v LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('late-fees:' || owner_id::text || ':' || current_date::text,0));
    INSERT INTO public.notifications(user_id,message,type,"from",link)
    SELECT owner_id,'Encargos de parcelas em atraso atualizados. Confira os saldos em Cobranças.',
      'late_fees_auto','Automação','/cobrancas'
    WHERE NOT EXISTS(SELECT 1 FROM public.notifications n
      WHERE n.user_id = owner_id AND n.type = 'late_fees_auto'
        AND n.created_at >= current_date::timestamptz
        AND n.created_at < (current_date + 1)::timestamptz);
    GET DIAGNOSTICS inserted = ROW_COUNT;
    owner_count := owner_count + inserted;
  END LOOP;
  RETURN jsonb_build_object('scanned',scanned,'fees_updated',fees_updated,
    'status_updated',status_updated,'client_notifications',client_count,
    'owner_notifications',owner_count,'errors',errors,
    'next_cursor',CASE WHEN scanned = batch_limit THEN last_id ELSE NULL END);
END;
$_$;


--
-- Name: register_investor_interest_payment(uuid, numeric, date, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_investor_interest_payment(_loan_id uuid, _amount numeric, _next_due_date date, _method text DEFAULT 'pix'::text, _notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _loan public.investor_loans%rowtype;
  _payment_id uuid;
  _interest numeric;
BEGIN
  SELECT * INTO _loan FROM public.investor_loans WHERE id = _loan_id FOR UPDATE;
  IF _loan.id IS NULL THEN RAISE EXCEPTION 'investor_loan_not_found'; END IF;
  IF _loan.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _loan.status = 'paid' THEN RAISE EXCEPTION 'investor_loan_paid'; END IF;

  _interest := round((_loan.principal * _loan.interest_rate / 100)::numeric, 2);
  IF round(coalesce(_amount, 0)::numeric, 2) <> _interest OR _interest <= 0 THEN
    RAISE EXCEPTION 'invalid_interest_amount';
  END IF;
  IF _next_due_date IS NULL OR _next_due_date <= current_date THEN
    RAISE EXCEPTION 'invalid_next_due_date';
  END IF;

  INSERT INTO public.investor_payments
    (loan_id, investor_id, user_id, amount, method, notes, payment_type)
  VALUES
    (_loan.id, _loan.investor_id, auth.uid(), _interest,
     nullif(_method, ''), nullif(_notes, ''), 'interest_only')
  RETURNING id INTO _payment_id;

  UPDATE public.investor_loans
  SET due_date = _next_due_date, payment_method = nullif(_method, ''),
      status = 'active', paid_at = NULL
  WHERE id = _loan.id;

  INSERT INTO public.transactions
    (user_id, type, category, description, amount, date, investor_payment_id)
  VALUES
    (auth.uid(), 'expense', 'investor_interest_payment',
     'Pagamento somente dos juros ao investidor', _interest, now(), _payment_id);

  RETURN jsonb_build_object(
    'ok', true, 'payment_id', _payment_id, 'amount', _interest,
    'next_due_date', _next_due_date, 'remaining', greatest(0, _loan.total_due - _loan.paid_amount)
  );
END;
$$;


--
-- Name: register_investor_payment(uuid, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_investor_payment(_loan_id uuid, _amount numeric, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text, _notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _loan public.investor_loans%rowtype;
  _payment_id uuid;
  _amount_rounded numeric;
  _new_paid numeric;
  _remaining numeric;
BEGIN
  SELECT * INTO _loan FROM public.investor_loans WHERE id = _loan_id FOR UPDATE;
  IF _loan.id IS NULL THEN RAISE EXCEPTION 'investor_loan_not_found'; END IF;
  IF _loan.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;

  _amount_rounded := round(coalesce(_amount, 0)::numeric, 2);
  _remaining := round(greatest(0, _loan.total_due - _loan.paid_amount)::numeric, 2);
  IF _amount_rounded <= 0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;
  IF _amount_rounded > _remaining THEN RAISE EXCEPTION 'payment_exceeds_balance'; END IF;

  INSERT INTO public.investor_payments
    (loan_id, investor_id, user_id, amount, method, receipt_url, notes)
  VALUES
    (_loan.id, _loan.investor_id, auth.uid(), _amount_rounded,
     nullif(_method, ''), nullif(_receipt_url, ''), nullif(_notes, ''))
  RETURNING id INTO _payment_id;

  _new_paid := round((_loan.paid_amount + _amount_rounded)::numeric, 2);
  UPDATE public.investor_loans
  SET paid_amount = _new_paid,
      status = CASE WHEN _new_paid >= total_due THEN 'paid' ELSE 'active' END,
      paid_at = CASE WHEN _new_paid >= total_due THEN now() ELSE NULL END,
      payment_method = nullif(_method, '')
  WHERE id = _loan.id;

  INSERT INTO public.transactions
    (user_id, type, category, description, amount, date, investor_payment_id)
  VALUES
    (auth.uid(), 'expense', 'investor_payment', 'Pagamento a investidor',
     _amount_rounded, now(), _payment_id);

  RETURN jsonb_build_object(
    'ok', true,
    'payment_id', _payment_id,
    'paid_amount', _new_paid,
    'remaining', greatest(0, _loan.total_due - _new_paid)
  );
END;
$$;


--
-- Name: renegotiate_contract_atomically(uuid, jsonb, jsonb, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric DEFAULT 0, _reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _old public.contracts%rowtype;
  _created jsonb;
  _new_id uuid;
  _payload jsonb;
  _note text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO _old FROM public.contracts
   WHERE id = _old_contract_id AND user_id = auth.uid() FOR UPDATE;
  IF _old.id IS NULL THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF _old.status NOT IN ('active', 'overdue') THEN RAISE EXCEPTION 'contract_not_renegotiable'; END IF;
  IF jsonb_typeof(_installments) <> 'array' OR jsonb_array_length(_installments) = 0 THEN
    RAISE EXCEPTION 'installments_required';
  END IF;
  IF coalesce(_new_cash_disbursed, 0) < 0 THEN RAISE EXCEPTION 'invalid_new_cash'; END IF;

  _note := format('RenegociaÃ§Ã£o do contrato %s [cash_disbursed:%s]', _old.id, round(coalesce(_new_cash_disbursed, 0), 2));
  _payload := jsonb_set(coalesce(_contract, '{}'::jsonb), '{notes}', to_jsonb(_note));
  _payload := jsonb_set(_payload, '{status}', '"active"'::jsonb);

  _created := public.create_client_contract(_old.client_id, '{}'::jsonb, _payload, _installments);
  _new_id := (_created->>'contract_id')::uuid;

  UPDATE public.contract_installments
     SET status = 'cancelled'
   WHERE contract_id = _old.id AND status NOT IN ('paid', 'cancelled');

  UPDATE public.contracts
     SET status = 'renegotiated',
         lifecycle_stage = 'renegotiated',
         renegotiated_at = now(),
         notes = concat_ws(E'\n', notes, 'Renegociado para o contrato ' || _new_id::text)
   WHERE id = _old.id;

  UPDATE public.contracts
     SET origin_contract_id = _old.id,
         renegotiated_balance = round(coalesce((_contract->>'capital')::numeric, 0) - coalesce(_new_cash_disbursed, 0), 2),
         new_cash_disbursed = round(coalesce(_new_cash_disbursed, 0), 2),
         renegotiation_reason = nullif(left(_reason, 1000), ''),
         notes = nullif(_contract->>'notes', '')
   WHERE id = _new_id AND user_id = auth.uid();

  INSERT INTO public.contract_events(contract_id, client_id, user_id, event_type, from_stage, to_stage, reason, metadata)
  VALUES (_new_id, _old.client_id, auth.uid(), 'renegotiated_from', 'renegotiated', 'active', _reason,
    jsonb_build_object('origin_contract_id', _old.id, 'new_cash_disbursed', coalesce(_new_cash_disbursed, 0)));

  RETURN _created || jsonb_build_object('origin_contract_id', _old.id);
END;
$$;


--
-- Name: renew_installment_interest(uuid, date, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renew_installment_interest(_installment_id uuid, _next_due_date date, _method text DEFAULT 'pix'::text, _origin text DEFAULT NULL::text, _receipt_url text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE
  _inst public.contract_installments%rowtype;
  _contract public.contracts%rowtype;
  _capital numeric;
  _total_interest numeric;
  _base_interest numeric;
  _late numeric;
  _received numeric;
  _previous_due date;
  _period_rate numeric;
  _periods_elapsed integer;
  _growth numeric;
  _grace_periods integer;
  _remaining_payments integer;
BEGIN
  IF _next_due_date IS NULL THEN
    RAISE EXCEPTION 'next_due_date_required';
  END IF;

  SELECT * INTO _inst FROM public.contract_installments WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL OR _inst.user_id <> auth.uid() THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  IF _inst.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'installment_closed'; END IF;

  SELECT * INTO _contract FROM public.contracts WHERE id = _inst.contract_id AND user_id = auth.uid();
  IF _contract.id IS NULL THEN RAISE EXCEPTION 'contract_not_found'; END IF;

  _capital := greatest(0, coalesce(_contract.capital, 0));
  _total_interest := coalesce(_contract.total_interest, greatest(0, coalesce(_contract.total_amount, 0) - _capital));
  _late := greatest(0, coalesce(_inst.late_fee, 0));
  _period_rate := greatest(0, coalesce(_contract.interest_rate, 0)) / 100;
  _periods_elapsed := greatest(0, coalesce(_inst.installment_number, 1) - 1);
  _grace_periods := greatest(0, coalesce(_contract.grace_periods, 0));
  _remaining_payments := coalesce(_contract.num_installments, 0) - _grace_periods;

  _base_interest := CASE
    WHEN _contract.loan_mode = 'bullet' THEN _total_interest
    WHEN _contract.loan_mode IN ('percentage', 'interest_only') THEN round(_capital * _period_rate, 2)
    WHEN coalesce(_inst.scheduled_interest, 0) > 0 THEN _inst.scheduled_interest
    WHEN _contract.loan_mode = 'price' AND _period_rate > 0 THEN
      round(greatest(0,
        _capital * power(1 + _period_rate, _periods_elapsed)
        - coalesce(nullif(_contract.installment_amount, 0), _inst.amount, 0)
          * ((power(1 + _period_rate, _periods_elapsed) - 1) / _period_rate)
      ) * _period_rate, 2)
    WHEN _contract.loan_mode = 'grace'
      AND _remaining_payments > 0
      AND coalesce(_inst.installment_number, 0) > _grace_periods THEN
      round(greatest(0,
        coalesce(nullif(_contract.installment_amount, 0), _inst.amount, 0)
        - _capital / _remaining_payments
      ), 2)
    WHEN _contract.loan_mode = 'grace' AND _remaining_payments > 0 THEN
      round(_capital * _period_rate, 2)
    WHEN coalesce(_contract.num_installments, 0) > 0 THEN
      round(_total_interest / _contract.num_installments, 2)
    ELSE coalesce(_inst.amount, 0)
  END;

  _received := round(greatest(0, _base_interest) + _late, 2);
  IF _received <= 0 THEN RAISE EXCEPTION 'invalid_renewal_amount'; END IF;

  _previous_due := _inst.due_date;

  UPDATE public.contract_installments
  SET due_date = _next_due_date,
      late_fee = 0,
      paid_amount = 0,
      paid_at = NULL,
      status = 'pending',
      payment_method = _method,
      receipt_url = coalesce(_receipt_url, receipt_url)
  WHERE id = _inst.id;

  INSERT INTO public.transactions (
    user_id, amount, type, category, description, client_id, contract_id,
    installment_id, principal_amount, interest_amount, fee_amount
  ) VALUES (
    auth.uid(), _received, 'payment', 'interest_renewal',
    'Renovação por pagamento somente dos juros' || CASE WHEN _origin IS NOT NULL THEN ' (' || _origin || ')' ELSE '' END,
    _inst.client_id, _inst.contract_id, _inst.id, 0, greatest(0, _received - _late), _late
  );

  INSERT INTO public.profits (user_id, amount, description, client_id, installment_id)
  VALUES (
    auth.uid(), _received,
    'Juros de renovação · parcela #' || coalesce(_inst.installment_number::text, '-'),
    _inst.client_id, NULL
  );

  RETURN jsonb_build_object(
    'amount', _received,
    'previous_due_date', _previous_due,
    'next_due_date', _next_due_date
  );
END;
$$;


--
-- Name: reopen_contract_with_unsettled_installments(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reopen_contract_with_unsettled_installments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.contracts
  SET status = 'active', lifecycle_stage = 'active'
  WHERE id = NEW.contract_id
    AND status = 'completed'
    AND public.contract_has_unsettled_installments(NEW.contract_id);
  RETURN NEW;
END;
$$;


--
-- Name: request_payment_receipt(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_payment_receipt(_transaction_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE uid uuid:=auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transactions WHERE id=_transaction_id AND user_id=uid) THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE='P0002';
  END IF;
  RETURN public.enqueue_payment_receipt(_transaction_id,uid);
END;
$$;


--
-- Name: restore_user_backup_atomic(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_user_backup_atomic(_user_id uuid, _dump jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  _table text; _rows jsonb; _columns text; _updates text; _count integer;
  _counts jsonb := '{}'::jsonb;
  _allowed constant text[] := ARRAY[
    'clients','investors','collectors','vehicles','stock_items','settings','contracts',
    'investor_loans','rentals','goals','notes','todos','contract_installments',
    'investor_payments','transactions','expenses','profits','collector_assignments',
    'subscriptions','notifications','client_notifications','collection_attempts','audit_logs',
    'bot_actions_log','support_tickets','support_ticket_messages','whatsapp_conversations',
    'whatsapp_messages','whatsapp_notes','whatsapp_scheduled_messages','message_templates',
    'leads','pledges','ai_conversations','chat_channel_members','chat_messages',
    'chat_message_reactions','client_errors','user_roles'
  ];
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _user_id IS NULL OR _dump IS NULL OR jsonb_typeof(_dump) <> 'object' THEN RAISE EXCEPTION 'invalid_backup'; END IF;

  FOREACH _table IN ARRAY _allowed LOOP
    _rows := COALESCE(_dump -> _table, '[]'::jsonb);
    IF jsonb_typeof(_rows) <> 'array' THEN RAISE EXCEPTION 'invalid_table_payload:%', _table; END IF;
    IF _table = 'support_ticket_messages' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(_rows) row
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(_dump -> 'support_tickets', '[]'::jsonb)) ticket
          WHERE ticket ->> 'id' = row ->> 'ticket_id' AND ticket ->> 'user_id' = _user_id::text
        )
      ) THEN RAISE EXCEPTION 'backup_user_mismatch:%', _table; END IF;
    ELSIF EXISTS (
      SELECT 1 FROM jsonb_array_elements(_rows) row
      WHERE COALESCE(row ->> 'user_id', '') <> _user_id::text
    ) THEN RAISE EXCEPTION 'backup_user_mismatch:%', _table; END IF;

    _count := jsonb_array_length(_rows);
    IF _count > 0 THEN
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
             string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' ORDER BY a.attnum)
               FILTER (WHERE a.attname <> 'id')
      INTO _columns, _updates
      FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', _table)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';
      EXECUTE format(
        'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1) ON CONFLICT (id) DO UPDATE SET %3$s',
        _table, _columns, _updates
      ) USING _rows;
    END IF;
    _counts := _counts || jsonb_build_object(_table, _count);
  END LOOP;

  INSERT INTO public.audit_logs(user_id, entity_type, action, entity_id, details)
  VALUES (_user_id, 'backup', 'atomic_restore', NULL, jsonb_build_object('counts', _counts));
  RETURN jsonb_build_object('ok', true, 'counts', _counts);
END;
$_$;


--
-- Name: return_loan_collateral(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.return_loan_collateral(_id uuid, _note text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE item loan_collateral%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  SELECT * INTO item FROM loan_collateral WHERE id=_id AND user_id=auth.uid() FOR UPDATE;
  IF item.id IS NULL THEN RAISE EXCEPTION 'Garantia não encontrada'; END IF;
  IF item.status='returned' THEN RETURN; END IF;
  IF length(trim(coalesce(_note,'')))<3 THEN RAISE EXCEPTION 'Informe quem recebeu o bem e a observação de devolução'; END IF;
  UPDATE loan_collateral SET status='returned',returned_at=now(),return_note=_note WHERE id=item.id;
  INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(auth.uid(),'return','loan_collateral',item.id,jsonb_build_object('note',_note));
END $$;


--
-- Name: reverse_installment_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_installment_payment(_installment_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE
  uid uuid := auth.uid();
  inst public.contract_installments%ROWTYPE;
  snap jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO inst FROM public.contract_installments
    WHERE id = _installment_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'installment_not_found'; END IF;

  DELETE FROM public.profits
    WHERE user_id = uid AND installment_id = inst.id;
  DELETE FROM public.transactions
    WHERE user_id = uid AND installment_id = inst.id
      AND type = 'payment' AND COALESCE(category, '') <> 'interest_renewal';

  snap := inst.pre_settlement_snapshot;

  UPDATE public.contract_installments
  SET paid_amount = 0, paid_fees = 0, paid_interest = 0, paid_principal = 0,
      paid_at = NULL,
      status = CASE WHEN due_date < current_date THEN 'overdue' ELSE 'pending' END,
      -- Desfaz a inflação de amount/scheduled_* que settle_percentage_installment
      -- aplicou antes de quitar (ver 20260922100000). Sem isso a parcela
      -- reaberta ficava com capital+juros permanentemente na base de cálculo
      -- do juros de atraso e do próximo "quitar capital + juros".
      amount = CASE WHEN snap IS NOT NULL THEN (snap->>'amount')::numeric ELSE amount END,
      scheduled_principal = CASE WHEN snap IS NOT NULL THEN (snap->>'scheduled_principal')::numeric ELSE scheduled_principal END,
      scheduled_interest = CASE WHEN snap IS NOT NULL THEN (snap->>'scheduled_interest')::numeric ELSE scheduled_interest END,
      pre_settlement_snapshot = NULL
  WHERE id = inst.id AND user_id = uid;

  UPDATE public.contracts SET status = CASE
    WHEN status = 'completed' THEN 'active' ELSE status END
  WHERE id = inst.contract_id AND user_id = uid;

  RETURN jsonb_build_object('ok', true, 'installment_id', inst.id, 'status', 'reversed');
END;
$$;


--
-- Name: reverse_last_investor_payment(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reverse_last_investor_payment(_loan_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _loan public.investor_loans%rowtype;
  _payment public.investor_payments%rowtype;
  _new_paid numeric;
BEGIN
  SELECT * INTO _loan FROM public.investor_loans WHERE id = _loan_id FOR UPDATE;
  IF _loan.id IS NULL THEN RAISE EXCEPTION 'investor_loan_not_found'; END IF;
  IF _loan.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO _payment
  FROM public.investor_payments
  WHERE loan_id = _loan.id AND user_id = auth.uid()
  ORDER BY paid_at DESC, created_at DESC, id DESC
  LIMIT 1
  FOR UPDATE;
  IF _payment.id IS NULL THEN RAISE EXCEPTION 'investor_payment_not_found'; END IF;

  DELETE FROM public.transactions
  WHERE investor_payment_id = _payment.id AND user_id = auth.uid();
  DELETE FROM public.investor_payments WHERE id = _payment.id;

  SELECT round(coalesce(sum(amount), 0)::numeric, 2)
  INTO _new_paid
  FROM public.investor_payments
  WHERE loan_id = _loan.id;

  UPDATE public.investor_loans
  SET paid_amount = _new_paid,
      status = CASE WHEN _new_paid >= total_due THEN 'paid' ELSE 'active' END,
      paid_at = CASE WHEN _new_paid >= total_due THEN paid_at ELSE NULL END
  WHERE id = _loan.id;

  RETURN jsonb_build_object(
    'ok', true,
    'reversed_payment_id', _payment.id,
    'reversed_amount', _payment.amount,
    'paid_amount', _new_paid
  );
END;
$$;


--
-- Name: save_business_asset(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_business_asset(_data jsonb, _id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE uid uuid:=auth.uid(); asset public.business_assets%rowtype; result uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  IF _id IS NOT NULL THEN
    SELECT * INTO asset FROM business_assets WHERE id=_id AND user_id=uid FOR UPDATE;
    IF asset.id IS NULL THEN RAISE EXCEPTION 'Bem não encontrado'; END IF;
    IF asset.status IN ('sold','rented') THEN RAISE EXCEPTION 'Bem vinculado a uma operação; não pode ser alterado'; END IF;
  END IF;
  IF (_data->>'kind') NOT IN ('phone','car','motorcycle') OR nullif(trim(_data->>'label'),'') IS NULL OR nullif(trim(_data->>'identifier'),'') IS NULL THEN RAISE EXCEPTION 'Informe tipo, descrição e identificação'; END IF;
  IF _data->>'kind'='phone' AND (_data->>'identifier') !~ '^\d{15}$' THEN RAISE EXCEPTION 'IMEI deve ter 15 dígitos'; END IF;
  IF _data->>'kind' IN ('car','motorcycle') AND upper(_data->>'identifier') !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' THEN RAISE EXCEPTION 'Placa inválida'; END IF;
  IF coalesce(_data->>'status','available') NOT IN ('available','maintenance','archived') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  IF _id IS NULL THEN
    INSERT INTO business_assets(user_id,kind,label,identifier,cost,price,condition,notes,photos,details)
    VALUES(uid,_data->>'kind',trim(_data->>'label'),upper(trim(_data->>'identifier')),coalesce((_data->>'cost')::numeric,0),coalesce((_data->>'price')::numeric,0),coalesce(_data->>'condition','Usado'),coalesce(_data->>'notes',''),coalesce(_data->'photos','[]'),coalesce(_data->'details','{}')) RETURNING id INTO result;
  ELSE
    UPDATE business_assets SET label=trim(_data->>'label'),identifier=upper(trim(_data->>'identifier')),cost=coalesce((_data->>'cost')::numeric,0),price=coalesce((_data->>'price')::numeric,0),condition=coalesce(_data->>'condition','Usado'),notes=coalesce(_data->>'notes',''),photos=coalesce(_data->'photos','[]'),details=coalesce(_data->'details','{}'),status=coalesce(_data->>'status','available') WHERE id=_id;
    result:=_id;
  END IF;
  RETURN result;
END $_$;


--
-- Name: save_loan_collateral(uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_loan_collateral(_contract_id uuid, _data jsonb, _request_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE uid uuid:=auth.uid(); cid uuid; result uuid;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM loan_collateral WHERE user_id=uid AND request_id=_request_id;IF result IS NOT NULL THEN RETURN result;END IF;
  SELECT client_id INTO cid FROM contracts WHERE id=_contract_id AND user_id=uid FOR UPDATE;
  IF cid IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  INSERT INTO loan_collateral(user_id,client_id,contract_id,description,category,identifier,estimated_value,condition,storage_location,photos,notes,request_id)
  VALUES(uid,cid,_contract_id,_data->>'description',coalesce(_data->>'category','Outro'),coalesce(_data->>'identifier',''),(_data->>'estimated_value')::numeric,coalesce(_data->>'condition',''),coalesce(_data->>'storage_location',''),coalesce(_data->'photos','[]'),coalesce(_data->>'notes',''),_request_id) RETURNING id INTO result;
  RETURN result;
END $$;


--
-- Name: save_whatsapp_event(uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_whatsapp_event(_user_id uuid, _instance text, _message_id text, _payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.whatsapp_event_claims(user_id,instance,message_id,status,payload,attempts)
    VALUES(_user_id,_instance,_message_id,'received',_payload,0)
    ON CONFLICT(user_id,instance,message_id) DO UPDATE SET payload=EXCLUDED.payload WHERE whatsapp_event_claims.status<>'completed';
END; $$;


--
-- Name: search_clients_by_document(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_clients_by_document(_document text) RETURNS TABLE(id uuid, name text, email text, phone text, cpf_cnpj text, status text, avatar_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.name, c.email, c.phone, c.cpf_cnpj, c.status, c.avatar_url
  FROM public.clients c
  WHERE c.user_id = auth.uid()
    AND regexp_replace(coalesce(c.cpf_cnpj, ''), '\D', '', 'g')
        = regexp_replace(coalesce(_document, ''), '\D', '', 'g')
    AND length(regexp_replace(coalesce(_document, ''), '\D', '', 'g')) IN (11, 14)
  ORDER BY c.name ASC
  LIMIT 50;
$$;


--
-- Name: search_clients_fuzzy(text, real, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_clients_fuzzy(_term text, _threshold real DEFAULT 0.2, _limit integer DEFAULT 20) RETURNS TABLE(id uuid, name text, email text, phone text, cpf_cnpj text, status text, avatar_url text, similarity real)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    c.id, c.name, c.email, c.phone, c.cpf_cnpj, c.status, c.avatar_url,
    GREATEST(
      similarity(lower(c.name), lower(_term)),
      similarity(lower(coalesce(c.email,'')), lower(_term))
    )::real AS similarity
  FROM public.clients c
  WHERE c.user_id = auth.uid()
    AND (
      similarity(lower(c.name), lower(_term)) >= _threshold
      OR lower(c.name) ILIKE '%' || lower(_term) || '%'
      OR similarity(lower(coalesce(c.email,'')), lower(_term)) >= _threshold
    )
  ORDER BY similarity DESC, c.name ASC
  LIMIT _limit;
$$;


--
-- Name: settle_percentage_installment(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.settle_percentage_installment(_installment_id uuid, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE
  _inst public.contract_installments%rowtype;
  _contract public.contracts%rowtype;
  _principal numeric;
  _interest numeric;
  _total numeric;
BEGIN
  SELECT * INTO _inst FROM public.contract_installments WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL OR _inst.user_id <> auth.uid() THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  IF _inst.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'installment_closed'; END IF;
  SELECT * INTO _contract FROM public.contracts WHERE id = _inst.contract_id AND user_id = auth.uid();
  IF _contract.id IS NULL THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF _contract.loan_mode NOT IN ('percentage', 'interest_only') THEN RAISE EXCEPTION 'not_renewable_contract'; END IF;

  _principal := greatest(0, coalesce(_contract.capital, 0));
  _interest := greatest(0, coalesce(_inst.amount, 0));
  _total := round((_principal + _interest + greatest(0, coalesce(_inst.late_fee, 0)))::numeric, 2);
  IF _total <= 0 THEN RAISE EXCEPTION 'invalid_settlement_amount'; END IF;

  UPDATE public.contract_installments
  SET amount = round((_principal + _interest)::numeric, 2),
      scheduled_principal = _principal,
      scheduled_interest = _interest,
      -- Só grava um snapshot novo se não houver um pendente: evita perder o
      -- estado ORIGINAL caso, por algum motivo, esta parcela seja "quitada"
      -- mais de uma vez sem um estorno completo entre as chamadas.
      pre_settlement_snapshot = COALESCE(_inst.pre_settlement_snapshot, jsonb_build_object(
        'amount', _inst.amount,
        'scheduled_principal', _inst.scheduled_principal,
        'scheduled_interest', _inst.scheduled_interest
      ))
  WHERE id = _inst.id;

  RETURN public.pay_installment(_installment_id, _total, true, _method, _receipt_url);
END;
$$;


--
-- Name: stop_charges_for_closed_contract(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.stop_charges_for_closed_contract() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.status IN ('active', 'overdue')
     AND NEW.status NOT IN ('active', 'overdue') THEN
    UPDATE public.contract_installments
       SET status = 'cancelled'
     WHERE contract_id = NEW.id
       AND status NOT IN ('paid', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sync_paid_installment_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_paid_installment_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE total_due numeric;
BEGIN
  IF coalesce(NEW.amount::text,'') IN ('NaN','Infinity','-Infinity')
    OR coalesce(NEW.late_fee::text,'') IN ('NaN','Infinity','-Infinity')
    OR coalesce(NEW.paid_amount::text,'') IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_installment_amount' USING ERRCODE = '22003';
  END IF;
  total_due := round(greatest(0,coalesce(NEW.amount,0)) + greatest(0,coalesce(NEW.late_fee,0)),2);
  IF NEW.status IS DISTINCT FROM 'cancelled' AND total_due > 0 THEN
    IF round(greatest(0,coalesce(NEW.paid_amount,0)),2) >= total_due THEN
      NEW.status := 'paid'; NEW.paid_at := coalesce(NEW.paid_at,now());
    ELSIF NEW.status = 'paid' THEN
      NEW.status := CASE WHEN NEW.due_date < current_date THEN 'overdue' ELSE 'pending' END;
      NEW.paid_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    address jsonb,
    cpf_cnpj text,
    avatar_url text DEFAULT ''::text,
    status text DEFAULT 'Ativo'::text NOT NULL,
    client_type text DEFAULT 'loan'::text NOT NULL,
    loan jsonb,
    cellphone_sale jsonb,
    documents jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    credit_score integer DEFAULT 100,
    whatsapp text,
    birth_date date,
    bot_memory text,
    CONSTRAINT clients_client_type_check CHECK ((client_type = ANY (ARRAY['loan'::text, 'rental'::text, 'cellphone'::text]))),
    CONSTRAINT clients_status_check CHECK ((status = ANY (ARRAY['Ativo'::text, 'Inativo'::text])))
);

ALTER TABLE ONLY public.clients REPLICA IDENTITY FULL;


--
-- Name: system_find_clients_by_phone(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.system_find_clients_by_phone(_user_id uuid, _phone text) RETURNS SETOF public.clients
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT c.* FROM public.clients c WHERE c.user_id=_user_id
    AND public.bot_phone_key(_phone) IS NOT NULL AND (
      public.bot_phone_key(c.phone)=public.bot_phone_key(_phone) OR public.bot_phone_key(c.whatsapp)=public.bot_phone_key(_phone)) ORDER BY c.id;
END; $$;


--
-- Name: system_pay_client_balance(uuid, numeric, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.system_pay_client_balance(_client_id uuid, _amount numeric, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text, _origin text DEFAULT NULL::text, _source_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$ DECLARE owner_id uuid; result jsonb; BEGIN IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF; SELECT user_id INTO owner_id FROM public.clients WHERE id=_client_id; IF owner_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF; PERFORM set_config('request.jwt.claim.sub', owner_id::text, true); result := public.pay_client_balance(_client_id,_amount,_method,_receipt_url); RETURN result || jsonb_build_object('origin',_origin,'source_key',_source_key); END; $$;


--
-- Name: system_register_payment(uuid, numeric, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.system_register_payment(_installment_id uuid, _paid_total numeric, _method text DEFAULT 'pix'::text, _origem text DEFAULT NULL::text, _receipt_url text DEFAULT NULL::text, _source_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  owner_id uuid;
  total_due numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT user_id INTO owner_id
  FROM public.contract_installments
  WHERE id = _installment_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  SELECT round(greatest(0, coalesce(amount, 0)) + greatest(0, coalesce(late_fee, 0)), 2)
    INTO total_due
  FROM public.contract_installments WHERE id = _installment_id;

  -- pay_installment valida auth.uid(); o webhook usa service_role, então
  -- definimos o proprietário derivado da própria parcela dentro da transação.
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  RETURN public.pay_installment(
    _installment_id, _paid_total, coalesce(_paid_total, 0) + 0.005 >= total_due,
    _method, _receipt_url,
    _source_key
  );
END;
$$;


--
-- Name: system_renew_installment_interest(uuid, numeric, timestamp with time zone, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.system_renew_installment_interest(_installment_id uuid, _amount numeric, _next_due_date timestamp with time zone, _origin text DEFAULT NULL::text, _source_key text DEFAULT NULL::text, _method text DEFAULT 'pix'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  owner_id uuid;
  result jsonb;
  tx_id uuid;
  computed_amount numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT user_id INTO owner_id
  FROM public.contract_installments
  WHERE id = _installment_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'installment_not_found'; END IF;

  IF NULLIF(trim(_source_key), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = owner_id AND source_key = trim(_source_key)
  ) THEN
    SELECT to_jsonb(t) INTO result
    FROM public.transactions t
    WHERE t.user_id = owner_id AND t.source_key = trim(_source_key)
    ORDER BY t.created_at DESC LIMIT 1;
    RETURN coalesce(result, jsonb_build_object('ok', true, 'idempotent', true));
  END IF;

  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  result := public.renew_installment_interest(
    _installment_id,
    (_next_due_date AT TIME ZONE 'UTC')::date,
    _method,
    _origin,
    NULL
  );

  -- O comprovante que o bot verificou precisa bater com o juros que o
  -- contrato realmente cobra nesta renovação. Diverge além de um centavo de
  -- arredondamento? Falha a transação inteira em vez de gravar um número
  -- que não corresponde ao dinheiro recebido.
  computed_amount := (result->>'amount')::numeric;
  IF _amount IS NOT NULL AND _amount > 0
     AND abs(computed_amount - _amount) > 0.01 THEN
    RAISE EXCEPTION 'renewal_amount_mismatch: contrato calcula %, comprovante informa %',
      computed_amount, _amount;
  END IF;

  IF NULLIF(trim(_source_key), '') IS NOT NULL THEN
    SELECT id INTO tx_id
    FROM public.transactions
    WHERE user_id = owner_id
      AND installment_id = _installment_id
      AND category = 'interest_renewal'
    ORDER BY created_at DESC LIMIT 1;
    IF tx_id IS NOT NULL THEN
      UPDATE public.transactions SET source_key = trim(_source_key) WHERE id = tx_id;
    END IF;
  END IF;
  RETURN result;
END;
$$;


--
-- Name: touch_dm_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_dm_thread() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.dm_thread_id IS NOT NULL THEN
    UPDATE public.chat_dm_threads SET last_message_at = NEW.created_at WHERE id = NEW.dm_thread_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: touch_payment_promise(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_payment_promise() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


--
-- Name: try_consume_rate_limit(text, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_consume_rate_limit(_key text, _capacity double precision, _refill_per_sec double precision) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE current_time_value timestamptz:=clock_timestamp(); available double precision;
 last_update timestamptz; elapsed double precision; retry_ms integer;
BEGIN
 IF nullif(btrim(_key),'')IS NULL OR length(_key)>512
   OR _capacity IS NULL OR _capacity::text IN ('NaN','Infinity','-Infinity') OR _capacity<1 OR _capacity>1000000
   OR _refill_per_sec IS NULL OR _refill_per_sec::text IN ('NaN','Infinity','-Infinity') OR _refill_per_sec<=0 OR _refill_per_sec>1000000 THEN
  RAISE EXCEPTION 'invalid_rate_limit' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.rate_limit_hits(key,tokens,updated_at)VALUES(_key,_capacity,current_time_value)ON CONFLICT(key)DO NOTHING;
 SELECT tokens,updated_at INTO available,last_update FROM public.rate_limit_hits WHERE key=_key FOR UPDATE;
 IF available IS NULL OR available::text IN ('NaN','Infinity','-Infinity') OR available<0
    OR last_update IS NULL OR NOT isfinite(last_update) THEN
  RAISE EXCEPTION 'invalid_rate_limit_state' USING ERRCODE='22023';
 END IF;
 -- Re-read the clock after waiting on another invocation's transaction.
 current_time_value:=clock_timestamp();
 elapsed:=greatest(0,extract(epoch FROM(current_time_value-last_update)));
 available:=least(_capacity,available+elapsed*_refill_per_sec);
 IF available::text IN ('NaN','Infinity','-Infinity') OR available<0 THEN
  RAISE EXCEPTION 'invalid_rate_limit_state' USING ERRCODE='22023';
 END IF;
 IF available>=1 THEN
  UPDATE public.rate_limit_hits SET tokens=available-1,updated_at=current_time_value WHERE key=_key;
  RETURN jsonb_build_object('allowed',true,'remaining',floor(available-1),'retry_after_ms',0);
 END IF;
 UPDATE public.rate_limit_hits SET tokens=available,updated_at=current_time_value WHERE key=_key;
 retry_ms:=least(2147483647,greatest(1,ceil(((1-available)/_refill_per_sec)*1000)))::integer;
 RETURN jsonb_build_object('allowed',false,'remaining',0,'retry_after_ms',retry_ms);
END;
$$;


--
-- Name: update_contract_atomically(uuid, jsonb, boolean, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_contract_atomically(_contract_id uuid, _contract jsonb, _regenerate boolean DEFAULT false, _installments jsonb DEFAULT '[]'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
  current_contract public.contracts%ROWTYPE;
  new_installment_count integer;
  paid_count integer;
  expected_pending integer;
  supplied_count integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT * INTO current_contract
  FROM public.contracts
  WHERE id = _contract_id AND user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  new_installment_count := COALESCE(
    NULLIF(_contract->>'num_installments', '')::integer,
    current_contract.num_installments
  );

  IF new_installment_count IS NULL OR new_installment_count < 1 THEN
    RAISE EXCEPTION 'Quantidade de parcelas inválida';
  END IF;

  UPDATE public.contracts
  SET capital = COALESCE(NULLIF(_contract->>'capital', '')::numeric, capital),
      interest_rate = COALESCE(NULLIF(_contract->>'interest_rate', '')::numeric, interest_rate),
      num_installments = new_installment_count,
      installment_amount = COALESCE(NULLIF(_contract->>'installment_amount', '')::numeric, installment_amount),
      frequency = COALESCE(NULLIF(_contract->>'frequency', ''), frequency),
      start_date = COALESCE(NULLIF(_contract->>'start_date', '')::timestamptz, start_date),
      late_fee_percent = COALESCE(NULLIF(_contract->>'late_fee_percent', '')::numeric, late_fee_percent),
      daily_interest_percent = COALESCE(NULLIF(_contract->>'daily_interest_percent', '')::numeric, daily_interest_percent),
      total_amount = COALESCE(NULLIF(_contract->>'total_amount', '')::numeric, total_amount),
      total_interest = COALESCE(NULLIF(_contract->>'total_interest', '')::numeric, total_interest),
      notes = CASE WHEN _contract ? 'notes' THEN _contract->>'notes' ELSE notes END
  WHERE id = _contract_id AND user_id = uid;

  IF NOT _regenerate THEN
    RETURN;
  END IF;

  -- Lock every installment before deciding which pending rows may be replaced.
  PERFORM 1
  FROM public.contract_installments
  WHERE contract_id = _contract_id AND user_id = uid
  FOR UPDATE;

  SELECT count(*) INTO paid_count
  FROM public.contract_installments
  WHERE contract_id = _contract_id AND user_id = uid AND status = 'paid';

  IF paid_count > new_installment_count
     OR EXISTS (
       SELECT 1 FROM public.contract_installments
       WHERE contract_id = _contract_id AND user_id = uid
         AND status = 'paid' AND installment_number > new_installment_count
     ) THEN
    RAISE EXCEPTION 'paid_installment_would_be_removed';
  END IF;

  IF jsonb_typeof(_installments) <> 'array' THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  expected_pending := new_installment_count - paid_count;
  supplied_count := jsonb_array_length(_installments);
  IF supplied_count <> expected_pending THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_installments) AS item(installment_number integer, amount numeric, due_date timestamptz)
    WHERE item.installment_number IS NULL
       OR item.installment_number < 1
       OR item.installment_number > new_installment_count
       OR item.amount IS NULL
       OR item.amount <= 0
       OR item.due_date IS NULL
  ) OR (
    SELECT count(DISTINCT item.installment_number)
    FROM jsonb_to_recordset(_installments) AS item(installment_number integer)
  ) <> supplied_count THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_installments) AS item(installment_number integer)
    JOIN public.contract_installments paid
      ON paid.contract_id = _contract_id
     AND paid.user_id = uid
     AND paid.status = 'paid'
     AND paid.installment_number = item.installment_number
  ) THEN
    RAISE EXCEPTION 'paid_installment_would_be_removed';
  END IF;

  DELETE FROM public.contract_installments
  WHERE contract_id = _contract_id AND user_id = uid AND status <> 'paid';

  INSERT INTO public.contract_installments (
    user_id, contract_id, client_id, installment_number, amount, due_date,
    status, scheduled_principal, scheduled_interest
  )
  SELECT uid, _contract_id, current_contract.client_id,
         item.installment_number, item.amount, item.due_date,
         'pending', COALESCE(item.scheduled_principal, 0), COALESCE(item.scheduled_interest, 0)
  FROM jsonb_to_recordset(_installments) AS item(
    installment_number integer,
    amount numeric,
    due_date timestamptz,
    scheduled_principal numeric,
    scheduled_interest numeric
  );
END;
$$;


--
-- Name: update_ticket_on_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ticket_on_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- Nota interna não muda SLA/status e nunca aciona aviso para o assinante.
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  UPDATE public.support_tickets
  SET
    last_message_at = NEW.created_at,
    updated_at = NEW.created_at,
    unread_by_admin = CASE WHEN NEW.sender_role = 'user' THEN true ELSE unread_by_admin END,
    unread_by_user = CASE WHEN NEW.sender_role = 'admin' THEN true ELSE unread_by_user END,
    status = CASE
      WHEN NEW.sender_role = 'user' AND status = 'closed' THEN 'open'
      WHEN NEW.sender_role = 'admin' AND status = 'open' THEN 'answered'
      ELSE status
    END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: wallet_cash_report(integer, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wallet_cash_report(_days integer DEFAULT NULL::integer, _search text DEFAULT ''::text, _offset integer DEFAULT 0, _limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE uid uuid:=auth.uid(); today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
 IF (_days IS NOT NULL AND _days NOT IN (7,30,90)) OR coalesce(_offset,0)<0 OR coalesce(_limit,50) NOT BETWEEN 1 AND 100
   OR length(coalesce(_search,''))>200 THEN RAISE EXCEPTION 'invalid_wallet_filter' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.transactions WHERE user_id=uid AND (amount::text IN ('NaN','Infinity','-Infinity') OR amount<0))
   OR EXISTS(SELECT 1 FROM public.expenses WHERE user_id=uid AND (amount::text IN ('NaN','Infinity','-Infinity') OR amount<0))
   OR EXISTS(SELECT 1 FROM public.contract_installments WHERE user_id=uid AND (paid_amount::text IN ('NaN','Infinity','-Infinity') OR paid_amount<0)) THEN
   RAISE EXCEPTION 'invalid_wallet_amount' USING ERRCODE='22003';
 END IF;
 WITH receipts AS MATERIALIZED (
   SELECT t.*,round(amount,2) AS cash,
     CASE WHEN least(principal_amount,interest_amount,fee_amount,unallocated_amount)>=0
       AND principal_amount::text NOT IN ('NaN','Infinity','-Infinity') AND interest_amount::text NOT IN ('NaN','Infinity','-Infinity')
       AND fee_amount::text NOT IN ('NaN','Infinity','-Infinity') AND unallocated_amount::text NOT IN ('NaN','Infinity','-Infinity')
       AND round(principal_amount,2)+round(interest_amount,2)+round(fee_amount,2)+round(unallocated_amount,2)<=round(amount,2) THEN true ELSE false END AS valid_allocation
   FROM public.transactions t WHERE user_id=uid AND type IN ('payment','partial_payment') AND amount>0
 ), installment_groups AS (
   SELECT contract_id,client_id,round(sum(coalesce(paid_amount,0)),2) AS received
   FROM public.contract_installments WHERE user_id=uid AND paid_amount>0 GROUP BY contract_id,client_id
 ), ledger_groups AS (
   SELECT contract_id,client_id,sum(cash) AS received FROM receipts WHERE coalesce(category,'')<>'interest_renewal' GROUP BY contract_id,client_id
 ), gaps AS MATERIALIZED (
   SELECT i.contract_id,i.client_id,greatest(0,i.received-coalesce(l.received,0)) AS cash
   FROM installment_groups i LEFT JOIN ledger_groups l ON l.contract_id IS NOT DISTINCT FROM i.contract_id AND l.client_id IS NOT DISTINCT FROM i.client_id
 ), movements AS MATERIALIZED (
   SELECT 'transaction:'||r.id::text AS id,'in'::text AS type,coalesce(nullif(r.description,''),'Recebimento registrado') AS description,
     r.cash AS amount,r.date,CASE WHEN r.category='interest_renewal' THEN 'Juros de renovação' ELSE 'Recebimento' END AS source,
     false AS removable,NULL::uuid AS remove_id,'receipt'::text AS kind,
     CASE WHEN valid_allocation THEN round(principal_amount,2) ELSE 0 END AS principal,
     CASE WHEN valid_allocation THEN round(interest_amount,2)+round(fee_amount,2) ELSE 0 END AS profit,
     CASE WHEN valid_allocation THEN greatest(0,cash-round(principal_amount,2)-round(interest_amount,2)-round(fee_amount,2)) ELSE cash END AS unclassified
   FROM receipts r
   UNION ALL
   -- Contract/client coverage avoids counting unlinked legacy ledger and paid totals twice.
   -- A residual has no proven cash date and never borrows the final settlement date.
   SELECT 'legacy:'||coalesce(contract_id::text,'none')||':'||coalesce(client_id::text,'none'),'in',
     'Recebimento histórico sem lançamento completo',cash,NULL::timestamptz,'Recebimento legado',false,NULL::uuid,'legacy_receipt',0,0,cash
   FROM gaps WHERE cash>0
   UNION ALL
   SELECT 'transaction:'||t.id::text,CASE WHEN type='capital_injection' THEN 'in' ELSE 'out' END,
     coalesce(nullif(description,''),'Movimentação registrada'),round(amount,2),date,
     CASE WHEN type='capital_injection' THEN 'Aporte' WHEN type='capital_withdrawal' THEN 'Retirada de capital'
       WHEN type IN ('loan_disbursement','loan') THEN 'Empréstimo liberado' ELSE 'Pagamento a investidor' END,
     type IN ('capital_injection','capital_withdrawal'),CASE WHEN type IN ('capital_injection','capital_withdrawal') THEN id ELSE NULL END,
     CASE WHEN type IN ('loan_disbursement','loan') THEN 'disbursement' ELSE type END,0,0,0
   FROM public.transactions t WHERE user_id=uid AND type IN ('capital_injection','capital_withdrawal','loan_disbursement','loan','expense') AND amount>0
   UNION ALL
   SELECT 'expense:'||id::text,'out',coalesce(nullif(description,''),'Gasto registrado'),round(amount,2),date,
     coalesce(nullif(category,''),'Gasto'),false,NULL::uuid,'manual_expense',0,0,0 FROM public.expenses WHERE user_id=uid AND amount>0
 ), dated AS MATERIALIZED (
   SELECT *,CASE WHEN date IS NOT NULL AND isfinite(date) THEN (date AT TIME ZONE 'America/Sao_Paulo')::date ELSE NULL END AS day FROM movements
 ), booked AS MATERIALIZED (
   SELECT * FROM dated WHERE day IS NULL OR day<=today
 ), totals AS (
   SELECT coalesce(sum(amount) FILTER(WHERE type='in'),0) AS inflows,coalesce(sum(amount) FILTER(WHERE type='out'),0) AS outflows,
     coalesce(sum(amount) FILTER(WHERE kind='capital_injection'),0) AS capital,
     coalesce(sum(amount) FILTER(WHERE kind='capital_withdrawal'),0) AS withdrawals,
     coalesce(sum(amount) FILTER(WHERE kind IN ('receipt','legacy_receipt')),0) AS receipts,
     coalesce(sum(amount) FILTER(WHERE kind='disbursement'),0) AS disbursements,
     coalesce(sum(amount) FILTER(WHERE kind='expense'),0) AS ledger_expenses,
     coalesce(sum(amount) FILTER(WHERE kind='manual_expense'),0) AS manual_expenses,
     coalesce(sum(principal),0) AS principal,coalesce(sum(profit),0) AS profit,coalesce(sum(unclassified),0) AS unclassified,
     coalesce(sum(amount) FILTER(WHERE day IS NULL),0) AS undated_amount,
     coalesce(sum(amount) FILTER(WHERE kind='legacy_receipt'),0) AS legacy_gap_amount
   FROM booked
 ), current_period AS MATERIALIZED (
   SELECT * FROM booked WHERE _days IS NULL OR day BETWEEN today-(_days-1) AND today
 ), period_totals AS (
   SELECT coalesce(sum(amount) FILTER(WHERE type='in'),0) AS inflows,coalesce(sum(amount) FILTER(WHERE type='out'),0) AS outflows FROM current_period
 ), previous_totals AS (
   SELECT coalesce(sum(amount) FILTER(WHERE type='in'),0) AS inflows,coalesce(sum(amount) FILTER(WHERE type='out'),0) AS outflows
   FROM booked WHERE _days IS NOT NULL AND day BETWEEN today-(_days*2-1) AND today-_days
 ), filtered AS MATERIALIZED (
   SELECT * FROM current_period WHERE strpos(lower(description||' '||source),lower(btrim(coalesce(_search,''))))>0
 ), page AS (
   SELECT id,type,description AS desc,amount,CASE WHEN day IS NOT NULL THEN date ELSE NULL END AS date,source,removable,remove_id FROM filtered
   ORDER BY day DESC NULLS LAST,date DESC NULLS LAST,id DESC OFFSET coalesce(_offset,0) LIMIT coalesce(_limit,50)
 ), forecast AS (
   SELECT i.due_date,round(greatest(0,i.amount+public.quote_installment_late_fee(i.amount,i.due_date,i.status,i.late_fee,i.pre_settlement_snapshot,
     c.daily_interest_percent,c.daily_penalty_type,c.daily_penalty_value,c.max_interest_cap_percent)-coalesce(i.paid_amount,0)),2) AS balance
   FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id AND c.user_id=i.user_id AND c.client_id=i.client_id
   WHERE i.user_id=uid AND (i.status IS NULL OR i.status NOT IN ('paid','cancelled')) AND c.status IN ('active','overdue')
 ), forecast_totals AS (
   SELECT coalesce(sum(balance) FILTER(WHERE (due_date AT TIME ZONE 'America/Sao_Paulo')::date<=today+7),0) AS d7,
     coalesce(sum(balance) FILTER(WHERE (due_date AT TIME ZONE 'America/Sao_Paulo')::date<=today+30),0) AS d30,
     coalesce(sum(balance) FILTER(WHERE (due_date AT TIME ZONE 'America/Sao_Paulo')::date<=today+90),0) AS d90 FROM forecast
 )
 SELECT jsonb_build_object('as_of',now(),'financial_day',today,'totals',to_jsonb(t)||jsonb_build_object('balance',t.inflows-t.outflows),
   'period',jsonb_build_object('inflows',p.inflows,'outflows',p.outflows,'previous_inflows',prev.inflows,'previous_outflows',prev.outflows,
     'opening_balance',CASE WHEN _days IS NULL THEN 0 ELSE t.inflows-t.outflows-p.inflows+p.outflows END,'closing_balance',t.inflows-t.outflows),
   'forecast',to_jsonb(f),'timeline',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'timeline_count',(SELECT count(*) FROM filtered),
   'warnings',jsonb_build_object('undated_amount',t.undated_amount,'legacy_gap_amount',t.legacy_gap_amount,
     'unlinked_receipts',(SELECT count(*) FROM receipts WHERE installment_id IS NULL),
     'cash_above_installments',(SELECT coalesce(sum(greatest(0,l.received-coalesce(i.received,0))),0) FROM ledger_groups l
       LEFT JOIN installment_groups i ON i.contract_id IS NOT DISTINCT FROM l.contract_id AND i.client_id IS NOT DISTINCT FROM l.client_id),
     'future_amount',(SELECT coalesce(sum(amount),0) FROM dated WHERE day>today),
     'recorded_profit',(SELECT coalesce(sum(amount),0) FROM public.profits WHERE user_id=uid)))
 INTO result FROM totals t CROSS JOIN period_totals p CROSS JOIN previous_totals prev CROSS JOIN forecast_totals f;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(result->'totals') WHERE value::numeric::text IN ('NaN','Infinity','-Infinity') OR abs(value::numeric)>90071992547409.91) THEN
   RAISE EXCEPTION 'wallet_total_out_of_range' USING ERRCODE='22003';
 END IF;
 RETURN result;
END;
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
_filename text;
BEGIN
	select string_to_array(name, '/') into _parts;
	select _parts[array_length(_parts,1)] into _filename;
	-- @todo return the last part instead of 2
	return reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::int) as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: ai_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    messages jsonb DEFAULT '[]'::jsonb NOT NULL,
    title text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: automation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid,
    level text NOT NULL,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bot_actions_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bot_actions_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid,
    conversation_id uuid,
    tool_name text NOT NULL,
    tool_input jsonb DEFAULT '{}'::jsonb NOT NULL,
    tool_output jsonb DEFAULT '{}'::jsonb NOT NULL,
    success boolean DEFAULT true NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    identifier text NOT NULL,
    cost numeric(14,2) DEFAULT 0 NOT NULL,
    price numeric(14,2) DEFAULT 0 NOT NULL,
    condition text DEFAULT 'Usado'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_assets_cost_check CHECK ((cost >= (0)::numeric)),
    CONSTRAINT business_assets_details_check CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT business_assets_identifier_check CHECK (((length(TRIM(BOTH FROM identifier)) >= 3) AND (length(TRIM(BOTH FROM identifier)) <= 50))),
    CONSTRAINT business_assets_kind_check CHECK ((kind = ANY (ARRAY['phone'::text, 'car'::text, 'motorcycle'::text]))),
    CONSTRAINT business_assets_label_check CHECK (((length(TRIM(BOTH FROM label)) >= 2) AND (length(TRIM(BOTH FROM label)) <= 150))),
    CONSTRAINT business_assets_photos_check CHECK ((jsonb_typeof(photos) = 'array'::text)),
    CONSTRAINT business_assets_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT business_assets_status_check CHECK ((status = ANY (ARRAY['available'::text, 'sold'::text, 'rented'::text, 'maintenance'::text, 'archived'::text])))
);


--
-- Name: business_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_operations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    total numeric(14,2) NOT NULL,
    down_payment numeric(14,2) DEFAULT 0 NOT NULL,
    deposit numeric(14,2) DEFAULT 0 NOT NULL,
    deposit_returned numeric(14,2) DEFAULT 0 NOT NULL,
    start_date date NOT NULL,
    end_date date,
    returned_at timestamp with time zone,
    billing text DEFAULT 'monthly'::text NOT NULL,
    rate numeric(14,2) DEFAULT 0 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_operations_billing_check CHECK ((billing = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))),
    CONSTRAINT business_operations_check CHECK ((down_payment <= total)),
    CONSTRAINT business_operations_check1 CHECK ((deposit_returned <= deposit)),
    CONSTRAINT business_operations_check2 CHECK (((end_date IS NULL) OR (end_date >= start_date))),
    CONSTRAINT business_operations_deposit_check CHECK ((deposit >= (0)::numeric)),
    CONSTRAINT business_operations_deposit_returned_check CHECK ((deposit_returned >= (0)::numeric)),
    CONSTRAINT business_operations_down_payment_check CHECK ((down_payment >= (0)::numeric)),
    CONSTRAINT business_operations_kind_check CHECK ((kind = ANY (ARRAY['sale'::text, 'rental'::text]))),
    CONSTRAINT business_operations_rate_check CHECK ((rate >= (0)::numeric)),
    CONSTRAINT business_operations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT business_operations_total_check CHECK ((total > (0)::numeric))
);


--
-- Name: business_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    receivable_id uuid,
    kind text NOT NULL,
    amount numeric(14,2) NOT NULL,
    method text NOT NULL,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT business_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT business_payments_kind_check CHECK ((kind = ANY (ARRAY['receipt'::text, 'down_payment'::text, 'deposit'::text, 'deposit_refund'::text, 'refund'::text]))),
    CONSTRAINT business_payments_method_check CHECK ((method = ANY (ARRAY['pix'::text, 'cash'::text, 'card'::text, 'transfer'::text])))
);


--
-- Name: business_receivables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_receivables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    operation_id uuid NOT NULL,
    number integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    paid_amount numeric(14,2) DEFAULT 0 NOT NULL,
    due_date date NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT business_receivables_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT business_receivables_check CHECK ((paid_amount <= amount)),
    CONSTRAINT business_receivables_number_check CHECK ((number > 0)),
    CONSTRAINT business_receivables_paid_amount_check CHECK ((paid_amount >= (0)::numeric)),
    CONSTRAINT business_receivables_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text])))
);


--
-- Name: chat_channel_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channel_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_channel_members REPLICA IDENTITY FULL;


--
-- Name: chat_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_default boolean DEFAULT false NOT NULL,
    is_announcement boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_dm_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_dm_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_a uuid NOT NULL,
    user_b uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    last_read_a timestamp with time zone DEFAULT now() NOT NULL,
    last_read_b timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_dm_threads_check CHECK ((user_a < user_b))
);

ALTER TABLE ONLY public.chat_dm_threads REPLICA IDENTITY FULL;


--
-- Name: chat_message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.chat_message_reactions REPLICA IDENTITY FULL;


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid,
    dm_thread_id uuid,
    user_id uuid NOT NULL,
    user_name text NOT NULL,
    user_avatar text,
    content text NOT NULL,
    type text DEFAULT 'text'::text NOT NULL,
    file_url text,
    file_name text,
    file_type text,
    reply_to jsonb,
    is_pinned boolean DEFAULT false NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_by uuid,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chat_messages_check CHECK (((((channel_id IS NOT NULL))::integer + ((dm_thread_id IS NOT NULL))::integer) = 1))
);

ALTER TABLE ONLY public.chat_messages REPLICA IDENTITY FULL;


--
-- Name: client_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    rota text DEFAULT ''::text NOT NULL,
    mensagem text NOT NULL,
    pilha text,
    navegador text,
    contexto jsonb DEFAULT '{}'::jsonb NOT NULL,
    criado_em timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT client_errors_mensagem_tamanho CHECK ((char_length(mensagem) <= 2000)),
    CONSTRAINT client_errors_pilha_tamanho CHECK (((pilha IS NULL) OR (char_length(pilha) <= 8000)))
);


--
-- Name: TABLE client_errors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_errors IS 'Erros de JavaScript capturados no navegador. Escrita aberta, leitura só para admin.';


--
-- Name: client_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    contract_id uuid,
    installment_id uuid,
    type text NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    dedupe_day date DEFAULT ((now() AT TIME ZONE 'UTC'::text))::date NOT NULL
);


--
-- Name: client_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    token text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.client_tokens REPLICA IDENTITY FULL;


--
-- Name: collection_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid,
    contract_id uuid,
    installment_id uuid,
    channel text NOT NULL,
    message_preview text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_attempts_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text, 'sms'::text, 'pix_copy'::text, 'manual'::text])))
);


--
-- Name: collection_dispatch_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_dispatch_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    channel text NOT NULL,
    claim_bucket timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collection_dispatch_claims_channel_check CHECK ((channel = ANY (ARRAY['whatsapp'::text, 'email'::text])))
);


--
-- Name: collector_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collector_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    collector_id uuid NOT NULL,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.collector_assignments REPLICA IDENTITY FULL;


--
-- Name: collector_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collector_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    collector_id uuid NOT NULL,
    token text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.collector_tokens REPLICA IDENTITY FULL;


--
-- Name: collectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collectors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    state text NOT NULL,
    city text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true,
    email text
);

ALTER TABLE ONLY public.collectors REPLICA IDENTITY FULL;


--
-- Name: contract_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    from_stage text,
    to_stage text,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contract_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    client_id uuid NOT NULL,
    installment_number integer NOT NULL,
    amount numeric NOT NULL,
    due_date timestamp with time zone NOT NULL,
    paid_at timestamp with time zone,
    paid_amount numeric,
    late_fee numeric DEFAULT 0,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_method text,
    receipt_url text,
    collection_status text,
    last_collected_at timestamp with time zone,
    last_collected_channel text,
    collection_count integer DEFAULT 0 NOT NULL,
    receipt_storage_path text,
    receipt_review_status text DEFAULT 'none'::text NOT NULL,
    scheduled_principal numeric DEFAULT 0 NOT NULL,
    scheduled_interest numeric DEFAULT 0 NOT NULL,
    paid_principal numeric DEFAULT 0 NOT NULL,
    paid_interest numeric DEFAULT 0 NOT NULL,
    paid_fees numeric DEFAULT 0 NOT NULL,
    pre_settlement_snapshot jsonb,
    CONSTRAINT contract_installments_receipt_review_status_check CHECK ((receipt_review_status = ANY (ARRAY['none'::text, 'pending'::text, 'approved'::text, 'rejected'::text])))
);

ALTER TABLE ONLY public.contract_installments REPLICA IDENTITY FULL;


--
-- Name: contract_signature_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_signature_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    signer_name text NOT NULL,
    signer_cpf text NOT NULL,
    user_agent text,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    capital numeric NOT NULL,
    interest_rate numeric DEFAULT 0 NOT NULL,
    num_installments integer NOT NULL,
    installment_amount numeric NOT NULL,
    frequency text DEFAULT 'monthly'::text NOT NULL,
    start_date timestamp with time zone DEFAULT now() NOT NULL,
    late_fee_percent numeric DEFAULT 0 NOT NULL,
    daily_interest_percent numeric DEFAULT 4 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    total_amount numeric DEFAULT 0 NOT NULL,
    total_interest numeric DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    grace_days integer DEFAULT 0 NOT NULL,
    guarantee_type text,
    guarantee_description text,
    guarantor_name text,
    guarantor_cpf text,
    guarantor_phone text,
    payment_method text DEFAULT 'pix'::text NOT NULL,
    auto_renew boolean DEFAULT false NOT NULL,
    early_payment_discount_percent numeric DEFAULT 0 NOT NULL,
    max_interest_cap_percent numeric,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    signature_status text DEFAULT 'pending'::text NOT NULL,
    signature_url text,
    signed_at timestamp with time zone,
    signature_token text,
    loan_mode text DEFAULT 'installments'::text NOT NULL,
    grace_periods integer DEFAULT 0 NOT NULL,
    investor_loan_id uuid,
    daily_penalty_type text DEFAULT 'percentage'::text NOT NULL,
    daily_penalty_value numeric DEFAULT 0 NOT NULL,
    signer_name text,
    signer_cpf text,
    signature_user_agent text,
    origin_contract_id uuid,
    renegotiated_balance numeric,
    new_cash_disbursed numeric DEFAULT 0 NOT NULL,
    renegotiation_reason text,
    renegotiated_at timestamp with time zone,
    lifecycle_stage text DEFAULT 'active'::text NOT NULL,
    activated_at timestamp with time zone,
    disbursed_at timestamp with time zone,
    disbursed_by uuid,
    disbursement_method text,
    disbursement_receipt_url text,
    CONSTRAINT contracts_daily_penalty_type_check CHECK ((daily_penalty_type = ANY (ARRAY['percentage'::text, 'fixed'::text]))),
    CONSTRAINT contracts_daily_penalty_value_check CHECK ((daily_penalty_value >= (0)::numeric)),
    CONSTRAINT contracts_lifecycle_stage_check CHECK ((lifecycle_stage = ANY (ARRAY['draft'::text, 'proposed'::text, 'approved'::text, 'signed'::text, 'disbursed'::text, 'active'::text, 'completed'::text, 'renegotiated'::text, 'cancelled'::text])))
);

ALTER TABLE ONLY public.contracts REPLICA IDENTITY FULL;


--
-- Name: COLUMN contracts.daily_penalty_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contracts.daily_penalty_type IS 'Forma da multa por dia de atraso: percentage ou fixed.';


--
-- Name: COLUMN contracts.daily_penalty_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contracts.daily_penalty_value IS 'Percentual ou valor fixo em reais aplicado por dia, conforme daily_penalty_type.';


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    description text NOT NULL,
    amount numeric NOT NULL,
    date timestamp with time zone NOT NULL,
    category text,
    receipt_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.expenses REPLICA IDENTITY FULL;


--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    description text NOT NULL,
    target_amount numeric NOT NULL,
    current_amount numeric DEFAULT 0 NOT NULL,
    frequency text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT goals_frequency_check CHECK ((frequency = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])))
);

ALTER TABLE ONLY public.goals REPLICA IDENTITY FULL;


--
-- Name: installments_legado_20260805; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.installments_legado_20260805 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid NOT NULL,
    installment_number integer NOT NULL,
    amount numeric NOT NULL,
    due_date timestamp with time zone NOT NULL,
    paid_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.installments_legado_20260805 REPLICA IDENTITY FULL;


--
-- Name: TABLE installments_legado_20260805; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.installments_legado_20260805 IS 'Legado, substituída por contract_installments. Renomeada em 2026-08-05. Se nada quebrar até 2026-09-05, pode ser removida.';


--
-- Name: investor_loans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investor_loans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    investor_id uuid NOT NULL,
    user_id uuid NOT NULL,
    principal numeric(14,2) NOT NULL,
    interest_rate numeric(6,2) DEFAULT 0 NOT NULL,
    total_due numeric(14,2) NOT NULL,
    paid_amount numeric(14,2) DEFAULT 0 NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date NOT NULL,
    frequency text DEFAULT 'bullet'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    payment_method text,
    paid_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT investor_loans_principal_check CHECK ((principal > (0)::numeric))
);


--
-- Name: investor_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investor_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    loan_id uuid NOT NULL,
    investor_id uuid NOT NULL,
    user_id uuid NOT NULL,
    amount numeric(14,2) NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    method text,
    receipt_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_type text DEFAULT 'balance'::text NOT NULL,
    CONSTRAINT investor_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT investor_payments_payment_type_check CHECK ((payment_type = ANY (ARRAY['balance'::text, 'interest_only'::text])))
);


--
-- Name: investors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    cpf_cnpj text,
    email text,
    phone text,
    whatsapp text,
    pix_key text,
    pix_key_type text,
    avatar_url text,
    notes text,
    access_token uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    cpf text,
    email text,
    amount_requested numeric,
    income_monthly numeric,
    purpose text,
    term_months integer,
    stage text DEFAULT 'new'::text NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_summary text,
    last_message_at timestamp with time zone,
    next_followup_at timestamp with time zone,
    converted_client_id uuid,
    source text DEFAULT 'whatsapp'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loan_collateral; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_collateral (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    contract_id uuid NOT NULL,
    client_id uuid NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    identifier text DEFAULT ''::text NOT NULL,
    estimated_value numeric(14,2) NOT NULL,
    condition text DEFAULT ''::text NOT NULL,
    storage_location text DEFAULT ''::text NOT NULL,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'held'::text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    returned_at timestamp with time zone,
    return_note text,
    request_id uuid NOT NULL,
    CONSTRAINT loan_collateral_description_check CHECK (((length(TRIM(BOTH FROM description)) >= 3) AND (length(TRIM(BOTH FROM description)) <= 500))),
    CONSTRAINT loan_collateral_estimated_value_check CHECK ((estimated_value > (0)::numeric)),
    CONSTRAINT loan_collateral_photos_check CHECK ((jsonb_typeof(photos) = 'array'::text)),
    CONSTRAINT loan_collateral_status_check CHECK ((status = ANY (ARRAY['held'::text, 'returned'::text])))
);


--
-- Name: loan_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loan_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT loan_presets_name_check CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 80)))
);


--
-- Name: manual_cash_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_cash_operations (
    user_id uuid NOT NULL,
    request_id uuid NOT NULL,
    operation text NOT NULL,
    request_payload jsonb NOT NULL,
    entry_id uuid,
    before_row jsonb,
    after_row jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    content text NOT NULL,
    trigger_days integer,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.message_templates REPLICA IDENTITY FULL;


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notes REPLICA IDENTITY FULL;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    message text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    "from" text DEFAULT 'Sistema'::text NOT NULL,
    link text,
    type text,
    subscription_cycle text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.notifications REPLICA IDENTITY FULL;


--
-- Name: payment_promises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_promises (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    contract_id uuid,
    installment_id uuid,
    promised_amount numeric,
    promised_for date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    source text DEFAULT 'bot'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fulfilled_at timestamp with time zone,
    broken_at timestamp with time zone,
    CONSTRAINT payment_promises_promised_amount_check CHECK (((promised_amount IS NULL) OR (promised_amount > (0)::numeric))),
    CONSTRAINT payment_promises_source_check CHECK ((source = ANY (ARRAY['bot'::text, 'human'::text, 'import'::text]))),
    CONSTRAINT payment_promises_status_check CHECK ((status = ANY (ARRAY['open'::text, 'fulfilled'::text, 'broken'::text, 'cancelled'::text, 'superseded'::text])))
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id boolean DEFAULT true NOT NULL,
    maintenance_mode boolean DEFAULT false NOT NULL,
    maintenance_message text,
    allow_new_registrations boolean DEFAULT true NOT NULL,
    default_trial_days integer DEFAULT 3 NOT NULL,
    global_announcement text,
    checkout_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT platform_settings_singleton CHECK (id),
    CONSTRAINT platform_settings_trial_days_sane CHECK (((default_trial_days >= 0) AND (default_trial_days <= 365)))
);


--
-- Name: TABLE platform_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.platform_settings IS 'Configuração global da plataforma (linha única). Só admin escreve; leitura é pública porque não guarda segredo.';


--
-- Name: pledges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pledges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    description text NOT NULL,
    client_name text NOT NULL,
    photo_url text DEFAULT ''::text,
    estimated_value numeric DEFAULT 0 NOT NULL,
    pledge_date timestamp with time zone DEFAULT now() NOT NULL,
    return_date timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pledges_status_check CHECK ((status = ANY (ARRAY['active'::text, 'returned'::text, 'executed'::text])))
);

ALTER TABLE ONLY public.pledges REPLICA IDENTITY FULL;


--
-- Name: portal_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_sessions (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    name text DEFAULT 'Usuário'::text NOT NULL,
    email text,
    avatar_url text,
    loan_balance numeric DEFAULT 0 NOT NULL,
    profit_balance numeric DEFAULT 0 NOT NULL,
    expense_balance numeric DEFAULT 0 NOT NULL,
    pix_key text,
    pix_key_type text,
    billing_message text DEFAULT '[Nome da Empresa]: Sr(a) [Nome do Cliente], identificamos um atraso em sua parcela de empréstimo. O valor pendente é de R$ [Valor da Parcela]. Por favor, entre em contato para regularizar.'::text,
    subscription_type text DEFAULT 'monthly'::text,
    subscription_expires_at timestamp with time zone,
    is_admin boolean DEFAULT false NOT NULL,
    is_chat_blocked boolean DEFAULT false NOT NULL,
    is_blocked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    trial_ends_at timestamp with time zone,
    onboarding_completed_at timestamp with time zone,
    plan_tier text DEFAULT 'completo'::text NOT NULL,
    CONSTRAINT profiles_pix_key_type_check CHECK ((pix_key_type = ANY (ARRAY['cpf'::text, 'cnpj'::text, 'email'::text, 'phone'::text, 'random'::text]))),
    CONSTRAINT profiles_subscription_type_check CHECK ((subscription_type = ANY (ARRAY['monthly'::text, 'annual'::text, 'lifetime'::text])))
);

ALTER TABLE ONLY public.profiles REPLICA IDENTITY FULL;


--
-- Name: profits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    description text NOT NULL,
    amount numeric NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    client_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    installment_id uuid,
    CONSTRAINT profits_status_check CHECK ((status = ANY (ARRAY['available'::text, 'withdrawn'::text])))
);

ALTER TABLE ONLY public.profits REPLICA IDENTITY FULL;


--
-- Name: rate_limit_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_hits (
    key text NOT NULL,
    tokens double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rentals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rentals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    client_id text NOT NULL,
    client_name text NOT NULL,
    start_date timestamp with time zone NOT NULL,
    end_date timestamp with time zone NOT NULL,
    price numeric NOT NULL,
    rental_type text NOT NULL,
    is_paid boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rentals_rental_type_check CHECK ((rental_type = ANY (ARRAY['daily'::text, 'weekly'::text, 'biweekly'::text, 'monthly'::text])))
);

ALTER TABLE ONLY public.rentals REPLICA IDENTITY FULL;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_name text,
    company_cnpj text,
    company_logo_url text,
    default_interest_rate numeric DEFAULT 10,
    default_late_fee numeric DEFAULT 2,
    default_daily_interest numeric DEFAULT 0.33,
    default_frequency text DEFAULT 'monthly'::text,
    whatsapp_api_url text DEFAULT 'https://disabled.staging.invalid/'::text,
    whatsapp_api_key text,
    whatsapp_instance text,
    n8n_webhook_url text,
    push_notifications_enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    primary_color text DEFAULT '#d97706'::text,
    accent_color text DEFAULT '#f59e0b'::text,
    theme_mode text DEFAULT 'dark'::text,
    bot_enabled boolean DEFAULT false,
    bot_auto_send boolean DEFAULT false,
    bot_send_hour integer DEFAULT 9,
    bot_send_minute integer DEFAULT 0,
    bot_max_messages_per_day integer DEFAULT 50,
    bot_work_days jsonb DEFAULT '["mon", "tue", "wed", "thu", "fri"]'::jsonb,
    bot_escalation_rules jsonb DEFAULT '[{"days": 0, "channel": "whatsapp", "template": "lembrete"}, {"days": 1, "channel": "whatsapp", "template": "cobranca_1d"}, {"days": 3, "channel": "whatsapp", "template": "cobranca_3d"}, {"days": 7, "channel": "whatsapp", "template": "cobranca_7d"}, {"days": 15, "channel": "whatsapp", "template": "cobranca_15d"}, {"days": 30, "channel": "whatsapp", "template": "cobranca_30d"}]'::jsonb,
    bot_retry_interval_hours integer DEFAULT 24,
    bot_stop_on_payment boolean DEFAULT true,
    bot_notify_owner boolean DEFAULT true,
    bot_greeting_message text DEFAULT 'Olá {nome}, aqui é do {empresa}.'::text,
    bot_closing_message text DEFAULT 'Qualquer dúvida, entre em contato. Obrigado!'::text,
    bot_send_pix boolean DEFAULT true,
    bot_send_receipt boolean DEFAULT false,
    bot_tone text DEFAULT 'formal'::text,
    sidebar_style text DEFAULT 'default'::text,
    login_title text,
    login_subtitle text,
    footer_text text,
    border_radius text DEFAULT '16'::text,
    font_family text DEFAULT 'default'::text,
    bot_use_ai boolean DEFAULT false,
    bot_negotiation_enabled boolean DEFAULT false,
    bot_send_audio boolean DEFAULT false,
    portal_title text DEFAULT 'Portal do Cliente'::text,
    portal_subtitle text DEFAULT 'Acompanhe seus contratos e pagamentos'::text,
    portal_welcome_message text,
    portal_primary_color text,
    portal_logo_url text,
    portal_contact_phone text,
    portal_contact_email text,
    bot_process_audio boolean DEFAULT true,
    bot_process_receipts boolean DEFAULT true,
    bot_auto_confirm_payment boolean DEFAULT false,
    custom_contract_template text,
    bot_business_hours_only boolean DEFAULT false,
    bot_business_start text DEFAULT '08:00'::text,
    bot_business_end text DEFAULT '18:00'::text,
    favicon_url text,
    modules_enabled jsonb DEFAULT jsonb_build_object('analises', true, 'relatorios', true, 'inadimplencia', true, 'cobradores', true, 'portais', true, 'lucros', true, 'gastos', true, 'comunicacao_inbox', true, 'chat_interno', true, 'simulador', true, 'metas', true, 'tarefas', true, 'anotacoes', true, 'planilha', true, 'puxada_dados', true, 'penhores', false, 'veiculos', false, 'alugueis', false, 'estoque', false) NOT NULL,
    mercadopago_checkout_url text,
    portal_require_birth_date boolean DEFAULT false NOT NULL,
    company_address text,
    company_phone text,
    default_num_installments integer,
    default_payment_method text,
    default_max_interest_cap numeric,
    default_term_months integer
);

ALTER TABLE ONLY public.settings REPLICA IDENTITY FULL;


--
-- Name: COLUMN settings.portal_require_birth_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.portal_require_birth_date IS 'Exige data de nascimento junto do CPF no acesso do cliente ao portal. So funciona depois que as datas estiverem cadastradas nos clientes.';


--
-- Name: COLUMN settings.company_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.company_address IS 'Endereço do credor, usado na qualificação das partes no contrato ({{empresa_endereco}}).';


--
-- Name: COLUMN settings.company_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.company_phone IS 'Telefone do credor, usado no contrato ({{empresa_telefone}}).';


--
-- Name: COLUMN settings.default_num_installments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.default_num_installments IS 'Quantidade de parcelas que vem preenchida ao criar um empréstimo.';


--
-- Name: COLUMN settings.default_payment_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.default_payment_method IS 'Forma de pagamento padrão: pix, cash, boleto ou transfer.';


--
-- Name: COLUMN settings.default_max_interest_cap; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.default_max_interest_cap IS 'Teto dos juros de atraso, em % sobre o valor da parcela. Vazio = sem teto.';


--
-- Name: COLUMN settings.default_term_months; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.settings.default_term_months IS 'Prazo padrão em meses, usado pelo bot ao montar proposta de empréstimo.';


--
-- Name: settings_safe; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.settings_safe WITH (security_invoker='true') AS
 SELECT s.id,
    s.user_id,
    s.created_at,
    s.company_name,
    s.company_cnpj,
    s.company_logo_url,
    s.favicon_url,
    s.primary_color,
    s.accent_color,
    s.theme_mode,
    s.sidebar_style,
    s.login_title,
    s.login_subtitle,
    s.footer_text,
    s.border_radius,
    s.font_family,
    s.default_interest_rate,
    s.default_late_fee,
    s.default_daily_interest,
    s.default_frequency,
    s.whatsapp_api_url,
    s.whatsapp_instance,
    ((s.whatsapp_api_key IS NOT NULL) AND (length(s.whatsapp_api_key) > 0)) AS whatsapp_api_key_configured,
    s.n8n_webhook_url,
    s.push_notifications_enabled,
    s.bot_enabled,
    s.bot_auto_send,
    s.bot_send_hour,
    s.bot_send_minute,
    s.bot_max_messages_per_day,
    s.bot_work_days,
    s.bot_escalation_rules,
    s.bot_retry_interval_hours,
    s.bot_stop_on_payment,
    s.bot_notify_owner,
    s.bot_greeting_message,
    s.bot_closing_message,
    s.bot_send_pix,
    s.bot_send_receipt,
    s.bot_tone,
    s.bot_use_ai,
    s.bot_negotiation_enabled,
    s.bot_send_audio,
    s.bot_process_audio,
    s.bot_process_receipts,
    s.bot_auto_confirm_payment,
    s.bot_business_hours_only,
    s.bot_business_start,
    s.bot_business_end,
    s.portal_title,
    s.portal_subtitle,
    s.portal_welcome_message,
    s.portal_primary_color,
    s.portal_logo_url,
    s.portal_contact_phone,
    s.portal_contact_email,
    s.custom_contract_template,
    s.modules_enabled,
    s.company_address,
    s.company_phone,
    s.portal_require_birth_date,
    s.default_num_installments,
    s.default_payment_method,
    s.default_max_interest_cap,
    s.default_term_months
   FROM public.settings s;


--
-- Name: stock_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    model text NOT NULL,
    imei text NOT NULL,
    color text NOT NULL,
    storage text NOT NULL,
    cost_price numeric NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_items_status_check CHECK ((status = ANY (ARRAY['available'::text, 'sold'::text])))
);

ALTER TABLE ONLY public.stock_items REPLICA IDENTITY FULL;


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text NOT NULL,
    status text DEFAULT 'inactive'::text NOT NULL,
    hubla_order_id text,
    hubla_subscription_id text,
    plan_name text,
    amount_paid numeric(10,2),
    current_period_end timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    mercadopago_payment_id text,
    provider text DEFAULT 'hubla'::text,
    plan_tier text
);

ALTER TABLE ONLY public.subscriptions REPLICA IDENTITY FULL;


--
-- Name: support_ticket_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_role text DEFAULT 'user'::text NOT NULL,
    sender_name text NOT NULL,
    message text NOT NULL,
    attachment_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_internal boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.support_ticket_messages REPLICA IDENTITY FULL;


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subject text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    priority text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    last_message_at timestamp with time zone DEFAULT now() NOT NULL,
    unread_by_user boolean DEFAULT false NOT NULL,
    unread_by_admin boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_category text,
    ai_severity text,
    ai_suggested_reply text,
    ai_triaged_at timestamp with time zone
);

ALTER TABLE ONLY public.support_tickets REPLICA IDENTITY FULL;


--
-- Name: system_automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_automations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_run timestamp with time zone,
    total_executions integer DEFAULT 0,
    success_rate numeric(5,2) DEFAULT 100.00,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: todos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    task text,
    is_complete boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.todos REPLICA IDENTITY FULL;


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text DEFAULT 'other'::text NOT NULL,
    category text,
    description text NOT NULL,
    amount numeric NOT NULL,
    date timestamp with time zone DEFAULT now() NOT NULL,
    contract_id uuid,
    client_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    installment_id uuid,
    investor_payment_id uuid,
    source_key text,
    principal_amount numeric DEFAULT 0 NOT NULL,
    interest_amount numeric DEFAULT 0 NOT NULL,
    fee_amount numeric DEFAULT 0 NOT NULL,
    unallocated_amount numeric DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.transactions REPLICA IDENTITY FULL;


--
-- Name: COLUMN transactions.unallocated_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.unallocated_amount IS 'Recebimento preservado no caixa cuja classificação em capital/juros/encargos exige conciliação humana.';


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    brand text NOT NULL,
    model text NOT NULL,
    year integer NOT NULL,
    plate text NOT NULL,
    photo_url text,
    status text DEFAULT 'available'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicles_status_check CHECK ((status = ANY (ARRAY['available'::text, 'rented'::text, 'maintenance'::text]))),
    CONSTRAINT vehicles_type_check CHECK ((type = ANY (ARRAY['car'::text, 'motorcycle'::text])))
);

ALTER TABLE ONLY public.vehicles REPLICA IDENTITY FULL;


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    event_key text NOT NULL,
    provider text NOT NULL,
    status text DEFAULT 'processing'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT webhook_events_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text])))
);


--
-- Name: TABLE webhook_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.webhook_events IS 'Idempotency ledger for trusted provider webhooks. Accessible only by service_role.';


--
-- Name: whatsapp_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    instance text NOT NULL,
    api_url text NOT NULL,
    api_key text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    direction text NOT NULL,
    sender text NOT NULL,
    message_type text DEFAULT 'text'::text NOT NULL,
    content text,
    media_url text,
    wa_message_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT whatsapp_messages_sender_check CHECK ((sender = ANY (ARRAY['client'::text, 'bot'::text, 'human'::text])))
);

ALTER TABLE ONLY public.whatsapp_messages REPLICA IDENTITY FULL;


--
-- Name: whatsapp_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    author_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: whatsapp_receipt_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_receipt_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    conversation_id uuid,
    installment_id uuid,
    amount numeric NOT NULL,
    media_hash text,
    match_type text,
    status text DEFAULT 'pending'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_receipt_reviews_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT whatsapp_receipt_reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: whatsapp_response_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_response_windows (
    user_id uuid NOT NULL,
    jid text NOT NULL,
    claimed_until timestamp with time zone NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: iceberg_namespaces; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.iceberg_namespaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_name text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    catalog_id uuid NOT NULL
);


--
-- Name: iceberg_tables; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.iceberg_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    namespace_id uuid NOT NULL,
    bucket_name text NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    location text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    remote_table_id text,
    shard_key text,
    shard_id text,
    catalog_id uuid NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ai_conversations ai_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_logs automation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_pkey PRIMARY KEY (id);


--
-- Name: bot_actions_log bot_actions_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_actions_log
    ADD CONSTRAINT bot_actions_log_pkey PRIMARY KEY (id);


--
-- Name: business_assets business_assets_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_assets
    ADD CONSTRAINT business_assets_id_user_id_key UNIQUE (id, user_id);


--
-- Name: business_assets business_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_assets
    ADD CONSTRAINT business_assets_pkey PRIMARY KEY (id);


--
-- Name: business_assets business_assets_user_id_kind_identifier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_assets
    ADD CONSTRAINT business_assets_user_id_kind_identifier_key UNIQUE (user_id, kind, identifier);


--
-- Name: business_operations business_operations_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_operations
    ADD CONSTRAINT business_operations_id_user_id_key UNIQUE (id, user_id);


--
-- Name: business_operations business_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_operations
    ADD CONSTRAINT business_operations_pkey PRIMARY KEY (id);


--
-- Name: business_operations business_operations_user_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_operations
    ADD CONSTRAINT business_operations_user_id_request_id_key UNIQUE (user_id, request_id);


--
-- Name: business_payments business_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_payments
    ADD CONSTRAINT business_payments_pkey PRIMARY KEY (id);


--
-- Name: business_payments business_payments_user_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_payments
    ADD CONSTRAINT business_payments_user_id_request_id_key UNIQUE (user_id, request_id);


--
-- Name: business_receivables business_receivables_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_receivables
    ADD CONSTRAINT business_receivables_id_user_id_key UNIQUE (id, user_id);


--
-- Name: business_receivables business_receivables_operation_id_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_receivables
    ADD CONSTRAINT business_receivables_operation_id_number_key UNIQUE (operation_id, number);


--
-- Name: business_receivables business_receivables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_receivables
    ADD CONSTRAINT business_receivables_pkey PRIMARY KEY (id);


--
-- Name: chat_channel_members chat_channel_members_channel_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_channel_id_user_id_key UNIQUE (channel_id, user_id);


--
-- Name: chat_channel_members chat_channel_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_pkey PRIMARY KEY (id);


--
-- Name: chat_channels chat_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_pkey PRIMARY KEY (id);


--
-- Name: chat_dm_threads chat_dm_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_dm_threads
    ADD CONSTRAINT chat_dm_threads_pkey PRIMARY KEY (id);


--
-- Name: chat_dm_threads chat_dm_threads_user_a_user_b_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_dm_threads
    ADD CONSTRAINT chat_dm_threads_user_a_user_b_key UNIQUE (user_a, user_b);


--
-- Name: chat_message_reactions chat_message_reactions_message_id_user_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);


--
-- Name: chat_message_reactions chat_message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: client_errors client_errors_contexto_tamanho; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.client_errors
    ADD CONSTRAINT client_errors_contexto_tamanho CHECK ((octet_length((contexto)::text) <= 8192)) NOT VALID;


--
-- Name: client_errors client_errors_navegador_tamanho; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.client_errors
    ADD CONSTRAINT client_errors_navegador_tamanho CHECK (((navegador IS NULL) OR (char_length(navegador) <= 400))) NOT VALID;


--
-- Name: client_errors client_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_errors
    ADD CONSTRAINT client_errors_pkey PRIMARY KEY (id);


--
-- Name: client_errors client_errors_rota_tamanho; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.client_errors
    ADD CONSTRAINT client_errors_rota_tamanho CHECK ((char_length(rota) <= 500)) NOT VALID;


--
-- Name: client_notifications client_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_pkey PRIMARY KEY (id);


--
-- Name: client_tokens client_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_tokens
    ADD CONSTRAINT client_tokens_pkey PRIMARY KEY (id);


--
-- Name: client_tokens client_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_tokens
    ADD CONSTRAINT client_tokens_token_key UNIQUE (token);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: collection_attempts collection_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_attempts
    ADD CONSTRAINT collection_attempts_pkey PRIMARY KEY (id);


--
-- Name: collection_dispatch_claims collection_dispatch_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_dispatch_claims
    ADD CONSTRAINT collection_dispatch_claims_pkey PRIMARY KEY (id);


--
-- Name: collection_dispatch_claims collection_dispatch_claims_user_id_client_id_channel_claim__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_dispatch_claims
    ADD CONSTRAINT collection_dispatch_claims_user_id_client_id_channel_claim__key UNIQUE (user_id, client_id, channel, claim_bucket);


--
-- Name: collector_assignments collector_assignments_collector_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_assignments
    ADD CONSTRAINT collector_assignments_collector_id_client_id_key UNIQUE (collector_id, client_id);


--
-- Name: collector_assignments collector_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_assignments
    ADD CONSTRAINT collector_assignments_pkey PRIMARY KEY (id);


--
-- Name: collector_tokens collector_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_tokens
    ADD CONSTRAINT collector_tokens_pkey PRIMARY KEY (id);


--
-- Name: collector_tokens collector_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_tokens
    ADD CONSTRAINT collector_tokens_token_key UNIQUE (token);


--
-- Name: collectors collectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collectors
    ADD CONSTRAINT collectors_pkey PRIMARY KEY (id);


--
-- Name: contract_events contract_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_pkey PRIMARY KEY (id);


--
-- Name: contract_installments contract_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_pkey PRIMARY KEY (id);


--
-- Name: contract_signature_events contract_signature_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signature_events
    ADD CONSTRAINT contract_signature_events_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);


--
-- Name: installments_legado_20260805 installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installments_legado_20260805
    ADD CONSTRAINT installments_pkey PRIMARY KEY (id);


--
-- Name: investor_loans investor_loans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investor_loans
    ADD CONSTRAINT investor_loans_pkey PRIMARY KEY (id);


--
-- Name: investor_payments investor_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investor_payments
    ADD CONSTRAINT investor_payments_pkey PRIMARY KEY (id);


--
-- Name: investors investors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: loan_collateral loan_collateral_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_collateral
    ADD CONSTRAINT loan_collateral_pkey PRIMARY KEY (id);


--
-- Name: loan_collateral loan_collateral_user_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_collateral
    ADD CONSTRAINT loan_collateral_user_id_request_id_key UNIQUE (user_id, request_id);


--
-- Name: loan_presets loan_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_presets
    ADD CONSTRAINT loan_presets_pkey PRIMARY KEY (id);


--
-- Name: manual_cash_operations manual_cash_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_cash_operations
    ADD CONSTRAINT manual_cash_operations_pkey PRIMARY KEY (user_id, request_id);


--
-- Name: message_templates message_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payment_promises payment_promises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_promises
    ADD CONSTRAINT payment_promises_pkey PRIMARY KEY (id);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: pledges pledges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pledges
    ADD CONSTRAINT pledges_pkey PRIMARY KEY (id);


--
-- Name: portal_sessions portal_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessions
    ADD CONSTRAINT portal_sessions_pkey PRIMARY KEY (token);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profits profits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profits
    ADD CONSTRAINT profits_pkey PRIMARY KEY (id);


--
-- Name: rate_limit_hits rate_limit_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_hits
    ADD CONSTRAINT rate_limit_hits_pkey PRIMARY KEY (key);


--
-- Name: rentals rentals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings settings_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_key UNIQUE (user_id);


--
-- Name: stock_items stock_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_email_key UNIQUE (email);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_messages support_ticket_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: system_automations system_automations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_automations
    ADD CONSTRAINT system_automations_pkey PRIMARY KEY (id);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (event_key);


--
-- Name: whatsapp_conversations whatsapp_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_conversations whatsapp_conversations_user_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_user_id_phone_key UNIQUE (user_id, phone);


--
-- Name: whatsapp_event_claims whatsapp_event_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_event_claims
    ADD CONSTRAINT whatsapp_event_claims_pkey PRIMARY KEY (user_id, instance, message_id);


--
-- Name: whatsapp_instances whatsapp_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_instances
    ADD CONSTRAINT whatsapp_instances_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_notes whatsapp_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_notes
    ADD CONSTRAINT whatsapp_notes_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_receipt_reviews whatsapp_receipt_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_receipt_reviews
    ADD CONSTRAINT whatsapp_receipt_reviews_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_response_windows whatsapp_response_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_response_windows
    ADD CONSTRAINT whatsapp_response_windows_pkey PRIMARY KEY (user_id, jid);


--
-- Name: whatsapp_scheduled_messages whatsapp_scheduled_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_scheduled_messages
    ADD CONSTRAINT whatsapp_scheduled_messages_pkey PRIMARY KEY (id);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: iceberg_namespaces iceberg_namespaces_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_namespaces
    ADD CONSTRAINT iceberg_namespaces_pkey PRIMARY KEY (id);


--
-- Name: iceberg_tables iceberg_tables_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: bot_actions_log_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bot_actions_log_client_idx ON public.bot_actions_log USING btree (client_id, created_at DESC);


--
-- Name: bot_actions_log_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bot_actions_log_user_created_idx ON public.bot_actions_log USING btree (user_id, created_at DESC);


--
-- Name: business_operations_user_id_client_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_operations_user_id_client_id_created_at_idx ON public.business_operations USING btree (user_id, client_id, created_at DESC);


--
-- Name: business_receivables_user_id_due_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX business_receivables_user_id_due_date_idx ON public.business_receivables USING btree (user_id, due_date) WHERE (status = 'pending'::text);


--
-- Name: client_errors_criado_em_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_errors_criado_em_idx ON public.client_errors USING btree (criado_em DESC);


--
-- Name: client_errors_rota_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_errors_rota_idx ON public.client_errors USING btree (rota, criado_em DESC);


--
-- Name: clients_bot_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_bot_phone_idx ON public.clients USING btree (user_id, public.bot_phone_key(phone));


--
-- Name: clients_bot_whatsapp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX clients_bot_whatsapp_idx ON public.clients USING btree (user_id, public.bot_phone_key(whatsapp));


--
-- Name: idx_audit_logs_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_created ON public.audit_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_bot_actions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_actions_user_created ON public.bot_actions_log USING btree (user_id, created_at DESC);


--
-- Name: idx_ccm_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccm_channel ON public.chat_channel_members USING btree (channel_id);


--
-- Name: idx_ccm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ccm_user ON public.chat_channel_members USING btree (user_id);


--
-- Name: idx_ci_open_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_open_due ON public.contract_installments USING btree (user_id, due_date) WHERE (status <> 'paid'::text);


--
-- Name: idx_client_notifications_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_notifications_client ON public.client_notifications USING btree (client_id, created_at DESC);


--
-- Name: idx_clients_cpf_cnpj_digits; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_cpf_cnpj_digits ON public.clients USING btree (regexp_replace(COALESCE(cpf_cnpj, ''::text), '\D'::text, ''::text, 'g'::text));


--
-- Name: idx_clients_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_name_trgm ON public.clients USING gin (lower(name) public.gin_trgm_ops);


--
-- Name: idx_cm_channel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cm_channel_created ON public.chat_messages USING btree (channel_id, created_at DESC);


--
-- Name: idx_cm_dm_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cm_dm_created ON public.chat_messages USING btree (dm_thread_id, created_at DESC);


--
-- Name: idx_cm_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cm_user ON public.chat_messages USING btree (user_id);


--
-- Name: idx_cmr_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cmr_message ON public.chat_message_reactions USING btree (message_id);


--
-- Name: idx_collection_attempts_user_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_attempts_user_client ON public.collection_attempts USING btree (user_id, client_id, created_at DESC);


--
-- Name: idx_collection_attempts_user_inst; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_attempts_user_inst ON public.collection_attempts USING btree (user_id, installment_id, created_at DESC);


--
-- Name: idx_collection_dispatch_claims_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collection_dispatch_claims_created ON public.collection_dispatch_claims USING btree (created_at);


--
-- Name: idx_contract_events_contract_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_events_contract_created ON public.contract_events USING btree (contract_id, created_at DESC);


--
-- Name: idx_contracts_investor_loan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_investor_loan ON public.contracts USING btree (investor_loan_id);


--
-- Name: idx_contracts_origin_contract; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_origin_contract ON public.contracts USING btree (origin_contract_id);


--
-- Name: idx_installments_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installments_client ON public.installments_legado_20260805 USING btree (client_id);


--
-- Name: idx_installments_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installments_due_date ON public.installments_legado_20260805 USING btree (due_date);


--
-- Name: idx_installments_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_installments_user_status ON public.installments_legado_20260805 USING btree (user_id, status);


--
-- Name: idx_loan_presets_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_loan_presets_user_created ON public.loan_presets USING btree (user_id, created_at DESC);


--
-- Name: idx_payment_promises_one_open_per_client; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_promises_one_open_per_client ON public.payment_promises USING btree (user_id, client_id) WHERE (status = 'open'::text);


--
-- Name: idx_payment_promises_open_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_promises_open_due ON public.payment_promises USING btree (user_id, status, promised_for, client_id) WHERE (status = 'open'::text);


--
-- Name: idx_portal_sessions_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_sessions_client ON public.portal_sessions USING btree (client_id);


--
-- Name: idx_profits_installment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profits_installment_id ON public.profits USING btree (installment_id);


--
-- Name: idx_subscriptions_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_email ON public.subscriptions USING btree (email);


--
-- Name: idx_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions USING btree (user_id);


--
-- Name: idx_support_ticket_messages_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_ticket_messages_ticket ON public.support_ticket_messages USING btree (ticket_id, created_at);


--
-- Name: idx_support_tickets_ai_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_ai_category ON public.support_tickets USING btree (ai_category);


--
-- Name: idx_support_tickets_ai_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_ai_severity ON public.support_tickets USING btree (ai_severity);


--
-- Name: idx_support_tickets_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_last_message ON public.support_tickets USING btree (last_message_at DESC);


--
-- Name: idx_support_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_support_tickets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_user_id ON public.support_tickets USING btree (user_id);


--
-- Name: idx_transactions_installment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_installment_id ON public.transactions USING btree (installment_id);


--
-- Name: idx_wa_conv_agent_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_conv_agent_state ON public.whatsapp_conversations USING btree (user_id, agent_state);


--
-- Name: idx_wa_conv_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_conv_tags ON public.whatsapp_conversations USING gin (tags);


--
-- Name: idx_wa_conv_user_last; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_conv_user_last ON public.whatsapp_conversations USING btree (user_id, last_message_at DESC);


--
-- Name: idx_wa_convo_user_lastmsg; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_convo_user_lastmsg ON public.whatsapp_conversations USING btree (user_id, last_message_at DESC);


--
-- Name: idx_wa_msg_client_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_msg_client_created ON public.whatsapp_messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_wa_msg_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_msg_conv ON public.whatsapp_messages USING btree (conversation_id, created_at);


--
-- Name: idx_wa_msg_convo_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_msg_convo_created ON public.whatsapp_messages USING btree (conversation_id, created_at);


--
-- Name: idx_wa_notes_convo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_notes_convo ON public.whatsapp_notes USING btree (conversation_id, created_at DESC);


--
-- Name: idx_wa_sched_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_sched_pending ON public.whatsapp_scheduled_messages USING btree (status, scheduled_for) WHERE (status = 'pending'::text);


--
-- Name: idx_wa_scheduled_client_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_scheduled_client_pending ON public.whatsapp_scheduled_messages USING btree (client_id, status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_webhook_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_created_at ON public.webhook_events USING btree (created_at);


--
-- Name: idx_whatsapp_event_claims_age; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_event_claims_age ON public.whatsapp_event_claims USING btree (claimed_at);


--
-- Name: idx_whatsapp_receipt_reviews_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_receipt_reviews_queue ON public.whatsapp_receipt_reviews USING btree (user_id, status, created_at DESC);


--
-- Name: investor_loans_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investor_loans_due_idx ON public.investor_loans USING btree (due_date);


--
-- Name: investor_loans_investor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investor_loans_investor_idx ON public.investor_loans USING btree (investor_id);


--
-- Name: investor_loans_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investor_loans_user_idx ON public.investor_loans USING btree (user_id);


--
-- Name: investor_payments_investor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investor_payments_investor_idx ON public.investor_payments USING btree (investor_id);


--
-- Name: investor_payments_loan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investor_payments_loan_idx ON public.investor_payments USING btree (loan_id);


--
-- Name: investor_payments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investor_payments_user_idx ON public.investor_payments USING btree (user_id);


--
-- Name: investors_access_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX investors_access_token_key ON public.investors USING btree (access_token);


--
-- Name: investors_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investors_user_id_idx ON public.investors USING btree (user_id);


--
-- Name: leads_followup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_followup_idx ON public.leads USING btree (user_id, next_followup_at);


--
-- Name: leads_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX leads_stage_idx ON public.leads USING btree (user_id, stage);


--
-- Name: leads_user_phone_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX leads_user_phone_uniq ON public.leads USING btree (user_id, phone);


--
-- Name: loan_collateral_user_id_contract_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX loan_collateral_user_id_contract_id_idx ON public.loan_collateral USING btree (user_id, contract_id);


--
-- Name: uq_client_notifications_daily; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_client_notifications_daily ON public.client_notifications USING btree (installment_id, type, dedupe_day);


--
-- Name: uq_contract_installment_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_contract_installment_number ON public.contract_installments USING btree (contract_id, installment_number);


--
-- Name: uq_profit_installment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_profit_installment ON public.profits USING btree (installment_id) WHERE (installment_id IS NOT NULL);


--
-- Name: uq_transactions_investor_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_transactions_investor_payment ON public.transactions USING btree (investor_payment_id) WHERE (investor_payment_id IS NOT NULL);


--
-- Name: uq_transactions_source_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_transactions_source_key ON public.transactions USING btree (user_id, source_key) WHERE (source_key IS NOT NULL);


--
-- Name: uq_whatsapp_messages_external_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_whatsapp_messages_external_id ON public.whatsapp_messages USING btree (user_id, wa_message_id) WHERE (wa_message_id IS NOT NULL);


--
-- Name: uq_whatsapp_receipt_review_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_whatsapp_receipt_review_hash ON public.whatsapp_receipt_reviews USING btree (user_id, media_hash) WHERE (media_hash IS NOT NULL);


--
-- Name: whatsapp_messages_conv_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_conv_created_idx ON public.whatsapp_messages USING btree (conversation_id, created_at DESC);


--
-- Name: whatsapp_receipt_transaction_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_receipt_transaction_idx ON public.whatsapp_scheduled_messages USING btree (payment_transaction_id) WHERE (payment_transaction_id IS NOT NULL);


--
-- Name: whatsapp_scheduled_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_scheduled_source_idx ON public.whatsapp_scheduled_messages USING btree (user_id, source_key);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_iceberg_namespaces_bucket_id; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_iceberg_namespaces_bucket_id ON storage.iceberg_namespaces USING btree (catalog_id, name);


--
-- Name: idx_iceberg_tables_location; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_iceberg_tables_location ON storage.iceberg_tables USING btree (location);


--
-- Name: idx_iceberg_tables_namespace_id; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX idx_iceberg_tables_namespace_id ON storage.iceberg_tables USING btree (catalog_id, namespace_id, name);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: users on_auth_user_created; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_with_settings();


--
-- Name: whatsapp_conversations bot_takeover_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bot_takeover_guard BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.bot_takeover_guard();


--
-- Name: business_payments business_payment_ledger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER business_payment_ledger AFTER INSERT ON public.business_payments FOR EACH ROW EXECUTE FUNCTION public.record_business_ledger();


--
-- Name: profiles on_auth_user_created_trial; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_auth_user_created_trial BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_trial();


--
-- Name: contracts trg_activate_signed_contract; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activate_signed_contract BEFORE UPDATE OF signature_status ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.activate_signed_contract();


--
-- Name: contracts trg_audit_contract_lifecycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_contract_lifecycle AFTER INSERT OR UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.audit_contract_lifecycle();


--
-- Name: transactions trg_cancel_changed_payment_receipt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cancel_changed_payment_receipt AFTER DELETE OR UPDATE OF amount, type, category, user_id, client_id, contract_id, installment_id, date ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.cancel_changed_payment_receipt();


--
-- Name: contract_installments trg_cancel_scheduled_charges_after_payment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cancel_scheduled_charges_after_payment AFTER UPDATE OF status, paid_amount ON public.contract_installments FOR EACH ROW EXECUTE FUNCTION public.cancel_scheduled_charges_after_installment_change();


--
-- Name: contract_installments trg_fulfill_payment_promises_on_installment_paid; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_fulfill_payment_promises_on_installment_paid AFTER UPDATE OF status ON public.contract_installments FOR EACH ROW EXECUTE FUNCTION public.fulfill_payment_promises_on_installment_paid();


--
-- Name: contract_installments trg_installment_paid; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_installment_paid AFTER UPDATE OF status ON public.contract_installments FOR EACH ROW EXECUTE FUNCTION public.notify_installment_paid();


--
-- Name: investor_loans trg_investor_loans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_investor_loans_updated_at BEFORE UPDATE ON public.investor_loans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: investors trg_investors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_investors_updated_at BEFORE UPDATE ON public.investors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: leads trg_leads_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.leads_touch_updated_at();


--
-- Name: collection_attempts trg_mark_installment_collected; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mark_installment_collected AFTER INSERT ON public.collection_attempts FOR EACH ROW EXECUTE FUNCTION public.mark_installment_collected();


--
-- Name: audit_logs trg_materialize_payment_promise_from_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_materialize_payment_promise_from_audit AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.materialize_payment_promise_from_audit();


--
-- Name: contracts trg_normalize_contract_lifecycle; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_normalize_contract_lifecycle BEFORE INSERT OR UPDATE OF status, lifecycle_stage ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.normalize_contract_lifecycle();


--
-- Name: profits trg_normalize_interest_renewal_profit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_normalize_interest_renewal_profit BEFORE INSERT ON public.profits FOR EACH ROW EXECUTE FUNCTION public.normalize_interest_renewal_profit();


--
-- Name: platform_settings trg_platform_settings_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_platform_settings_touch BEFORE INSERT OR UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION public.platform_settings_touch();


--
-- Name: profiles trg_protect_profile_admin_columns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_profile_admin_columns BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_admin_columns();


--
-- Name: transactions trg_queue_registered_payment_receipt; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_queue_registered_payment_receipt AFTER INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.queue_registered_payment_receipt();


--
-- Name: contracts trg_record_contract_disbursement; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_record_contract_disbursement AFTER INSERT ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.record_contract_disbursement();


--
-- Name: contract_installments trg_reopen_contract_with_unsettled_installments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_reopen_contract_with_unsettled_installments AFTER INSERT OR UPDATE OF status, paid_amount, amount, late_fee ON public.contract_installments FOR EACH ROW EXECUTE FUNCTION public.reopen_contract_with_unsettled_installments();


--
-- Name: contracts trg_stop_charges_for_closed_contract; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_stop_charges_for_closed_contract AFTER UPDATE OF status ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.stop_charges_for_closed_contract();


--
-- Name: support_tickets trg_support_tickets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: contract_installments trg_sync_paid_installment_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_paid_installment_status BEFORE INSERT OR UPDATE OF amount, late_fee, paid_amount, status ON public.contract_installments FOR EACH ROW EXECUTE FUNCTION public.sync_paid_installment_status();


--
-- Name: chat_messages trg_touch_dm; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_dm AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.touch_dm_thread();


--
-- Name: payment_promises trg_touch_payment_promise; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_payment_promise BEFORE UPDATE ON public.payment_promises FOR EACH ROW EXECUTE FUNCTION public.touch_payment_promise();


--
-- Name: support_ticket_messages trg_update_ticket_on_message; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_ticket_on_message AFTER INSERT ON public.support_ticket_messages FOR EACH ROW EXECUTE FUNCTION public.update_ticket_on_message();


--
-- Name: subscriptions update_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: ai_conversations ai_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_conversations
    ADD CONSTRAINT ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: automation_logs automation_logs_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_logs
    ADD CONSTRAINT automation_logs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.system_automations(id) ON DELETE CASCADE;


--
-- Name: business_assets business_assets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_assets
    ADD CONSTRAINT business_assets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: business_operations business_operations_asset_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_operations
    ADD CONSTRAINT business_operations_asset_id_user_id_fkey FOREIGN KEY (asset_id, user_id) REFERENCES public.business_assets(id, user_id);


--
-- Name: business_operations business_operations_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_operations
    ADD CONSTRAINT business_operations_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: business_operations business_operations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_operations
    ADD CONSTRAINT business_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: business_payments business_payments_operation_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_payments
    ADD CONSTRAINT business_payments_operation_id_user_id_fkey FOREIGN KEY (operation_id, user_id) REFERENCES public.business_operations(id, user_id);


--
-- Name: business_payments business_payments_receivable_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_payments
    ADD CONSTRAINT business_payments_receivable_id_user_id_fkey FOREIGN KEY (receivable_id, user_id) REFERENCES public.business_receivables(id, user_id);


--
-- Name: business_payments business_payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_payments
    ADD CONSTRAINT business_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: business_receivables business_receivables_operation_id_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_receivables
    ADD CONSTRAINT business_receivables_operation_id_user_id_fkey FOREIGN KEY (operation_id, user_id) REFERENCES public.business_operations(id, user_id);


--
-- Name: business_receivables business_receivables_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_receivables
    ADD CONSTRAINT business_receivables_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: chat_channel_members chat_channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channel_members
    ADD CONSTRAINT chat_channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: chat_message_reactions chat_message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_message_reactions
    ADD CONSTRAINT chat_message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_dm_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_dm_thread_id_fkey FOREIGN KEY (dm_thread_id) REFERENCES public.chat_dm_threads(id) ON DELETE CASCADE;


--
-- Name: client_notifications client_notifications_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_notifications client_notifications_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: client_notifications client_notifications_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_notifications
    ADD CONSTRAINT client_notifications_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE CASCADE;


--
-- Name: client_tokens client_tokens_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_tokens
    ADD CONSTRAINT client_tokens_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_tokens client_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_tokens
    ADD CONSTRAINT client_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: clients clients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: collector_assignments collector_assignments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_assignments
    ADD CONSTRAINT collector_assignments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: collector_assignments collector_assignments_collector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_assignments
    ADD CONSTRAINT collector_assignments_collector_id_fkey FOREIGN KEY (collector_id) REFERENCES public.collectors(id) ON DELETE CASCADE;


--
-- Name: collector_assignments collector_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_assignments
    ADD CONSTRAINT collector_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: collector_tokens collector_tokens_collector_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_tokens
    ADD CONSTRAINT collector_tokens_collector_id_fkey FOREIGN KEY (collector_id) REFERENCES public.collectors(id) ON DELETE CASCADE;


--
-- Name: collector_tokens collector_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collector_tokens
    ADD CONSTRAINT collector_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: collectors collectors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collectors
    ADD CONSTRAINT collectors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contract_events contract_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: contract_events contract_events_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_events contract_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contract_installments contract_installments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: contract_installments contract_installments_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contract_installments contract_installments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_installments
    ADD CONSTRAINT contract_installments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contract_signature_events contract_signature_events_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signature_events
    ADD CONSTRAINT contract_signature_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: contract_signature_events contract_signature_events_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_signature_events
    ADD CONSTRAINT contract_signature_events_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_disbursed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_disbursed_by_fkey FOREIGN KEY (disbursed_by) REFERENCES auth.users(id);


--
-- Name: contracts contracts_investor_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_investor_loan_id_fkey FOREIGN KEY (investor_loan_id) REFERENCES public.investor_loans(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_origin_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_origin_contract_id_fkey FOREIGN KEY (origin_contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: goals goals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.goals
    ADD CONSTRAINT goals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: installments_legado_20260805 installments_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.installments_legado_20260805
    ADD CONSTRAINT installments_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: investor_loans investor_loans_investor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investor_loans
    ADD CONSTRAINT investor_loans_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id) ON DELETE CASCADE;


--
-- Name: investor_payments investor_payments_investor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investor_payments
    ADD CONSTRAINT investor_payments_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id) ON DELETE CASCADE;


--
-- Name: investor_payments investor_payments_loan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investor_payments
    ADD CONSTRAINT investor_payments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.investor_loans(id) ON DELETE CASCADE;


--
-- Name: loan_collateral loan_collateral_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_collateral
    ADD CONSTRAINT loan_collateral_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id);


--
-- Name: loan_collateral loan_collateral_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_collateral
    ADD CONSTRAINT loan_collateral_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id);


--
-- Name: loan_collateral loan_collateral_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_collateral
    ADD CONSTRAINT loan_collateral_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: loan_presets loan_presets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.loan_presets
    ADD CONSTRAINT loan_presets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: manual_cash_operations manual_cash_operations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_cash_operations
    ADD CONSTRAINT manual_cash_operations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: message_templates message_templates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_templates
    ADD CONSTRAINT message_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notes notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: payment_promises payment_promises_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_promises
    ADD CONSTRAINT payment_promises_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: payment_promises payment_promises_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_promises
    ADD CONSTRAINT payment_promises_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: payment_promises payment_promises_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_promises
    ADD CONSTRAINT payment_promises_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE SET NULL;


--
-- Name: payment_promises payment_promises_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_promises
    ADD CONSTRAINT payment_promises_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pledges pledges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pledges
    ADD CONSTRAINT pledges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: portal_sessions portal_sessions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_sessions
    ADD CONSTRAINT portal_sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profits profits_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profits
    ADD CONSTRAINT profits_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: profits profits_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profits
    ADD CONSTRAINT profits_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE SET NULL;


--
-- Name: profits profits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profits
    ADD CONSTRAINT profits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: rentals rentals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: rentals rentals_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rentals
    ADD CONSTRAINT rentals_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: settings settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: stock_items stock_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_items
    ADD CONSTRAINT stock_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: support_ticket_messages support_ticket_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: todos todos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_investor_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_investor_payment_id_fkey FOREIGN KEY (investor_payment_id) REFERENCES public.investor_payments(id) ON DELETE CASCADE;


--
-- Name: CONSTRAINT transactions_investor_payment_id_fkey ON transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT transactions_investor_payment_id_fkey ON public.transactions IS 'Mantém o razão sincronizado ao estornar/excluir pagamentos de investidores.';


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: vehicles vehicles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: whatsapp_messages whatsapp_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE;


--
-- Name: whatsapp_receipt_reviews whatsapp_receipt_reviews_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_receipt_reviews
    ADD CONSTRAINT whatsapp_receipt_reviews_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: whatsapp_receipt_reviews whatsapp_receipt_reviews_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_receipt_reviews
    ADD CONSTRAINT whatsapp_receipt_reviews_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL;


--
-- Name: whatsapp_receipt_reviews whatsapp_receipt_reviews_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_receipt_reviews
    ADD CONSTRAINT whatsapp_receipt_reviews_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE SET NULL;


--
-- Name: whatsapp_scheduled_messages whatsapp_scheduled_messages_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_scheduled_messages
    ADD CONSTRAINT whatsapp_scheduled_messages_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: whatsapp_scheduled_messages whatsapp_scheduled_messages_installment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_scheduled_messages
    ADD CONSTRAINT whatsapp_scheduled_messages_installment_id_fkey FOREIGN KEY (installment_id) REFERENCES public.contract_installments(id) ON DELETE CASCADE;


--
-- Name: iceberg_namespaces iceberg_namespaces_catalog_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_namespaces
    ADD CONSTRAINT iceberg_namespaces_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;


--
-- Name: iceberg_tables iceberg_tables_catalog_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_catalog_id_fkey FOREIGN KEY (catalog_id) REFERENCES storage.buckets_analytics(id) ON DELETE CASCADE;


--
-- Name: iceberg_tables iceberg_tables_namespace_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.iceberg_tables
    ADD CONSTRAINT iceberg_tables_namespace_id_fkey FOREIGN KEY (namespace_id) REFERENCES storage.iceberg_namespaces(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_message_reactions Add own reaction; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Add own reaction" ON public.chat_message_reactions FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: subscriptions Admins can delete subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete subscriptions" ON public.subscriptions FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: system_automations Admins can delete system automations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete system automations" ON public.system_automations FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: notifications Admins can insert notifications for anyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert notifications for anyone" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: subscriptions Admins can insert subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert subscriptions" ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: system_automations Admins can insert system automations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert system automations" ON public.system_automations FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: user_roles Admins can manage all roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage all roles" ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: profiles Admins can update all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: subscriptions Admins can update subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update subscriptions" ON public.subscriptions FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: system_automations Admins can update system automations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update system automations" ON public.system_automations FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: profiles Admins can view all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: automation_logs Admins can view automation_logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view automation_logs" ON public.automation_logs FOR SELECT USING (public.is_admin(auth.uid()));


--
-- Name: system_automations Admins can view system_automations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can view system_automations" ON public.system_automations FOR SELECT USING (public.is_admin(auth.uid()));


--
-- Name: chat_channels Admins manage channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage channels" ON public.chat_channels TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: chat_channels Anyone authenticated can view channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone authenticated can view channels" ON public.chat_channels FOR SELECT TO authenticated USING (true);


--
-- Name: chat_dm_threads Anyone create DM (function-mediated); Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone create DM (function-mediated)" ON public.chat_dm_threads FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_a) OR (auth.uid() = user_b)));


--
-- Name: chat_messages Author or admin deletes messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Author or admin deletes messages" ON public.chat_messages FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: chat_messages Author or admin edits messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Author or admin edits messages" ON public.chat_messages FOR UPDATE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: support_ticket_messages Insert support messages with verified visibility; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Insert support messages with verified visibility" ON public.support_ticket_messages FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND ((public.is_admin(auth.uid()) AND (sender_role = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE (t.id = support_ticket_messages.ticket_id)))) OR ((sender_role = 'user'::text) AND (is_internal = false) AND (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND (t.user_id = auth.uid()))))))));


--
-- Name: profiles No self privilege escalation on profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "No self privilege escalation on profiles" ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING (true) WITH CHECK ((public.is_admin(auth.uid()) OR ((NOT (is_admin IS DISTINCT FROM ( SELECT p.is_admin
   FROM public.profiles p
  WHERE (p.id = profiles.id)))) AND (NOT (is_blocked IS DISTINCT FROM ( SELECT p.is_blocked
   FROM public.profiles p
  WHERE (p.id = profiles.id)))) AND (NOT (is_chat_blocked IS DISTINCT FROM ( SELECT p.is_chat_blocked
   FROM public.profiles p
  WHERE (p.id = profiles.id)))) AND (NOT (trial_ends_at IS DISTINCT FROM ( SELECT p.trial_ends_at
   FROM public.profiles p
  WHERE (p.id = profiles.id)))) AND (NOT (subscription_expires_at IS DISTINCT FROM ( SELECT p.subscription_expires_at
   FROM public.profiles p
  WHERE (p.id = profiles.id)))) AND (NOT (subscription_type IS DISTINCT FROM ( SELECT p.subscription_type
   FROM public.profiles p
  WHERE (p.id = profiles.id)))))));


--
-- Name: investor_loans Owners manage their investor loans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage their investor loans" ON public.investor_loans USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: investor_payments Owners manage their investor payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage their investor payments" ON public.investor_payments USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: investors Owners manage their investors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners manage their investors" ON public.investors USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: chat_dm_threads Participants update own read watermark; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Participants update own read watermark" ON public.chat_dm_threads FOR UPDATE TO authenticated USING (((auth.uid() = user_a) OR (auth.uid() = user_b))) WITH CHECK (((auth.uid() = user_a) OR (auth.uid() = user_b)));


--
-- Name: chat_dm_threads Participants view DM threads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Participants view DM threads" ON public.chat_dm_threads FOR SELECT TO authenticated USING (((auth.uid() = user_a) OR (auth.uid() = user_b) OR public.is_admin(auth.uid())));


--
-- Name: chat_message_reactions Remove own reaction; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Remove own reaction" ON public.chat_message_reactions FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: chat_messages Send messages to accessible scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Send messages to accessible scope" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (((auth.uid() = user_id) AND (NOT COALESCE(( SELECT profiles.is_chat_blocked
   FROM public.profiles
  WHERE (profiles.id = auth.uid())), false)) AND (((channel_id IS NOT NULL) AND public.is_channel_member(channel_id, auth.uid())) OR ((dm_thread_id IS NOT NULL) AND public.is_dm_participant(dm_thread_id, auth.uid())))));


--
-- Name: automation_logs Service role can insert automation logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert automation logs" ON public.automation_logs FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id));


--
-- Name: profiles Users can view own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING ((auth.uid() = id));


--
-- Name: user_roles Users can view own roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: subscriptions Users can view their own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR (lower(email) = lower(COALESCE((auth.jwt() ->> 'email'::text), ''::text)))));


--
-- Name: support_tickets Users create own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users create own tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: support_tickets Users delete own tickets, admins delete all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own tickets, admins delete all" ON public.support_tickets FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: chat_channel_members Users join channels (self); Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users join channels (self)" ON public.chat_channel_members FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: chat_channel_members Users leave own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users leave own membership" ON public.chat_channel_members FOR DELETE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: ai_conversations Users manage own ai conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own ai conversations" ON public.ai_conversations TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: client_tokens Users manage own client tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own client tokens" ON public.client_tokens TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: clients Users manage own clients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own clients" ON public.clients TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: collector_assignments Users manage own collector assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own collector assignments" ON public.collector_assignments TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: collector_tokens Users manage own collector tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own collector tokens" ON public.collector_tokens TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: collectors Users manage own collectors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own collectors" ON public.collectors TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: contract_installments Users manage own contract installments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own contract installments" ON public.contract_installments TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: contracts Users manage own contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own contracts" ON public.contracts TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: expenses Users manage own expenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own expenses" ON public.expenses TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: goals Users manage own goals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own goals" ON public.goals TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: installments_legado_20260805 Users manage own installments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own installments" ON public.installments_legado_20260805 TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: message_templates Users manage own message templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own message templates" ON public.message_templates TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notes Users manage own notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own notes" ON public.notes TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notifications Users manage own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own notifications" ON public.notifications TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: pledges Users manage own pledges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own pledges" ON public.pledges TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profits Users manage own profits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own profits" ON public.profits TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: rentals Users manage own rentals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own rentals" ON public.rentals TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: settings Users manage own settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own settings" ON public.settings TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: stock_items Users manage own stock; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own stock" ON public.stock_items TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: todos Users manage own todos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own todos" ON public.todos TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: transactions Users manage own transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own transactions" ON public.transactions TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: vehicles Users manage own vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users manage own vehicles" ON public.vehicles TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: chat_channel_members Users update own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own membership" ON public.chat_channel_members FOR UPDATE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: support_tickets Users update own tickets, admins update all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own tickets, admins update all" ON public.support_tickets FOR UPDATE TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: audit_logs Users view own audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own audit logs" ON public.audit_logs FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: bot_actions_log Users view own bot actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own bot actions" ON public.bot_actions_log FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: support_tickets Users view own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own tickets" ON public.support_tickets FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR public.is_admin(auth.uid())));


--
-- Name: chat_messages View messages of accessible scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View messages of accessible scope" ON public.chat_messages FOR SELECT TO authenticated USING ((((channel_id IS NOT NULL) AND public.is_channel_member(channel_id, auth.uid())) OR ((dm_thread_id IS NOT NULL) AND public.is_dm_participant(dm_thread_id, auth.uid())) OR public.is_admin(auth.uid())));


--
-- Name: chat_message_reactions View reactions on visible messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View reactions on visible messages" ON public.chat_message_reactions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.chat_messages m
  WHERE ((m.id = chat_message_reactions.message_id) AND (((m.channel_id IS NOT NULL) AND public.is_channel_member(m.channel_id, auth.uid())) OR ((m.dm_thread_id IS NOT NULL) AND public.is_dm_participant(m.dm_thread_id, auth.uid())))))));


--
-- Name: support_ticket_messages View support messages with internal note isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View support messages with internal note isolation" ON public.support_ticket_messages FOR SELECT TO authenticated USING ((public.is_admin(auth.uid()) OR ((is_internal = false) AND (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_ticket_messages.ticket_id) AND (t.user_id = auth.uid())))))));


--
-- Name: ai_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs_platform_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_platform_admin_read ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: automation_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: bot_actions_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bot_actions_log ENABLE ROW LEVEL SECURITY;

--
-- Name: business_assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_assets ENABLE ROW LEVEL SECURITY;

--
-- Name: business_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: business_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: business_receivables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_receivables ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_channel_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_channel_members chat_channel_members_select_scoped; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_channel_members_select_scoped ON public.chat_channel_members FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin(auth.uid()) OR public.is_channel_member(channel_id, auth.uid())));


--
-- Name: chat_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_dm_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_dm_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: client_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: client_errors client_errors_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_errors_admin_read ON public.client_errors FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));


--
-- Name: client_errors client_errors_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_errors_insert ON public.client_errors FOR INSERT TO authenticated, anon WITH CHECK ((((auth.uid() IS NULL) AND (user_id IS NULL)) OR ((auth.uid() IS NOT NULL) AND (user_id = auth.uid()))));


--
-- Name: client_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: client_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collection_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_dispatch_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collection_dispatch_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: collector_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collector_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: collector_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collector_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: collectors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collectors ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_events contract_events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contract_events_owner_read ON public.contract_events FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: contract_installments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_installments ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_signature_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_signature_events ENABLE ROW LEVEL SECURITY;

--
-- Name: contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: goals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

--
-- Name: installments_legado_20260805; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.installments_legado_20260805 ENABLE ROW LEVEL SECURITY;

--
-- Name: investor_loans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investor_loans ENABLE ROW LEVEL SECURITY;

--
-- Name: investor_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investor_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: investors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

--
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- Name: leads leads_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY leads_owner_all ON public.leads TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: loan_collateral; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_collateral ENABLE ROW LEVEL SECURITY;

--
-- Name: loan_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.loan_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: manual_cash_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manual_cash_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: message_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_promises; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_promises ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_promises payment_promises_owner_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_promises_owner_access ON public.payment_promises TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: platform_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_settings platform_settings_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_admin_insert ON public.platform_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: platform_settings platform_settings_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_admin_update ON public.platform_settings FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));


--
-- Name: platform_settings platform_settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: pledges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pledges ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_signature_events portal_owner_views_contract_signatures; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY portal_owner_views_contract_signatures ON public.contract_signature_events FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: portal_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.portal_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profits ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limit_hits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;

--
-- Name: rentals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;

--
-- Name: client_notifications service role only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role only" ON public.client_notifications TO service_role USING (true) WITH CHECK (true);


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: stock_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: support_ticket_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: system_automations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_automations ENABLE ROW LEVEL SECURITY;

--
-- Name: business_assets tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.business_assets FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: business_operations tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.business_operations FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: business_payments tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.business_payments FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: business_receivables tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.business_receivables FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: loan_collateral tenant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_read ON public.loan_collateral FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: todos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

--
-- Name: transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: collection_attempts users manage own collection attempts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own collection attempts" ON public.collection_attempts USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: loan_presets users manage own loan presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own loan presets" ON public.loan_presets TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: whatsapp_receipt_reviews users manage own receipt reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own receipt reviews" ON public.whatsapp_receipt_reviews TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: whatsapp_conversations users manage own wa conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own wa conversations" ON public.whatsapp_conversations TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: whatsapp_instances users manage own wa instances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own wa instances" ON public.whatsapp_instances TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: whatsapp_messages users manage own wa messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own wa messages" ON public.whatsapp_messages TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: whatsapp_notes users manage own wa notes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own wa notes" ON public.whatsapp_notes TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: whatsapp_scheduled_messages users manage own wa scheduled; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users manage own wa scheduled" ON public.whatsapp_scheduled_messages TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_event_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_event_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_receipt_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_receipt_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_response_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_response_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: whatsapp_scheduled_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_scheduled_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: objects Users can upload own backups; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Users can upload own backups" ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'backups'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));


--
-- Name: objects Users delete own backups; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Users delete own backups" ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'backups'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));


--
-- Name: objects Users view own backups; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Users view own backups" ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'backups'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: iceberg_namespaces; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.iceberg_namespaces ENABLE ROW LEVEL SECURITY;

--
-- Name: iceberg_tables; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.iceberg_tables ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: objects uploads_delete_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_delete_own ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'uploads'::text) AND ((owner_id = (auth.uid())::text) OR ((storage.foldername(name))[1] = (auth.uid())::text))));


--
-- Name: objects uploads_insert_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_insert_own ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects uploads_owner_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_owner_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects uploads_owner_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_owner_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects uploads_owner_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_owner_select ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects uploads_owner_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_owner_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))) WITH CHECK (((bucket_id = 'uploads'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));


--
-- Name: objects uploads_select_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_select_own ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'uploads'::text) AND ((owner_id = (auth.uid())::text) OR ((storage.foldername(name))[1] = (auth.uid())::text))));


--
-- Name: objects uploads_update_own; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY uploads_update_own ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'uploads'::text) AND ((owner_id = (auth.uid())::text) OR ((storage.foldername(name))[1] = (auth.uid())::text)))) WITH CHECK (((bucket_id = 'uploads'::text) AND ((owner_id = (auth.uid())::text) OR ((storage.foldername(name))[1] = (auth.uid())::text))));


--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: SCHEMA storage; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA storage TO postgres;
GRANT USAGE ON SCHEMA storage TO anon;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO dashboard_user;


--
-- Name: FUNCTION email(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.email() TO dashboard_user;


--
-- Name: FUNCTION jwt(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.jwt() TO postgres;
GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;


--
-- Name: FUNCTION role(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.role() TO dashboard_user;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON FUNCTION auth.uid() TO dashboard_user;


--
-- Name: FUNCTION activate_signed_contract(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.activate_signed_contract() TO anon;
GRANT ALL ON FUNCTION public.activate_signed_contract() TO authenticated;
GRANT ALL ON FUNCTION public.activate_signed_contract() TO service_role;


--
-- Name: FUNCTION admin_set_user_admin(_target_user_id uuid, _make_admin boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_set_user_admin(_target_user_id uuid, _make_admin boolean) TO anon;
GRANT ALL ON FUNCTION public.admin_set_user_admin(_target_user_id uuid, _make_admin boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_user_admin(_target_user_id uuid, _make_admin boolean) TO service_role;


--
-- Name: FUNCTION allocate_installment_receipt(_received numeric, _old_paid numeric, _old_principal numeric, _old_interest numeric, _old_fees numeric, _base numeric, _fees numeric, _scheduled_interest numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.allocate_installment_receipt(_received numeric, _old_paid numeric, _old_principal numeric, _old_interest numeric, _old_fees numeric, _base numeric, _fees numeric, _scheduled_interest numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_installment_receipt(_received numeric, _old_paid numeric, _old_principal numeric, _old_interest numeric, _old_fees numeric, _base numeric, _fees numeric, _scheduled_interest numeric) TO service_role;


--
-- Name: FUNCTION apply_manual_cash_operation(_request_id uuid, _expected_owner uuid, _operation text, _amount numeric, _description text, _date timestamp with time zone, _category text, _entry_id uuid, _expected jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.apply_manual_cash_operation(_request_id uuid, _expected_owner uuid, _operation text, _amount numeric, _description text, _date timestamp with time zone, _category text, _entry_id uuid, _expected jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.apply_manual_cash_operation(_request_id uuid, _expected_owner uuid, _operation text, _amount numeric, _description text, _date timestamp with time zone, _category text, _entry_id uuid, _expected jsonb) TO authenticated;


--
-- Name: FUNCTION approve_whatsapp_receipt(_review_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.approve_whatsapp_receipt(_review_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.approve_whatsapp_receipt(_review_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.approve_whatsapp_receipt(_review_id uuid) TO service_role;


--
-- Name: FUNCTION audit_contract_lifecycle(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audit_contract_lifecycle() TO anon;
GRANT ALL ON FUNCTION public.audit_contract_lifecycle() TO authenticated;
GRANT ALL ON FUNCTION public.audit_contract_lifecycle() TO service_role;


--
-- Name: FUNCTION begin_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid) TO service_role;


--
-- Name: FUNCTION begin_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.begin_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.begin_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid) TO service_role;


--
-- Name: FUNCTION bot_phone_key(_phone text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.bot_phone_key(_phone text) TO anon;
GRANT ALL ON FUNCTION public.bot_phone_key(_phone text) TO authenticated;
GRANT ALL ON FUNCTION public.bot_phone_key(_phone text) TO service_role;


--
-- Name: FUNCTION bot_takeover_guard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bot_takeover_guard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.bot_takeover_guard() TO service_role;


--
-- Name: FUNCTION can_access_chat_topic(_topic text, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_access_chat_topic(_topic text, _user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.can_access_chat_topic(_topic text, _user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.can_access_chat_topic(_topic text, _user_id uuid) TO service_role;


--
-- Name: FUNCTION cancel_changed_payment_receipt(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_changed_payment_receipt() FROM PUBLIC;


--
-- Name: FUNCTION cancel_manual_cash_operation(_request_id uuid, _expected_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_manual_cash_operation(_request_id uuid, _expected_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_manual_cash_operation(_request_id uuid, _expected_owner uuid) TO authenticated;


--
-- Name: FUNCTION cancel_scheduled_charges_after_installment_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_scheduled_charges_after_installment_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_scheduled_charges_after_installment_change() TO service_role;


--
-- Name: FUNCTION claim_collection_dispatch(_user_id uuid, _client_id uuid, _channel text, _bucket timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_collection_dispatch(_user_id uuid, _client_id uuid, _channel text, _bucket timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_collection_dispatch(_user_id uuid, _client_id uuid, _channel text, _bucket timestamp with time zone) TO service_role;


--
-- Name: TABLE whatsapp_scheduled_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_scheduled_messages TO anon;
GRANT ALL ON TABLE public.whatsapp_scheduled_messages TO authenticated;
GRANT ALL ON TABLE public.whatsapp_scheduled_messages TO service_role;


--
-- Name: FUNCTION claim_due_whatsapp_messages(_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_due_whatsapp_messages(_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_due_whatsapp_messages(_limit integer) TO service_role;


--
-- Name: FUNCTION claim_whatsapp_event(_user_id uuid, _instance text, _message_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_whatsapp_event(_user_id uuid, _instance text, _message_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_whatsapp_event(_user_id uuid, _instance text, _message_id text) TO service_role;


--
-- Name: TABLE whatsapp_event_claims; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_event_claims TO anon;
GRANT ALL ON TABLE public.whatsapp_event_claims TO authenticated;
GRANT ALL ON TABLE public.whatsapp_event_claims TO service_role;


--
-- Name: FUNCTION claim_whatsapp_event_retries(_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_whatsapp_event_retries(_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_whatsapp_event_retries(_limit integer) TO service_role;


--
-- Name: TABLE whatsapp_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_conversations TO anon;
GRANT ALL ON TABLE public.whatsapp_conversations TO authenticated;
GRANT ALL ON TABLE public.whatsapp_conversations TO service_role;


--
-- Name: FUNCTION claim_whatsapp_followups(_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_whatsapp_followups(_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_whatsapp_followups(_limit integer) TO service_role;


--
-- Name: FUNCTION claim_whatsapp_job(_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_whatsapp_job(_id uuid, _user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_whatsapp_job(_id uuid, _user_id uuid) TO service_role;


--
-- Name: FUNCTION claim_whatsapp_response_window(_user_id uuid, _jid text, _seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_whatsapp_response_window(_user_id uuid, _jid text, _seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_whatsapp_response_window(_user_id uuid, _jid text, _seconds integer) TO service_role;


--
-- Name: FUNCTION close_business_operation(_operation_id uuid, _action text, _data jsonb, _request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.close_business_operation(_operation_id uuid, _action text, _data jsonb, _request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.close_business_operation(_operation_id uuid, _action text, _data jsonb, _request_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.close_business_operation(_operation_id uuid, _action text, _data jsonb, _request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.close_business_operation(_operation_id uuid, _action text, _data jsonb, _request_id uuid) TO service_role;


--
-- Name: FUNCTION collector_login_by_token(_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.collector_login_by_token(_token text) TO anon;
GRANT ALL ON FUNCTION public.collector_login_by_token(_token text) TO authenticated;
GRANT ALL ON FUNCTION public.collector_login_by_token(_token text) TO service_role;


--
-- Name: FUNCTION collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text, _receipt_url text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text, _receipt_url text) TO anon;
GRANT ALL ON FUNCTION public.collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text, _receipt_url text) TO authenticated;
GRANT ALL ON FUNCTION public.collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text, _receipt_url text) TO service_role;


--
-- Name: FUNCTION confirm_whatsapp_receipt(_review_id uuid, _received_amount numeric, _next_due_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.confirm_whatsapp_receipt(_review_id uuid, _received_amount numeric, _next_due_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.confirm_whatsapp_receipt(_review_id uuid, _received_amount numeric, _next_due_date date) TO authenticated;
GRANT ALL ON FUNCTION public.confirm_whatsapp_receipt(_review_id uuid, _received_amount numeric, _next_due_date date) TO service_role;


--
-- Name: FUNCTION contract_has_unsettled_installments(_contract_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.contract_has_unsettled_installments(_contract_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.contract_has_unsettled_installments(_contract_id uuid) TO service_role;


--
-- Name: FUNCTION convert_whatsapp_lead_to_client(_lead_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.convert_whatsapp_lead_to_client(_lead_id uuid) TO anon;
GRANT ALL ON FUNCTION public.convert_whatsapp_lead_to_client(_lead_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.convert_whatsapp_lead_to_client(_lead_id uuid) TO service_role;


--
-- Name: FUNCTION create_business_operation(_data jsonb, _request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_business_operation(_data jsonb, _request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_business_operation(_data jsonb, _request_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.create_business_operation(_data jsonb, _request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_business_operation(_data jsonb, _request_id uuid) TO service_role;


--
-- Name: FUNCTION create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb) TO anon;
GRANT ALL ON FUNCTION public.create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb) TO service_role;


--
-- Name: FUNCTION create_client_contract_with_collateral(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb, _collateral jsonb, _request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_client_contract_with_collateral(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb, _collateral jsonb, _request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_client_contract_with_collateral(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb, _collateral jsonb, _request_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.create_client_contract_with_collateral(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb, _collateral jsonb, _request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_client_contract_with_collateral(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb, _collateral jsonb, _request_id uuid) TO service_role;


--
-- Name: FUNCTION delete_client_cascade(_client_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_client_cascade(_client_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_client_cascade(_client_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.delete_client_cascade(_client_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_client_cascade(_client_id uuid) TO service_role;


--
-- Name: FUNCTION delete_contract_atomically(_contract_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_contract_atomically(_contract_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_contract_atomically(_contract_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.delete_contract_atomically(_contract_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.delete_contract_atomically(_contract_id uuid) TO service_role;


--
-- Name: FUNCTION enqueue_payment_receipt(_transaction_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enqueue_payment_receipt(_transaction_id uuid, _user_id uuid) FROM PUBLIC;


--
-- Name: FUNCTION expire_payment_promises(_reference_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_payment_promises(_reference_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_payment_promises(_reference_date date) TO anon;
GRANT ALL ON FUNCTION public.expire_payment_promises(_reference_date date) TO authenticated;
GRANT ALL ON FUNCTION public.expire_payment_promises(_reference_date date) TO service_role;


--
-- Name: FUNCTION financial_analytics_report(_from date, _to date, _expected_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.financial_analytics_report(_from date, _to date, _expected_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.financial_analytics_report(_from date, _to date, _expected_owner uuid) TO authenticated;


--
-- Name: FUNCTION finish_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid, _success boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finish_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid, _success boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_whatsapp_event(_user_id uuid, _instance text, _message_id text, _lease_token uuid, _success boolean) TO service_role;


--
-- Name: FUNCTION finish_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.finish_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.finish_whatsapp_response(_user_id uuid, _jid text, _lease_token uuid) TO service_role;


--
-- Name: FUNCTION fulfill_payment_promises_on_installment_paid(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fulfill_payment_promises_on_installment_paid() TO anon;
GRANT ALL ON FUNCTION public.fulfill_payment_promises_on_installment_paid() TO authenticated;
GRANT ALL ON FUNCTION public.fulfill_payment_promises_on_installment_paid() TO service_role;


--
-- Name: FUNCTION get_ativo_passivo(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_ativo_passivo() TO anon;
GRANT ALL ON FUNCTION public.get_ativo_passivo() TO authenticated;
GRANT ALL ON FUNCTION public.get_ativo_passivo() TO service_role;


--
-- Name: FUNCTION get_or_create_dm_thread(_other_user uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_or_create_dm_thread(_other_user uuid) TO anon;
GRANT ALL ON FUNCTION public.get_or_create_dm_thread(_other_user uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_or_create_dm_thread(_other_user uuid) TO service_role;


--
-- Name: FUNCTION get_signup_checkout_url(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_signup_checkout_url() TO anon;
GRANT ALL ON FUNCTION public.get_signup_checkout_url() TO authenticated;
GRANT ALL ON FUNCTION public.get_signup_checkout_url() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION handle_new_user_trial(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user_trial() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user_trial() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user_trial() TO service_role;


--
-- Name: FUNCTION handle_new_user_with_settings(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user_with_settings() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user_with_settings() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user_with_settings() TO service_role;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO anon;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;


--
-- Name: FUNCTION increment_goal_amount(_goal_id uuid, _delta numeric); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_goal_amount(_goal_id uuid, _delta numeric) TO anon;
GRANT ALL ON FUNCTION public.increment_goal_amount(_goal_id uuid, _delta numeric) TO authenticated;
GRANT ALL ON FUNCTION public.increment_goal_amount(_goal_id uuid, _delta numeric) TO service_role;


--
-- Name: FUNCTION investor_portal_login(_token uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.investor_portal_login(_token uuid) TO anon;
GRANT ALL ON FUNCTION public.investor_portal_login(_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.investor_portal_login(_token uuid) TO service_role;


--
-- Name: FUNCTION investor_regenerate_token(_investor_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.investor_regenerate_token(_investor_id uuid) TO anon;
GRANT ALL ON FUNCTION public.investor_regenerate_token(_investor_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.investor_regenerate_token(_investor_id uuid) TO service_role;


--
-- Name: FUNCTION is_admin(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_admin(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_admin(_user_id uuid) TO service_role;


--
-- Name: FUNCTION is_channel_member(_channel_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_channel_member(_channel_id uuid, _user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_channel_member(_channel_id uuid, _user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_channel_member(_channel_id uuid, _user_id uuid) TO service_role;


--
-- Name: FUNCTION is_dm_participant(_thread_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_dm_participant(_thread_id uuid, _user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_dm_participant(_thread_id uuid, _user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_dm_participant(_thread_id uuid, _user_id uuid) TO service_role;


--
-- Name: FUNCTION leads_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.leads_touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.leads_touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.leads_touch_updated_at() TO service_role;


--
-- Name: FUNCTION list_public_profiles(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.list_public_profiles() TO anon;
GRANT ALL ON FUNCTION public.list_public_profiles() TO authenticated;
GRANT ALL ON FUNCTION public.list_public_profiles() TO service_role;


--
-- Name: FUNCTION mark_installment_collected(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_installment_collected() TO anon;
GRANT ALL ON FUNCTION public.mark_installment_collected() TO authenticated;
GRANT ALL ON FUNCTION public.mark_installment_collected() TO service_role;


--
-- Name: FUNCTION materialize_payment_promise_from_audit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.materialize_payment_promise_from_audit() TO anon;
GRANT ALL ON FUNCTION public.materialize_payment_promise_from_audit() TO authenticated;
GRANT ALL ON FUNCTION public.materialize_payment_promise_from_audit() TO service_role;


--
-- Name: FUNCTION normalize_contract_lifecycle(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.normalize_contract_lifecycle() FROM PUBLIC;
GRANT ALL ON FUNCTION public.normalize_contract_lifecycle() TO service_role;


--
-- Name: FUNCTION normalize_interest_renewal_profit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalize_interest_renewal_profit() TO anon;
GRANT ALL ON FUNCTION public.normalize_interest_renewal_profit() TO authenticated;
GRANT ALL ON FUNCTION public.normalize_interest_renewal_profit() TO service_role;


--
-- Name: FUNCTION notify_installment_paid(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_installment_paid() FROM PUBLIC;


--
-- Name: FUNCTION pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text) TO authenticated;
GRANT ALL ON FUNCTION public.pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text) TO service_role;


--
-- Name: FUNCTION pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean, _method text, _receipt_url text, _source_key text, _fee_discount numeric); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean, _method text, _receipt_url text, _source_key text, _fee_discount numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean, _method text, _receipt_url text, _source_key text, _fee_discount numeric) TO postgres;
GRANT ALL ON FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean, _method text, _receipt_url text, _source_key text, _fee_discount numeric) TO authenticated;
GRANT ALL ON FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean, _method text, _receipt_url text, _source_key text, _fee_discount numeric) TO service_role;


--
-- Name: FUNCTION pay_installment_waiving_fees(_installment_id uuid, _paid_total numeric, _method text, _receipt_url text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.pay_installment_waiving_fees(_installment_id uuid, _paid_total numeric, _method text, _receipt_url text) TO anon;
GRANT ALL ON FUNCTION public.pay_installment_waiving_fees(_installment_id uuid, _paid_total numeric, _method text, _receipt_url text) TO authenticated;
GRANT ALL ON FUNCTION public.pay_installment_waiving_fees(_installment_id uuid, _paid_total numeric, _method text, _receipt_url text) TO service_role;


--
-- Name: FUNCTION payment_allocation_review(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payment_allocation_review() FROM PUBLIC;
GRANT ALL ON FUNCTION public.payment_allocation_review() TO authenticated;
GRANT ALL ON FUNCTION public.payment_allocation_review() TO service_role;


--
-- Name: FUNCTION payment_receipt_context(_transaction_id uuid, _user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.payment_receipt_context(_transaction_id uuid, _user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.payment_receipt_context(_transaction_id uuid, _user_id uuid) TO service_role;


--
-- Name: FUNCTION platform_settings_touch(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.platform_settings_touch() TO anon;
GRANT ALL ON FUNCTION public.platform_settings_touch() TO authenticated;
GRANT ALL ON FUNCTION public.platform_settings_touch() TO service_role;


--
-- Name: FUNCTION portal_client_login(_cpf text, _birth_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_client_login(_cpf text, _birth_date date) TO anon;
GRANT ALL ON FUNCTION public.portal_client_login(_cpf text, _birth_date date) TO authenticated;
GRANT ALL ON FUNCTION public.portal_client_login(_cpf text, _birth_date date) TO service_role;


--
-- Name: FUNCTION portal_client_login_for_owner(_cpf text, _birth_date date, _owner_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_client_login_for_owner(_cpf text, _birth_date date, _owner_id uuid) TO anon;
GRANT ALL ON FUNCTION public.portal_client_login_for_owner(_cpf text, _birth_date date, _owner_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_client_login_for_owner(_cpf text, _birth_date date, _owner_id uuid) TO service_role;


--
-- Name: FUNCTION portal_client_mark_notifications_read(_cpf text, _ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_client_mark_notifications_read(_cpf text, _ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.portal_client_mark_notifications_read(_cpf text, _ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.portal_client_mark_notifications_read(_cpf text, _ids uuid[]) TO service_role;


--
-- Name: FUNCTION portal_client_notifications(_cpf text, _limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_client_notifications(_cpf text, _limit integer) TO anon;
GRANT ALL ON FUNCTION public.portal_client_notifications(_cpf text, _limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.portal_client_notifications(_cpf text, _limit integer) TO service_role;


--
-- Name: FUNCTION portal_contract_signatures(_session_token uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_contract_signatures(_session_token uuid) TO anon;
GRANT ALL ON FUNCTION public.portal_contract_signatures(_session_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_contract_signatures(_session_token uuid) TO service_role;


--
-- Name: FUNCTION portal_login_by_token(_token uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_login_by_token(_token uuid) TO anon;
GRANT ALL ON FUNCTION public.portal_login_by_token(_token uuid) TO authenticated;
GRANT ALL ON FUNCTION public.portal_login_by_token(_token uuid) TO service_role;


--
-- Name: FUNCTION portal_lookup_creditor_contact(_cpf text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_lookup_creditor_contact(_cpf text) TO anon;
GRANT ALL ON FUNCTION public.portal_lookup_creditor_contact(_cpf text) TO authenticated;
GRANT ALL ON FUNCTION public.portal_lookup_creditor_contact(_cpf text) TO service_role;


--
-- Name: FUNCTION portal_lookup_creditor_contact(_cpf text, _birth_date date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_lookup_creditor_contact(_cpf text, _birth_date date) TO anon;
GRANT ALL ON FUNCTION public.portal_lookup_creditor_contact(_cpf text, _birth_date date) TO authenticated;
GRANT ALL ON FUNCTION public.portal_lookup_creditor_contact(_cpf text, _birth_date date) TO service_role;


--
-- Name: FUNCTION portal_mark_notifications_read_by_token(_token uuid, _ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_mark_notifications_read_by_token(_token uuid, _ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.portal_mark_notifications_read_by_token(_token uuid, _ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.portal_mark_notifications_read_by_token(_token uuid, _ids uuid[]) TO service_role;


--
-- Name: FUNCTION portal_notifications_by_token(_token uuid, _limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_notifications_by_token(_token uuid, _limit integer) TO anon;
GRANT ALL ON FUNCTION public.portal_notifications_by_token(_token uuid, _limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.portal_notifications_by_token(_token uuid, _limit integer) TO service_role;


--
-- Name: FUNCTION portal_sign_contract(_session_token uuid, _contract_id uuid, _signer_name text, _cpf_confirmation text, _user_agent text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.portal_sign_contract(_session_token uuid, _contract_id uuid, _signer_name text, _cpf_confirmation text, _user_agent text) TO anon;
GRANT ALL ON FUNCTION public.portal_sign_contract(_session_token uuid, _contract_id uuid, _signer_name text, _cpf_confirmation text, _user_agent text) TO authenticated;
GRANT ALL ON FUNCTION public.portal_sign_contract(_session_token uuid, _contract_id uuid, _signer_name text, _cpf_confirmation text, _user_agent text) TO service_role;


--
-- Name: FUNCTION protect_profile_admin_columns(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_profile_admin_columns() TO anon;
GRANT ALL ON FUNCTION public.protect_profile_admin_columns() TO authenticated;
GRANT ALL ON FUNCTION public.protect_profile_admin_columns() TO service_role;


--
-- Name: FUNCTION queue_registered_payment_receipt(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.queue_registered_payment_receipt() FROM PUBLIC;


--
-- Name: FUNCTION quote_installment_late_fee(_amount numeric, _due_date timestamp with time zone, _status text, _stored numeric, _snapshot jsonb, _rate numeric, _penalty_type text, _penalty_value numeric, _cap numeric, _at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.quote_installment_late_fee(_amount numeric, _due_date timestamp with time zone, _status text, _stored numeric, _snapshot jsonb, _rate numeric, _penalty_type text, _penalty_value numeric, _cap numeric, _at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.quote_installment_late_fee(_amount numeric, _due_date timestamp with time zone, _status text, _stored numeric, _snapshot jsonb, _rate numeric, _penalty_type text, _penalty_value numeric, _cap numeric, _at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION receive_business_payment(_receivable_id uuid, _amount numeric, _method text, _request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.receive_business_payment(_receivable_id uuid, _amount numeric, _method text, _request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.receive_business_payment(_receivable_id uuid, _amount numeric, _method text, _request_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.receive_business_payment(_receivable_id uuid, _amount numeric, _method text, _request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.receive_business_payment(_receivable_id uuid, _amount numeric, _method text, _request_id uuid) TO service_role;


--
-- Name: FUNCTION record_business_ledger(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_business_ledger() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_business_ledger() TO postgres;
GRANT ALL ON FUNCTION public.record_business_ledger() TO authenticated;
GRANT ALL ON FUNCTION public.record_business_ledger() TO service_role;


--
-- Name: FUNCTION record_contract_disbursement(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.record_contract_disbursement() TO anon;
GRANT ALL ON FUNCTION public.record_contract_disbursement() TO authenticated;
GRANT ALL ON FUNCTION public.record_contract_disbursement() TO service_role;


--
-- Name: FUNCTION refresh_installment_charges(_after_id uuid, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_installment_charges(_after_id uuid, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_installment_charges(_after_id uuid, _limit integer) TO service_role;


--
-- Name: FUNCTION register_investor_interest_payment(_loan_id uuid, _amount numeric, _next_due_date date, _method text, _notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.register_investor_interest_payment(_loan_id uuid, _amount numeric, _next_due_date date, _method text, _notes text) TO anon;
GRANT ALL ON FUNCTION public.register_investor_interest_payment(_loan_id uuid, _amount numeric, _next_due_date date, _method text, _notes text) TO authenticated;
GRANT ALL ON FUNCTION public.register_investor_interest_payment(_loan_id uuid, _amount numeric, _next_due_date date, _method text, _notes text) TO service_role;


--
-- Name: FUNCTION register_investor_payment(_loan_id uuid, _amount numeric, _method text, _receipt_url text, _notes text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.register_investor_payment(_loan_id uuid, _amount numeric, _method text, _receipt_url text, _notes text) TO anon;
GRANT ALL ON FUNCTION public.register_investor_payment(_loan_id uuid, _amount numeric, _method text, _receipt_url text, _notes text) TO authenticated;
GRANT ALL ON FUNCTION public.register_investor_payment(_loan_id uuid, _amount numeric, _method text, _receipt_url text, _notes text) TO service_role;


--
-- Name: FUNCTION renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric, _reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric, _reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric, _reason text) TO postgres;
GRANT ALL ON FUNCTION public.renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric, _reason text) TO anon;
GRANT ALL ON FUNCTION public.renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric, _reason text) TO authenticated;
GRANT ALL ON FUNCTION public.renegotiate_contract_atomically(_old_contract_id uuid, _contract jsonb, _installments jsonb, _new_cash_disbursed numeric, _reason text) TO service_role;


--
-- Name: FUNCTION renew_installment_interest(_installment_id uuid, _next_due_date date, _method text, _origin text, _receipt_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.renew_installment_interest(_installment_id uuid, _next_due_date date, _method text, _origin text, _receipt_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.renew_installment_interest(_installment_id uuid, _next_due_date date, _method text, _origin text, _receipt_url text) TO postgres;
GRANT ALL ON FUNCTION public.renew_installment_interest(_installment_id uuid, _next_due_date date, _method text, _origin text, _receipt_url text) TO authenticated;
GRANT ALL ON FUNCTION public.renew_installment_interest(_installment_id uuid, _next_due_date date, _method text, _origin text, _receipt_url text) TO service_role;


--
-- Name: FUNCTION reopen_contract_with_unsettled_installments(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reopen_contract_with_unsettled_installments() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reopen_contract_with_unsettled_installments() TO service_role;


--
-- Name: FUNCTION request_payment_receipt(_transaction_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_payment_receipt(_transaction_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_payment_receipt(_transaction_id uuid) TO authenticated;


--
-- Name: FUNCTION restore_user_backup_atomic(_user_id uuid, _dump jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.restore_user_backup_atomic(_user_id uuid, _dump jsonb) TO anon;
GRANT ALL ON FUNCTION public.restore_user_backup_atomic(_user_id uuid, _dump jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.restore_user_backup_atomic(_user_id uuid, _dump jsonb) TO service_role;


--
-- Name: FUNCTION return_loan_collateral(_id uuid, _note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.return_loan_collateral(_id uuid, _note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.return_loan_collateral(_id uuid, _note text) TO postgres;
GRANT ALL ON FUNCTION public.return_loan_collateral(_id uuid, _note text) TO authenticated;
GRANT ALL ON FUNCTION public.return_loan_collateral(_id uuid, _note text) TO service_role;


--
-- Name: FUNCTION reverse_installment_payment(_installment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reverse_installment_payment(_installment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_installment_payment(_installment_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.reverse_installment_payment(_installment_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reverse_installment_payment(_installment_id uuid) TO service_role;


--
-- Name: FUNCTION reverse_last_investor_payment(_loan_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reverse_last_investor_payment(_loan_id uuid) TO anon;
GRANT ALL ON FUNCTION public.reverse_last_investor_payment(_loan_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reverse_last_investor_payment(_loan_id uuid) TO service_role;


--
-- Name: FUNCTION save_business_asset(_data jsonb, _id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_business_asset(_data jsonb, _id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_business_asset(_data jsonb, _id uuid) TO postgres;
GRANT ALL ON FUNCTION public.save_business_asset(_data jsonb, _id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.save_business_asset(_data jsonb, _id uuid) TO service_role;


--
-- Name: FUNCTION save_loan_collateral(_contract_id uuid, _data jsonb, _request_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_loan_collateral(_contract_id uuid, _data jsonb, _request_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_loan_collateral(_contract_id uuid, _data jsonb, _request_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.save_loan_collateral(_contract_id uuid, _data jsonb, _request_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.save_loan_collateral(_contract_id uuid, _data jsonb, _request_id uuid) TO service_role;


--
-- Name: FUNCTION save_whatsapp_event(_user_id uuid, _instance text, _message_id text, _payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.save_whatsapp_event(_user_id uuid, _instance text, _message_id text, _payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.save_whatsapp_event(_user_id uuid, _instance text, _message_id text, _payload jsonb) TO service_role;


--
-- Name: FUNCTION search_clients_by_document(_document text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.search_clients_by_document(_document text) TO anon;
GRANT ALL ON FUNCTION public.search_clients_by_document(_document text) TO authenticated;
GRANT ALL ON FUNCTION public.search_clients_by_document(_document text) TO service_role;


--
-- Name: FUNCTION search_clients_fuzzy(_term text, _threshold real, _limit integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.search_clients_fuzzy(_term text, _threshold real, _limit integer) TO anon;
GRANT ALL ON FUNCTION public.search_clients_fuzzy(_term text, _threshold real, _limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.search_clients_fuzzy(_term text, _threshold real, _limit integer) TO service_role;


--
-- Name: FUNCTION settle_percentage_installment(_installment_id uuid, _method text, _receipt_url text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.settle_percentage_installment(_installment_id uuid, _method text, _receipt_url text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.settle_percentage_installment(_installment_id uuid, _method text, _receipt_url text) TO postgres;
GRANT ALL ON FUNCTION public.settle_percentage_installment(_installment_id uuid, _method text, _receipt_url text) TO authenticated;
GRANT ALL ON FUNCTION public.settle_percentage_installment(_installment_id uuid, _method text, _receipt_url text) TO service_role;


--
-- Name: FUNCTION stop_charges_for_closed_contract(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.stop_charges_for_closed_contract() TO anon;
GRANT ALL ON FUNCTION public.stop_charges_for_closed_contract() TO authenticated;
GRANT ALL ON FUNCTION public.stop_charges_for_closed_contract() TO service_role;


--
-- Name: FUNCTION sync_paid_installment_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sync_paid_installment_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.sync_paid_installment_status() TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clients TO anon;
GRANT ALL ON TABLE public.clients TO authenticated;
GRANT ALL ON TABLE public.clients TO service_role;


--
-- Name: FUNCTION system_find_clients_by_phone(_user_id uuid, _phone text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.system_find_clients_by_phone(_user_id uuid, _phone text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.system_find_clients_by_phone(_user_id uuid, _phone text) TO service_role;


--
-- Name: FUNCTION system_pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text, _origin text, _source_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.system_pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text, _origin text, _source_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.system_pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text, _origin text, _source_key text) TO postgres;
GRANT ALL ON FUNCTION public.system_pay_client_balance(_client_id uuid, _amount numeric, _method text, _receipt_url text, _origin text, _source_key text) TO service_role;


--
-- Name: FUNCTION system_register_payment(_installment_id uuid, _paid_total numeric, _method text, _origem text, _receipt_url text, _source_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.system_register_payment(_installment_id uuid, _paid_total numeric, _method text, _origem text, _receipt_url text, _source_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.system_register_payment(_installment_id uuid, _paid_total numeric, _method text, _origem text, _receipt_url text, _source_key text) TO postgres;
GRANT ALL ON FUNCTION public.system_register_payment(_installment_id uuid, _paid_total numeric, _method text, _origem text, _receipt_url text, _source_key text) TO service_role;


--
-- Name: FUNCTION system_renew_installment_interest(_installment_id uuid, _amount numeric, _next_due_date timestamp with time zone, _origin text, _source_key text, _method text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.system_renew_installment_interest(_installment_id uuid, _amount numeric, _next_due_date timestamp with time zone, _origin text, _source_key text, _method text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.system_renew_installment_interest(_installment_id uuid, _amount numeric, _next_due_date timestamp with time zone, _origin text, _source_key text, _method text) TO postgres;
GRANT ALL ON FUNCTION public.system_renew_installment_interest(_installment_id uuid, _amount numeric, _next_due_date timestamp with time zone, _origin text, _source_key text, _method text) TO service_role;


--
-- Name: FUNCTION touch_dm_thread(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_dm_thread() TO anon;
GRANT ALL ON FUNCTION public.touch_dm_thread() TO authenticated;
GRANT ALL ON FUNCTION public.touch_dm_thread() TO service_role;


--
-- Name: FUNCTION touch_payment_promise(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_payment_promise() TO anon;
GRANT ALL ON FUNCTION public.touch_payment_promise() TO authenticated;
GRANT ALL ON FUNCTION public.touch_payment_promise() TO service_role;


--
-- Name: FUNCTION try_consume_rate_limit(_key text, _capacity double precision, _refill_per_sec double precision); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.try_consume_rate_limit(_key text, _capacity double precision, _refill_per_sec double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION public.try_consume_rate_limit(_key text, _capacity double precision, _refill_per_sec double precision) TO service_role;


--
-- Name: FUNCTION update_contract_atomically(_contract_id uuid, _contract jsonb, _regenerate boolean, _installments jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_contract_atomically(_contract_id uuid, _contract jsonb, _regenerate boolean, _installments jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_contract_atomically(_contract_id uuid, _contract jsonb, _regenerate boolean, _installments jsonb) TO postgres;
GRANT ALL ON FUNCTION public.update_contract_atomically(_contract_id uuid, _contract jsonb, _regenerate boolean, _installments jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.update_contract_atomically(_contract_id uuid, _contract jsonb, _regenerate boolean, _installments jsonb) TO service_role;


--
-- Name: FUNCTION update_ticket_on_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_ticket_on_message() TO anon;
GRANT ALL ON FUNCTION public.update_ticket_on_message() TO authenticated;
GRANT ALL ON FUNCTION public.update_ticket_on_message() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION wallet_cash_report(_days integer, _search text, _offset integer, _limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.wallet_cash_report(_days integer, _search text, _offset integer, _limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.wallet_cash_report(_days integer, _search text, _offset integer, _limit integer) TO authenticated;


--
-- Name: FUNCTION extension(name text); Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON FUNCTION storage.extension(name text) TO anon;
GRANT ALL ON FUNCTION storage.extension(name text) TO authenticated;
GRANT ALL ON FUNCTION storage.extension(name text) TO service_role;
GRANT ALL ON FUNCTION storage.extension(name text) TO dashboard_user;
GRANT ALL ON FUNCTION storage.extension(name text) TO postgres;


--
-- Name: FUNCTION filename(name text); Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON FUNCTION storage.filename(name text) TO anon;
GRANT ALL ON FUNCTION storage.filename(name text) TO authenticated;
GRANT ALL ON FUNCTION storage.filename(name text) TO service_role;
GRANT ALL ON FUNCTION storage.filename(name text) TO dashboard_user;
GRANT ALL ON FUNCTION storage.filename(name text) TO postgres;


--
-- Name: FUNCTION foldername(name text); Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON FUNCTION storage.foldername(name text) TO anon;
GRANT ALL ON FUNCTION storage.foldername(name text) TO authenticated;
GRANT ALL ON FUNCTION storage.foldername(name text) TO service_role;
GRANT ALL ON FUNCTION storage.foldername(name text) TO dashboard_user;
GRANT ALL ON FUNCTION storage.foldername(name text) TO postgres;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: auth; Owner: -
--

GRANT SELECT ON TABLE auth.schema_migrations TO postgres WITH GRANT OPTION;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: -
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE ai_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_conversations TO anon;
GRANT ALL ON TABLE public.ai_conversations TO authenticated;
GRANT ALL ON TABLE public.ai_conversations TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO anon;
GRANT ALL ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE automation_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.automation_logs TO anon;
GRANT ALL ON TABLE public.automation_logs TO authenticated;
GRANT ALL ON TABLE public.automation_logs TO service_role;


--
-- Name: TABLE bot_actions_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bot_actions_log TO anon;
GRANT ALL ON TABLE public.bot_actions_log TO authenticated;
GRANT ALL ON TABLE public.bot_actions_log TO service_role;


--
-- Name: TABLE business_assets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.business_assets TO postgres;
GRANT ALL ON TABLE public.business_assets TO service_role;
GRANT SELECT ON TABLE public.business_assets TO authenticated;


--
-- Name: TABLE business_operations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.business_operations TO postgres;
GRANT ALL ON TABLE public.business_operations TO service_role;
GRANT SELECT ON TABLE public.business_operations TO authenticated;


--
-- Name: TABLE business_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.business_payments TO postgres;
GRANT ALL ON TABLE public.business_payments TO service_role;
GRANT SELECT ON TABLE public.business_payments TO authenticated;


--
-- Name: TABLE business_receivables; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.business_receivables TO postgres;
GRANT ALL ON TABLE public.business_receivables TO service_role;
GRANT SELECT ON TABLE public.business_receivables TO authenticated;


--
-- Name: TABLE chat_channel_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_channel_members TO anon;
GRANT ALL ON TABLE public.chat_channel_members TO authenticated;
GRANT ALL ON TABLE public.chat_channel_members TO service_role;


--
-- Name: TABLE chat_channels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_channels TO anon;
GRANT ALL ON TABLE public.chat_channels TO authenticated;
GRANT ALL ON TABLE public.chat_channels TO service_role;


--
-- Name: TABLE chat_dm_threads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_dm_threads TO anon;
GRANT ALL ON TABLE public.chat_dm_threads TO authenticated;
GRANT ALL ON TABLE public.chat_dm_threads TO service_role;


--
-- Name: TABLE chat_message_reactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_message_reactions TO anon;
GRANT ALL ON TABLE public.chat_message_reactions TO authenticated;
GRANT ALL ON TABLE public.chat_message_reactions TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE client_errors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_errors TO anon;
GRANT ALL ON TABLE public.client_errors TO authenticated;
GRANT ALL ON TABLE public.client_errors TO service_role;


--
-- Name: TABLE client_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_notifications TO anon;
GRANT ALL ON TABLE public.client_notifications TO authenticated;
GRANT ALL ON TABLE public.client_notifications TO service_role;


--
-- Name: TABLE client_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_tokens TO anon;
GRANT ALL ON TABLE public.client_tokens TO authenticated;
GRANT ALL ON TABLE public.client_tokens TO service_role;


--
-- Name: TABLE collection_attempts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collection_attempts TO anon;
GRANT ALL ON TABLE public.collection_attempts TO authenticated;
GRANT ALL ON TABLE public.collection_attempts TO service_role;


--
-- Name: TABLE collection_dispatch_claims; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collection_dispatch_claims TO anon;
GRANT ALL ON TABLE public.collection_dispatch_claims TO authenticated;
GRANT ALL ON TABLE public.collection_dispatch_claims TO service_role;


--
-- Name: TABLE collector_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collector_assignments TO anon;
GRANT ALL ON TABLE public.collector_assignments TO authenticated;
GRANT ALL ON TABLE public.collector_assignments TO service_role;


--
-- Name: TABLE collector_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collector_tokens TO anon;
GRANT ALL ON TABLE public.collector_tokens TO authenticated;
GRANT ALL ON TABLE public.collector_tokens TO service_role;


--
-- Name: TABLE collectors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.collectors TO anon;
GRANT ALL ON TABLE public.collectors TO authenticated;
GRANT ALL ON TABLE public.collectors TO service_role;


--
-- Name: TABLE contract_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contract_events TO anon;
GRANT ALL ON TABLE public.contract_events TO authenticated;
GRANT ALL ON TABLE public.contract_events TO service_role;


--
-- Name: TABLE contract_installments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contract_installments TO anon;
GRANT ALL ON TABLE public.contract_installments TO authenticated;
GRANT ALL ON TABLE public.contract_installments TO service_role;


--
-- Name: TABLE contract_signature_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contract_signature_events TO anon;
GRANT ALL ON TABLE public.contract_signature_events TO authenticated;
GRANT ALL ON TABLE public.contract_signature_events TO service_role;


--
-- Name: TABLE contracts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contracts TO anon;
GRANT ALL ON TABLE public.contracts TO authenticated;
GRANT ALL ON TABLE public.contracts TO service_role;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expenses TO anon;
GRANT ALL ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;


--
-- Name: TABLE goals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.goals TO anon;
GRANT ALL ON TABLE public.goals TO authenticated;
GRANT ALL ON TABLE public.goals TO service_role;


--
-- Name: TABLE installments_legado_20260805; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.installments_legado_20260805 TO anon;
GRANT ALL ON TABLE public.installments_legado_20260805 TO authenticated;
GRANT ALL ON TABLE public.installments_legado_20260805 TO service_role;


--
-- Name: TABLE investor_loans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.investor_loans TO anon;
GRANT ALL ON TABLE public.investor_loans TO authenticated;
GRANT ALL ON TABLE public.investor_loans TO service_role;


--
-- Name: TABLE investor_payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.investor_payments TO anon;
GRANT ALL ON TABLE public.investor_payments TO authenticated;
GRANT ALL ON TABLE public.investor_payments TO service_role;


--
-- Name: TABLE investors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.investors TO anon;
GRANT ALL ON TABLE public.investors TO authenticated;
GRANT ALL ON TABLE public.investors TO service_role;


--
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.leads TO anon;
GRANT ALL ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;


--
-- Name: TABLE loan_collateral; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.loan_collateral TO postgres;
GRANT ALL ON TABLE public.loan_collateral TO service_role;
GRANT SELECT ON TABLE public.loan_collateral TO authenticated;


--
-- Name: TABLE loan_presets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.loan_presets TO anon;
GRANT ALL ON TABLE public.loan_presets TO authenticated;
GRANT ALL ON TABLE public.loan_presets TO service_role;


--
-- Name: TABLE message_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.message_templates TO anon;
GRANT ALL ON TABLE public.message_templates TO authenticated;
GRANT ALL ON TABLE public.message_templates TO service_role;


--
-- Name: TABLE notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notes TO anon;
GRANT ALL ON TABLE public.notes TO authenticated;
GRANT ALL ON TABLE public.notes TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE payment_promises; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_promises TO anon;
GRANT ALL ON TABLE public.payment_promises TO authenticated;
GRANT ALL ON TABLE public.payment_promises TO service_role;


--
-- Name: TABLE platform_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_settings TO anon;
GRANT ALL ON TABLE public.platform_settings TO authenticated;
GRANT ALL ON TABLE public.platform_settings TO service_role;


--
-- Name: TABLE pledges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pledges TO anon;
GRANT ALL ON TABLE public.pledges TO authenticated;
GRANT ALL ON TABLE public.pledges TO service_role;


--
-- Name: TABLE portal_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.portal_sessions TO anon;
GRANT ALL ON TABLE public.portal_sessions TO authenticated;
GRANT ALL ON TABLE public.portal_sessions TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE profits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profits TO anon;
GRANT ALL ON TABLE public.profits TO authenticated;
GRANT ALL ON TABLE public.profits TO service_role;


--
-- Name: TABLE rate_limit_hits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limit_hits TO service_role;


--
-- Name: TABLE rentals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rentals TO anon;
GRANT ALL ON TABLE public.rentals TO authenticated;
GRANT ALL ON TABLE public.rentals TO service_role;


--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.settings TO anon;
GRANT ALL ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.settings TO service_role;


--
-- Name: TABLE settings_safe; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.settings_safe TO anon;
GRANT ALL ON TABLE public.settings_safe TO authenticated;
GRANT ALL ON TABLE public.settings_safe TO service_role;


--
-- Name: TABLE stock_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stock_items TO anon;
GRANT ALL ON TABLE public.stock_items TO authenticated;
GRANT ALL ON TABLE public.stock_items TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE support_ticket_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_ticket_messages TO anon;
GRANT ALL ON TABLE public.support_ticket_messages TO authenticated;
GRANT ALL ON TABLE public.support_ticket_messages TO service_role;


--
-- Name: TABLE support_tickets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_tickets TO anon;
GRANT ALL ON TABLE public.support_tickets TO authenticated;
GRANT ALL ON TABLE public.support_tickets TO service_role;


--
-- Name: TABLE system_automations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.system_automations TO anon;
GRANT ALL ON TABLE public.system_automations TO authenticated;
GRANT ALL ON TABLE public.system_automations TO service_role;


--
-- Name: TABLE todos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.todos TO anon;
GRANT ALL ON TABLE public.todos TO authenticated;
GRANT ALL ON TABLE public.todos TO service_role;


--
-- Name: TABLE transactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.transactions TO anon;
GRANT ALL ON TABLE public.transactions TO authenticated;
GRANT ALL ON TABLE public.transactions TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: TABLE vehicles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicles TO anon;
GRANT ALL ON TABLE public.vehicles TO authenticated;
GRANT ALL ON TABLE public.vehicles TO service_role;


--
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.webhook_events TO anon;
GRANT ALL ON TABLE public.webhook_events TO authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;


--
-- Name: TABLE whatsapp_instances; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_instances TO anon;
GRANT ALL ON TABLE public.whatsapp_instances TO authenticated;
GRANT ALL ON TABLE public.whatsapp_instances TO service_role;


--
-- Name: TABLE whatsapp_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_messages TO anon;
GRANT ALL ON TABLE public.whatsapp_messages TO authenticated;
GRANT ALL ON TABLE public.whatsapp_messages TO service_role;


--
-- Name: TABLE whatsapp_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_notes TO anon;
GRANT ALL ON TABLE public.whatsapp_notes TO authenticated;
GRANT ALL ON TABLE public.whatsapp_notes TO service_role;


--
-- Name: TABLE whatsapp_receipt_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_receipt_reviews TO anon;
GRANT ALL ON TABLE public.whatsapp_receipt_reviews TO authenticated;
GRANT ALL ON TABLE public.whatsapp_receipt_reviews TO service_role;


--
-- Name: TABLE whatsapp_response_windows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.whatsapp_response_windows TO anon;
GRANT ALL ON TABLE public.whatsapp_response_windows TO authenticated;
GRANT ALL ON TABLE public.whatsapp_response_windows TO service_role;


--
-- Name: TABLE buckets; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.buckets TO anon;
GRANT ALL ON TABLE storage.buckets TO authenticated;
GRANT ALL ON TABLE storage.buckets TO service_role;
GRANT ALL ON TABLE storage.buckets TO postgres WITH GRANT OPTION;


--
-- Name: TABLE buckets_analytics; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.buckets_analytics TO service_role;
GRANT ALL ON TABLE storage.buckets_analytics TO authenticated;
GRANT ALL ON TABLE storage.buckets_analytics TO anon;


--
-- Name: TABLE buckets_vectors; Type: ACL; Schema: storage; Owner: -
--

GRANT SELECT ON TABLE storage.buckets_vectors TO service_role;
GRANT SELECT ON TABLE storage.buckets_vectors TO authenticated;
GRANT SELECT ON TABLE storage.buckets_vectors TO anon;


--
-- Name: TABLE iceberg_namespaces; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.iceberg_namespaces TO service_role;
GRANT SELECT ON TABLE storage.iceberg_namespaces TO authenticated;
GRANT SELECT ON TABLE storage.iceberg_namespaces TO anon;


--
-- Name: TABLE iceberg_tables; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.iceberg_tables TO service_role;
GRANT SELECT ON TABLE storage.iceberg_tables TO authenticated;
GRANT SELECT ON TABLE storage.iceberg_tables TO anon;


--
-- Name: TABLE objects; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.objects TO anon;
GRANT ALL ON TABLE storage.objects TO authenticated;
GRANT ALL ON TABLE storage.objects TO service_role;
GRANT ALL ON TABLE storage.objects TO postgres WITH GRANT OPTION;


--
-- Name: TABLE s3_multipart_uploads; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO anon;


--
-- Name: TABLE s3_multipart_uploads_parts; Type: ACL; Schema: storage; Owner: -
--

GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO anon;


--
-- Name: TABLE vector_indexes; Type: ACL; Schema: storage; Owner: -
--

GRANT SELECT ON TABLE storage.vector_indexes TO service_role;
GRANT SELECT ON TABLE storage.vector_indexes TO authenticated;
GRANT SELECT ON TABLE storage.vector_indexes TO anon;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES  TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS  TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES  TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: storage; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: storage; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS  TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: storage; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES  TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES  TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES  TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES  TO service_role;


--
-- PostgreSQL database dump complete
--


--
-- PostgreSQL database dump
--

-- Dumped from database version 15.8
-- Dumped by pg_dump version 15.8

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.schema_migrations (version) FROM stdin;
20171026211738
20171026211808
20171026211834
20180103212743
20180108183307
20180119214651
20180125194653
00
20210710035447
20210722035447
20210730183235
20210909172000
20210927181326
20211122151130
20211124214934
20211202183645
20220114185221
20220114185340
20220224000811
20220323170000
20220429102000
20220531120530
20220614074223
20220811173540
20221003041349
20221003041400
20221011041400
20221020193600
20221021073300
20221021082433
20221027105023
20221114143122
20221114143410
20221125140132
20221208132122
20221215195500
20221215195800
20221215195900
20230116124310
20230116124412
20230131181311
20230322519590
20230402418590
20230411005111
20230508135423
20230523124323
20230818113222
20230914180801
20231027141322
20231114161723
20231117164230
20240115144230
20240214120130
20240306115329
20240314092811
20240427152123
20240612123726
20240729123726
20240802193726
20240806073726
20241009103726
20250717082212
20250731150234
20250804100000
20250901200500
20250903112500
20250904133000
20250925093508
20251007112900
20251104100000
20251111201300
20251201000000
20260115000000
20260121000000
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: storage; Owner: -
--

COPY storage.migrations (id, name, hash, executed_at) FROM stdin;
0	create-migrations-table	e18db593bcde2aca2a408c4d1100f6abba2195df	2026-09-11 03:42:14.303904
1	initialmigration	6ab16121fbaa08bbd11b712d05f358f9b555d777	2026-09-11 03:42:14.321744
2	storage-schema	f6a1fa2c93cbcd16d4e487b362e45fca157a8dbd	2026-09-11 03:42:14.331798
3	pathtoken-column	2cb1b0004b817b29d5b0a971af16bafeede4b70d	2026-09-11 03:42:14.362601
4	add-migrations-rls	427c5b63fe1c5937495d9c635c263ee7a5905058	2026-09-11 03:42:14.428243
5	add-size-functions	79e081a1455b63666c1294a440f8ad4b1e6a7f84	2026-09-11 03:42:14.434984
6	change-column-name-in-get-size	ded78e2f1b5d7e616117897e6443a925965b30d2	2026-09-11 03:42:14.443405
7	add-rls-to-buckets	e7e7f86adbc51049f341dfe8d30256c1abca17aa	2026-09-11 03:42:14.451952
8	add-public-to-buckets	fd670db39ed65f9d08b01db09d6202503ca2bab3	2026-09-11 03:42:14.465191
9	fix-search-function	af597a1b590c70519b464a4ab3be54490712796b	2026-09-11 03:42:14.468395
10	search-files-search-function	b595f05e92f7e91211af1bbfe9c6a13bb3391e16	2026-09-11 03:42:14.4764
11	add-trigger-to-auto-update-updated_at-column	7425bdb14366d1739fa8a18c83100636d74dcaa2	2026-09-11 03:42:14.490259
12	add-automatic-avif-detection-flag	8e92e1266eb29518b6a4c5313ab8f29dd0d08df9	2026-09-11 03:42:14.509243
13	add-bucket-custom-limits	cce962054138135cd9a8c4bcd531598684b25e7d	2026-09-11 03:42:14.523948
14	use-bytes-for-max-size	941c41b346f9802b411f06f30e972ad4744dad27	2026-09-11 03:42:14.538798
15	add-can-insert-object-function	934146bc38ead475f4ef4b555c524ee5d66799e5	2026-09-11 03:42:14.648804
16	add-version	76debf38d3fd07dcfc747ca49096457d95b1221b	2026-09-11 03:42:14.661227
17	drop-owner-foreign-key	f1cbb288f1b7a4c1eb8c38504b80ae2a0153d101	2026-09-11 03:42:14.6667
18	add_owner_id_column_deprecate_owner	e7a511b379110b08e2f214be852c35414749fe66	2026-09-11 03:42:14.681716
19	alter-default-value-objects-id	02e5e22a78626187e00d173dc45f58fa66a4f043	2026-09-11 03:42:14.689713
20	list-objects-with-delimiter	cd694ae708e51ba82bf012bba00caf4f3b6393b7	2026-09-11 03:42:14.696972
21	s3-multipart-uploads	8c804d4a566c40cd1e4cc5b3725a664a9303657f	2026-09-11 03:42:14.722111
22	s3-multipart-uploads-big-ints	9737dc258d2397953c9953d9b86920b8be0cdb73	2026-09-11 03:42:14.796843
23	optimize-search-function	9d7e604cddc4b56a5422dc68c9313f4a1b6f132c	2026-09-11 03:42:14.847253
24	operation-function	8312e37c2bf9e76bbe841aa5fda889206d2bf8aa	2026-09-11 03:42:14.859464
25	custom-metadata	d974c6057c3db1c1f847afa0e291e6165693b990	2026-09-11 03:42:14.87617
26	objects-prefixes	215cabcb7f78121892a5a2037a09fedf9a1ae322	2026-09-11 03:42:14.883354
27	search-v2	859ba38092ac96eb3964d83bf53ccc0b141663a6	2026-09-11 03:42:14.887762
28	object-bucket-name-sorting	c73a2b5b5d4041e39705814fd3a1b95502d38ce4	2026-09-11 03:42:14.892467
29	create-prefixes	ad2c1207f76703d11a9f9007f821620017a66c21	2026-09-11 03:42:14.900453
30	update-object-levels	2be814ff05c8252fdfdc7cfb4b7f5c7e17f0bed6	2026-09-11 03:42:14.909598
31	objects-level-index	b40367c14c3440ec75f19bbce2d71e914ddd3da0	2026-09-11 03:42:14.923176
32	backward-compatible-index-on-objects	e0c37182b0f7aee3efd823298fb3c76f1042c0f7	2026-09-11 03:42:14.928401
33	backward-compatible-index-on-prefixes	b480e99ed951e0900f033ec4eb34b5bdcb4e3d49	2026-09-11 03:42:14.935526
34	optimize-search-function-v1	ca80a3dc7bfef894df17108785ce29a7fc8ee456	2026-09-11 03:42:14.938866
35	add-insert-trigger-prefixes	458fe0ffd07ec53f5e3ce9df51bfdf4861929ccc	2026-09-11 03:42:14.945402
36	optimise-existing-functions	6ae5fca6af5c55abe95369cd4f93985d1814ca8f	2026-09-11 03:42:14.952457
37	add-bucket-name-length-trigger	3944135b4e3e8b22d6d4cbb568fe3b0b51df15c1	2026-09-11 03:42:14.961476
38	iceberg-catalog-flag-on-buckets	02716b81ceec9705aed84aa1501657095b32e5c5	2026-09-11 03:42:14.977453
39	add-search-v2-sort-support	6706c5f2928846abee18461279799ad12b279b78	2026-09-11 03:42:15.121833
40	fix-prefix-race-conditions-optimized	7ad69982ae2d372b21f48fc4829ae9752c518f6b	2026-09-11 03:42:15.133099
41	add-object-level-update-trigger	07fcf1a22165849b7a029deed059ffcde08d1ae0	2026-09-11 03:42:15.143719
42	rollback-prefix-triggers	771479077764adc09e2ea2043eb627503c034cd4	2026-09-11 03:42:15.155245
43	fix-object-level	84b35d6caca9d937478ad8a797491f38b8c2979f	2026-09-11 03:42:15.163228
44	vector-bucket-type	99c20c0ffd52bb1ff1f32fb992f3b351e3ef8fb3	2026-09-11 03:42:15.168707
45	vector-buckets	049e27196d77a7cb76497a85afae669d8b230953	2026-09-11 03:42:15.17697
46	buckets-objects-grants	fedeb96d60fefd8e02ab3ded9fbde05632f84aed	2026-09-11 03:42:15.323772
47	iceberg-table-metadata	649df56855c24d8b36dd4cc1aeb8251aa9ad42c2	2026-09-11 03:42:15.345235
48	iceberg-catalog-ids	e0e8b460c609b9999ccd0df9ad14294613eed939	2026-09-11 03:42:15.363923
49	buckets-objects-grants-postgres	072b1195d0d5a2f888af6b2302a1938dd94b8b3d	2026-09-11 03:42:15.488344
50	search-v2-optimised	6323ac4f850aa14e7387eb32102869578b5bd478	2026-09-11 03:42:15.505762
51	index-backward-compatible-search	2ee395d433f76e38bcd3856debaf6e0e5b674011	2026-09-11 03:42:15.563197
52	drop-not-used-indexes-and-functions	5cc44c8696749ac11dd0dc37f2a3802075f3a171	2026-09-11 03:42:15.568699
53	drop-index-lower-name	d0cb18777d9e2a98ebe0bc5cc7a42e57ebe41854	2026-09-11 03:42:15.593916
54	drop-index-object-level	6289e048b1472da17c31a7eba1ded625a6457e67	2026-09-11 03:42:15.601237
55	prevent-direct-deletes	262a4798d5e0f2e7c8970232e03ce8be695d5819	2026-09-11 03:42:15.609092
56	fix-optimized-search-function	cb58526ebc23048049fd5bf2fd148d18b04a2073	2026-09-11 03:42:15.627862
57	s3-multipart-uploads-metadata	f127886e00d1b374fadbc7c6b31e09336aad5287	2026-09-11 03:42:15.644711
58	operation-ergonomics	00ca5d483b3fe0d522133d9002ccc5df98365120	2026-09-11 03:42:15.651989
\.


--
-- PostgreSQL database dump complete
--

