-- Migrações pendentes agrupadas para colar no SQL Editor/console.
-- Regenerado em 2026-09-21: inclui a reescrita atômica de pay_installment
-- (20260919090000), os wrappers do bot (20260919100000), as colunas
-- financeiras que essa RPC exige (20260919110000), a correção de encargos em
-- pagamentos parciais (20260920090000) e a correção da quitação por
-- porcentagem/só-juros (20260921090000). Sem essas 4 últimas, `pay_installment`
-- e `reverse_installment_payment` simplesmente não existem no banco — todo
-- pagamento pelo app (parcial, total, estorno, bot do WhatsApp) falha ou fica
-- inconsistente. Também inclui o fix de delete_contract_atomically legado
-- (20260916130000) e os buckets de storage (20260918100000), que também
-- ficaram de fora da última rodada.
BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 20260823210000_forward_contract_disbursement.sql
-- ═══════════════════════════════════════════════════════════
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



-- ═══════════════════════════════════════════════════════════
-- 20260823230000_harden_client_error_ingestion.sql
-- ═══════════════════════════════════════════════════════════
BEGIN;

-- MantÃ©m o coletor disponÃ­vel para os portais pÃºblicos, mas impede que um
-- visitante atribua o erro a outro usuÃ¡rio ou envie payloads sem limite.
ALTER TABLE public.client_errors
  DROP CONSTRAINT IF EXISTS client_errors_rota_tamanho,
  DROP CONSTRAINT IF EXISTS client_errors_navegador_tamanho,
  DROP CONSTRAINT IF EXISTS client_errors_contexto_tamanho;

ALTER TABLE public.client_errors
  ADD CONSTRAINT client_errors_rota_tamanho
    CHECK (char_length(rota) <= 500) NOT VALID,
  ADD CONSTRAINT client_errors_navegador_tamanho
    CHECK (navegador IS NULL OR char_length(navegador) <= 400) NOT VALID,
  ADD CONSTRAINT client_errors_contexto_tamanho
    CHECK (octet_length(contexto::text) <= 8192) NOT VALID;

DROP POLICY IF EXISTS client_errors_insert ON public.client_errors;
CREATE POLICY client_errors_insert ON public.client_errors
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NULL AND user_id IS NULL)
    OR
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
  );

COMMIT;


-- ═══════════════════════════════════════════════════════════
-- 20260823233000_admin_audit_visibility.sql
-- ═══════════════════════════════════════════════════════════
BEGIN;

-- O painel de diagnÃ³stico da plataforma precisa enxergar a trilha global.
-- UsuÃ¡rios comuns continuam limitados pela polÃ­tica original ao prÃ³prio tenant.
DROP POLICY IF EXISTS audit_logs_platform_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_platform_admin_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

COMMIT;


-- ═══════════════════════════════════════════════════════════
-- 20260905100000_payment_promises.sql
-- ═══════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════
-- 20260905110000_contract_lifecycle.sql
-- ═══════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════
-- 20260905120000_atomic_contract_renegotiation.sql
-- ═══════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════
-- 20260911010000_atomic_contract_mutations.sql
-- ═══════════════════════════════════════════════════════════
-- Atomic, tenant-scoped mutations used by the client and contract screens.
-- This migration only creates functions; it does not touch existing rows.

DROP FUNCTION IF EXISTS public.update_contract_atomically(uuid, jsonb, boolean, jsonb);
CREATE OR REPLACE FUNCTION public.update_contract_atomically(
  _contract_id uuid,
  _contract jsonb,
  _regenerate boolean DEFAULT false,
  _installments jsonb DEFAULT '[]'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  current_contract public.contracts%ROWTYPE;
  new_installment_count integer;
  paid_count integer;
  expected_pending integer;
  supplied_count integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT * INTO current_contract
  FROM public.contracts
  WHERE id = _contract_id AND user_id = uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrato não encontrado';
  END IF;

  new_installment_count := COALESCE(
    NULLIF(_contract->>'num_installments', '')::integer,
    current_contract.num_installments
  );

  IF new_installment_count IS NULL OR new_installment_count < 1 THEN
    RAISE EXCEPTION 'Quantidade de parcelas inválida';
  END IF;

  UPDATE public.contracts
  SET capital = COALESCE(NULLIF(_contract->>'capital', '')::numeric, capital),
      interest_rate = COALESCE(NULLIF(_contract->>'interest_rate', '')::numeric, interest_rate),
      num_installments = new_installment_count,
      installment_amount = COALESCE(NULLIF(_contract->>'installment_amount', '')::numeric, installment_amount),
      frequency = COALESCE(NULLIF(_contract->>'frequency', ''), frequency),
      start_date = COALESCE(NULLIF(_contract->>'start_date', '')::timestamptz, start_date),
      late_fee_percent = COALESCE(NULLIF(_contract->>'late_fee_percent', '')::numeric, late_fee_percent),
      daily_interest_percent = COALESCE(NULLIF(_contract->>'daily_interest_percent', '')::numeric, daily_interest_percent),
      total_amount = COALESCE(NULLIF(_contract->>'total_amount', '')::numeric, total_amount),
      total_interest = COALESCE(NULLIF(_contract->>'total_interest', '')::numeric, total_interest),
      notes = CASE WHEN _contract ? 'notes' THEN _contract->>'notes' ELSE notes END
  WHERE id = _contract_id AND user_id = uid;

  IF NOT _regenerate THEN
    RETURN;
  END IF;

  -- Lock every installment before deciding which pending rows may be replaced.
  PERFORM 1
  FROM public.contract_installments
  WHERE contract_id = _contract_id AND user_id = uid
  FOR UPDATE;

  SELECT count(*) INTO paid_count
  FROM public.contract_installments
  WHERE contract_id = _contract_id AND user_id = uid AND status = 'paid';

  IF paid_count > new_installment_count
     OR EXISTS (
       SELECT 1 FROM public.contract_installments
       WHERE contract_id = _contract_id AND user_id = uid
         AND status = 'paid' AND installment_number > new_installment_count
     ) THEN
    RAISE EXCEPTION 'paid_installment_would_be_removed';
  END IF;

  IF jsonb_typeof(_installments) <> 'array' THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  expected_pending := new_installment_count - paid_count;
  supplied_count := jsonb_array_length(_installments);
  IF supplied_count <> expected_pending THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_installments) AS item(installment_number integer, amount numeric, due_date timestamptz)
    WHERE item.installment_number IS NULL
       OR item.installment_number < 1
       OR item.installment_number > new_installment_count
       OR item.amount IS NULL
       OR item.amount <= 0
       OR item.due_date IS NULL
  ) OR (
    SELECT count(DISTINCT item.installment_number)
    FROM jsonb_to_recordset(_installments) AS item(installment_number integer)
  ) <> supplied_count THEN
    RAISE EXCEPTION 'installment_count_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_installments) AS item(installment_number integer)
    JOIN public.contract_installments paid
      ON paid.contract_id = _contract_id
     AND paid.user_id = uid
     AND paid.status = 'paid'
     AND paid.installment_number = item.installment_number
  ) THEN
    RAISE EXCEPTION 'paid_installment_would_be_removed';
  END IF;

  DELETE FROM public.contract_installments
  WHERE contract_id = _contract_id AND user_id = uid AND status <> 'paid';

  INSERT INTO public.contract_installments (
    user_id, contract_id, client_id, installment_number, amount, due_date,
    status, scheduled_principal, scheduled_interest
  )
  SELECT uid, _contract_id, current_contract.client_id,
         item.installment_number, item.amount, item.due_date,
         'pending', COALESCE(item.scheduled_principal, 0), COALESCE(item.scheduled_interest, 0)
  FROM jsonb_to_recordset(_installments) AS item(
    installment_number integer,
    amount numeric,
    due_date timestamptz,
    scheduled_principal numeric,
    scheduled_interest numeric
  );
