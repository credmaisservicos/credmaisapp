BEGIN;
CREATE TABLE public.payment_classification_history (
 request_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 installment_id uuid NOT NULL,
 transaction_id uuid NOT NULL,
 reason text NOT NULL,
 evidence text NOT NULL,
 payload jsonb NOT NULL,
 before_state jsonb NOT NULL,
 after_state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_classification_history_owner ON public.payment_classification_history(user_id,installment_id,created_at DESC);
ALTER TABLE public.payment_classification_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_classification_history_owner_read ON public.payment_classification_history FOR SELECT TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON public.payment_classification_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.payment_classification_history TO authenticated,service_role;

CREATE FUNCTION public.keep_payment_classification_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'payment_classification_history_immutable'; END;
$$;
REVOKE ALL ON FUNCTION public.keep_payment_classification_history() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER payment_classification_history_immutable BEFORE UPDATE OR DELETE ON public.payment_classification_history
FOR EACH ROW EXECUTE FUNCTION public.keep_payment_classification_history();

-- A cancelled request stays fenced even if an earlier HTTP attempt arrives later.
CREATE TABLE public.payment_classification_cancellations (
 request_id uuid PRIMARY KEY,user_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_classification_cancellations ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_classification_cancellations_owner_read ON public.payment_classification_cancellations
 FOR SELECT TO authenticated USING(user_id=auth.uid());
REVOKE ALL ON public.payment_classification_cancellations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.payment_classification_cancellations TO authenticated,service_role;
CREATE TRIGGER payment_classification_cancellations_immutable BEFORE UPDATE OR DELETE ON public.payment_classification_cancellations
 FOR EACH ROW EXECUTE FUNCTION public.keep_payment_classification_history();

CREATE FUNCTION public.payment_classification_state(_installment_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id
   JOIN public.clients cl ON cl.id=c.client_id AND cl.user_id=uid
   WHERE i.id=_installment_id AND i.user_id=uid AND c.user_id=uid AND c.client_id=i.client_id)
 THEN RAISE EXCEPTION 'installment_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM public.transactions t JOIN public.contract_installments i ON i.id=t.installment_id
   WHERE i.id=_installment_id AND (t.user_id<>uid OR t.client_id IS DISTINCT FROM i.client_id OR t.contract_id IS DISTINCT FROM i.contract_id))
 OR EXISTS(SELECT 1 FROM public.profits p JOIN public.contract_installments i ON i.id=p.installment_id
   WHERE p.installment_id=_installment_id AND (p.user_id<>uid OR p.client_id IS DISTINCT FROM i.client_id))
 THEN RAISE EXCEPTION 'payment_reference_mismatch'; END IF;
 SELECT jsonb_build_object(
  'installment',jsonb_build_object('id',i.id,'paid_amount',coalesce(i.paid_amount,0),'paid_principal',i.paid_principal,
   'paid_interest',i.paid_interest,'paid_fees',i.paid_fees,'status',i.status,'paid_at',i.paid_at),
  'transactions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'amount',t.amount,'date',t.date,
    'principal',t.principal_amount,'interest',t.interest_amount,'fees',t.fee_amount,'unallocated',t.unallocated_amount)
    ORDER BY t.date,t.id) FROM public.transactions t WHERE t.installment_id=i.id AND t.user_id=uid AND t.type='payment'),'[]'::jsonb),
  'profits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount,'status',p.status,'date',p.date) ORDER BY p.id)
    FROM public.profits p WHERE p.installment_id=i.id AND p.user_id=uid),'[]'::jsonb),
  'revision',(SELECT count(*) FROM public.payment_classification_history h WHERE h.installment_id=i.id AND h.user_id=uid)
 ) INTO result FROM public.contract_installments i WHERE i.id=_installment_id AND i.user_id=uid;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.payment_classification_state(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.payment_classification_detail(_installment_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb; history jsonb; received numeric;
BEGIN
 state:=public.payment_classification_state(_installment_id);
 SELECT coalesce(sum(t.amount),0) INTO received FROM public.transactions t
 WHERE t.installment_id=_installment_id AND t.user_id=auth.uid() AND t.type='payment';
 SELECT coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) INTO history FROM (
  SELECT h.request_id,h.transaction_id,h.reason,h.evidence,h.created_at
  FROM public.payment_classification_history h WHERE h.installment_id=_installment_id AND h.user_id=auth.uid()
  ORDER BY h.created_at DESC,h.request_id LIMIT 20
 ) rows;
 RETURN jsonb_build_object('version',md5(state::text),'installment',state->'installment','transactions',state->'transactions',
  'history',history,'can_reconcile',received>0 AND received=(state->'installment'->>'paid_amount')::numeric);
END;
$$;
REVOKE ALL ON FUNCTION public.payment_classification_detail(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.payment_classification_detail(uuid) TO authenticated;

CREATE FUNCTION public.reclassify_payment_receipt(
 _request_id uuid,_expected_owner uuid,_transaction_id uuid,_expected_version text,
 _principal numeric,_interest numeric,_fees numeric,_reason text,_evidence text,_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); tx public.transactions%ROWTYPE; inst public.contract_installments%ROWTYPE;
 prior public.payment_classification_history%ROWTYPE; before_value jsonb; after_value jsonb; payload_value jsonb;
 received numeric; principal_total numeric; interest_total numeric; fees_total numeric; last_received timestamptz;
BEGIN
 IF uid IS NULL OR uid IS DISTINCT FROM _expected_owner THEN RAISE EXCEPTION 'auth_required'; END IF;
 IF _request_id IS NULL OR _confirmed IS DISTINCT FROM true OR coalesce(length(btrim(_reason)),0) NOT BETWEEN 10 AND 1000
   OR coalesce(length(btrim(_evidence)),0) NOT BETWEEN 8 AND 1000 OR nullif(_expected_version,'') IS NULL
 THEN RAISE EXCEPTION 'classification_evidence_required'; END IF;
 IF _principal IS NULL OR _interest IS NULL OR _fees IS NULL
  OR _principal::text IN('NaN','Infinity','-Infinity') OR _interest::text IN('NaN','Infinity','-Infinity') OR _fees::text IN('NaN','Infinity','-Infinity')
  OR least(_principal,_interest,_fees)<0 OR greatest(_principal,_interest,_fees)>1000000000000
  OR _principal<>round(_principal,2) OR _interest<>round(_interest,2) OR _fees<>round(_fees,2)
 THEN RAISE EXCEPTION 'invalid_classification_amounts'; END IF;
 payload_value:=jsonb_build_object('transaction_id',_transaction_id,'version',_expected_version,'principal',_principal,
  'interest',_interest,'fees',_fees,'reason',btrim(_reason),'evidence',btrim(_evidence));
 -- Serialize the request ID before consulting the journal, including across tabs.
 PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text,0));
 SELECT * INTO prior FROM public.payment_classification_history WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.user_id<>uid OR prior.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'classification_request_conflict'; END IF;
  RETURN jsonb_build_object('ok',true,'request_id',_request_id,'replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.payment_classification_cancellations WHERE request_id=_request_id)
 THEN RAISE EXCEPTION 'classification_cancelled'; END IF;
 SELECT * INTO tx FROM public.transactions WHERE id=_transaction_id AND user_id=uid AND type='payment' AND installment_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt_not_found'; END IF;
 SELECT * INTO inst FROM public.contract_installments WHERE id=tx.installment_id AND user_id=uid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt_not_found'; END IF;
 PERFORM t.id FROM public.transactions t WHERE t.installment_id=inst.id AND t.user_id=uid ORDER BY t.id FOR UPDATE;
 PERFORM p.id FROM public.profits p WHERE p.installment_id=inst.id AND p.user_id=uid ORDER BY p.id FOR UPDATE;
 SELECT * INTO tx FROM public.transactions WHERE id=_transaction_id AND user_id=uid AND type='payment' AND installment_id=inst.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt_not_found'; END IF;
 before_value:=public.payment_classification_state(inst.id);
 IF md5(before_value::text)<>_expected_version THEN RAISE EXCEPTION 'classification_changed'; END IF;
 IF tx.amount<=0 OR tx.amount<>round(tx.amount,2) OR _principal+_interest+_fees<>tx.amount
 THEN RAISE EXCEPTION 'classification_total_mismatch'; END IF;
 SELECT coalesce(sum(t.amount),0),max(t.date) INTO received,last_received FROM public.transactions t
 WHERE t.installment_id=inst.id AND t.user_id=uid AND t.type='payment';
 IF received IS DISTINCT FROM inst.paid_amount THEN RAISE EXCEPTION 'classification_cash_mismatch'; END IF;
 UPDATE public.transactions SET principal_amount=_principal,interest_amount=_interest,fee_amount=_fees,unallocated_amount=0 WHERE id=tx.id AND user_id=uid;
 SELECT coalesce(sum(t.principal_amount),0),coalesce(sum(t.interest_amount),0),coalesce(sum(t.fee_amount),0)
 INTO principal_total,interest_total,fees_total FROM public.transactions t WHERE t.installment_id=inst.id AND t.user_id=uid AND t.type='payment';
 UPDATE public.contract_installments SET paid_principal=principal_total,paid_interest=interest_total,paid_fees=fees_total WHERE id=inst.id AND user_id=uid;
 -- Preserve the original profit timestamp/status when its record already exists.
 UPDATE public.profits SET amount=interest_total+fees_total WHERE installment_id=inst.id AND user_id=uid;
 IF NOT FOUND AND interest_total+fees_total>0 THEN
  INSERT INTO public.profits(user_id,client_id,installment_id,amount,description,date)
  VALUES(uid,inst.client_id,inst.id,interest_total+fees_total,'Classificação manual de recebimentos',last_received);
 END IF;
 after_value:=public.payment_classification_state(inst.id);
 INSERT INTO public.payment_classification_history(request_id,user_id,installment_id,transaction_id,reason,evidence,payload,before_state,after_state)
 VALUES(_request_id,uid,inst.id,tx.id,btrim(_reason),btrim(_evidence),payload_value,before_value,after_value);
 RETURN jsonb_build_object('ok',true,'request_id',_request_id,'replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.reclassify_payment_receipt(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reclassify_payment_receipt(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,boolean) TO authenticated;

CREATE FUNCTION public.cancel_payment_classification(_request_id uuid,_expected_owner uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid uuid:=auth.uid(); prior public.payment_classification_history%ROWTYPE; cancelled_owner uuid;
BEGIN
 IF uid IS NULL OR uid IS DISTINCT FROM _expected_owner OR _request_id IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text,0));
 SELECT * INTO prior FROM public.payment_classification_history WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.user_id<>uid THEN RAISE EXCEPTION 'auth_required'; END IF;
  RETURN jsonb_build_object('ok',true,'request_id',_request_id,'cancelled',false,'replayed',true);
 END IF;
 SELECT user_id INTO cancelled_owner FROM public.payment_classification_cancellations WHERE request_id=_request_id;
 IF FOUND AND cancelled_owner<>uid THEN RAISE EXCEPTION 'auth_required'; END IF;
 INSERT INTO public.payment_classification_cancellations(request_id,user_id) VALUES(_request_id,uid) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true,'request_id',_request_id,'cancelled',true);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_payment_classification(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_payment_classification(uuid,uuid) TO authenticated;
ALTER TABLE public.payment_classification_history OWNER TO postgres;
ALTER TABLE public.payment_classification_cancellations OWNER TO postgres;
ALTER FUNCTION public.keep_payment_classification_history() OWNER TO postgres;
ALTER FUNCTION public.payment_classification_state(uuid) OWNER TO postgres;
ALTER FUNCTION public.payment_classification_detail(uuid) OWNER TO postgres;
ALTER FUNCTION public.reclassify_payment_receipt(uuid,uuid,uuid,text,numeric,numeric,numeric,text,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.cancel_payment_classification(uuid,uuid) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
