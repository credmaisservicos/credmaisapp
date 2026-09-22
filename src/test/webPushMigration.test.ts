import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922140000_web_push_notifications.sql"),
  "utf8",
);

describe("migração: infraestrutura de Web Push", () => {
  it("cria push_subscriptions com RLS restrita ao dono", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.push_subscriptions/i);
    expect(migration).toMatch(/ALTER TABLE public\.push_subscriptions ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/FOR SELECT USING \(auth\.uid\(\) = user_id\)/i);
    expect(migration).toMatch(/FOR INSERT WITH CHECK \(auth\.uid\(\) = user_id\)/i);
    expect(migration).toMatch(/FOR DELETE USING \(auth\.uid\(\) = user_id\)/i);
  });

  it("dispara send-push automaticamente em todo INSERT em notifications", () => {
    // Regressão: sem o gatilho, cada ponto do código que cria uma notificação
    // (bot do WhatsApp, crons de atraso/metas) precisaria lembrar de chamar
    // send-push manualmente — fácil de esquecer em um novo call site.
    expect(migration).toMatch(/CREATE TRIGGER notifications_push_on_insert/i);
    expect(migration).toMatch(/AFTER INSERT ON public\.notifications/i);
    expect(migration).toMatch(/EXECUTE FUNCTION public\.trigger_send_push_notification/i);
  });

  it("uma falha ao enfileirar o push nunca derruba o INSERT da notificação", () => {
    expect(migration).toMatch(/EXCEPTION WHEN OTHERS THEN/i);
    expect(migration).toMatch(/RETURN NEW;/);
  });
});