END;
$$;

DROP FUNCTION IF EXISTS public.delete_contract_atomically(uuid);
CREATE OR REPLACE FUNCTION public.delete_contract_atomically(_contract_id uuid)
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

  -- Remove dependent records first, keeping the operation atomic.
  DELETE FROM public.client_notifications
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.collection_attempts
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.profits
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.transactions
  WHERE user_id = uid AND (contract_id = _contract_id OR installment_id IN (
    SELECT id FROM public.contract_installments WHERE contract_id = _contract_id AND user_id = uid
  ));
  DELETE FROM public.loan_collateral
  WHERE user_id = uid AND contract_id = _contract_id;
  DELETE FROM public.contract_installments
  WHERE user_id = uid AND contract_id = _contract_id;
  DELETE FROM public.contracts
  WHERE user_id = uid AND id = _contract_id;
END;
$$;

DROP FUNCTION IF EXISTS public.delete_client_cascade(uuid);
CREATE OR REPLACE FUNCTION public.delete_client_cascade(_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  client_row public.clients%ROWTYPE;
  contract_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT * INTO client_row
  FROM public.clients
  WHERE id = _client_id AND user_id = uid
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente não encontrado';
  END IF;

  -- Contracts are removed through the same guarded function used by the detail page.
  FOR contract_id IN
    SELECT id FROM public.contracts WHERE client_id = _client_id AND user_id = uid FOR UPDATE
  LOOP
    PERFORM public.delete_contract_atomically(contract_id);
  END LOOP;

  DELETE FROM public.business_payments
  WHERE user_id = uid AND operation_id IN (
    SELECT id FROM public.business_operations WHERE client_id = _client_id AND user_id = uid
  );
  DELETE FROM public.business_receivables
  WHERE user_id = uid AND operation_id IN (
    SELECT id FROM public.business_operations WHERE client_id = _client_id AND user_id = uid
  );
  DELETE FROM public.business_operations
  WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.loan_collateral WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.client_notifications WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.client_tokens WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.portal_sessions WHERE client_id = _client_id;
  DELETE FROM public.collector_assignments WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.collection_attempts WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.profits WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.transactions WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.whatsapp_conversations WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.bot_actions_log WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.leads WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.rentals WHERE user_id = uid AND client_id = _client_id;
  DELETE FROM public.clients WHERE id = _client_id AND user_id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.update_contract_atomically(uuid, jsonb, boolean, jsonb),
  public.delete_contract_atomically(uuid), public.delete_client_cascade(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_contract_atomically(uuid, jsonb, boolean, jsonb),
  public.delete_contract_atomically(uuid), public.delete_client_cascade(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260911020000_quitar_capital_juros_renovavel.sql
-- ═══════════════════════════════════════════════════════════
-- Quita uma cobrança renovável (por porcentagem) separando principal e juros.
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
      scheduled_interest = _interest
  WHERE id = _inst.id;

  RETURN public.pay_installment(_installment_id, _total, true, _method, _receipt_url);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_percentage_installment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_percentage_installment(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- 20260912010000_commercial_operations.sql
-- ═══════════════════════════════════════════════════════════
-- Inventory, sales, rentals and voluntary loan collateral. Mutations are atomic,
-- tenant scoped, idempotent and serialize access to inventory and receivables.
CREATE TABLE public.business_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  kind text NOT NULL CHECK(kind IN ('phone','car','motorcycle')),
  label text NOT NULL CHECK(length(trim(label)) BETWEEN 2 AND 150),
  identifier text NOT NULL CHECK(length(trim(identifier)) BETWEEN 3 AND 50),
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(cost>=0),
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK(price>=0),
  condition text NOT NULL DEFAULT 'Usado', notes text NOT NULL DEFAULT '',
  photos jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(photos)='array'),
  details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'),
  status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','sold','rented','maintenance','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,kind,identifier), UNIQUE(id,user_id)
);
CREATE TABLE public.business_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  asset_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('sale','rental')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
  total numeric(14,2) NOT NULL CHECK(total>0), down_payment numeric(14,2) NOT NULL DEFAULT 0 CHECK(down_payment>=0),
  deposit numeric(14,2) NOT NULL DEFAULT 0 CHECK(deposit>=0), deposit_returned numeric(14,2) NOT NULL DEFAULT 0 CHECK(deposit_returned>=0),
  start_date date NOT NULL, end_date date, returned_at timestamptz,
  billing text NOT NULL DEFAULT 'monthly' CHECK(billing IN ('daily','weekly','monthly')),
  rate numeric(14,2) NOT NULL DEFAULT 0 CHECK(rate>=0),
  notes text NOT NULL DEFAULT '', details jsonb NOT NULL DEFAULT '{}',
  request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id), UNIQUE(id,user_id),
  FOREIGN KEY(asset_id,user_id) REFERENCES public.business_assets(id,user_id),
  CHECK(down_payment<=total), CHECK(deposit_returned<=deposit), CHECK(end_date IS NULL OR end_date>=start_date)
);
CREATE TABLE public.business_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  operation_id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
  amount numeric(14,2) NOT NULL CHECK(amount>0), paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(paid_amount>=0),
  due_date date NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','cancelled')),
  UNIQUE(operation_id,number), UNIQUE(id,user_id), CHECK(paid_amount<=amount),
  FOREIGN KEY(operation_id,user_id) REFERENCES public.business_operations(id,user_id)
);
CREATE TABLE public.business_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  operation_id uuid NOT NULL, receivable_id uuid,
  kind text NOT NULL CHECK(kind IN ('receipt','down_payment','deposit','deposit_refund','refund')),
  amount numeric(14,2) NOT NULL CHECK(amount>0), method text NOT NULL CHECK(method IN ('pix','cash','card','transfer')),
  request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_id), FOREIGN KEY(operation_id,user_id) REFERENCES public.business_operations(id,user_id),
  FOREIGN KEY(receivable_id,user_id) REFERENCES public.business_receivables(id,user_id)
);
CREATE TABLE public.loan_collateral (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
  contract_id uuid NOT NULL REFERENCES public.contracts(id), client_id uuid NOT NULL REFERENCES public.clients(id),
  description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 500),
  category text NOT NULL, identifier text NOT NULL DEFAULT '', estimated_value numeric(14,2) NOT NULL CHECK(estimated_value>0),
  condition text NOT NULL DEFAULT '', storage_location text NOT NULL DEFAULT '',
  photos jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(photos)='array'), notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','returned')),
  received_at timestamptz NOT NULL DEFAULT now(), returned_at timestamptz, return_note text,
  request_id uuid NOT NULL, UNIQUE(user_id,request_id)
);
CREATE INDEX ON public.business_operations(user_id,client_id,created_at DESC);
CREATE INDEX ON public.business_receivables(user_id,due_date) WHERE status='pending';
CREATE INDEX ON public.loan_collateral(user_id,contract_id);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['business_assets','business_operations','business_receivables','business_payments','loan_collateral'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(user_id=auth.uid())',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  END LOOP;
END $$;

CREATE FUNCTION public.save_business_asset(_data jsonb, _id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); asset public.business_assets%rowtype; result uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  IF _id IS NOT NULL THEN
    SELECT * INTO asset FROM business_assets WHERE id=_id AND user_id=uid FOR UPDATE;
    IF asset.id IS NULL THEN RAISE EXCEPTION 'Bem não encontrado'; END IF;
    IF asset.status IN ('sold','rented') THEN RAISE EXCEPTION 'Bem vinculado a uma operação; não pode ser alterado'; END IF;
  END IF;
  IF (_data->>'kind') NOT IN ('phone','car','motorcycle') OR nullif(trim(_data->>'label'),'') IS NULL OR nullif(trim(_data->>'identifier'),'') IS NULL THEN RAISE EXCEPTION 'Informe tipo, descrição e identificação'; END IF;
  IF _data->>'kind'='phone' AND (_data->>'identifier') !~ '^\d{15}$' THEN RAISE EXCEPTION 'IMEI deve ter 15 dígitos'; END IF;
  IF _data->>'kind' IN ('car','motorcycle') AND upper(_data->>'identifier') !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' THEN RAISE EXCEPTION 'Placa inválida'; END IF;
  IF coalesce(_data->>'status','available') NOT IN ('available','maintenance','archived') THEN RAISE EXCEPTION 'Situação inválida'; END IF;
  IF _id IS NULL THEN
    INSERT INTO business_assets(user_id,kind,label,identifier,cost,price,condition,notes,photos,details)
    VALUES(uid,_data->>'kind',trim(_data->>'label'),upper(trim(_data->>'identifier')),coalesce((_data->>'cost')::numeric,0),coalesce((_data->>'price')::numeric,0),coalesce(_data->>'condition','Usado'),coalesce(_data->>'notes',''),coalesce(_data->'photos','[]'),coalesce(_data->'details','{}')) RETURNING id INTO result;
  ELSE
    UPDATE business_assets SET label=trim(_data->>'label'),identifier=upper(trim(_data->>'identifier')),cost=coalesce((_data->>'cost')::numeric,0),price=coalesce((_data->>'price')::numeric,0),condition=coalesce(_data->>'condition','Usado'),notes=coalesce(_data->>'notes',''),photos=coalesce(_data->'photos','[]'),details=coalesce(_data->'details','{}'),status=coalesce(_data->>'status','available') WHERE id=_id;
    result:=_id;
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.create_business_operation(_data jsonb, _request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); asset business_assets%rowtype; result uuid; total numeric; entry numeric; deposit numeric;
  start_at date; end_at date; due date; billing text; rate numeric; count integer; n integer; cents bigint; part bigint; remaining bigint; op_kind text;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Identificação da operação obrigatória'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM business_operations WHERE user_id=uid AND request_id=_request_id; IF result IS NOT NULL THEN RETURN result; END IF;
  PERFORM 1 FROM clients WHERE id=(_data->>'client_id')::uuid AND user_id=uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente não encontrado'; END IF;
  SELECT * INTO asset FROM business_assets WHERE id=(_data->>'asset_id')::uuid AND user_id=uid FOR UPDATE;
  IF asset.id IS NULL OR asset.status<>'available' THEN RAISE EXCEPTION 'Bem indisponível para esta operação'; END IF;
  op_kind:=_data->>'kind'; billing:=coalesce(_data->>'billing','monthly');
  start_at:=(_data->>'start_date')::date; due:=coalesce((_data->>'first_due')::date,start_at);
  IF start_at IS NULL OR due<start_at OR billing NOT IN ('daily','weekly','monthly') THEN RAISE EXCEPTION 'Datas ou frequência inválidas'; END IF;
  entry:=round(coalesce((_data->>'down_payment')::numeric,0),2); deposit:=round(coalesce((_data->>'deposit')::numeric,0),2);
  IF op_kind='sale' THEN
    IF asset.kind<>'phone' THEN RAISE EXCEPTION 'Selecione um celular disponível'; END IF;
    total:=round((_data->>'total')::numeric,2);count:=(_data->>'installments')::integer;rate:=0;deposit:=0;
  ELSIF op_kind='rental' THEN
    IF asset.kind NOT IN ('car','motorcycle') THEN RAISE EXCEPTION 'Selecione um veículo disponível'; END IF;
    end_at:=(_data->>'end_date')::date;rate:=round((_data->>'rate')::numeric,2);count:=0;due:=start_at;
    IF end_at IS NULL OR end_at<=start_at OR end_at>start_at+interval '5 years' OR rate IS NULL OR rate<=0 THEN RAISE EXCEPTION 'Informe período de locação e valor válidos'; END IF;
    WHILE due<end_at LOOP
      count:=count+1;
      due:=CASE billing WHEN 'daily' THEN start_at+count WHEN 'weekly' THEN start_at+7*count ELSE (start_at+make_interval(months=>count))::date END;
    END LOOP;
    total:=rate*count;entry:=0;
  ELSE RAISE EXCEPTION 'Operação inválida'; END IF;
  IF total IS NULL OR total<=0 OR total>999999999 OR entry<0 OR entry>total OR deposit<0 OR count IS NULL OR count<1 OR count>366 THEN RAISE EXCEPTION 'Confira valores e quantidade de parcelas (máximo 366)'; END IF;
  remaining:=round((total-entry)*100)::bigint;
  IF remaining>0 AND remaining<count THEN RAISE EXCEPTION 'Valor insuficiente para dividir em parcelas'; END IF;
  INSERT INTO business_operations(user_id,client_id,asset_id,kind,total,down_payment,deposit,start_date,end_date,billing,rate,notes,details,request_id)
  VALUES(uid,(_data->>'client_id')::uuid,asset.id,op_kind,total,entry,deposit,start_at,end_at,billing,rate,coalesce(_data->>'notes',''),coalesce(_data->'details','{}'),_request_id) RETURNING id INTO result;
  IF remaining>0 THEN
    FOR n IN 1..count LOOP
      cents:=remaining/count+CASE WHEN n<=remaining%count THEN 1 ELSE 0 END;
      due:=CASE billing WHEN 'daily' THEN coalesce((_data->>'first_due')::date,start_at)+(n-1) WHEN 'weekly' THEN coalesce((_data->>'first_due')::date,start_at)+7*(n-1) ELSE (coalesce((_data->>'first_due')::date,start_at)+make_interval(months=>n-1))::date END;
      IF op_kind='rental' THEN due:=CASE billing WHEN 'daily' THEN start_at+n-1 WHEN 'weekly' THEN start_at+7*(n-1) ELSE (start_at+make_interval(months=>n-1))::date END; END IF;
      INSERT INTO business_receivables(user_id,operation_id,number,amount,due_date) VALUES(uid,result,n,cents/100.0,due);
    END LOOP;
  END IF;
  IF entry>0 THEN
    INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,result,'down_payment',entry,coalesce(_data->>'method','pix'),gen_random_uuid());
  END IF;
  IF deposit>0 THEN
    INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,result,'deposit',deposit,coalesce(_data->>'method','pix'),gen_random_uuid());
  END IF;
  UPDATE business_assets SET status=CASE WHEN op_kind='sale' THEN 'sold' ELSE 'rented' END WHERE id=asset.id;
  IF op_kind='sale' AND remaining=0 THEN UPDATE business_operations SET status='completed' WHERE id=result; END IF;
  INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(uid,'create','business_operation',result,jsonb_build_object('kind',op_kind,'total',total));
  RETURN result;
