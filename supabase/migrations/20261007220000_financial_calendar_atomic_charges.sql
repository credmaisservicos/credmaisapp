-- Keep global UTC and historical dates/cash unchanged. Only financial routines
-- use Brazil's civil day, including the conversion of date inputs to timestamps.
BEGIN;
DO $calendar$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
      'pay_installment', 'collector_register_payment', 'reverse_installment_payment',
      'renew_installment_interest', 'settle_percentage_installment',
      'sync_paid_installment_status', 'confirm_whatsapp_receipt',
      'cancel_scheduled_charges_after_installment_change')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET TimeZone TO %L', f.signature, 'America/Sao_Paulo');
  END LOOP;
END;
$calendar$;

-- PostgreSQL treats numeric NaN as greater than ordinary numbers. Reject new
-- nonfinite balances before the status trigger can turn them into a receipt.
CREATE OR REPLACE FUNCTION public.sync_paid_installment_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
SET TimeZone = 'America/Sao_Paulo'
AS $status$
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
$status$;
REVOKE ALL ON FUNCTION public.sync_paid_installment_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.quote_installment_late_fee(
  _amount numeric, _due_date timestamptz, _status text, _stored numeric,
  _snapshot jsonb, _rate numeric, _penalty_type text, _penalty_value numeric,
  _cap numeric, _at timestamptz DEFAULT now()
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $quote$
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
$quote$;
ALTER FUNCTION public.quote_installment_late_fee(numeric,timestamptz,text,numeric,jsonb,numeric,text,numeric,numeric,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.quote_installment_late_fee(numeric,timestamptz,text,numeric,jsonb,numeric,text,numeric,numeric,timestamptz)
  FROM PUBLIC, anon, authenticated;

-- Covering the original amount cannot cancel charges while fees remain.
-- Generic service follow-ups and other tenants' messages are preserved.
CREATE OR REPLACE FUNCTION public.cancel_scheduled_charges_after_installment_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET TimeZone = 'America/Sao_Paulo'
AS $cancel$
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
$cancel$;
ALTER FUNCTION public.cancel_scheduled_charges_after_installment_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cancel_scheduled_charges_after_installment_change()
  FROM PUBLIC, anon, authenticated;

-- Ordered batches lock the installment and its contract before calculating.
-- Concurrent receipts or configuration changes cannot be overwritten.
CREATE OR REPLACE FUNCTION public.refresh_installment_charges(
  _after_id uuid DEFAULT NULL, _limit integer DEFAULT 250
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
SET TimeZone = 'America/Sao_Paulo'
AS $refresh$
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
$refresh$;
ALTER FUNCTION public.refresh_installment_charges(uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.refresh_installment_charges(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_installment_charges(uuid,integer) TO service_role;
-- Payment paths use the same SQL quote, preserving receipt allocation and discounts.
CREATE OR REPLACE FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean DEFAULT true, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text, _source_key text DEFAULT NULL::text, _fee_discount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET TimeZone TO 'America/Sao_Paulo'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text DEFAULT 'dinheiro'::text, _receipt_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET TimeZone TO 'America/Sao_Paulo'
AS $function$
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
$function$;
NOTIFY pgrst, 'reload schema';
COMMIT;
