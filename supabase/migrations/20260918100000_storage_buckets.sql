-- Buckets usados pelo app CredMais.
-- uploads e privado: o frontend trabalha com URLs assinadas.
-- backups e privado: somente Edge Functions com service role acessam.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('uploads', 'uploads', false, 15728640),
  ('backups', 'backups', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "uploads_select_own" ON storage.objects;
CREATE POLICY "uploads_select_own"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
);

DROP POLICY IF EXISTS "uploads_insert_own" ON storage.objects;
CREATE POLICY "uploads_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'uploads'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "uploads_update_own" ON storage.objects;
CREATE POLICY "uploads_update_own"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
)
WITH CHECK (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
);

DROP POLICY IF EXISTS "uploads_delete_own" ON storage.objects;
CREATE POLICY "uploads_delete_own"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'uploads'
  AND (owner_id = auth.uid()::text OR (storage.foldername(name))[1] = auth.uid()::text)
);
