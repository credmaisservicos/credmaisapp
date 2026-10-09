BEGIN;
-- Replace function only: preserve existing rows, ownership and grants.
CREATE OR REPLACE FUNCTION public.receive_business_payment(_receivable_id uuid,_amount numeric,_method text,_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid:=auth.uid(); receivable_row business_receivables%rowtype; op business_operations%rowtype; result uuid;
BEGIN
  IF uid IS NULL OR _request_id IS NULL THEN RAISE EXCEPTION 'Autenticação e identificação obrigatórias'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||_request_id::text,0));
  SELECT id INTO result FROM business_payments WHERE user_id=uid AND request_id=_request_id;IF result IS NOT NULL THEN RETURN result;END IF;
  SELECT o.* INTO op FROM business_operations o JOIN business_receivables br ON br.operation_id=o.id WHERE br.id=_receivable_id AND br.user_id=uid AND o.user_id=uid FOR UPDATE OF o;
  IF op.id IS NULL OR op.status='cancelled' THEN RAISE EXCEPTION 'Operação não encontrada'; END IF;
  SELECT * INTO receivable_row FROM business_receivables WHERE id=_receivable_id AND user_id=uid FOR UPDATE;
  IF receivable_row.status<>'pending' OR _amount IS NULL OR _amount<=0 OR round(_amount,2)<>_amount OR _amount>receivable_row.amount-receivable_row.paid_amount THEN RAISE EXCEPTION 'Pagamento deve ser maior que zero e não exceder o saldo'; END IF;
  INSERT INTO business_payments(user_id,operation_id,receivable_id,kind,amount,method,request_id) VALUES(uid,receivable_row.operation_id,receivable_row.id,'receipt',_amount,_method,_request_id) RETURNING id INTO result;
  UPDATE business_receivables SET paid_amount=paid_amount+_amount,status=CASE WHEN paid_amount+_amount=amount THEN 'paid' ELSE 'pending' END WHERE id=receivable_row.id;
  IF op.kind='sale' AND NOT EXISTS(SELECT 1 FROM business_receivables WHERE operation_id=op.id AND status='pending') THEN UPDATE business_operations SET status='completed' WHERE id=op.id; END IF;
  RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
