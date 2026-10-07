BEGIN;
-- A receipt amount is newly received money, never the accumulated paid total.
CREATE OR REPLACE FUNCTION public.confirm_whatsapp_receipt(_review_id uuid,_received_amount numeric,_next_due_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE review public.whatsapp_receipt_reviews%rowtype; inst public.contract_installments%rowtype; result jsonb; remaining numeric; received numeric; allocations jsonb:='[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  SELECT * INTO review FROM public.whatsapp_receipt_reviews WHERE id=_review_id AND user_id=auth.uid() FOR UPDATE;
  IF review.id IS NULL THEN RAISE EXCEPTION 'receipt_review_not_found'; END IF;
  IF review.status='approved' THEN RETURN jsonb_build_object('ok',true,'already_approved',true); END IF;
  IF review.status<>'pending' THEN RAISE EXCEPTION 'receipt_review_not_pending'; END IF;
  IF _received_amount IS NULL OR _received_amount<=0 THEN RAISE EXCEPTION 'received_amount_required'; END IF;
  SELECT * INTO inst FROM public.contract_installments WHERE id=review.installment_id AND user_id=auth.uid() AND client_id=review.client_id FOR UPDATE;
  IF inst.id IS NULL OR inst.status IN ('paid','cancelled') THEN RAISE EXCEPTION 'installment_not_open'; END IF;
  IF review.metadata->>'payment_kind'='interest_only' THEN
    IF _next_due_date IS NULL OR _next_due_date<=greatest(current_date,inst.due_date) THEN RAISE EXCEPTION 'future_renewal_due_date_required'; END IF;
    IF coalesce(inst.paid_amount,0)>0 THEN RAISE EXCEPTION 'partial_payment_requires_manual_reconciliation'; END IF;
    result:=public.renew_installment_interest(inst.id,_next_due_date,'pix','Comprovante conferido '||review.id::text,NULL);
    IF abs(round(_received_amount,2)-coalesce((result->>'amount')::numeric,0))>=0.01 THEN RAISE EXCEPTION 'renewal_amount_mismatch'; END IF;
    UPDATE public.whatsapp_receipt_reviews SET amount=round(_received_amount,2),status='approved',reviewed_at=now(),reviewed_by=auth.uid(),
      metadata=coalesce(metadata,'{}')||jsonb_build_object('next_due_date',_next_due_date) WHERE id=review.id;
    RETURN jsonb_build_object('ok',true,'review_id',review.id,'renewal',result);
  END IF;
  remaining:=round(_received_amount,2);
  FOR inst IN SELECT i.* FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id AND c.user_id=auth.uid()
    WHERE i.user_id=auth.uid() AND i.client_id=review.client_id AND i.status NOT IN ('paid','cancelled') AND c.status IN ('active','overdue')
    ORDER BY CASE WHEN i.id=review.installment_id THEN 0 ELSE 1 END,i.due_date,i.id FOR UPDATE OF i
  LOOP
    EXIT WHEN remaining<0.01;
    result:=public.pay_installment(inst.id,coalesce(inst.paid_amount,0)+remaining,false,'pix',NULL,'wa-reviewed:'||review.id::text||':'||inst.id::text);
    received:=coalesce((result->>'received')::numeric,0);
    IF received<=0 THEN RAISE EXCEPTION 'payment_allocation_unavailable'; END IF;
    remaining:=round(remaining-received,2);
    allocations:=allocations||jsonb_build_array(result);
  END LOOP;
  IF remaining>=0.01 THEN RAISE EXCEPTION 'payment_exceeds_open_balance'; END IF;
  UPDATE public.whatsapp_receipt_reviews SET amount=round(_received_amount,2),status='approved',reviewed_at=now(),reviewed_by=auth.uid() WHERE id=review.id;
  RETURN jsonb_build_object('ok',true,'review_id',review.id,'allocations',allocations);
END; $$;
REVOKE ALL ON FUNCTION public.confirm_whatsapp_receipt(uuid,numeric,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_whatsapp_receipt(uuid,numeric,date) TO authenticated;
CREATE OR REPLACE FUNCTION public.approve_whatsapp_receipt(_review_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE received numeric;
BEGIN
  SELECT amount INTO received FROM public.whatsapp_receipt_reviews WHERE id=_review_id AND user_id=auth.uid();
  RETURN public.confirm_whatsapp_receipt(_review_id,received);
END; $$;
REVOKE ALL ON FUNCTION public.approve_whatsapp_receipt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_whatsapp_receipt(uuid) TO authenticated;
UPDATE public.settings SET bot_auto_confirm_payment=false WHERE bot_auto_confirm_payment=true;
NOTIFY pgrst,'reload schema';
COMMIT;
