-- Keep interest-only renewals aligned with the saved per-installment interest.
-- This matters for Price and grace contracts, whose interest varies by period.
CREATE OR REPLACE FUNCTION public.renew_installment_interest(
  _installment_id uuid,
  _next_due_date date,
  _method text DEFAULT 'pix',
  _origin text DEFAULT NULL,
  _receipt_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
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

REVOKE ALL ON FUNCTION public.renew_installment_interest(uuid, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_installment_interest(uuid, date, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
