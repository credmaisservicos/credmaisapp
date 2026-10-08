BEGIN;
-- New operations only. Historical cash is never backfilled or rewritten.
CREATE TABLE public.manual_cash_operations (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  operation text NOT NULL,
  request_payload jsonb NOT NULL,
  entry_id uuid,
  before_row jsonb,
  after_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
ALTER TABLE public.manual_cash_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_cash_operations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.manual_cash_operations OWNER TO postgres;

CREATE FUNCTION public.apply_manual_cash_operation(
  _request_id uuid, _expected_owner uuid, _operation text,
  _amount numeric DEFAULT NULL, _description text DEFAULT NULL, _date timestamptz DEFAULT NULL,
  _category text DEFAULT NULL, _entry_id uuid DEFAULT NULL, _expected jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET TimeZone='UTC'
AS $cash$
DECLARE uid uuid:=auth.uid(); payload jsonb; prior public.manual_cash_operations%ROWTYPE;
  expense public.expenses%ROWTYPE; capital public.transactions%ROWTYPE;
  target uuid; before_value jsonb; after_value jsonb; current_value jsonb; state text;
BEGIN
  IF uid IS NULL OR _expected_owner IS DISTINCT FROM uid THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
  IF _request_id IS NULL OR _operation IS NULL OR _operation NOT IN
    ('capital_injection','capital_withdrawal','expense_create','expense_update','expense_delete','capital_delete') THEN
    RAISE EXCEPTION 'invalid_manual_cash_operation' USING ERRCODE='22023';
  END IF;
  IF _operation IN ('capital_injection','capital_withdrawal','expense_create','expense_update') THEN
    IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity') OR _amount<=0
      OR _amount>90071992547409.91 OR _amount<>round(_amount,2)
      OR nullif(btrim(_description),'') IS NULL OR length(btrim(_description))>500
      OR _date IS NULL OR NOT isfinite(_date) OR extract(year FROM _date) NOT BETWEEN 1 AND 9999
      OR length(coalesce(btrim(_category),''))>100 THEN
      RAISE EXCEPTION 'invalid_manual_cash_values' USING ERRCODE='22023';
    END IF;
  ELSIF _amount IS NOT NULL OR _description IS NOT NULL OR _date IS NOT NULL OR _category IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_manual_cash_values' USING ERRCODE='22023';
  END IF;
  IF _operation IN ('expense_update','expense_delete','capital_delete') THEN
    IF _entry_id IS NULL THEN RAISE EXCEPTION 'invalid_manual_cash_target' USING ERRCODE='22023'; END IF;
  ELSIF _entry_id IS NOT NULL OR _expected IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_manual_cash_target' USING ERRCODE='22023';
  END IF;
  IF _operation IN ('expense_update','expense_delete') THEN
    IF _expected IS NULL OR jsonb_typeof(_expected)<>'object' OR _expected->>'id' IS DISTINCT FROM _entry_id::text
      OR _expected->>'user_id' IS DISTINCT FROM uid::text THEN
      RAISE EXCEPTION 'invalid_manual_cash_expected' USING ERRCODE='22023';
    END IF;
    _expected:=to_jsonb(jsonb_populate_record(NULL::public.expenses,_expected));
  ELSIF _expected IS NOT NULL THEN RAISE EXCEPTION 'invalid_manual_cash_expected' USING ERRCODE='22023';
  END IF;
  payload:=jsonb_build_object('operation',_operation,'amount',_amount,'description',btrim(_description),'date',_date,
    'category',nullif(btrim(_category),''),'entry_id',_entry_id,'expected',_expected);
  -- Same owner/request is serialized even when the HTTP response was lost.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':'||_request_id::text,0));
  SELECT * INTO prior FROM public.manual_cash_operations WHERE user_id=uid AND request_id=_request_id;
  IF FOUND THEN
    IF prior.operation='cancelled' THEN RAISE EXCEPTION 'manual_cash_cancelled' USING ERRCODE='P0001'; END IF;
    IF prior.request_payload<>payload THEN RAISE EXCEPTION 'manual_cash_request_conflict' USING ERRCODE='23505'; END IF;
    IF _operation LIKE 'expense_%' THEN SELECT to_jsonb(e) INTO current_value FROM public.expenses e WHERE id=prior.entry_id AND user_id=uid;
    ELSE SELECT to_jsonb(t) INTO current_value FROM public.transactions t WHERE id=prior.entry_id AND user_id=uid; END IF;
    state:=CASE WHEN current_value IS NULL THEN 'deleted' WHEN current_value=prior.after_row THEN 'applied' ELSE 'changed' END;
    RETURN jsonb_build_object('ok',true,'entry_id',prior.entry_id,'operation',_operation,'replayed',true,'current_state',state);
  END IF;
  IF _operation IN ('capital_injection','capital_withdrawal') THEN
    INSERT INTO public.transactions(user_id,type,amount,description,date,category,source_key)
      VALUES(uid,_operation,_amount,btrim(_description),_date,
        CASE WHEN _operation='capital_injection' THEN 'Aporte de capital' ELSE 'Retirada de capital' END,'manual-cash:'||_request_id::text)
      RETURNING * INTO capital;
    target:=capital.id;after_value:=to_jsonb(capital);
  ELSIF _operation='expense_create' THEN
    INSERT INTO public.expenses(user_id,amount,description,date,category)
      VALUES(uid,_amount,btrim(_description),_date,nullif(btrim(_category),'')) RETURNING * INTO expense;
    target:=expense.id;after_value:=to_jsonb(expense);
  ELSIF _operation IN ('expense_update','expense_delete') THEN
    SELECT * INTO expense FROM public.expenses WHERE id=_entry_id AND user_id=uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'manual_cash_not_found' USING ERRCODE='P0002'; END IF;
    before_value:=to_jsonb(expense);
    IF before_value<>_expected THEN RAISE EXCEPTION 'manual_cash_changed' USING ERRCODE='40001'; END IF;
    target:=expense.id;
    IF _operation='expense_delete' THEN DELETE FROM public.expenses WHERE id=target AND user_id=uid;
    ELSE UPDATE public.expenses SET amount=_amount,description=btrim(_description),date=_date,category=nullif(btrim(_category),'')
      WHERE id=target AND user_id=uid RETURNING * INTO expense;after_value:=to_jsonb(expense); END IF;
  ELSE
    SELECT * INTO capital FROM public.transactions WHERE id=_entry_id AND user_id=uid
      AND type IN ('capital_injection','capital_withdrawal') AND contract_id IS NULL AND installment_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'manual_cash_not_found' USING ERRCODE='P0002'; END IF;
    target:=capital.id;before_value:=to_jsonb(capital);
    DELETE FROM public.transactions WHERE id=target AND user_id=uid;
  END IF;
  INSERT INTO public.manual_cash_operations(user_id,request_id,operation,request_payload,entry_id,before_row,after_row)
    VALUES(uid,_request_id,_operation,payload,target,before_value,after_value);
  RETURN jsonb_build_object('ok',true,'entry_id',target,'operation',_operation,'replayed',false,
    'current_state',CASE WHEN after_value IS NULL THEN 'deleted' ELSE 'applied' END);
