BEGIN;

CREATE OR REPLACE FUNCTION public.create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb) RETURNS jsonb
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
    (user_id, contract_id, client_id, installment_number, amount, due_date, status,
     scheduled_principal, scheduled_interest)
  SELECT auth.uid(), _contract_id, _cid, x.installment_number, x.amount, x.due_date, 'pending',
         coalesce(x.scheduled_principal, 0), coalesce(x.scheduled_interest, 0)
  FROM jsonb_to_recordset(_installments) AS x(
    installment_number integer,
    amount numeric,
    due_date timestamptz,
    scheduled_principal numeric,
    scheduled_interest numeric
  );

  GET DIAGNOSTICS _count = ROW_COUNT;
  IF _count <> (_contract->>'num_installments')::integer THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  RETURN jsonb_build_object('client_id', _cid, 'contract_id', _contract_id, 'installment_count', _count);
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
