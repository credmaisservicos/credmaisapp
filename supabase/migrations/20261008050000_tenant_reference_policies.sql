-- Ownership of a new row is insufficient when it references another tenant.
-- Restrictive checks compose with the existing owner policies. No historical
-- row, cash event, principal, session or customer is rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';
-- A contract self-reference inside a policy would recursively expand its RLS.
-- This narrow predicate returns only whether the caller's own reference exists.
CREATE FUNCTION public.owned_contract_reference(_id uuid,_owner uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT _owner=auth.uid() AND EXISTS(SELECT 1 FROM public.contracts c WHERE c.id=_id AND c.user_id=_owner)
 $$;
ALTER FUNCTION public.owned_contract_reference(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.owned_contract_reference(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owned_contract_reference(uuid,uuid) TO authenticated;
CREATE POLICY tenant_contract_references ON public.contracts AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  EXISTS(SELECT 1 FROM public.clients c WHERE c.id=contracts.client_id AND c.user_id=contracts.user_id)
  AND (origin_contract_id IS NULL OR public.owned_contract_reference(origin_contract_id,user_id))
  AND (investor_loan_id IS NULL OR EXISTS(SELECT 1 FROM public.investor_loans l WHERE l.id=contracts.investor_loan_id AND l.user_id=contracts.user_id))
 );
CREATE POLICY tenant_installment_references ON public.contract_installments AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(EXISTS(SELECT 1 FROM public.contracts c WHERE c.id=contract_installments.contract_id
  AND c.user_id=contract_installments.user_id AND c.client_id=contract_installments.client_id));
CREATE POLICY tenant_assignment_references ON public.collector_assignments AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  EXISTS(SELECT 1 FROM public.collectors c WHERE c.id=collector_assignments.collector_id AND c.user_id=collector_assignments.user_id)
  AND EXISTS(SELECT 1 FROM public.clients c WHERE c.id=collector_assignments.client_id AND c.user_id=collector_assignments.user_id));
CREATE POLICY tenant_collector_token_reference ON public.collector_tokens AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(EXISTS(SELECT 1 FROM public.collectors c WHERE c.id=collector_tokens.collector_id AND c.user_id=collector_tokens.user_id));
CREATE POLICY tenant_transaction_references ON public.transactions AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  (client_id IS NULL OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=transactions.client_id AND c.user_id=transactions.user_id))
  AND (contract_id IS NULL OR EXISTS(SELECT 1 FROM public.contracts c WHERE c.id=transactions.contract_id AND c.user_id=transactions.user_id
    AND (transactions.client_id IS NULL OR c.client_id=transactions.client_id)))
  AND (installment_id IS NULL OR EXISTS(SELECT 1 FROM public.contract_installments i WHERE i.id=transactions.installment_id AND i.user_id=transactions.user_id
    AND (transactions.client_id IS NULL OR i.client_id=transactions.client_id) AND (transactions.contract_id IS NULL OR i.contract_id=transactions.contract_id)))
 );
CREATE POLICY tenant_conversation_client_reference ON public.whatsapp_conversations AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(client_id IS NULL OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=whatsapp_conversations.client_id AND c.user_id=whatsapp_conversations.user_id));
CREATE POLICY tenant_receipt_review_references ON public.whatsapp_receipt_reviews AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  (client_id IS NULL OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=whatsapp_receipt_reviews.client_id AND c.user_id=whatsapp_receipt_reviews.user_id))
  AND (installment_id IS NULL OR EXISTS(SELECT 1 FROM public.contract_installments i WHERE i.id=whatsapp_receipt_reviews.installment_id AND i.user_id=whatsapp_receipt_reviews.user_id
    AND (whatsapp_receipt_reviews.client_id IS NULL OR i.client_id=whatsapp_receipt_reviews.client_id))));
CREATE POLICY tenant_investor_loan_reference ON public.investor_loans AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(EXISTS(SELECT 1 FROM public.investors i WHERE i.id=investor_loans.investor_id AND i.user_id=investor_loans.user_id));
CREATE POLICY tenant_investor_payment_references ON public.investor_payments AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(EXISTS(SELECT 1 FROM public.investor_loans l WHERE l.id=investor_payments.loan_id
  AND l.user_id=investor_payments.user_id AND l.investor_id=investor_payments.investor_id));
CREATE POLICY tenant_collection_attempt_references ON public.collection_attempts AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  (client_id IS NULL OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=collection_attempts.client_id AND c.user_id=collection_attempts.user_id))
  AND (contract_id IS NULL OR EXISTS(SELECT 1 FROM public.contracts c WHERE c.id=collection_attempts.contract_id AND c.user_id=collection_attempts.user_id
    AND (collection_attempts.client_id IS NULL OR c.client_id=collection_attempts.client_id)))
  AND (installment_id IS NULL OR EXISTS(SELECT 1 FROM public.contract_installments i WHERE i.id=collection_attempts.installment_id AND i.user_id=collection_attempts.user_id
    AND (collection_attempts.client_id IS NULL OR i.client_id=collection_attempts.client_id) AND (collection_attempts.contract_id IS NULL OR i.contract_id=collection_attempts.contract_id)))
 );
CREATE POLICY tenant_profit_references ON public.profits AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  (client_id IS NULL OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=profits.client_id AND c.user_id=profits.user_id))
  AND (installment_id IS NULL OR EXISTS(SELECT 1 FROM public.contract_installments i WHERE i.id=profits.installment_id AND i.user_id=profits.user_id
    AND (profits.client_id IS NULL OR i.client_id=profits.client_id))));
CREATE POLICY tenant_collateral_references ON public.loan_collateral AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(EXISTS(SELECT 1 FROM public.contracts c WHERE c.id=loan_collateral.contract_id
  AND c.user_id=loan_collateral.user_id AND c.client_id=loan_collateral.client_id));
CREATE POLICY tenant_outbox_references ON public.whatsapp_scheduled_messages AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(
  EXISTS(SELECT 1 FROM public.whatsapp_conversations c WHERE c.id=whatsapp_scheduled_messages.conversation_id AND c.user_id=whatsapp_scheduled_messages.user_id)
  AND (client_id IS NULL OR EXISTS(SELECT 1 FROM public.clients c WHERE c.id=whatsapp_scheduled_messages.client_id AND c.user_id=whatsapp_scheduled_messages.user_id))
  AND (installment_id IS NULL OR EXISTS(SELECT 1 FROM public.contract_installments i WHERE i.id=whatsapp_scheduled_messages.installment_id AND i.user_id=whatsapp_scheduled_messages.user_id
    AND (whatsapp_scheduled_messages.client_id IS NULL OR i.client_id=whatsapp_scheduled_messages.client_id))));
CREATE POLICY tenant_whatsapp_message_reference ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated
 USING(true) WITH CHECK(EXISTS(SELECT 1 FROM public.whatsapp_conversations c WHERE c.id=whatsapp_messages.conversation_id AND c.user_id=whatsapp_messages.user_id));
NOTIFY pgrst,'reload schema';
COMMIT;
