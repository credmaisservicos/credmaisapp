BEGIN;
-- The selected installment and the operational forecast are written in the same
-- transaction as the audit. Existing rows and the one-open-per-client rule stay intact.
CREATE OR REPLACE FUNCTION public.materialize_payment_promise_from_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
COMMIT;
