BEGIN;
SET LOCAL lock_timeout='5s';
-- Only the server supplies claims after checking Auth/RLS or a portal token.
-- A URL stored by a user is insufficient evidence that the object is theirs.
CREATE FUNCTION public.authorize_upload_objects(_claims jsonb) RETURNS TABLE(path text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
 SELECT DISTINCT o.name FROM jsonb_to_recordset(
  CASE WHEN jsonb_typeof(_claims)='array' AND jsonb_array_length(_claims)<=200 THEN _claims ELSE '[]'::jsonb END
 ) AS c(path text,owner_id uuid,client_id uuid)
 JOIN storage.objects o ON o.bucket_id='uploads' AND o.name=c.path
 WHERE c.owner_id IS NOT NULL AND (
  (split_part(o.name,'/',1)=c.owner_id::text)
  OR (split_part(o.name,'/',1)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND o.owner_id=c.owner_id::text)
  OR (c.client_id IS NOT NULL AND o.name LIKE 'portal-receipts/'||c.client_id::text||'/%'
    AND EXISTS(SELECT 1 FROM public.clients client WHERE client.id=c.client_id AND client.user_id=c.owner_id))
 );
 $$;
ALTER FUNCTION public.authorize_upload_objects(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.authorize_upload_objects(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_upload_objects(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
