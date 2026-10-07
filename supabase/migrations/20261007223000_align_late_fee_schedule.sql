-- The scheduler remains GMT. Run the existing daily charge refresh at 00:05
-- in Sao Paulo (03:05 UTC), after the financial day has actually changed.
-- Do not create new automations or execute any charge batch during deployment.
DO $schedule$
DECLARE job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN RETURN; END IF;
  IF coalesce(current_setting('cron.timezone',true),'GMT') NOT IN ('GMT','UTC','Etc/UTC') THEN
    RAISE EXCEPTION 'cron_timezone_requires_review';
  END IF;
  FOR job IN SELECT jobid FROM cron.job
    WHERE strpos(command,'/functions/v1/auto-late-fees') > 0
      AND schedule = '5 0 * * *'
  LOOP
    PERFORM cron.alter_job(job.jobid, schedule := '5 3 * * *');
  END LOOP;
END;
$schedule$;
