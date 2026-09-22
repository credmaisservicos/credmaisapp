-- Bug: system_renew_installment_interest declara `_amount numeric` (o valor
-- verificado no comprovante PIX que o bot recebeu) mas NUNCA usa esse
-- parâmetro — ele só repassa a chamada para renew_installment_interest, que
-- recalcula o juros sozinho a partir do contrato e grava ESSE valor em
-- transactions/profits, ignorando silenciosamente o que foi de fato
-- recebido. Numa mudança de taxa no meio do ciclo, arredondamento, ou
-- qualquer divergência entre o comprovante e o cálculo do contrato, o caixa
-- registrado nunca bate com o dinheiro que realmente entrou — sem nenhum
-- alerta, porque a chamada "tem sucesso" normalmente.
--
-- Fix: não é seguro deixar o valor do comprovante (informado pelo cliente
-- via bot) sobrescrever o cálculo do servidor — isso reabriria a mesma
-- classe de problema que o checkout do Mercado Pago já evita de propósito
-- (nunca cobrar o valor que o cliente manda). Em vez disso, se o valor
-- verificado divergir do juros calculado pelo contrato além de uma
-- tolerância de arredondamento, a renovação falha alto (RAISE EXCEPTION,
-- desfazendo a transação inteira) em vez de silenciosamente gravar um
-- número que não bate com o caixa real — o bot então cai no fallback de
-- erro já existente (loga a falha e avisa o operador) em vez de fingir que
-- deu tudo certo.

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
  computed_amount numeric;
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

  -- O comprovante que o bot verificou precisa bater com o juros que o
  -- contrato realmente cobra nesta renovação. Diverge além de um centavo de
  -- arredondamento? Falha a transação inteira em vez de gravar um número
  -- que não corresponde ao dinheiro recebido.
  computed_amount := (result->>'amount')::numeric;
  IF _amount IS NOT NULL AND _amount > 0
     AND abs(computed_amount - _amount) > 0.01 THEN
    RAISE EXCEPTION 'renewal_amount_mismatch: contrato calcula %, comprovante informa %',
      computed_amount, _amount;
  END IF;

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

REVOKE ALL ON FUNCTION public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
