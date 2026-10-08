-- Bind public portal payloads and privileged triggers to their owner.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.investor_portal_login(_token uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _investor public.investors%rowtype;
  _loans jsonb;
  _branding jsonb;
  _owner jsonb;
BEGIN
  IF _token IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _investor FROM public.investors
   WHERE access_token = _token AND status = 'active'
   LIMIT 1;
  IF _investor.id IS NULL THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(row_payload ORDER BY (row_payload->>'due_date') ASC), '[]'::jsonb)
    INTO _loans
  FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'principal', l.principal,
      'interest_rate', l.interest_rate,
      'total_due', l.total_due,
      'paid_amount', l.paid_amount,
      'start_date', l.start_date,
      'due_date', l.due_date,
      'frequency', l.frequency,
      'status', l.status,
      'payment_method', l.payment_method,
      'paid_at', l.paid_at,
      'notes', l.notes,
      'created_at', l.created_at,
      'payments', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'amount', p.amount, 'paid_at', p.paid_at,
          'method', p.method, 'receipt_url', p.receipt_url, 'notes', p.notes
        ) ORDER BY p.paid_at DESC)
        FROM public.investor_payments p WHERE p.loan_id = l.id AND p.user_id = _investor.user_id AND p.investor_id = _investor.id
      ), '[]'::jsonb)
    ) AS row_payload
    FROM public.investor_loans l
    WHERE l.investor_id = _investor.id AND l.user_id = _investor.user_id
  ) x;

  SELECT jsonb_build_object('name', p.name, 'pix_key', p.pix_key, 'pix_key_type', p.pix_key_type)
    INTO _owner
    FROM public.profiles p WHERE p.id = _investor.user_id;

  SELECT jsonb_build_object(
    'portal_title', s.portal_title,
    'portal_primary_color', s.portal_primary_color,
    'portal_contact_phone', s.portal_contact_phone,
    'portal_contact_email', s.portal_contact_email,
    'portal_logo_url', s.portal_logo_url,
    'company_name', s.company_name,
    'company_logo_url', s.company_logo_url
  ) INTO _branding FROM public.settings s WHERE s.user_id = _investor.user_id LIMIT 1;

  RETURN jsonb_build_object(
    'investor', jsonb_build_object(
      'id', _investor.id, 'name', _investor.name, 'email', _investor.email,
      'phone', _investor.phone, 'whatsapp', _investor.whatsapp,
      'cpf_cnpj', _investor.cpf_cnpj, 'avatar_url', _investor.avatar_url,
      'status', _investor.status
    ),
    'loans', _loans,
    'owner', coalesce(_owner, '{}'::jsonb),
    'branding', coalesce(_branding, '{}'::jsonb)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.collector_login_by_token(_token text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tok       public.collector_tokens%rowtype;
  _collector public.collectors%rowtype;
  _owner     jsonb;
  _branding  jsonb;
  _clientes  jsonb;
BEGIN
  IF _token IS NULL OR btrim(_token) = '' THEN RETURN NULL; END IF;

  SELECT * INTO _tok
    FROM public.collector_tokens
   WHERE token = btrim(_token) AND is_active
   LIMIT 1;
  IF _tok.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _collector FROM public.collectors WHERE id = _tok.collector_id AND user_id = _tok.user_id;
  -- Cobrador desativado perde o acesso mesmo com token ainda ativo.
  IF _collector.id IS NULL OR _collector.is_active IS NOT TRUE THEN RETURN NULL; END IF;

  -- SÃ³ os clientes atribuÃ­dos a ESTE cobrador, com as parcelas de cada um.
  SELECT coalesce(jsonb_agg(payload ORDER BY payload->>'name'), '[]'::jsonb)
  INTO _clientes
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'whatsapp', c.whatsapp,
      'cpf_cnpj', c.cpf_cnpj, 'email', c.email, 'status', c.status, 'address', c.address,
      'installments', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id, 'installment_number', i.installment_number, 'amount', i.amount,
          'due_date', i.due_date, 'status', i.status, 'paid_at', i.paid_at,
          'paid_amount', i.paid_amount, 'late_fee', i.late_fee,
          'payment_method', i.payment_method, 'receipt_url', i.receipt_url,
          'contract_id', i.contract_id,
          'contract_status', ct.status,
          'has_active_settlement', i.pre_settlement_snapshot IS NOT NULL,
          'daily_interest_percent', ct.daily_interest_percent,
          'max_interest_cap_percent', ct.max_interest_cap_percent,
          'daily_penalty_type', ct.daily_penalty_type,
          'daily_penalty_value', ct.daily_penalty_value
        ) ORDER BY i.due_date ASC)
        FROM public.contract_installments i
        JOIN public.contracts ct ON ct.id = i.contract_id AND ct.user_id = _tok.user_id AND ct.client_id = c.id
        WHERE i.client_id = c.id AND i.user_id = _tok.user_id
      ), '[]'::jsonb)
    ) AS payload
    FROM public.collector_assignments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.collector_id = _tok.collector_id AND a.user_id = _tok.user_id AND c.user_id = _tok.user_id
  ) t;

  SELECT jsonb_build_object('name', p.name, 'pix_key', p.pix_key,
                            'pix_key_type', p.pix_key_type, 'billing_message', p.billing_message)
    INTO _owner FROM public.profiles p WHERE p.id = _tok.user_id;

  SELECT jsonb_build_object('company_name', s.company_name, 'company_logo_url', s.company_logo_url,
                            'portal_primary_color', s.portal_primary_color)
    INTO _branding FROM public.settings s WHERE s.user_id = _tok.user_id LIMIT 1;

  RETURN jsonb_build_object(
    'collector', jsonb_build_object(
      'id', _collector.id, 'name', _collector.name, 'phone', _collector.phone,
      'email', _collector.email, 'city', _collector.city, 'state', _collector.state,
      'created_at', _collector.created_at
    ),
    'owner_id', _tok.user_id,
    'owner', coalesce(_owner, '{}'::jsonb),
    'branding', coalesce(_branding, '{}'::jsonb),
    'clients', _clientes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.collector_register_payment(_token text, _installment_id uuid, _paid_total numeric, _method text DEFAULT 'dinheiro'::text, _receipt_url text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    SET "TimeZone" TO 'America/Sao_Paulo'
    AS $$
DECLARE
  _tok public.collector_tokens%rowtype; _collector public.collectors%rowtype;
  _inst public.contract_installments%rowtype; _prev numeric; _new numeric;
  _allocation record;
  _new_principal numeric; _new_interest numeric; _new_fees numeric; _remaining integer;
  _daily_rate numeric; _cap_percent numeric;
  _live_fee numeric; _expected_total numeric;
  _penalty_type text; _penalty_value numeric; _contract_status text;
BEGIN
  SELECT * INTO _tok FROM public.collector_tokens
  WHERE token = btrim(coalesce(_token,'')) AND is_active LIMIT 1;
  IF _tok.id IS NULL THEN RAISE EXCEPTION 'token_invalido'; END IF;
  SELECT * INTO _collector FROM public.collectors WHERE id = _tok.collector_id AND user_id = _tok.user_id;
  IF _collector.id IS NULL OR NOT _collector.is_active THEN RAISE EXCEPTION 'cobrador_inativo'; END IF;
  SELECT * INTO _inst FROM public.contract_installments WHERE id = _installment_id FOR UPDATE;
  IF _inst.id IS NULL THEN RAISE EXCEPTION 'parcela_nao_encontrada'; END IF;
  IF _inst.user_id IS DISTINCT FROM _tok.user_id THEN RAISE EXCEPTION 'parcela_de_outro_credor'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.collector_assignments a
    WHERE a.collector_id = _tok.collector_id AND a.client_id = _inst.client_id
      AND a.user_id = _tok.user_id) THEN RAISE EXCEPTION 'cliente_nao_atribuido'; END IF;
  IF _inst.status = 'cancelled' THEN RAISE EXCEPTION 'parcela_cancelada'; END IF;
  IF _inst.status = 'paid' THEN RETURN jsonb_build_object('ok', true, 'already_paid', true, 'new_money', 0); END IF;
  SELECT c.daily_interest_percent, c.max_interest_cap_percent,
    c.daily_penalty_type, c.daily_penalty_value, c.status
    INTO _daily_rate, _cap_percent, _penalty_type, _penalty_value, _contract_status
  FROM public.contracts c
  WHERE c.id = _inst.contract_id AND c.user_id = _tok.user_id AND c.client_id = _inst.client_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contrato_nao_encontrado'; END IF;
  IF _contract_status IN ('cancelled','canceled') THEN RAISE EXCEPTION 'contrato_cancelado'; END IF;
  _live_fee := public.quote_installment_late_fee(
    _inst.amount,_inst.due_date,_inst.status,_inst.late_fee,_inst.pre_settlement_snapshot,
    _daily_rate,_penalty_type,_penalty_value,_cap_percent);
  IF _paid_total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'valor_de_quitacao_invalido'; END IF;
  _prev := round(coalesce(_inst.paid_amount,0)::numeric,2);
  _paid_total := round(coalesce(_paid_total,0)::numeric,2);
  _expected_total := round((_inst.amount + _live_fee)::numeric, 2);
  IF _paid_total <= _prev OR abs(_paid_total - _expected_total) > 0.005 THEN
    RAISE EXCEPTION 'valor_de_quitacao_invalido';
  END IF;
  IF _method IS NULL OR _method NOT IN ('pix', 'dinheiro', 'transferencia') THEN RAISE EXCEPTION 'metodo_invalido'; END IF;
  IF _receipt_url IS NOT NULL AND length(_receipt_url) > 2048 THEN RAISE EXCEPTION 'comprovante_invalido'; END IF;
  _new := _paid_total - _prev;
  SELECT * INTO _allocation FROM public.allocate_installment_receipt(
    _new, _prev, _inst.paid_principal, _inst.paid_interest, _inst.paid_fees,
    _inst.amount, _live_fee, _inst.scheduled_interest);
  _new_principal := _allocation.principal_amount;
  _new_interest := _allocation.interest_amount;
  _new_fees := _allocation.fee_amount;
  UPDATE public.contract_installments SET paid_amount=_paid_total,
    paid_principal=coalesce(_inst.paid_principal,0)+_new_principal,
    paid_interest=coalesce(_inst.paid_interest,0)+_new_interest,
    paid_fees=coalesce(_inst.paid_fees,0)+_new_fees,
    late_fee=_live_fee, payment_method=_method,
    receipt_url=coalesce(_receipt_url,receipt_url), status='paid', paid_at=now()
  WHERE id=_installment_id;
  IF _new_interest+_new_fees > 0 THEN
    INSERT INTO public.profits(user_id,amount,description,client_id,installment_id)
    VALUES(_tok.user_id,_new_interest+_new_fees,'Juros e encargos parcela #'||_inst.installment_number,
      _inst.client_id,_installment_id)
    ON CONFLICT (installment_id) WHERE installment_id IS NOT NULL
    DO UPDATE SET amount=public.profits.amount+excluded.amount
      WHERE public.profits.user_id=_tok.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'profit_owner_mismatch'; END IF;
  END IF;
  INSERT INTO public.transactions(user_id,amount,type,category,description,client_id,contract_id,
    installment_id,principal_amount,interest_amount,fee_amount,unallocated_amount)
  VALUES(_tok.user_id,_new,'payment','installment_payment',
    'Pagamento parcela #'||_inst.installment_number||' recebido por '||_collector.name,
    _inst.client_id,_inst.contract_id,_installment_id,greatest(0,_new_principal),
    greatest(0,_new_interest),greatest(0,_new_fees),_allocation.unallocated_amount);
  INSERT INTO public.collection_attempts(user_id,client_id,contract_id,installment_id,channel,message_preview)
  VALUES(_tok.user_id,_inst.client_id,_inst.contract_id,_installment_id,'manual',
    'Pagamento de '||_new::text||' via '||coalesce(_method,'-')||' por '||_collector.name);
  SELECT count(*) INTO _remaining FROM public.contract_installments
  WHERE contract_id=_inst.contract_id AND user_id=_tok.user_id
    AND (status IS NULL OR status NOT IN ('paid', 'cancelled'));
  IF _remaining=0 THEN UPDATE public.contracts SET status='completed' WHERE id=_inst.contract_id; END IF;
  RETURN jsonb_build_object('ok',true,'new_money',_new,'principal',_new_principal,
    'interest',_new_interest,'fees',_new_fees,
    'allocation_pending_review',_allocation.review_required,'unallocated_amount',_allocation.unallocated_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_installment_collected() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.installment_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Only outbound collection channels mark "cobrado"
  IF NEW.channel IN ('whatsapp','email','sms','pix_copy','manual') THEN
    UPDATE public.contract_installments
    SET
      collection_status = 'cobrado',
      last_collected_at = COALESCE(NEW.created_at, now()),
      last_collected_channel = NEW.channel,
      collection_count = COALESCE(collection_count, 0) + 1
    WHERE id = NEW.installment_id AND user_id = NEW.user_id
      AND (NEW.client_id IS NULL OR client_id = NEW.client_id)
      AND (NEW.contract_id IS NULL OR contract_id = NEW.contract_id)
      AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
