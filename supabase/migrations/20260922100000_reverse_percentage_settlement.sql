-- Bug: settle_percentage_installment ("Quitar capital + juros", usado em
-- contratos loan_mode='percentage'/'interest_only") reescreve
-- contract_installments.amount de "juros do ciclo" para "capital + juros",
-- e também sobrescreve scheduled_principal/scheduled_interest — mas
-- reverse_installment_payment (o estorno) nunca desfazia isso: só zerava
-- paid_amount/paid_fees/paid_interest/paid_principal/paid_at/status.
--
-- Consequência: depois de quitar e estornar um contrato por porcentagem/só
-- juros, a parcela reaberta fica com `amount` permanentemente inflado em
-- capital+juros. Daí em diante:
--   1. auto-late-fees calcula juros composto diário sobre essa base inflada
--      (capital inteiro, não mais o ciclo periódico) todo santo dia — a
--      multa dispara.
--   2. Se a parcela for quitada de novo, settle_percentage_installment lê
--      `_interest := inst.amount` (já capital+juros) e soma `contract.capital`
--      de novo por cima — dobra o principal cobrado.
--
-- Fix: settle_percentage_installment agora guarda o estado anterior em
-- `pre_settlement_snapshot` antes de reescrever a parcela. reverse_installment_payment
-- restaura amount/scheduled_principal/scheduled_interest desse snapshot
-- quando ele existir, e limpa a coluna depois — tornando o estorno seguro
-- para reaplicar quitação/estorno quantas vezes for preciso.

ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS pre_settlement_snapshot jsonb;

-- ── settle_percentage_installment ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_percentage_installment(
  _installment_id uuid,
  _method text DEFAULT 'pix',
  _receipt_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  _inst public.contract_installments%rowtype;
  _contract public.contracts%rowtype;
  _principal numeric;
  _interest numeric;
  _total numeric;
BEGIN
  SELECT * INTO _inst FROM public.contract_installments WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL OR _inst.user_id <> auth.uid() THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  IF _inst.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'installment_closed'; END IF;
  SELECT * INTO _contract FROM public.contracts WHERE id = _inst.contract_id AND user_id = auth.uid();
  IF _contract.id IS NULL THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF _contract.loan_mode NOT IN ('percentage', 'interest_only') THEN RAISE EXCEPTION 'not_renewable_contract'; END IF;

  _principal := greatest(0, coalesce(_contract.capital, 0));
  _interest := greatest(0, coalesce(_inst.amount, 0));
  _total := round((_principal + _interest + greatest(0, coalesce(_inst.late_fee, 0)))::numeric, 2);
  IF _total <= 0 THEN RAISE EXCEPTION 'invalid_settlement_amount'; END IF;

  UPDATE public.contract_installments
  SET amount = round((_principal + _interest)::numeric, 2),
      scheduled_principal = _principal,
      scheduled_interest = _interest,
      -- Só grava um snapshot novo se não houver um pendente: evita perder o
      -- estado ORIGINAL caso, por algum motivo, esta parcela seja "quitada"
      -- mais de uma vez sem um estorno completo entre as chamadas.
      pre_settlement_snapshot = COALESCE(_inst.pre_settlement_snapshot, jsonb_build_object(
        'amount', _inst.amount,
        'scheduled_principal', _inst.scheduled_principal,
        'scheduled_interest', _inst.scheduled_interest
      ))
  WHERE id = _inst.id;

  RETURN public.pay_installment(_installment_id, _total, true, _method, _receipt_url);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_percentage_installment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_percentage_installment(uuid, text, text) TO authenticated;

-- ── reverse_installment_payment ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reverse_installment_payment(uuid);
CREATE OR REPLACE FUNCTION public.reverse_installment_payment(_installment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  inst public.contract_installments%ROWTYPE;
  snap jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO inst FROM public.contract_installments
    WHERE id = _installment_id AND user_id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'installment_not_found'; END IF;

  DELETE FROM public.profits
    WHERE user_id = uid AND installment_id = inst.id;
  DELETE FROM public.transactions
    WHERE user_id = uid AND installment_id = inst.id
      AND type = 'payment' AND COALESCE(category, '') <> 'interest_renewal';

  snap := inst.pre_settlement_snapshot;

  UPDATE public.contract_installments
  SET paid_amount = 0, paid_fees = 0, paid_interest = 0, paid_principal = 0,
      paid_at = NULL,
      status = CASE WHEN due_date < current_date THEN 'overdue' ELSE 'pending' END,
      -- Desfaz a inflação de amount/scheduled_* que settle_percentage_installment
      -- aplicou antes de quitar (ver 20260922100000). Sem isso a parcela
      -- reaberta ficava com capital+juros permanentemente na base de cálculo
      -- do juros de atraso e do próximo "quitar capital + juros".
      amount = CASE WHEN snap IS NOT NULL THEN (snap->>'amount')::numeric ELSE amount END,
      scheduled_principal = CASE WHEN snap IS NOT NULL THEN (snap->>'scheduled_principal')::numeric ELSE scheduled_principal END,
      scheduled_interest = CASE WHEN snap IS NOT NULL THEN (snap->>'scheduled_interest')::numeric ELSE scheduled_interest END,
      pre_settlement_snapshot = NULL
  WHERE id = inst.id AND user_id = uid;

  UPDATE public.contracts SET status = CASE
    WHEN status = 'completed' THEN 'active' ELSE status END
  WHERE id = inst.contract_id AND user_id = uid;

  RETURN jsonb_build_object('ok', true, 'installment_id', inst.id, 'status', 'reversed');
END;
$$;

REVOKE ALL ON FUNCTION public.pay_installment(uuid, numeric, boolean, text, text, text, numeric),
  public.reverse_installment_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_installment(uuid, numeric, boolean, text, text, text, numeric),
  public.reverse_installment_payment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
