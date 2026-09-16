-- Promessas de pagamento deixam de ser apenas texto no log do bot. Elas passam
-- a ter ciclo de vida prÃ³prio, parcela vinculada e baixa automÃ¡tica quando a
-- parcela Ã© efetivamente quitada.
CREATE TABLE IF NOT EXISTS public.payment_promises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  installment_id uuid REFERENCES public.contract_installments(id) ON DELETE SET NULL,
  promised_amount numeric,
  promised_for date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  source text NOT NULL DEFAULT 'bot',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  broken_at timestamptz,
  CHECK (status IN ('open', 'fulfilled', 'broken', 'cancelled', 'superseded')),
  CHECK (source IN ('bot', 'human', 'import')),
  CHECK (promised_amount IS NULL OR promised_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_promises_open_due
  ON public.payment_promises (user_id, status, promised_for, client_id)
  WHERE status = 'open';

-- Uma promessa vigente por cliente evita que cada mensagem do WhatsApp gere
-- uma nova pendÃªncia concorrente. Uma correÃ§Ã£o de data atualiza a existente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_promises_one_open_per_client
  ON public.payment_promises (user_id, client_id)
  WHERE status = 'open';

ALTER TABLE public.payment_promises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_promises_owner_access ON public.payment_promises;
CREATE POLICY payment_promises_owner_access ON public.payment_promises
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.touch_payment_promise()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_payment_promise ON public.payment_promises;
CREATE TRIGGER trg_touch_payment_promise
  BEFORE UPDATE ON public.payment_promises
  FOR EACH ROW EXECUTE FUNCTION public.touch_payment_promise();

-- A integraÃ§Ã£o atual jÃ¡ grava promise_to_pay/payment_promise_changed em
-- audit_logs. Este gatilho transforma esse evento legado em dado operacional,
-- sem depender de uma implantaÃ§Ã£o simultÃ¢nea do webhook.
CREATE OR REPLACE FUNCTION public.materialize_payment_promise_from_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _promised_for date;
  _installment record;
  _amount numeric;
BEGIN
  IF NEW.entity_type <> 'whatsapp_bot'
     OR NEW.action NOT IN ('promise_to_pay', 'payment_promise_changed')
     OR NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    _promised_for := nullif(NEW.details->>'promise_date', '')::date;
  EXCEPTION WHEN invalid_datetime_format THEN
    RETURN NEW;
  END;
  IF _promised_for IS NULL THEN RETURN NEW; END IF;

  SELECT i.id, i.contract_id, greatest(0, i.amount - coalesce(i.paid_amount, 0)) AS outstanding
    INTO _installment
  FROM public.contract_installments i
  JOIN public.contracts c ON c.id = i.contract_id
  WHERE i.user_id = NEW.user_id
    AND i.client_id = NEW.entity_id
    AND i.status NOT IN ('paid', 'cancelled')
    AND c.status IN ('active', 'overdue')
    AND i.amount - coalesce(i.paid_amount, 0) > 0.009
  ORDER BY i.due_date, i.installment_number
  LIMIT 1;

  _amount := nullif(NEW.details->>'promise_amount', '')::numeric;
  IF _amount IS NOT NULL AND _amount <= 0 THEN _amount := NULL; END IF;

  UPDATE public.payment_promises
     SET promised_for = _promised_for,
         promised_amount = coalesce(_amount, promised_amount, _installment.outstanding),
         installment_id = coalesce(_installment.id, installment_id),
         contract_id = coalesce(_installment.contract_id, contract_id),
         source = 'bot',
         notes = left(coalesce(NEW.details->>'message', notes), 1000)
   WHERE user_id = NEW.user_id
     AND client_id = NEW.entity_id
     AND status = 'open';

  IF NOT FOUND THEN
    INSERT INTO public.payment_promises
      (user_id, client_id, contract_id, installment_id, promised_amount, promised_for, source, notes)
    VALUES
      (NEW.user_id, NEW.entity_id, _installment.contract_id, _installment.id,
       coalesce(_amount, _installment.outstanding), _promised_for, 'bot',
       left(coalesce(NEW.details->>'message', ''), 1000));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_materialize_payment_promise_from_audit ON public.audit_logs;
CREATE TRIGGER trg_materialize_payment_promise_from_audit
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.materialize_payment_promise_from_audit();

-- Pagamento parcial mantÃ©m a promessa aberta. Ao quitar a parcela vinculada,
-- a promessa Ã© cumprida automaticamente e nÃ£o volta para a fila de cobranÃ§a.
CREATE OR REPLACE FUNCTION public.fulfill_payment_promises_on_installment_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    UPDATE public.payment_promises
       SET status = 'fulfilled', fulfilled_at = now()
     WHERE installment_id = NEW.id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fulfill_payment_promises_on_installment_paid ON public.contract_installments;
CREATE TRIGGER trg_fulfill_payment_promises_on_installment_paid
  AFTER UPDATE OF status ON public.contract_installments
  FOR EACH ROW EXECUTE FUNCTION public.fulfill_payment_promises_on_installment_paid();

-- O cron pode chamar esta RPC diariamente para transformar promessas vencidas
-- em fila de aÃ§Ã£o humana. Ela Ã© idempotente e tambÃ©m pode ser usada pelo dono.
CREATE OR REPLACE FUNCTION public.expire_payment_promises(_reference_date date DEFAULT current_date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count integer;
BEGIN
  IF auth.uid() IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.payment_promises
     SET status = 'broken', broken_at = now()
   WHERE status = 'open'
     AND promised_for < _reference_date
     AND (auth.role() = 'service_role' OR user_id = auth.uid());
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_payment_promises(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_payment_promises(date) TO authenticated, service_role;

