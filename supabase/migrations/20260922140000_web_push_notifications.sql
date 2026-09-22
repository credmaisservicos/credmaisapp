-- Push notification de verdade (Web Push), não só o "Notification()" que só
-- funcionava com a aba aberta e dependia do Realtime estar de pé (achado da
-- auditoria de notificações — item 1).
--
-- Arquitetura: cada navegador/dispositivo que ativa "Notificações Push" nas
-- Configurações grava uma inscrição (endpoint + chaves públicas do push
-- service do navegador) em `push_subscriptions`. Um gatilho em
-- `public.notifications` chama a function `send-push` (via pg_net) a cada
-- INSERT — assim TODO ponto do código que já cria uma notificação (bot do
-- WhatsApp, crons de atraso/metas, etc.) passa a disparar push automático,
-- sem precisar editar cada um deles.

-- pg_net cria e usa seu próprio schema `net` (não é relocável de forma
-- confiável entre versões) — por isso não especificamos WITH SCHEMA aqui.
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;

-- Gatilho: toda notificação nova tenta empurrar um push (a function `send-push`
-- decide, por usuário, se ele tem push ativado e inscrições válidas — o
-- gatilho só avisa que "algo foi criado", não decide nada sozinho).
CREATE OR REPLACE FUNCTION public.trigger_send_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://credmaisapp-supabase.fcoipz.easypanel.host/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'j2UTq0Y4z-fxj8vbqryGTF6G8SMfNBWWjqxSCe7EGOY'
    ),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'user_id', NEW.user_id,
      'message', NEW.message,
      'from', NEW.from,
      'link', NEW.link,
      'type', NEW.type
    ),
    timeout_milliseconds := 8000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Uma falha ao ENFILEIRAR o push (ex.: pg_net indisponível) nunca pode
  -- impedir a notificação em si de ser gravada — só registra e segue.
  RAISE WARNING 'trigger_send_push_notification falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_push_on_insert ON public.notifications;
CREATE TRIGGER notifications_push_on_insert
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_send_push_notification();

NOTIFY pgrst, 'reload schema';
