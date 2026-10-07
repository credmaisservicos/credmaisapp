BEGIN;
-- Read-only, owner-scoped snapshot. No backfill, allocation or cash mutation.
CREATE OR REPLACE FUNCTION public.wallet_cash_report(_days integer DEFAULT NULL,_search text DEFAULT '',_offset integer DEFAULT 0,_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp
SET TimeZone='America/Sao_Paulo' AS $wallet$
DECLARE uid uuid:=auth.uid(); today date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date; result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'auth_required' USING ERRCODE='42501'; END IF;
 IF (_days IS NOT NULL AND _days NOT IN (7,30,90)) OR coalesce(_offset,0)<0 OR coalesce(_limit,50) NOT BETWEEN 1 AND 100
   OR length(coalesce(_search,''))>200 THEN RAISE EXCEPTION 'invalid_wallet_filter' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.transactions WHERE user_id=uid AND (amount::text IN ('NaN','Infinity','-Infinity') OR amount<0))
   OR EXISTS(SELECT 1 FROM public.expenses WHERE user_id=uid AND (amount::text IN ('NaN','Infinity','-Infinity') OR amount<0))
   OR EXISTS(SELECT 1 FROM public.contract_installments WHERE user_id=uid AND (paid_amount::text IN ('NaN','Infinity','-Infinity') OR paid_amount<0)) THEN
   RAISE EXCEPTION 'invalid_wallet_amount' USING ERRCODE='22003';
 END IF;
 WITH receipts AS MATERIALIZED (
   SELECT t.*,round(amount,2) AS cash,
     CASE WHEN least(principal_amount,interest_amount,fee_amount,unallocated_amount)>=0
       AND principal_amount::text NOT IN ('NaN','Infinity','-Infinity') AND interest_amount::text NOT IN ('NaN','Infinity','-Infinity')
       AND fee_amount::text NOT IN ('NaN','Infinity','-Infinity') AND unallocated_amount::text NOT IN ('NaN','Infinity','-Infinity')
       AND round(principal_amount,2)+round(interest_amount,2)+round(fee_amount,2)+round(unallocated_amount,2)<=round(amount,2) THEN true ELSE false END AS valid_allocation
   FROM public.transactions t WHERE user_id=uid AND type IN ('payment','partial_payment') AND amount>0
 ), installment_groups AS (
   SELECT contract_id,client_id,round(sum(coalesce(paid_amount,0)),2) AS received
   FROM public.contract_installments WHERE user_id=uid AND paid_amount>0 GROUP BY contract_id,client_id
 ), ledger_groups AS (
   SELECT contract_id,client_id,sum(cash) AS received FROM receipts WHERE coalesce(category,'')<>'interest_renewal' GROUP BY contract_id,client_id
 ), gaps AS MATERIALIZED (
   SELECT i.contract_id,i.client_id,greatest(0,i.received-coalesce(l.received,0)) AS cash
   FROM installment_groups i LEFT JOIN ledger_groups l ON l.contract_id IS NOT DISTINCT FROM i.contract_id AND l.client_id IS NOT DISTINCT FROM i.client_id
 ), movements AS MATERIALIZED (
   SELECT 'transaction:'||r.id::text AS id,'in'::text AS type,coalesce(nullif(r.description,''),'Recebimento registrado') AS description,
     r.cash AS amount,r.date,CASE WHEN r.category='interest_renewal' THEN 'Juros de renovação' ELSE 'Recebimento' END AS source,
     false AS removable,NULL::uuid AS remove_id,'receipt'::text AS kind,
     CASE WHEN valid_allocation THEN round(principal_amount,2) ELSE 0 END AS principal,
     CASE WHEN valid_allocation THEN round(interest_amount,2)+round(fee_amount,2) ELSE 0 END AS profit,
     CASE WHEN valid_allocation THEN greatest(0,cash-round(principal_amount,2)-round(interest_amount,2)-round(fee_amount,2)) ELSE cash END AS unclassified
   FROM receipts r
   UNION ALL
   -- Contract/client coverage avoids counting unlinked legacy ledger and paid totals twice.
   -- A residual has no proven cash date and never borrows the final settlement date.
   SELECT 'legacy:'||coalesce(contract_id::text,'none')||':'||coalesce(client_id::text,'none'),'in',
     'Recebimento histórico sem lançamento completo',cash,NULL::timestamptz,'Recebimento legado',false,NULL::uuid,'legacy_receipt',0,0,cash
   FROM gaps WHERE cash>0
   UNION ALL
   SELECT 'transaction:'||t.id::text,CASE WHEN type='capital_injection' THEN 'in' ELSE 'out' END,
     coalesce(nullif(description,''),'Movimentação registrada'),round(amount,2),date,
     CASE WHEN type='capital_injection' THEN 'Aporte' WHEN type='capital_withdrawal' THEN 'Retirada de capital'
       WHEN type IN ('loan_disbursement','loan') THEN 'Empréstimo liberado' ELSE 'Pagamento a investidor' END,
     type IN ('capital_injection','capital_withdrawal'),CASE WHEN type IN ('capital_injection','capital_withdrawal') THEN id ELSE NULL END,
     CASE WHEN type IN ('loan_disbursement','loan') THEN 'disbursement' ELSE type END,0,0,0
   FROM public.transactions t WHERE user_id=uid AND type IN ('capital_injection','capital_withdrawal','loan_disbursement','loan','expense') AND amount>0
   UNION ALL
   SELECT 'expense:'||id::text,'out',coalesce(nullif(description,''),'Gasto registrado'),round(amount,2),date,
     coalesce(nullif(category,''),'Gasto'),false,NULL::uuid,'manual_expense',0,0,0 FROM public.expenses WHERE user_id=uid AND amount>0
 ), dated AS MATERIALIZED (
   SELECT *,CASE WHEN date IS NOT NULL AND isfinite(date) THEN (date AT TIME ZONE 'America/Sao_Paulo')::date ELSE NULL END AS day FROM movements
 ), booked AS MATERIALIZED (
   SELECT * FROM dated WHERE day IS NULL OR day<=today
 ), totals AS (
   SELECT coalesce(sum(amount) FILTER(WHERE type='in'),0) AS inflows,coalesce(sum(amount) FILTER(WHERE type='out'),0) AS outflows,
     coalesce(sum(amount) FILTER(WHERE kind='capital_injection'),0) AS capital,
     coalesce(sum(amount) FILTER(WHERE kind='capital_withdrawal'),0) AS withdrawals,
     coalesce(sum(amount) FILTER(WHERE kind IN ('receipt','legacy_receipt')),0) AS receipts,
     coalesce(sum(amount) FILTER(WHERE kind='disbursement'),0) AS disbursements,
     coalesce(sum(amount) FILTER(WHERE kind='expense'),0) AS ledger_expenses,
     coalesce(sum(amount) FILTER(WHERE kind='manual_expense'),0) AS manual_expenses,
     coalesce(sum(principal),0) AS principal,coalesce(sum(profit),0) AS profit,coalesce(sum(unclassified),0) AS unclassified,
     coalesce(sum(amount) FILTER(WHERE day IS NULL),0) AS undated_amount,
     coalesce(sum(amount) FILTER(WHERE kind='legacy_receipt'),0) AS legacy_gap_amount
   FROM booked
 ), current_period AS MATERIALIZED (
   SELECT * FROM booked WHERE _days IS NULL OR day BETWEEN today-(_days-1) AND today
 ), period_totals AS (
   SELECT coalesce(sum(amount) FILTER(WHERE type='in'),0) AS inflows,coalesce(sum(amount) FILTER(WHERE type='out'),0) AS outflows FROM current_period
 ), previous_totals AS (
   SELECT coalesce(sum(amount) FILTER(WHERE type='in'),0) AS inflows,coalesce(sum(amount) FILTER(WHERE type='out'),0) AS outflows
   FROM booked WHERE _days IS NOT NULL AND day BETWEEN today-(_days*2-1) AND today-_days
 ), filtered AS MATERIALIZED (
   SELECT * FROM current_period WHERE strpos(lower(description||' '||source),lower(btrim(coalesce(_search,''))))>0
 ), page AS (
   SELECT id,type,description AS desc,amount,CASE WHEN day IS NOT NULL THEN date ELSE NULL END AS date,source,removable,remove_id FROM filtered
   ORDER BY day DESC NULLS LAST,date DESC NULLS LAST,id DESC OFFSET coalesce(_offset,0) LIMIT coalesce(_limit,50)
 ), forecast AS (
   SELECT i.due_date,round(greatest(0,i.amount+public.quote_installment_late_fee(i.amount,i.due_date,i.status,i.late_fee,i.pre_settlement_snapshot,
     c.daily_interest_percent,c.daily_penalty_type,c.daily_penalty_value,c.max_interest_cap_percent)-coalesce(i.paid_amount,0)),2) AS balance
   FROM public.contract_installments i JOIN public.contracts c ON c.id=i.contract_id AND c.user_id=i.user_id AND c.client_id=i.client_id
   WHERE i.user_id=uid AND (i.status IS NULL OR i.status NOT IN ('paid','cancelled')) AND c.status IN ('active','overdue')
 ), forecast_totals AS (
   SELECT coalesce(sum(balance) FILTER(WHERE (due_date AT TIME ZONE 'America/Sao_Paulo')::date<=today+7),0) AS d7,
     coalesce(sum(balance) FILTER(WHERE (due_date AT TIME ZONE 'America/Sao_Paulo')::date<=today+30),0) AS d30,
     coalesce(sum(balance) FILTER(WHERE (due_date AT TIME ZONE 'America/Sao_Paulo')::date<=today+90),0) AS d90 FROM forecast
 )
 SELECT jsonb_build_object('as_of',now(),'financial_day',today,'totals',to_jsonb(t)||jsonb_build_object('balance',t.inflows-t.outflows),
   'period',jsonb_build_object('inflows',p.inflows,'outflows',p.outflows,'previous_inflows',prev.inflows,'previous_outflows',prev.outflows,
     'opening_balance',CASE WHEN _days IS NULL THEN 0 ELSE t.inflows-t.outflows-p.inflows+p.outflows END,'closing_balance',t.inflows-t.outflows),
   'forecast',to_jsonb(f),'timeline',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'timeline_count',(SELECT count(*) FROM filtered),
   'warnings',jsonb_build_object('undated_amount',t.undated_amount,'legacy_gap_amount',t.legacy_gap_amount,
     'unlinked_receipts',(SELECT count(*) FROM receipts WHERE installment_id IS NULL),
     'cash_above_installments',(SELECT coalesce(sum(greatest(0,l.received-coalesce(i.received,0))),0) FROM ledger_groups l
       LEFT JOIN installment_groups i ON i.contract_id IS NOT DISTINCT FROM l.contract_id AND i.client_id IS NOT DISTINCT FROM l.client_id),
     'future_amount',(SELECT coalesce(sum(amount),0) FROM dated WHERE day>today),
     'recorded_profit',(SELECT coalesce(sum(amount),0) FROM public.profits WHERE user_id=uid)))
 INTO result FROM totals t CROSS JOIN period_totals p CROSS JOIN previous_totals prev CROSS JOIN forecast_totals f;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(result->'totals') WHERE value::numeric::text IN ('NaN','Infinity','-Infinity') OR abs(value::numeric)>90071992547409.91) THEN
   RAISE EXCEPTION 'wallet_total_out_of_range' USING ERRCODE='22003';
 END IF;
 RETURN result;
END;
$wallet$;
REVOKE ALL ON FUNCTION public.wallet_cash_report(integer,text,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.wallet_cash_report(integer,text,integer,integer) TO authenticated;
ALTER FUNCTION public.wallet_cash_report(integer,text,integer,integer) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
