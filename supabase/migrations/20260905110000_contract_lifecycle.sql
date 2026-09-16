-- Ciclo operacional do contrato. `status` continua compatÃ­vel com o cÃ³digo
-- legado; `lifecycle_stage` registra a formalizaÃ§Ã£o e impede cobranÃ§a antes da
-- assinatura quando ela Ã© obrigatÃ³ria.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS disbursed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disbursed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS disbursement_method text,
  ADD COLUMN IF NOT EXISTS disbursement_receipt_url text;

ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_lifecycle_stage_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_lifecycle_stage_check
  CHECK (lifecycle_stage IN ('draft', 'proposed', 'approved', 'signed', 'disbursed', 'active', 'completed', 'renegotiated', 'cancelled'));

UPDATE public.contracts
SET lifecycle_stage = CASE
  WHEN status = 'completed' THEN 'completed'
  WHEN status IN ('cancelled', 'canceled') THEN 'cancelled'
  WHEN status = 'renegotiated' THEN 'renegotiated'
  WHEN status = 'pending_signature' THEN 'proposed'
  ELSE 'active'
END
WHERE lifecycle_stage = 'active';

CREATE TABLE IF NOT EXISTS public.contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_stage text,
  to_stage text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_events_contract_created
  ON public.contract_events (contract_id, created_at DESC);

ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_events_owner_read ON public.contract_events;
CREATE POLICY contract_events_owner_read ON public.contract_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Compatibilidade: contrato criado jÃ¡ ativo continua sendo ativo. O novo fluxo
-- usa pending_signature e comeÃ§a no estÃ¡gio proposed.
CREATE OR REPLACE FUNCTION public.normalize_contract_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending_signature' THEN
    NEW.lifecycle_stage := 'proposed';
  ELSIF NEW.status = 'completed' THEN
    NEW.lifecycle_stage := 'completed';
  ELSIF NEW.status = 'renegotiated' THEN
    NEW.lifecycle_stage := 'renegotiated';
  ELSIF NEW.status IN ('cancelled', 'canceled') THEN
    NEW.lifecycle_stage := 'cancelled';
  ELSIF NEW.status = 'active' AND NEW.lifecycle_stage IN ('draft', 'proposed', 'approved', 'signed', 'disbursed') THEN
    NEW.lifecycle_stage := 'active';
    NEW.activated_at := coalesce(NEW.activated_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_contract_lifecycle ON public.contracts;
CREATE TRIGGER trg_normalize_contract_lifecycle
  BEFORE INSERT OR UPDATE OF status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.normalize_contract_lifecycle();

CREATE OR REPLACE FUNCTION public.audit_contract_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contract_events(contract_id, client_id, user_id, event_type, to_stage, metadata)
    VALUES (NEW.id, NEW.client_id, NEW.user_id, 'created', NEW.lifecycle_stage,
      jsonb_build_object('status', NEW.status, 'signature_status', NEW.signature_status));
  ELSIF OLD.lifecycle_stage IS DISTINCT FROM NEW.lifecycle_stage OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.contract_events(contract_id, client_id, user_id, event_type, from_stage, to_stage, metadata)
    VALUES (NEW.id, NEW.client_id, NEW.user_id, 'stage_changed', OLD.lifecycle_stage, NEW.lifecycle_stage,
      jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_contract_lifecycle ON public.contracts;
CREATE TRIGGER trg_audit_contract_lifecycle
  AFTER INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.audit_contract_lifecycle();

-- A assinatura pelo portal libera o contrato para a carteira e para a rÃ©gua de
-- cobranÃ§a no mesmo UPDATE. Enquanto pendente, status Ã© pending_signature.
CREATE OR REPLACE FUNCTION public.activate_signed_contract()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.signature_status = 'signed' AND OLD.signature_status IS DISTINCT FROM 'signed'
     AND NEW.status = 'pending_signature' THEN
    NEW.status := 'active';
    NEW.lifecycle_stage := 'active';
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_activate_signed_contract ON public.contracts;
CREATE TRIGGER trg_activate_signed_contract
  BEFORE UPDATE OF signature_status ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.activate_signed_contract();

REVOKE ALL ON public.contract_events FROM PUBLIC;
GRANT SELECT ON public.contract_events TO authenticated;

