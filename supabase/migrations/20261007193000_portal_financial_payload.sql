-- Completa a cotação pública sem alterar parcelas, pagamentos ou permissões.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.collector_login_by_token(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT * INTO _collector FROM public.collectors WHERE id = _tok.collector_id;
  -- Cobrador desativado perde o acesso mesmo com token ainda ativo.
  IF _collector.id IS NULL OR _collector.is_active IS NOT TRUE THEN RETURN NULL; END IF;

  -- Só os clientes atribuídos a ESTE cobrador, com as parcelas de cada um.
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
$function$;

CREATE OR REPLACE FUNCTION public.portal_login_by_token(_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_id uuid;
  _client public.clients%rowtype;
  _contracts jsonb;
  _owner jsonb;
  _branding jsonb;
BEGIN
  IF _token IS NULL THEN RETURN NULL; END IF;

  SELECT client_id INTO _client_id
    FROM public.portal_sessions
   WHERE token = _token AND expires_at > now()
   LIMIT 1;

  IF _client_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO _client FROM public.clients WHERE id = _client_id;
  IF _client.id IS NULL OR lower(coalesce(_client.status, 'ativo')) NOT IN ('ativo', 'active') THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(contract_payload ORDER BY (contract_payload->>'created_at')::timestamptz DESC), '[]'::jsonb)
  INTO _contracts
  FROM (
    SELECT jsonb_build_object(
      'id', c.id, 'capital', c.capital, 'interest_rate', c.interest_rate,
      'num_installments', c.num_installments, 'installment_amount', c.installment_amount,
      'frequency', c.frequency, 'start_date', c.start_date, 'status', c.status,
      'total_amount', c.total_amount, 'total_interest', c.total_interest,
      'payment_method', c.payment_method, 'created_at', c.created_at,
      'late_fee_percent', c.late_fee_percent,
      'daily_interest_percent', c.daily_interest_percent,
      'max_interest_cap_percent', c.max_interest_cap_percent,
          'daily_penalty_type', c.daily_penalty_type,
          'daily_penalty_value', c.daily_penalty_value,
      'installments', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id, 'installment_number', i.installment_number, 'amount', i.amount,
          'due_date', i.due_date, 'paid_at', i.paid_at, 'paid_amount', i.paid_amount,
          'late_fee', i.late_fee, 'status', i.status, 'payment_method', i.payment_method,
          'receipt_url', i.receipt_url,
          'has_active_settlement', i.pre_settlement_snapshot IS NOT NULL,
          'late_fee_percent', c.late_fee_percent,
          'daily_interest_percent', c.daily_interest_percent,
          'max_interest_cap_percent', c.max_interest_cap_percent,
          'daily_penalty_type', c.daily_penalty_type,
          'daily_penalty_value', c.daily_penalty_value
        ) ORDER BY i.installment_number ASC, i.due_date ASC)
        FROM public.contract_installments i
        WHERE i.contract_id = c.id AND i.client_id = _client.id AND i.user_id = _client.user_id
      ), '[]'::jsonb)
    ) AS contract_payload
    FROM public.contracts c WHERE c.client_id = _client.id AND c.user_id = _client.user_id
  ) payload;

  SELECT jsonb_build_object('name', p.name, 'pix_key', p.pix_key, 'pix_key_type', p.pix_key_type)
  INTO _owner FROM public.profiles p WHERE p.id = _client.user_id;

  SELECT jsonb_build_object(
    'portal_title', s.portal_title, 'portal_subtitle', s.portal_subtitle,
    'portal_welcome_message', s.portal_welcome_message, 'portal_primary_color', s.portal_primary_color,
    'portal_contact_phone', s.portal_contact_phone, 'portal_contact_email', s.portal_contact_email,
    'portal_logo_url', s.portal_logo_url, 'company_name', s.company_name, 'company_logo_url', s.company_logo_url
  ) INTO _branding FROM public.settings s WHERE s.user_id = _client.user_id LIMIT 1;

  RETURN jsonb_build_object(
    'client', jsonb_build_object(
      'id', _client.id, 'name', _client.name, 'email', _client.email,
      'phone', _client.phone, 'whatsapp', _client.whatsapp,
      'cpf_cnpj', _client.cpf_cnpj, 'status', _client.status, 'birth_date', _client.birth_date
    ),
    'contracts', _contracts,
    'owner', coalesce(_owner, '{}'::jsonb),
    'branding', coalesce(_branding, '{}'::jsonb),
    'session_token', _token
  );
END;
$function$;

COMMIT;
