-- Registra no razÃ£o somente emprÃ©stimos criados daqui para frente.
-- Deliberadamente nÃ£o existe backfill: nenhum contrato ou saldo antigo Ã© alterado.

CREATE OR REPLACE FUNCTION public.record_contract_disbursement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cash numeric;
BEGIN
  -- RenegociaÃ§Ã£o carrega saldo anterior, mas sÃ³ o capital adicional Ã© uma
  -- nova saÃ­da de caixa. O marcador Ã© produzido pelo fluxo atÃ´mico do app.
  _cash := CASE
    WHEN coalesce(NEW.notes, '') LIKE 'RenegociaÃ§Ã£o do contrato%'
      THEN coalesce(
        nullif(substring(NEW.notes from '\[cash_disbursed:([0-9]+(\.[0-9]+)?)\]'), '')::numeric,
        0
      )
    ELSE round(coalesce(NEW.capital, 0)::numeric, 2)
  END;

  IF _cash <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.transactions
    (user_id, type, category, description, amount, date, contract_id, client_id, source_key)
  VALUES
    (NEW.user_id, 'loan_disbursement', 'loan_disbursement', 'EmprÃ©stimo liberado',
     round(_cash, 2), coalesce(NEW.created_at, now()), NEW.id, NEW.client_id,
     'loan-disbursement:' || NEW.id::text)
  ON CONFLICT (user_id, source_key) WHERE source_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_contract_disbursement ON public.contracts;
CREATE TRIGGER trg_record_contract_disbursement
AFTER INSERT ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.record_contract_disbursement();

COMMENT ON FUNCTION public.record_contract_disbursement() IS
  'Registra a saÃ­da de caixa de contratos novos sem modificar o histÃ³rico anterior.';