END $$;

CREATE FUNCTION public.receive_business_payment(_receivable_id uuid,_amount numeric,_method text,_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); r business_receivables%rowtype; op business_operations%rowtype; result uuid;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação e identificação obrigatórias'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM business_payments WHERE user_id=uid AND request_id=_request_id;IF result IS NOT NULL THEN RETURN result;END IF;
  SELECT o.* INTO op FROM business_operations o JOIN business_receivables r ON r.operation_id=o.id WHERE r.id=_receivable_id AND o.user_id=uid FOR UPDATE OF o;
  IF op.id IS NULL OR op.status='cancelled' THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  SELECT * INTO r FROM business_receivables WHERE id=_receivable_id AND user_id=uid FOR UPDATE;
  IF r.status<>'pending' OR _amount IS NULL OR _amount<=0 OR round(_amount,2)<>_amount OR _amount>r.amount-r.paid_amount THEN RAISE EXCEPTION 'Pagamento deve ser maior que zero e não exceder o saldo'; END IF;
  INSERT INTO business_payments(user_id,operation_id,receivable_id,kind,amount,method,request_id) VALUES(uid,r.operation_id,r.id,'receipt',_amount,_method,_request_id) RETURNING id INTO result;
  UPDATE business_receivables SET paid_amount=paid_amount+_amount,status=CASE WHEN paid_amount+_amount=amount THEN 'paid' ELSE 'pending' END WHERE id=r.id;
  IF op.kind='sale' AND NOT EXISTS(SELECT 1 FROM business_receivables WHERE operation_id=op.id AND status='pending') THEN UPDATE business_operations SET status='completed' WHERE id=op.id; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.close_business_operation(_operation_id uuid,_action text,_data jsonb,_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); op business_operations%rowtype; received numeric; refund numeric;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  SELECT * INTO op FROM business_operations WHERE id=_operation_id AND user_id=uid FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  IF _action='cancel' THEN
    IF op.status='cancelled' THEN RETURN; END IF;
    IF op.returned_at IS NOT NULL THEN RAISE EXCEPTION 'Locação já encerrada'; END IF;
    SELECT coalesce(sum(amount),0) INTO received FROM business_payments WHERE operation_id=op.id AND kind IN ('receipt','down_payment');
    IF received>0 THEN INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,op.id,'refund',received,coalesce(_data->>'method','pix'),_request_id); END IF;
    refund:=op.deposit-op.deposit_returned;
    IF refund>0 THEN INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,op.id,'deposit_refund',refund,coalesce(_data->>'method','pix'),gen_random_uuid()); END IF;
    UPDATE business_receivables SET status='cancelled' WHERE operation_id=op.id;
    UPDATE business_operations SET status='cancelled',deposit_returned=deposit,notes=notes||E'\nCancelamento: '||coalesce(_data->>'notes','') WHERE id=op.id;
  ELSIF _action='return' THEN
    IF op.kind<>'rental' OR op.status='cancelled' THEN RAISE EXCEPTION 'Locação inválida'; END IF;
    IF op.returned_at IS NOT NULL THEN RETURN; END IF;
    IF (_data->>'odometer')::numeric IS NULL OR (_data->>'odometer')::numeric<coalesce((op.details->>'odometer')::numeric,0) THEN RAISE EXCEPTION 'Quilometragem final inválida'; END IF;
    refund:=op.deposit-op.deposit_returned;
    IF refund>0 THEN INSERT INTO business_payments(user_id,operation_id,kind,amount,method,request_id) VALUES(uid,op.id,'deposit_refund',refund,coalesce(_data->>'method','pix'),_request_id); END IF;
    UPDATE business_operations SET status='completed',returned_at=now(),deposit_returned=deposit,details=details||jsonb_build_object('return',_data) WHERE id=op.id;
  ELSE RAISE EXCEPTION 'Ação inválida'; END IF;
  UPDATE business_assets SET status='available' WHERE id=op.asset_id AND user_id=uid;
  INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(uid,_action,'business_operation',op.id,_data);
