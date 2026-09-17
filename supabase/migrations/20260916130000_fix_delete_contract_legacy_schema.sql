-- Some self-hosted installations have legacy child tables without contract_id.
-- Keep contract deletion atomic while checking the actual columns at runtime.
DROP FUNCTION IF EXISTS public.delete_contract_atomically(uuid);

CREATE FUNCTION public.delete_contract_atomically(_contract_id uuid)
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
$$;

REVOKE ALL ON FUNCTION public.delete_contract_atomically(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_contract_atomically(uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
