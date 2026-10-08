BEGIN;
-- Read-only financial events. Contract/installment status never proves cash.
CREATE OR REPLACE FUNCTION public.financial_analytics_report(_from date DEFAULT NULL,_to date DEFAULT NULL,_expected_owner uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
SET TimeZone='America/Sao_Paulo' AS $analytics$
DECLARE uid uuid:=auth.uid(); today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; result jsonb; wallet jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
 IF _expected_owner IS NOT NULL AND _expected_owner<>uid THEN RAISE EXCEPTION 'financial_owner_changed' USING ERRCODE='42501'; END IF;
 IF (_from IS NULL)<>(_to IS NULL) OR _from>_to OR (_from IS NOT NULL AND (NOT isfinite(_from) OR NOT isfinite(_to) OR _to-_from>3660)) THEN
  RAISE EXCEPTION 'invalid_financial_period' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM public.transactions WHERE user_id=uid)>50000 THEN RAISE EXCEPTION 'financial_event_limit' USING ERRCODE='54000'; END IF;
 wallet:=public.wallet_cash_report(NULL,'',0,1);
 WITH raw AS MATERIALIZED (
  SELECT t.*,round(amount,2) AS cash,CASE WHEN date IS NOT NULL AND isfinite(date) THEN (date AT TIME ZONE 'America/Sao_Paulo')::date ELSE NULL END AS day,
   CASE WHEN least(principal_amount,interest_amount,fee_amount,unallocated_amount)>=0
    AND principal_amount::text NOT IN ('NaN','Infinity','-Infinity') AND interest_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND fee_amount::text NOT IN ('NaN','Infinity','-Infinity') AND unallocated_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND round(principal_amount,2)+round(interest_amount,2)+round(fee_amount,2)+round(unallocated_amount,2)<=round(amount,2) THEN true ELSE false END AS classified
  FROM public.transactions t WHERE user_id=uid AND amount>0 AND type IN ('payment','partial_payment','loan','loan_disbursement')
   AND (date IS NULL OR NOT isfinite(date) OR (date AT TIME ZONE 'America/Sao_Paulo')::date<=today)
 ), receipts AS MATERIALIZED (
  SELECT id,contract_id,client_id,installment_id,CASE WHEN day IS NOT NULL THEN date ELSE NULL END AS date,day,coalesce(description,'Recebimento') AS description,category,cash AS amount,
   coalesce((SELECT name FROM public.clients c WHERE c.id=raw.client_id AND c.user_id=uid),'Recebimento registrado') AS client_name,
   CASE WHEN classified THEN round(principal_amount,2) ELSE 0 END AS principal,
   CASE WHEN classified THEN round(interest_amount,2) ELSE 0 END AS interest,
   CASE WHEN classified THEN round(fee_amount,2) ELSE 0 END AS fees,
   CASE WHEN classified THEN greatest(0,cash-round(principal_amount,2)-round(interest_amount,2)-round(fee_amount,2)) ELSE cash END AS unclassified
  FROM raw WHERE type IN ('payment','partial_payment')
 ), disbursements AS MATERIALIZED (
  SELECT id,contract_id,client_id,CASE WHEN day IS NOT NULL THEN date ELSE NULL END AS date,day,cash AS amount FROM raw WHERE type IN ('loan','loan_disbursement')
 ), expenses AS MATERIALIZED (
  SELECT 'expense:'||id::text AS id,description,category,round(amount,2) amount,date,(date AT TIME ZONE 'America/Sao_Paulo')::date AS day
  FROM public.expenses WHERE user_id=uid AND amount>0 AND date IS NOT NULL AND isfinite(date) AND (date AT TIME ZONE 'America/Sao_Paulo')::date<=today
  UNION ALL
  SELECT 'transaction:'||id::text,description,coalesce(category,'Pagamento a investidor'),round(amount,2),date,(date AT TIME ZONE 'America/Sao_Paulo')::date
  FROM public.transactions WHERE user_id=uid AND type='expense' AND amount>0 AND date IS NOT NULL AND isfinite(date) AND (date AT TIME ZONE 'America/Sao_Paulo')::date<=today
 ), capital AS (
  SELECT c.id AS contract_id,coalesce(d.amount,0) AS disbursed,coalesce(r.amount,0) AS returned,
   greatest(0,coalesce(d.amount,0)-coalesce(r.amount,0)) AS outstanding
  FROM public.contracts c
  LEFT JOIN (SELECT contract_id,sum(amount) amount FROM disbursements GROUP BY contract_id) d ON d.contract_id=c.id
  LEFT JOIN (SELECT contract_id,sum(principal) amount FROM receipts GROUP BY contract_id) r ON r.contract_id=c.id
  WHERE c.user_id=uid
 ), period_receipts AS (SELECT * FROM receipts WHERE _from IS NULL OR day BETWEEN _from AND _to)
 SELECT jsonb_build_object('wallet',wallet,
  'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY date DESC,id) FROM period_receipts r),'[]'::jsonb),
  'disbursements',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY date DESC,id) FROM disbursements d WHERE _from IS NULL OR day BETWEEN _from AND _to),'[]'::jsonb),
  'expenses',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY date DESC,id) FROM expenses e WHERE _from IS NULL OR day BETWEEN _from AND _to),'[]'::jsonb),
  'capital',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM capital c),'[]'::jsonb),
  'warnings',jsonb_build_object('contracts_without_disbursement',(SELECT count(*) FROM capital WHERE disbursed=0),
   'unlinked_principal',(SELECT coalesce(sum(principal),0) FROM receipts WHERE contract_id IS NULL))) INTO result;
 RETURN result;
END;
$analytics$;
REVOKE ALL ON FUNCTION public.financial_analytics_report(date,date,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.financial_analytics_report(date,date,uuid) TO authenticated;
ALTER FUNCTION public.financial_analytics_report(date,date,uuid) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