END $$;

CREATE FUNCTION public.record_business_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op business_operations%rowtype;
BEGIN
  SELECT * INTO op FROM business_operations WHERE id=NEW.operation_id;
  INSERT INTO transactions(user_id,client_id,type,category,description,amount,date)
  VALUES(NEW.user_id,op.client_id,CASE WHEN NEW.kind IN ('deposit_refund','refund') THEN 'business_refund' WHEN NEW.kind='deposit' THEN 'security_deposit' ELSE 'business_income' END,
  CASE WHEN NEW.kind IN ('deposit','deposit_refund') THEN 'Caução' WHEN op.kind='sale' THEN 'Venda de celular' ELSE 'Locação de veículo' END,
  CASE NEW.kind WHEN 'deposit' THEN 'Caução recebida' WHEN 'deposit_refund' THEN 'Caução devolvida' WHEN 'refund' THEN 'Estorno de operação' ELSE 'Recebimento de operação' END||' · '||op.id::text,NEW.amount,NEW.created_at);
  RETURN NEW;
END $$;
CREATE TRIGGER business_payment_ledger AFTER INSERT ON business_payments FOR EACH ROW EXECUTE FUNCTION record_business_ledger();

CREATE FUNCTION public.save_loan_collateral(_contract_id uuid,_data jsonb,_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); cid uuid; result uuid;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM loan_collateral WHERE user_id=uid AND request_id=_request_id;IF result IS NOT NULL THEN RETURN result;END IF;
  SELECT client_id INTO cid FROM contracts WHERE id=_contract_id AND user_id=uid FOR UPDATE;
  IF cid IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  INSERT INTO loan_collateral(user_id,client_id,contract_id,description,category,identifier,estimated_value,condition,storage_location,photos,notes,request_id)
  VALUES(uid,cid,_contract_id,_data->>'description',coalesce(_data->>'category','Outro'),coalesce(_data->>'identifier',''),(_data->>'estimated_value')::numeric,coalesce(_data->>'condition',''),coalesce(_data->>'storage_location',''),coalesce(_data->'photos','[]'),coalesce(_data->>'notes',''),_request_id) RETURNING id INTO result;
  RETURN result;
