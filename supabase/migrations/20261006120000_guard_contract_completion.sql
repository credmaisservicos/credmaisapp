-- A baixa de uma parcela (inclusive a última) não basta para quitar o contrato.
-- A proteção no contrato também cobre RPCs e gatilhos legados que tentem
-- concluí-lo sem conferir as parcelas anteriores ou pagamentos parciais.
-- O gatilho legado comparava paid_amount somente com amount e transformava
-- parciais em 'paid' quando ainda faltavam encargos. O total deve incluir
-- late_fee, inclusive depois de um desconto registrado pela RPC de pagamento.
CREATE OR REPLACE FUNCTION public.sync_paid_installment_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  total_due numeric;
BEGIN
  total_due := round(greatest(0, coalesce(NEW.amount, 0))
                     + greatest(0, coalesce(NEW.late_fee, 0)), 2);
  IF NEW.status IS DISTINCT FROM 'cancelled' AND total_due > 0 THEN
    IF round(greatest(0, coalesce(NEW.paid_amount, 0)), 2) >= total_due THEN
      NEW.status := 'paid';
      NEW.paid_at := coalesce(NEW.paid_at, now());
    ELSIF NEW.status = 'paid' THEN
      NEW.status := CASE WHEN NEW.due_date < current_date THEN 'overdue' ELSE 'pending' END;
      NEW.paid_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_paid_installment_status ON public.contract_installments;
CREATE TRIGGER trg_sync_paid_installment_status
  BEFORE INSERT OR UPDATE OF amount, late_fee, paid_amount, status ON public.contract_installments
  FOR EACH ROW EXECUTE FUNCTION public.sync_paid_installment_status();

REVOKE ALL ON FUNCTION public.sync_paid_installment_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.contract_has_unsettled_installments(_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contract_installments i
    WHERE i.contract_id = _contract_id
      AND i.status IS DISTINCT FROM 'cancelled'
      AND (
        i.status IS DISTINCT FROM 'paid'
        OR round(greatest(0, coalesce(i.paid_amount, 0)), 2)
           < round(greatest(0, coalesce(i.amount, 0))
                   + greatest(0, coalesce(i.late_fee, 0)), 2)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.contract_has_unsettled_installments(uuid)
  FROM PUBLIC, anon, authenticated;

-- Reutiliza o gatilho de normalização existente para que o status e o estágio
-- sejam corrigidos juntos, antes de gerar eventos de contrato concluído.
CREATE OR REPLACE FUNCTION public.normalize_contract_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND public.contract_has_unsettled_installments(NEW.id) THEN
    IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('active', 'overdue', 'completed') THEN
      NEW.status := OLD.status;
      NEW.lifecycle_stage := OLD.lifecycle_stage;
    ELSE
      NEW.status := 'active';
      NEW.lifecycle_stage := 'active';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending_signature' THEN
    NEW.lifecycle_stage := 'proposed';
  ELSIF NEW.status = 'completed' THEN
    NEW.lifecycle_stage := 'completed';
  ELSIF NEW.status = 'renegotiated' THEN
    NEW.lifecycle_stage := 'renegotiated';
  ELSIF NEW.status IN ('cancelled', 'canceled') THEN
    NEW.lifecycle_stage := 'cancelled';
  ELSIF NEW.status = 'active' AND NEW.lifecycle_stage IN ('draft', 'proposed', 'approved', 'signed', 'disbursed', 'completed') THEN
    NEW.lifecycle_stage := 'active';
    NEW.activated_at := coalesce(NEW.activated_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_contract_lifecycle ON public.contracts;
CREATE TRIGGER trg_normalize_contract_lifecycle
  BEFORE INSERT OR UPDATE OF status, lifecycle_stage ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.normalize_contract_lifecycle();

-- Estornos, alterações de valor e novas parcelas podem reabrir um contrato.
-- Não interfere em cancelamentos, renegociações ou contratos sem assinatura.
CREATE OR REPLACE FUNCTION public.reopen_contract_with_unsettled_installments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.contracts
  SET status = 'active', lifecycle_stage = 'active'
  WHERE id = NEW.contract_id
    AND status = 'completed'
    AND public.contract_has_unsettled_installments(NEW.contract_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reopen_contract_with_unsettled_installments ON public.contract_installments;
CREATE TRIGGER trg_reopen_contract_with_unsettled_installments
  AFTER INSERT OR UPDATE OF status, paid_amount, amount, late_fee ON public.contract_installments
  FOR EACH ROW EXECUTE FUNCTION public.reopen_contract_with_unsettled_installments();

REVOKE ALL ON FUNCTION public.normalize_contract_lifecycle(),
  public.reopen_contract_with_unsettled_installments() FROM PUBLIC, anon, authenticated;

-- Corrige contratos antigos com pendência explícita ou valor base ainda devido.
-- Diferenças apenas nos encargos de parcelas já pagas exigem conciliação:
-- dados legados podem conter descontos não registrados ou multas incorretas.
-- Não transforma essas diferenças históricas em nova dívida automaticamente.
UPDATE public.contracts c
SET status = 'active', lifecycle_stage = 'active'
WHERE c.status = 'completed'
  AND EXISTS (
    SELECT 1 FROM public.contract_installments i
    WHERE i.contract_id = c.id AND i.status IS DISTINCT FROM 'cancelled'
      AND (i.status IS DISTINCT FROM 'paid'
        OR (i.paid_amount IS NOT NULL
          AND round(greatest(0, i.paid_amount), 2)
              < round(greatest(0, coalesce(i.amount, 0)), 2)))
  );

NOTIFY pgrst, 'reload schema';