END;
$cash$;
REVOKE ALL ON FUNCTION public.apply_manual_cash_operation(uuid,uuid,text,numeric,text,timestamptz,text,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.apply_manual_cash_operation(uuid,uuid,text,numeric,text,timestamptz,text,uuid,jsonb) TO authenticated;
ALTER FUNCTION public.apply_manual_cash_operation(uuid,uuid,text,numeric,text,timestamptz,text,uuid,jsonb) OWNER TO postgres;

-- Reserving a cancelled request prevents a delayed first HTTP call from
-- arriving after the browser has abandoned its draft and creating cash.
CREATE FUNCTION public.cancel_manual_cash_operation(_request_id uuid,_expected_owner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET TimeZone='UTC'
AS $cancel$
DECLARE uid uuid:=auth.uid(); prior public.manual_cash_operations%ROWTYPE; current_value jsonb; state text;
BEGIN
 IF uid IS NULL OR uid IS DISTINCT FROM _expected_owner THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
 IF _request_id IS NULL THEN RAISE EXCEPTION 'invalid_manual_cash_operation' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':'||_request_id::text,0));
 SELECT * INTO prior FROM public.manual_cash_operations WHERE user_id=uid AND request_id=_request_id;
 IF NOT FOUND THEN
  INSERT INTO public.manual_cash_operations(user_id,request_id,operation,request_payload)VALUES(uid,_request_id,'cancelled','{}');
  RETURN jsonb_build_object('ok',true,'cancelled',true);
 END IF;
 IF prior.operation='cancelled' THEN RETURN jsonb_build_object('ok',true,'cancelled',true); END IF;
 IF prior.operation LIKE 'expense_%' THEN SELECT to_jsonb(e) INTO current_value FROM public.expenses e WHERE id=prior.entry_id AND user_id=uid;
 ELSE SELECT to_jsonb(t) INTO current_value FROM public.transactions t WHERE id=prior.entry_id AND user_id=uid; END IF;
 state:=CASE WHEN current_value IS NULL THEN 'deleted' WHEN current_value=prior.after_row THEN 'applied' ELSE 'changed' END;
 RETURN jsonb_build_object('ok',true,'cancelled',false,'entry_id',prior.entry_id,'operation',prior.operation,'replayed',true,'current_state',state);
END;
$cancel$;
REVOKE ALL ON FUNCTION public.cancel_manual_cash_operation(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.cancel_manual_cash_operation(uuid,uuid) TO authenticated;
ALTER FUNCTION public.cancel_manual_cash_operation(uuid,uuid) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
