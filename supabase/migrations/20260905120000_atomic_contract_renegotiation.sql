-- Dados prÃ³prios da renegociaÃ§Ã£o, substituindo o marcador persistente em notes.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS origin_contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renegotiated_balance numeric,
  ADD COLUMN IF NOT EXISTS new_cash_disbursed numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renegotiation_reason text,
  ADD COLUMN IF NOT EXISTS renegotiated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_contracts_origin_contract ON public.contracts(origin_contract_id);

-- A criaÃ§Ã£o transitÃ³ria ainda usa o marcador para ser compatÃ­vel com o gatilho
-- financeiro existente. Nesta RPC ele Ã© removido antes do commit, e os campos
-- prÃ³prios tornam-se a fonte de verdade do contrato salvo.
CREATE OR REPLACE FUNCTION public.renegotiate_contract_atomically(
  _old_contract_id uuid,
  _contract jsonb,
  _installments jsonb,
  _new_cash_disbursed numeric DEFAULT 0,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.renegotiate_contract_atomically(uuid, jsonb, jsonb, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renegotiate_contract_atomically(uuid, jsonb, jsonb, numeric, text) TO authenticated;

