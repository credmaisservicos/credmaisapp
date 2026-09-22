-- Bug: cada gerador de notificação recorrente do operador (auto-notifications,
-- check-overdue) fazia "SELECT existe? pula : insere" antes de gravar — uma
-- corrida clássica (TOCTOU): se o cron disparar duas vezes de perto (retry,
-- sobreposição de execução), os dois SELECTs passam antes de qualquer INSERT
-- acontecer, e o operador recebe a mesma notificação duplicada.
--
-- `client_notifications` (auto-late-fees) já evita isso com um índice único
-- em (installment_id, type, dedupe_day) + upsert com ignoreDuplicates. Este
-- migration traz a mesma ideia pra `notifications` (operador), só que com uma
-- coluna livre (`dedupe_key`) em vez de uma data fixa: os avisos diários
-- (parcelas vencendo hoje, resumo de atraso, score baixo, teste expirando)
-- usam a data do dia como chave; "meta atingida" usa o próprio id da meta
-- (não é "uma vez por dia", é "uma vez pra sempre por meta batida" — o código
-- antigo tentava isso do jeito errado, procurando um pedaço do id DENTRO do
-- texto da mensagem com LIKE, que quebra silenciosamente se o texto mudar).
-- Eventos pontuais (pagamento recebido, handoff, etc.) continuam sem
-- dedupe_key (NULL), e múltiplos NULL nunca colidem num índice único — livres
-- pra acontecer quantas vezes for preciso no mesmo dia.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_type_dedupe_key_idx
  ON public.notifications (user_id, type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
