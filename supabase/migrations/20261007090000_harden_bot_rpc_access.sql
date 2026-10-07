-- Worker RPCs must never be callable by a public REST client.
BEGIN;
DO $migration$
DECLARE fn record; definition text;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'claim_whatsapp_event', 'claim_whatsapp_response_window',
      'claim_due_whatsapp_messages', 'claim_whatsapp_followups', 'claim_collection_dispatch'
    )
  LOOP
    definition := pg_get_functiondef(fn.oid);
    IF position('service_role_required' IN definition) = 0 THEN
      definition := regexp_replace(definition, '\mBEGIN\M',
        E'BEGIN\n  IF auth.role() IS DISTINCT FROM ''service_role'' THEN\n    RAISE EXCEPTION ''service_role_required'' USING ERRCODE = ''42501'';\n  END IF;', 'i');
      IF position('service_role_required' IN definition) = 0 THEN
        RAISE EXCEPTION 'Cannot secure worker RPC %', fn.proname;
      END IF;
      EXECUTE definition;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', fn.proname, fn.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', fn.proname, fn.args);
  END LOOP;
END;
$migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
