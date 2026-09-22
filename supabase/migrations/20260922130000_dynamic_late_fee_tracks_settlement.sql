-- Bug: pay_installment pula o recálculo dinâmico de juros+multa de atraso
-- (e confia cegamente no `late_fee` já gravado) para QUALQUER parcela de
-- contrato loan_mode IN ('percentage','interest_only') — mesmo quando essa
-- parcela específica nunca passou por settle_percentage_installment e seu
-- `amount` nunca foi inflado. A guarda deveria proteger só o caso em que
-- `amount` está de fato inflado (capital+juros), não o tipo de contrato
-- inteiro.
--
-- Consequência prática: nesses contratos, o cliente vê na tela (Cobrancas,
-- ClienteDetalhe, portal — tudo via src/lib/lateFee.ts) o juros composto
-- diário + a multa configurada, somados. O servidor, na hora de cobrar,
-- ignora esse cálculo e usa só o `late_fee` gravado — que, quando a multa é
-- diária/fixa, o job auto-late-fees mantinha (antes da correção em
-- 20260922100000... não, na correção do auto-late-fees/index.ts) SEM somar
-- o juros composto, um valor bem menor. Um pagamento parcial que deveria
-- deixar saldo pendente acaba cobrindo o (baixo) total_due do servidor e
-- fecha a parcela como paga, mesmo a tela tendo mostrado um valor bem maior
-- como devido.
--
-- Fix: a guarda agora usa `inst.pre_settlement_snapshot IS NULL` (a coluna
-- criada em 20260922100000) em vez do loan_mode. Só quando esta parcela
-- específica está com o amount inflado por uma quitação de capital+juros
-- ainda não revertida é que o recálculo dinâmico é pulado — em todo o
-- resto, inclusive parcelas normais de contratos por porcentagem/só-juros,
-- o servidor calcula exatamente a mesma fórmula que a tela mostra.

CREATE OR REPLACE FUNCTION public.pay_installment(
  _installment_id uuid,
  _paid_total numeric,
  _mark_paid boolean DEFAULT true,
  _method text DEFAULT 'pix',
  _receipt_url text DEFAULT NULL,
  _source_key text DEFAULT NULL,
  _fee_discount numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  fee_target numeric;
  interest_target numeric;
  principal_target numeric;
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
  IF inst.status = 'cancelled' THEN RAISE EXCEPTION 'installment_closed'; END IF;

  base_amount := greatest(0, coalesce(inst.amount, 0));
  stored_late_fee := greatest(0, coalesce(inst.late_fee, 0));
  calculated_late_fee := 0;
  days_late := greatest(0, current_date - inst.due_date::date);

  -- Só pula o recálculo dinâmico quando ESTA parcela está com o amount
  -- inflado por uma quitação de capital+juros ainda ativa (settle_percentage_
  -- installment gravou um snapshot e ainda não foi revertida). Fora isso —
  -- inclusive parcelas normais, nunca quitadas, de contratos por
  -- porcentagem/só-juros — a mesma fórmula da tela vale aqui.
  IF inst.status NOT IN ('paid', 'cancelled') AND base_amount > 0 AND days_late > 0
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
  effective_late_fee := round(effective_late_fee - applied_fee_discount, 2);

  total_due := round(base_amount + effective_late_fee, 2);
  old_paid := round(greatest(0, coalesce(inst.paid_amount, 0)), 2);

  IF NULLIF(trim(_source_key), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transactions
    WHERE user_id = uid AND source_key = trim(_source_key)
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'installment_id', inst.id,
      'paid_total', old_paid, 'status', inst.status);
  END IF;

  IF inst.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'installment_id', inst.id,
      'paid_total', old_paid, 'status', inst.status);
  END IF;

  IF _mark_paid AND COALESCE(_paid_total, 0) + 0.005 < total_due THEN
    RAISE EXCEPTION 'payment_below_installment_balance';
  END IF;

  new_paid := round(least(total_due, greatest(old_paid, COALESCE(_paid_total, 0))), 2);
  received := round(greatest(0, new_paid - old_paid), 2);
  IF received <= 0 THEN RAISE EXCEPTION 'payment_below_installment_balance'; END IF;

  fee_target := round(least(new_paid, effective_late_fee), 2);
  interest_target := round(least(
    greatest(0, new_paid - fee_target),
    greatest(0, coalesce(inst.scheduled_interest, inst.amount, 0))
  ), 2);
  principal_target := round(greatest(0, new_paid - fee_target - interest_target), 2);

  old_fee := round(greatest(0, coalesce(inst.paid_fees, 0)), 2);
  old_interest := round(greatest(0, coalesce(inst.paid_interest, 0)), 2);
  old_principal := round(greatest(0, coalesce(inst.paid_principal, 0)), 2);
  fee_delta := round(greatest(0, fee_target - old_fee), 2);
  interest_delta := round(greatest(0, interest_target - old_interest), 2);
  principal_delta := round(greatest(0, principal_target - old_principal), 2);

  next_status := CASE
    WHEN _mark_paid OR new_paid + 0.005 >= total_due THEN 'paid'
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
    installment_id, principal_amount, interest_amount, fee_amount, source_key
  ) VALUES (
    uid, received, 'payment', 'loan_payment',
    CASE WHEN next_status = 'paid' THEN 'Pagamento da parcela #' ELSE 'Pagamento parcial da parcela #' END
      || COALESCE(inst.installment_number::text, '-'),
    inst.client_id, inst.contract_id, inst.id,
    principal_delta, interest_delta, fee_delta, NULLIF(trim(_source_key), '')
  );

  IF interest_delta + fee_delta > 0 THEN
    INSERT INTO public.profits (user_id, amount, description, client_id, installment_id)
    VALUES (uid, interest_delta + fee_delta,
      'Juros e encargos da parcela #' || COALESCE(inst.installment_number::text, '-'),
      inst.client_id, inst.id);
  END IF;

  IF next_status = 'paid' AND NOT EXISTS (
    SELECT 1 FROM public.contract_installments
    WHERE contract_id = inst.contract_id AND user_id = uid
      AND status NOT IN ('paid', 'cancelled')
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
    'status', next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_installment(uuid, numeric, boolean, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_installment(uuid, numeric, boolean, text, text, text, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
