-- Operações financeiras executadas pelo webhook/cron com a service role.
-- Esses wrappers preservam o isolamento por user_id e delegam a regra de
-- distribuição/baixa para as RPCs transacionais do app.

DROP FUNCTION IF EXISTS public.system_register_payment(uuid, numeric, text, text, text, text);
CREATE OR REPLACE FUNCTION public.system_register_payment(
  _installment_id uuid,
  _paid_total numeric,
  _method text DEFAULT 'pix',
  _origem text DEFAULT NULL,
  _receipt_url text DEFAULT NULL,
  _source_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT user_id INTO owner_id
  FROM public.contract_installments
  WHERE id = _installment_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'installment_not_found'; END IF;

  -- pay_installment valida auth.uid(); o webhook usa service_role, então
  -- definimos o proprietário derivado da própria parcela dentro da transação.
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  RETURN public.pay_installment(
    _installment_id, _paid_total, true, _method, _receipt_url,
    _source_key
  );
END;
$$;

DROP FUNCTION IF EXISTS public.system_pay_client_balance(uuid, numeric, text, text, text, text);
CREATE OR REPLACE FUNCTION public.system_pay_client_balance(
  _client_id uuid,
  _amount numeric,
  _method text DEFAULT 'pix',
  _receipt_url text DEFAULT NULL,
  _origin text DEFAULT NULL,
  _source_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  inst public.contract_installments%ROWTYPE;
  remaining numeric := round(greatest(0, coalesce(_amount, 0)), 2);
  balance numeric;
  allocation numeric;
  paid_count integer := 0;
  partial_count integer := 0;
  allocations jsonb := '[]'::jsonb;
  payment jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF _client_id IS NULL OR remaining <= 0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;

  SELECT user_id INTO owner_id
  FROM public.clients
  WHERE id = _client_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  FOR inst IN
    SELECT ci.*
    FROM public.contract_installments ci
    JOIN public.contracts c ON c.id = ci.contract_id AND c.user_id = ci.user_id
    WHERE ci.user_id = owner_id
      AND ci.client_id = _client_id
      AND ci.status NOT IN ('paid', 'cancelled')
      AND c.status IN ('active', 'overdue')
    ORDER BY ci.due_date NULLS FIRST, ci.installment_number NULLS FIRST, ci.id
    FOR UPDATE OF ci
  LOOP
    EXIT WHEN remaining <= 0;
    balance := round(greatest(0, coalesce(inst.amount, 0))
      + greatest(0, coalesce(inst.late_fee, 0))
      - greatest(0, coalesce(inst.paid_amount, 0)), 2);
    IF balance <= 0 THEN CONTINUE; END IF;

    allocation := round(least(remaining, balance), 2);
    payment := public.pay_installment(
      inst.id,
      round(greatest(0, coalesce(inst.paid_amount, 0)) + allocation, 2),
      allocation + 0.005 >= balance,
      _method,
      _receipt_url,
      CASE WHEN NULLIF(trim(_source_key), '') IS NULL THEN NULL
        ELSE trim(_source_key) || ':' || inst.id::text END
    );

    remaining := round(remaining - allocation, 2);
    IF (payment->>'status') = 'paid' THEN paid_count := paid_count + 1;
    ELSE partial_count := partial_count + 1;
    END IF;
    allocations := allocations || jsonb_build_array(jsonb_build_object(
      'installment_id', inst.id,
      'installment_number', inst.installment_number,
      'amount', allocation,
      'paid', (payment->>'status') = 'paid'
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'paid_installments', paid_count,
    'partial_installments', partial_count,
    'unallocated', remaining,
    'allocations', allocations,
    'origin', _origin
  );
END;
$$;

DROP FUNCTION IF EXISTS public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text);
CREATE OR REPLACE FUNCTION public.system_renew_installment_interest(
  _installment_id uuid,
  _amount numeric,
  _next_due_date timestamptz,
  _origin text DEFAULT NULL,
  _source_key text DEFAULT NULL,
  _method text DEFAULT 'pix'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  result jsonb;
  tx_id uuid;
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

REVOKE ALL ON FUNCTION public.system_register_payment(uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_pay_client_balance(uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_register_payment(uuid, numeric, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_pay_client_balance(uuid, numeric, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