END $$;
CREATE FUNCTION public.return_loan_collateral(_id uuid,_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item loan_collateral%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  SELECT * INTO item FROM loan_collateral WHERE id=_id AND user_id=auth.uid() FOR UPDATE;
  IF item.id IS NULL THEN RAISE EXCEPTION 'Garantia não encontrada'; END IF;
  IF item.status='returned' THEN RETURN; END IF;
  IF length(trim(coalesce(_note,'')))<3 THEN RAISE EXCEPTION 'Informe quem recebeu o bem e a observação de devolução'; END IF;
  UPDATE loan_collateral SET status='returned',returned_at=now(),return_note=_note WHERE id=item.id;
  INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details) VALUES(auth.uid(),'return','loan_collateral',item.id,jsonb_build_object('note',_note));
END $$;
CREATE FUNCTION public.create_client_contract_with_collateral(_client_id uuid,_client jsonb,_contract jsonb,_installments jsonb,_collateral jsonb,_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; previous loan_collateral%rowtype;
BEGIN
  IF auth.uid() IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||_request_id::text,0));
  SELECT * INTO previous FROM loan_collateral WHERE user_id=auth.uid() AND request_id=_request_id;
  IF previous.id IS NOT NULL THEN RETURN jsonb_build_object('client_id',previous.client_id,'contract_id',previous.contract_id,'installment_count',(SELECT count(*) FROM contract_installments WHERE contract_id=previous.contract_id)); END IF;
  result:=public.create_client_contract(_client_id,_client,_contract,_installments);
  PERFORM public.save_loan_collateral((result->>'contract_id')::uuid,_collateral,_request_id);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_business_asset(jsonb,uuid),public.create_business_operation(jsonb,uuid),public.receive_business_payment(uuid,numeric,text,uuid),public.close_business_operation(uuid,text,jsonb,uuid),public.save_loan_collateral(uuid,jsonb,uuid),public.return_loan_collateral(uuid,text),public.create_client_contract_with_collateral(uuid,jsonb,jsonb,jsonb,jsonb,uuid),public.record_business_ledger() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_business_asset(jsonb,uuid),public.create_business_operation(jsonb,uuid),public.receive_business_payment(uuid,numeric,text,uuid),public.close_business_operation(uuid,text,jsonb,uuid),public.save_loan_collateral(uuid,jsonb,uuid),public.return_loan_collateral(uuid,text),public.create_client_contract_with_collateral(uuid,jsonb,jsonb,jsonb,jsonb,uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260916120000_renew_installment_interest.sql
-- ═══════════════════════════════════════════════════════════
-- "Pagar só juros e renovar": recebe apenas o rendimento do período, mantém
-- o capital pendente e empurra o vencimento para a próxima data de cobrança
-- escolhida pelo usuário. Usado pelo pagamento único (bullet), por
-- porcentagem e por só-juros. Sem essa função a chamada do front falhava
-- com "Could not find the function" e a renovação nunca era concluída.
DROP FUNCTION IF EXISTS public.renew_installment_interest(uuid, date, text, text);
DROP FUNCTION IF EXISTS public.renew_installment_interest(uuid, date, text, text, text);
CREATE OR REPLACE FUNCTION public.renew_installment_interest(
  _installment_id uuid,
  _next_due_date date,
  _method text DEFAULT 'pix',
  _origin text DEFAULT NULL,
  _receipt_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  _inst public.contract_installments%rowtype;
  _contract public.contracts%rowtype;
  _capital numeric;
  _total_interest numeric;
  _base_interest numeric;
  _late numeric;
  _received numeric;
  _previous_due date;
BEGIN
  IF _next_due_date IS NULL THEN
    RAISE EXCEPTION 'next_due_date_required';
  END IF;

  SELECT * INTO _inst FROM public.contract_installments WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL OR _inst.user_id <> auth.uid() THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  IF _inst.status IN ('paid', 'cancelled') THEN RAISE EXCEPTION 'installment_closed'; END IF;

  SELECT * INTO _contract FROM public.contracts WHERE id = _inst.contract_id AND user_id = auth.uid();
  IF _contract.id IS NULL THEN RAISE EXCEPTION 'contract_not_found'; END IF;

  _capital := greatest(0, coalesce(_contract.capital, 0));
  _total_interest := coalesce(_contract.total_interest, greatest(0, coalesce(_contract.total_amount, 0) - _capital));
  _late := greatest(0, coalesce(_inst.late_fee, 0));

  -- Mesma regra de src/lib/interestOnly.ts: "bullet" cobra o juros total do
  -- ciclo, porcentagem/só-juros cobram a taxa sobre o capital, parcelado
  -- divide o juros total pelo nº de parcelas.
  _base_interest := CASE
    WHEN _contract.loan_mode = 'bullet' THEN _total_interest
    WHEN _contract.loan_mode IN ('percentage', 'interest_only') THEN round(_capital * coalesce(_contract.interest_rate, 0) / 100, 2)
    WHEN coalesce(_contract.num_installments, 0) > 0 THEN round(_total_interest / _contract.num_installments, 2)
    ELSE coalesce(_inst.amount, 0)
  END;

  _received := round(greatest(0, _base_interest) + _late, 2);
  IF _received <= 0 THEN RAISE EXCEPTION 'invalid_renewal_amount'; END IF;

  _previous_due := _inst.due_date;

  UPDATE public.contract_installments
  SET due_date = _next_due_date,
      late_fee = 0,
      paid_amount = 0,
      paid_at = NULL,
      status = 'pending',
      payment_method = _method,
      receipt_url = coalesce(_receipt_url, receipt_url)
  WHERE id = _inst.id;

  INSERT INTO public.transactions (
    user_id, amount, type, category, description, client_id, contract_id,
    installment_id, principal_amount, interest_amount, fee_amount
  ) VALUES (
    auth.uid(), _received, 'payment', 'interest_renewal',
    'Renovação por pagamento somente dos juros' || CASE WHEN _origin IS NOT NULL THEN ' (' || _origin || ')' ELSE '' END,
    _inst.client_id, _inst.contract_id, _inst.id, 0, greatest(0, _received - _late), _late
  );

  INSERT INTO public.profits (user_id, amount, description, client_id, installment_id)
  VALUES (
    auth.uid(), _received,
    'Juros de renovação · parcela #' || coalesce(_inst.installment_number::text, '-'),
    _inst.client_id, NULL
  );

  RETURN jsonb_build_object(
    'amount', _received,
    'previous_due_date', _previous_due,
    'next_due_date', _next_due_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.renew_installment_interest(uuid, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_installment_interest(uuid, date, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260916130000_fix_delete_contract_legacy_schema.sql
-- ═══════════════════════════════════════════════════════════
-- Alguns bancos self-hosted têm tabelas filhas legadas sem contract_id.
-- Mantém a exclusão de contrato atômica checando as colunas de fato
-- existentes em tempo de execução.
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

-- ═══════════════════════════════════════════════════════════
-- 20260918100000_storage_buckets.sql
-- ═══════════════════════════════════════════════════════════
-- Buckets usados pelo app CredMais.
-- uploads e privado: o frontend trabalha com URLs assinadas.
-- backups e privado: somente Edge Functions com service role acessam.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('uploads', 'uploads', false, 15728640),
  ('backups', 'backups', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "uploads_select_own" ON storage.objects;
CREATE POLICY "uploads_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
);

DROP POLICY IF EXISTS "uploads_insert_own" ON storage.objects;
CREATE POLICY "uploads_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "uploads_update_own" ON storage.objects;
CREATE POLICY "uploads_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
);

DROP POLICY IF EXISTS "uploads_delete_own" ON storage.objects;
CREATE POLICY "uploads_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
);

-- ═══════════════════════════════════════════════════════════
-- 20260919090000_payment_installment_atomic.sql
-- ═══════════════════════════════════════════════════════════
-- Baixa de parcelas usada por Cobrancas, Hoje, ClienteDetalhe e portal interno.
-- A operacao e idempotente e grava parcela + razao na mesma transacao.
-- (Substituída pela versão de 20260920090000 e 20260921090000 mais abaixo —
-- mantida aqui apenas para criar reverse_installment_payment; o CREATE OR
-- REPLACE seguinte já cobre pay_installment com a versão final.)

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

  UPDATE public.contract_installments
  SET paid_amount = 0, paid_fees = 0, paid_interest = 0, paid_principal = 0,
      paid_at = NULL,
      status = CASE WHEN due_date < current_date THEN 'overdue' ELSE 'pending' END
  WHERE id = inst.id AND user_id = uid;

  UPDATE public.contracts SET status = CASE
    WHEN status = 'completed' THEN 'active' ELSE status END
  WHERE id = inst.contract_id AND user_id = uid;

  RETURN jsonb_build_object('ok', true, 'installment_id', inst.id, 'status', 'reversed');
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_installment_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_installment_payment(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260919100000_bot_payment_service_wrappers.sql
-- ═══════════════════════════════════════════════════════════
-- Operações financeiras executadas pelo webhook/cron com a service role.
-- Esses wrappers preservam o isolamento por user_id e delegam a regra de
-- distribuição/baixa para as RPCs transacionais do app.

DROP FUNCTION IF EXISTS public.system_register_payment(uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.system_register_payment(uuid, numeric, text, text, text, text);
CREATE OR REPLACE FUNCTION public.system_register_payment(
  _installment_id uuid,
  _paid_total numeric,
  _method text DEFAULT 'pix',
  _origem text DEFAULT NULL,
  _receipt_url text DEFAULT NULL,
  _source_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  total_due numeric;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT user_id INTO owner_id
  FROM public.contract_installments
  WHERE id = _installment_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'installment_not_found'; END IF;
  SELECT round(greatest(0, coalesce(amount, 0)) + greatest(0, coalesce(late_fee, 0)), 2)
    INTO total_due
  FROM public.contract_installments WHERE id = _installment_id;

  -- pay_installment valida auth.uid(); o webhook usa service_role, então
  -- definimos o proprietário derivado da própria parcela dentro da transação.
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);
  RETURN public.pay_installment(
    _installment_id, _paid_total, coalesce(_paid_total, 0) + 0.005 >= total_due,
    _method, _receipt_url,
    _source_key
  );
END;
$$;

DROP FUNCTION IF EXISTS public.system_pay_client_balance(uuid, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.system_pay_client_balance(uuid, numeric, text, text, text, text);
CREATE OR REPLACE FUNCTION public.system_pay_client_balance(
  _client_id uuid,
  _amount numeric,
  _method text DEFAULT 'pix',
  _receipt_url text DEFAULT NULL,
  _origin text DEFAULT NULL,
  _source_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  inst public.contract_installments%ROWTYPE;
  remaining numeric := round(greatest(0, coalesce(_amount, 0)), 2);
  balance numeric;
  allocation numeric;
  paid_count integer := 0;
  partial_count integer := 0;
  allocations jsonb := '[]'::jsonb;
  payment jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF _client_id IS NULL OR remaining <= 0 THEN RAISE EXCEPTION 'invalid_payment_amount'; END IF;

  SELECT user_id INTO owner_id
  FROM public.clients
  WHERE id = _client_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'client_not_found'; END IF;
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, true);

  FOR inst IN
    SELECT ci.*
    FROM public.contract_installments ci
    JOIN public.contracts c ON c.id = ci.contract_id AND c.user_id = ci.user_id
    WHERE ci.user_id = owner_id
      AND ci.client_id = _client_id
      AND ci.status NOT IN ('paid', 'cancelled')
      AND c.status IN ('active', 'overdue')
    ORDER BY ci.due_date NULLS FIRST, ci.installment_number NULLS FIRST, ci.id
    FOR UPDATE OF ci
  LOOP
    EXIT WHEN remaining <= 0;
    balance := round(greatest(0, coalesce(inst.amount, 0))
      + greatest(0, coalesce(inst.late_fee, 0))
      - greatest(0, coalesce(inst.paid_amount, 0)), 2);
    IF balance <= 0 THEN CONTINUE; END IF;

    allocation := round(least(remaining, balance), 2);
    payment := public.pay_installment(
      inst.id,
      round(greatest(0, coalesce(inst.paid_amount, 0)) + allocation, 2),
      allocation + 0.005 >= balance,
      _method,
      _receipt_url,
      CASE WHEN NULLIF(trim(_source_key), '') IS NULL THEN NULL
        ELSE trim(_source_key) || ':' || inst.id::text END
    );

    remaining := round(remaining - allocation, 2);
    IF (payment->>'status') = 'paid' THEN paid_count := paid_count + 1;
    ELSE partial_count := partial_count + 1;
    END IF;
    allocations := allocations || jsonb_build_array(jsonb_build_object(
      'installment_id', inst.id,
      'installment_number', inst.installment_number,
      'amount', allocation,
      'paid', (payment->>'status') = 'paid'
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'paid_installments', paid_count,
    'partial_installments', partial_count,
    'unallocated', remaining,
    'allocations', allocations,
    'origin', _origin
  );
END;
$$;

DROP FUNCTION IF EXISTS public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text);
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

REVOKE ALL ON FUNCTION public.system_register_payment(uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_pay_client_balance(uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_register_payment(uuid, numeric, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_pay_client_balance(uuid, numeric, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.system_renew_installment_interest(uuid, numeric, timestamptz, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260919110000_ensure_installment_financial_columns.sql
-- ═══════════════════════════════════════════════════════════
-- pay_installment lê estes campos de contract_installments%ROWTYPE. Bancos
-- criados antes da divisão financeira não têm essas colunas, o que faz TODO
-- pagamento falhar com: record "inst" has no field "scheduled_interest".
-- Aditivo: preserva todas as parcelas já existentes.

ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS scheduled_principal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_interest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_principal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_interest numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_fees numeric NOT NULL DEFAULT 0;

ALTER TABLE public.contract_installments
  ADD COLUMN IF NOT EXISTS receipt_url text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

NOTIFY pgrst, 'reload schema';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS principal_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interest_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_key text;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260920090000_fix_partial_payment_remaining_fees.sql
-- ═══════════════════════════════════════════════════════════
-- Mantém a parcela aberta quando o pagamento cobre apenas o principal
-- e ainda existem juros/multa de atraso.
-- A RPC anterior confiava somente em contract_installments.late_fee. Esse
-- campo pode estar desatualizado (o frontend calcula o encargo dinamicamente),
-- fazendo um pagamento parcial ser interpretado como quitação.
-- (Substituída pela versão final em 20260921090000, logo abaixo — mantida
-- aqui apenas para registrar a cadeia de correções.)

-- ═══════════════════════════════════════════════════════════
-- 20260921090000_fix_percentage_settlement_late_fee.sql
-- ═══════════════════════════════════════════════════════════
-- settle_percentage_installment (quitação de contratos "por porcentagem" e
-- "só juros") grava `amount = capital + juros` na parcela ANTES de chamar
-- pay_installment, para que o total_due inclua o capital.
--
-- Só que pay_installment recalcula a multa/juros de atraso dinamicamente
-- usando `inst.amount` como base do juros composto diário. Com `amount` já
-- inflado para capital + juros, um contrato atrasado passa a acumular juros
-- de atraso sobre o CAPITAL inteiro (não mais sobre a parcela periódica),
-- inflando o encargo calculado muito além do `_total` que a quitação enviou
-- — e a chamada falha com `payment_below_installment_balance`: a parcela
-- nunca dá baixa.
--
-- Para os modos 'percentage' e 'interest_only' o valor da parcela nunca foi
-- a base correta para essa fórmula (o job auto-late-fees já mantém
-- `late_fee` atualizado com a base certa todos os dias); a recomputação
-- dinâmica aqui é só uma rede de segurança para o dia corrente e não deve
-- rodar sobre um `amount` que a própria quitação acabou de inflar.

DROP FUNCTION IF EXISTS public.pay_installment(uuid, numeric, boolean, text, text, text);

CREATE OR REPLACE FUNCTION public.pay_installment(
  _installment_id uuid,
  _paid_total numeric,
  _mark_paid boolean DEFAULT true,
  _method text DEFAULT 'pix',
  _receipt_url text DEFAULT NULL,
  _source_key text DEFAULT NULL
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

  -- Recalcula o encargo com a mesma política exibida pelo app. O valor já
  -- gravado nunca é reduzido: ele pode conter um encargo materializado por
  -- uma execução anterior do job de atraso.
  base_amount := greatest(0, coalesce(inst.amount, 0));
  stored_late_fee := greatest(0, coalesce(inst.late_fee, 0));
  calculated_late_fee := 0;
  days_late := greatest(0, current_date - inst.due_date::date);

  -- 'percentage'/'interest_only': `amount` é o valor do ciclo (juros), mas na
  -- quitação (settle_percentage_installment) ele é reescrito para
  -- capital + juros antes desta chamada. Rodar o juros composto diário sobre
  -- essa base inflada cobraria juros de atraso sobre o capital inteiro.
  -- O `late_fee` já gravado (mantido em dia pelo job auto-late-fees) é
  -- suficiente para esses modos.
  IF inst.status NOT IN ('paid', 'cancelled') AND base_amount > 0 AND days_late > 0
     AND coalesce(contract_row.loan_mode, '') NOT IN ('percentage', 'interest_only') THEN
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
  total_due := round(base_amount + effective_late_fee, 2);
  old_paid := round(greatest(0, coalesce(inst.paid_amount, 0)), 2);

  -- O mesmo comprovante pode chegar novamente por retry do WhatsApp/Evolution.
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

  -- Primeiro encargos, depois juros e por fim principal. Os alvos acumulados
  -- impedem duplicação de lucro/caixa em vários pagamentos parciais.
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
    'remaining', greatest(0, round(total_due - new_paid, 2)),
    'status', next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_installment(uuid, numeric, boolean, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_installment(uuid, numeric, boolean, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════
-- 20260922090000_pay_installment_fee_discount.sql
-- ═══════════════════════════════════════════════════════════
-- Bug: "Dar desconto" / "Remover multa" (PayModal.tsx e PagamentoModal.tsx)
-- calculam o desconto só no frontend e mandam um `_paid_total` já reduzido
-- para pay_installment com `_mark_paid = true`. O RPC nunca soube de
-- desconto: ele recalcula o próprio `total_due` (base + multa/juros de
-- atraso) do zero e exige `_paid_total >= total_due`, então qualquer
-- desconto > 0 faz `_paid_total` ficar abaixo do total_due recalculado —
-- e a chamada falha com `payment_below_installment_balance`, deixando a
-- parcela em aberto mesmo o operador tendo "confirmado" o desconto na tela.
--
-- Fix: pay_installment ganha `_fee_discount`, um perdão explícito que só
-- reduz a multa/juros de atraso (nunca o principal — é limitado ao próprio
-- `effective_late_fee`) antes de calcular `total_due`. O valor efetivamente
-- perdoado volta no jsonb de resposta para auditoria.

DROP FUNCTION IF EXISTS public.pay_installment(uuid, numeric, boolean, text, text, text);

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

  -- Recalcula o encargo com a mesma política exibida pelo app. O valor já
  -- gravado nunca é reduzido: ele pode conter um encargo materializado por
  -- uma execução anterior do job de atraso.
  base_amount := greatest(0, coalesce(inst.amount, 0));
  stored_late_fee := greatest(0, coalesce(inst.late_fee, 0));
  calculated_late_fee := 0;
  days_late := greatest(0, current_date - inst.due_date::date);

  -- 'percentage'/'interest_only': `amount` é o valor do ciclo (juros), mas na
  -- quitação (settle_percentage_installment) ele é reescrito para
  -- capital + juros antes desta chamada. Rodar o juros composto diário sobre
  -- essa base inflada cobraria juros de atraso sobre o capital inteiro.
  -- O `late_fee` já gravado (mantido em dia pelo job auto-late-fees) é
  -- suficiente para esses modos.
  IF inst.status NOT IN ('paid', 'cancelled') AND base_amount > 0 AND days_late > 0
     AND coalesce(contract_row.loan_mode, '') NOT IN ('percentage', 'interest_only') THEN
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

  -- Desconto/perdão explícito, dado pelo operador na tela de pagamento
  -- ("Dar desconto" / "Remover multa"). Nunca alcança o principal: fica
  -- limitado ao próprio encargo calculado acima.
  applied_fee_discount := least(greatest(0, coalesce(_fee_discount, 0)), effective_late_fee);
  effective_late_fee := round(effective_late_fee - applied_fee_discount, 2);

  total_due := round(base_amount + effective_late_fee, 2);
  old_paid := round(greatest(0, coalesce(inst.paid_amount, 0)), 2);

  -- O mesmo comprovante pode chegar novamente por retry do WhatsApp/Evolution.
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

  -- Primeiro encargos, depois juros e por fim principal. Os alvos acumulados
  -- impedem duplicação de lucro/caixa em vários pagamentos parciais.
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

-- ═══════════════════════════════════════════════════════════
-- 20260922100000_reverse_percentage_settlement.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 20260922110000_fee_discount_full_settlement_only.sql
-- ═══════════════════════════════════════════════════════════
-- Bug: _fee_discount (20260922090000) era honrado mesmo com _mark_paid=false
-- (pagamento parcial). Isso é alcançável em PagamentoModal.tsx: o operador
-- arrasta o slider de desconto (fixa `payFeeDiscount`) e depois edita o campo
-- de valor manualmente para algo MENOR que o total já descontado — vira um
-- pagamento parcial com desconto.
--
-- O problema é que o desconto não é durável: ele só reduz o `total_due`
-- DESSA chamada. Na próxima leitura/pagamento (ou no próximo run do cron
-- auto-late-fees), `effective_late_fee := greatest(stored_late_fee,
-- calculated_late_fee)` recalcula a multa do zero — sem saber que um
-- desconto foi concedido — e o valor recalculado quase sempre volta a ser
-- maior que o stored (descontado), "desfazendo" o desconto silenciosamente.
-- Resultado: o operador registra um desconto que nunca chega a valer, e o
-- saldo do cliente volta a subir sozinho pouco depois.
--
-- Fix: desconto de encargo só é aceito quando a chamada efetivamente quita
-- a parcela (_mark_paid=true) — mesma regra que a UI de Cobrancas.tsx já
-- segue (lá o modo de desconto sempre mira o valor final, nunca parcial).
-- Isso elimina a ambiguidade em vez de tentar tornar o desconto parcial
-- "durável", que exigiria um novo mecanismo de rastreamento permanente sem
-- necessidade de produto clara para isso hoje.

DROP FUNCTION IF EXISTS public.pay_installment(uuid, numeric, boolean, text, text, text, numeric);

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

  IF inst.status NOT IN ('paid', 'cancelled') AND base_amount > 0 AND days_late > 0
     AND coalesce(contract_row.loan_mode, '') NOT IN ('percentage', 'interest_only') THEN
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

  -- Desconto só é aplicado quando a chamada quita a parcela: um desconto
  -- "parcial" não sobrevive à próxima recomputação (ver comentário acima),
  -- então nem chega a ser concedido — evita a ilusão de um desconto que some
  -- sozinho depois.
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

-- ═══════════════════════════════════════════════════════════
-- 20260922120000_renew_interest_amount_mismatch_guard.sql
-- ═══════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════
-- 20260922130000_dynamic_late_fee_tracks_settlement.sql
-- ═══════════════════════════════════════════════════════════
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

COMMIT;
