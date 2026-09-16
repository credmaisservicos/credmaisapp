BEGIN;

-- MantÃ©m o coletor disponÃ­vel para os portais pÃºblicos, mas impede que um
-- visitante atribua o erro a outro usuÃ¡rio ou envie payloads sem limite.
ALTER TABLE public.client_errors
  DROP CONSTRAINT IF EXISTS client_errors_rota_tamanho,
  DROP CONSTRAINT IF EXISTS client_errors_navegador_tamanho,
  DROP CONSTRAINT IF EXISTS client_errors_contexto_tamanho;

ALTER TABLE public.client_errors
  ADD CONSTRAINT client_errors_rota_tamanho
    CHECK (char_length(rota) <= 500) NOT VALID,
  ADD CONSTRAINT client_errors_navegador_tamanho
    CHECK (navegador IS NULL OR char_length(navegador) <= 400) NOT VALID,
  ADD CONSTRAINT client_errors_contexto_tamanho
    CHECK (octet_length(contexto::text) <= 8192) NOT VALID;

DROP POLICY IF EXISTS client_errors_insert ON public.client_errors;
CREATE POLICY client_errors_insert ON public.client_errors
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (auth.uid() IS NULL AND user_id IS NULL)
    OR
    (auth.uid() IS NOT NULL AND user_id = auth.uid())
  );

COMMIT;

