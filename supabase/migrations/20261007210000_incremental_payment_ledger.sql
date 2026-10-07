-- Registra somente dinheiro novo, sem reclassificar recebimentos históricos.
-- A migração altera estrutura/funções; não baixa parcelas nem refaz o razão.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS unallocated_amount numeric NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_profit_installment ON public.profits(installment_id) WHERE installment_id IS NOT NULL;
COMMENT ON COLUMN public.transactions.unallocated_amount IS 'Recebimento preservado no caixa cuja classificação em capital/juros/encargos exige conciliação humana.';

CREATE OR REPLACE FUNCTION public.allocate_installment_receipt(
 _received numeric, _old_paid numeric, _old_principal numeric,
 _old_interest numeric, _old_fees numeric, _base numeric,
 _fees numeric, _scheduled_interest numeric
) RETURNS TABLE(principal_amount numeric, interest_amount numeric,
 fee_amount numeric, unallocated_amount numeric, review_required boolean)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $allocation$
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
$allocation$;
REVOKE ALL ON FUNCTION public.allocate_installment_receipt(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;
-- O recebimento por cobrador é uma função de postgres; o helper deve ser
-- executável pelo seu dono, sem concedê-lo aos papéis de usuário do app.
ALTER FUNCTION public.allocate_installment_receipt(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.pay_installment(_installment_id uuid, _paid_total numeric, _mark_paid boolean DEFAULT true, _method text DEFAULT 'pix'::text, _receipt_url text DEFAULT NULL::text, _source_key text DEFAULT NULL::text, _fee_discount numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  inst public.contract_installments%ROWTYPE;
  contract_row public.contracts%ROWTYPE;
  total_due numeric;
  old_paid numeric;
  new_paid numeric;
  received numeric;
  stored_late_fee numeric;
  calculated_late_fee numeric;
  effective_late_fee numeric;
  applied_fee_discount numeric;
  base_amount numeric;
  daily_rate numeric;
  penalty_value numeric;
  penalty_amount numeric;
  cap_percent numeric;
  cap_amount numeric;
  days_late integer;
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
  WHERE id = inst.contract_id AND user_id = uid
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
  stored_late_fee := greatest(0, coalesce(inst.late_fee, 0));
  calculated_late_fee := 0;
  days_late := greatest(0, current_date - inst.due_date::date);
  -- Só pula o recálculo dinâmico quando ESTA parcela está com o amount
  -- inflado por uma quitação de capital+juros ainda ativa (settle_percentage_
  -- installment gravou um snapshot e ainda não foi revertida). Fora isso —
  -- inclusive parcelas normais, nunca quitadas, de contratos por
  -- porcentagem/só-juros — a mesma fórmula da tela vale aqui.
  IF inst.status IS DISTINCT FROM 'paid' AND inst.status IS DISTINCT FROM 'cancelled' AND base_amount > 0 AND days_late > 0
     AND inst.pre_settlement_snapshot IS NULL THEN
    daily_rate := greatest(0, coalesce(nullif(contract_row.daily_interest_percent, 0), 4));
    penalty_value := greatest(0, coalesce(contract_row.daily_penalty_value, 0));
    penalty_amount := CASE
      WHEN coalesce(contract_row.daily_penalty_type, 'percentage') = 'fixed'
        THEN penalty_value * days_late
      ELSE base_amount * (penalty_value / 100) * days_late
    END;
    calculated_late_fee := round((
      base_amount * (power(1 + daily_rate / 100, days_late) - 1)
      + penalty_amount
    )::numeric, 2);
    cap_percent := greatest(0, coalesce(contract_row.max_interest_cap_percent, 0));
    IF cap_percent > 0 THEN
      cap_amount := round((base_amount * cap_percent / 100)::numeric, 2);
      calculated_late_fee := least(calculated_late_fee, cap_amount);
    END IF;
  END IF;
  effective_late_fee := greatest(stored_late_fee, calculated_late_fee);
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
 SET search_path TO 'public'
AS $function$
DECLARE
  _tok public.collector_tokens%rowtype; _collector public.collectors%rowtype;
  _inst public.contract_installments%rowtype; _prev numeric; _new numeric;
  _allocation record;
  _new_principal numeric; _new_interest numeric; _new_fees numeric; _remaining integer;
  _daily_rate numeric; _cap_percent numeric; _days_late integer;
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
  SELECT greatest(0, coalesce(nullif(c.daily_interest_percent, 0), 4)), c.max_interest_cap_percent,
    c.daily_penalty_type, greatest(0, coalesce(c.daily_penalty_value, 0)), c.status
    INTO _daily_rate, _cap_percent, _penalty_type, _penalty_value, _contract_status
  FROM public.contracts c
  WHERE c.id = _inst.contract_id AND c.user_id = _tok.user_id AND c.client_id = _inst.client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrato_nao_encontrado'; END IF;
  IF _contract_status = 'cancelled' THEN RAISE EXCEPTION 'contrato_cancelado'; END IF;
  _days_late := greatest(0, current_date - _inst.due_date::date);
  _live_fee := 0;
  IF _inst.pre_settlement_snapshot IS NULL AND _days_late > 0 THEN
    _live_fee := round((greatest(0, _inst.amount) * (power(1 + (_daily_rate / 100), _days_late) - 1)
      + CASE WHEN _penalty_type = 'fixed' THEN _penalty_value * _days_late
        ELSE greatest(0, _inst.amount) * _penalty_value / 100 * _days_late END)::numeric, 2);
    IF _cap_percent IS NOT NULL AND _cap_percent > 0 THEN
      _live_fee := least(_live_fee, round((greatest(0, _inst.amount) * _cap_percent / 100)::numeric, 2));
    END IF;
  END IF;
  _live_fee := greatest(_live_fee, greatest(0, coalesce(_inst.late_fee, 0)));
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

-- Consulta por dono; não concilia nem modifica nenhum recebimento.
CREATE OR REPLACE FUNCTION public.payment_allocation_review()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $review$
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
$review$;
REVOKE ALL ON FUNCTION public.payment_allocation_review() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.payment_allocation_review() TO authenticated;
ALTER FUNCTION public.payment_allocation_review() OWNER TO postgres;
NOTIFY pgrst, 'reload schema';
COMMIT;
