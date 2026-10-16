CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('test.owner', true), '')::uuid
$$;

CREATE TABLE public.clients(
  id uuid PRIMARY KEY, user_id uuid, name text, email text, phone text, whatsapp text,
  cpf_cnpj text, birth_date date, client_type text, status text, avatar_url text, address jsonb
);
CREATE TABLE public.contracts(
  id uuid PRIMARY KEY, user_id uuid, client_id uuid, capital numeric, interest_rate numeric,
  num_installments integer, installment_amount numeric, frequency text, start_date timestamptz,
  late_fee_percent numeric, daily_interest_percent numeric, total_amount numeric, total_interest numeric,
  status text, notes text, loan_mode text, grace_periods integer, grace_days integer,
  payment_method text, auto_renew boolean, early_payment_discount_percent numeric,
  max_interest_cap_percent numeric, guarantee_type text, guarantee_description text,
  guarantor_name text, guarantor_cpf text, guarantor_phone text, attachments jsonb,
  investor_loan_id uuid, signature_status text, signature_token text
);
CREATE TABLE public.contract_installments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, contract_id uuid, client_id uuid,
  installment_number integer, amount numeric, due_date timestamptz, status text,
  scheduled_principal numeric NOT NULL DEFAULT 0, scheduled_interest numeric NOT NULL DEFAULT 0
);

-- Snapshot behavior before the schedule-components migration.
CREATE FUNCTION public.create_client_contract(_client_id uuid, _client jsonb, _contract jsonb, _installments jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  _cid uuid := coalesce(_client_id, gen_random_uuid());
  _contract_id uuid := gen_random_uuid();
  _count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _client_id IS NULL THEN
    INSERT INTO public.clients(id,user_id,name) VALUES(_cid,auth.uid(),nullif(btrim(_client->>'name'),''));
  END IF;
  INSERT INTO public.contracts(id,user_id,client_id,capital,num_installments,installment_amount)
  VALUES(_contract_id,auth.uid(),_cid,(_contract->>'capital')::numeric,(_contract->>'num_installments')::integer,(_contract->>'installment_amount')::numeric);
  INSERT INTO public.contract_installments(user_id,contract_id,client_id,installment_number,amount,due_date,status)
  SELECT auth.uid(),_contract_id,_cid,x.installment_number,x.amount,x.due_date,'pending'
  FROM jsonb_to_recordset(_installments) AS x(installment_number integer,amount numeric,due_date timestamptz);
  GET DIAGNOSTICS _count = ROW_COUNT;
  IF _count <> (_contract->>'num_installments')::integer THEN RAISE EXCEPTION 'installment_count_mismatch'; END IF;
  RETURN jsonb_build_object('client_id',_cid,'contract_id',_contract_id,'installment_count',_count);
END;
$$;
