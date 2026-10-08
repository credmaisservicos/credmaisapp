BEGIN;
-- The existing runtime schema was not recorded in migrations. Recreate it for
-- clean environments without deleting or resetting existing quotas.
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  key text PRIMARY KEY,
  tokens double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rate_limit_hits TO service_role;

CREATE OR REPLACE FUNCTION public.try_consume_rate_limit(
 _key text,_capacity double precision,_refill_per_sec double precision
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $quota$
DECLARE current_time_value timestamptz:=clock_timestamp(); available double precision;
 last_update timestamptz; elapsed double precision; retry_ms integer;
BEGIN
 IF nullif(btrim(_key),'')IS NULL OR length(_key)>512
   OR _capacity IS NULL OR _capacity::text IN ('NaN','Infinity','-Infinity') OR _capacity<1 OR _capacity>1000000
   OR _refill_per_sec IS NULL OR _refill_per_sec::text IN ('NaN','Infinity','-Infinity') OR _refill_per_sec<=0 OR _refill_per_sec>1000000 THEN
  RAISE EXCEPTION 'invalid_rate_limit' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.rate_limit_hits(key,tokens,updated_at)VALUES(_key,_capacity,current_time_value)ON CONFLICT(key)DO NOTHING;
 SELECT tokens,updated_at INTO available,last_update FROM public.rate_limit_hits WHERE key=_key FOR UPDATE;
 IF available IS NULL OR available::text IN ('NaN','Infinity','-Infinity') OR available<0
    OR last_update IS NULL OR NOT isfinite(last_update) THEN
  RAISE EXCEPTION 'invalid_rate_limit_state' USING ERRCODE='22023';
 END IF;
 -- Re-read the clock after waiting on another invocation's transaction.
 current_time_value:=clock_timestamp();
 elapsed:=greatest(0,extract(epoch FROM(current_time_value-last_update)));
 available:=least(_capacity,available+elapsed*_refill_per_sec);
 IF available::text IN ('NaN','Infinity','-Infinity') OR available<0 THEN
  RAISE EXCEPTION 'invalid_rate_limit_state' USING ERRCODE='22023';
 END IF;
 IF available>=1 THEN
  UPDATE public.rate_limit_hits SET tokens=available-1,updated_at=current_time_value WHERE key=_key;
  RETURN jsonb_build_object('allowed',true,'remaining',floor(available-1),'retry_after_ms',0);
 END IF;
 UPDATE public.rate_limit_hits SET tokens=available,updated_at=current_time_value WHERE key=_key;
 retry_ms:=least(2147483647,greatest(1,ceil(((1-available)/_refill_per_sec)*1000)))::integer;
 RETURN jsonb_build_object('allowed',false,'remaining',0,'retry_after_ms',retry_ms);
END;
$quota$;
ALTER FUNCTION public.try_consume_rate_limit(text,double precision,double precision)OWNER TO postgres;
REVOKE ALL ON FUNCTION public.try_consume_rate_limit(text,double precision,double precision)FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.try_consume_rate_limit(text,double precision,double precision)TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
