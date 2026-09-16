-- Atomic, tenant-scoped mutations used by the client and contract screens.
-- This migration only creates functions; it does not touch existing rows.

DROP FUNCTION IF EXISTS public.update_contract_atomically(uuid, jsonb, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.update_contract_atomically(
  _contract_id uuid,
  _contract jsonb,
  _regenerate boolean DEFAULT false,
  _installments jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP FUNCTION IF EXISTS public.delete_contract_atomically(uuid);
CREATE OR REPLACE FUNCTION public.delete_contract_atomically(_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Remove dependent records first, keeping the operation atomic.
  DELETE FROM public.client_notifications
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.collection_attempts
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.profits
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.transactions
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.loan_collateral
  WHERE user_id = uid AND contract_id = _contract_id;
  DELETE FROM public.contract_installments
  WHERE user_id = uid AND contract_id = _contract_id;
  DELETE FROM public.contracts
  WHERE user_id = uid AND id = _contract_id;
END;
$$;

DROP FUNCTION IF EXISTS public.delete_client_cascade(uuid);
CREATE OR REPLACE FUNCTION public.delete_client_cascade(_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.update_contract_atomically(uuid, jsonb, boolean, jsonb),
  public.delete_contract_atomically(uuid), public.delete_client_cascade(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_contract_atomically(uuid, jsonb, boolean, jsonb),
  public.delete_contract_atomically(uuid), public.delete_client_cascade(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
