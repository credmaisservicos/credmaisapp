BEGIN;

-- O painel de diagnÃ³stico da plataforma precisa enxergar a trilha global.
-- UsuÃ¡rios comuns continuam limitados pela polÃ­tica original ao prÃ³prio tenant.
DROP POLICY IF EXISTS audit_logs_platform_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_platform_admin_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

COMMIT;

