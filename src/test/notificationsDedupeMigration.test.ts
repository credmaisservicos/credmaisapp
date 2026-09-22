import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260922150000_notifications_dedupe_key.sql"),
  "utf8",
);

describe("migração: dedupe_key em notifications", () => {
  it("adiciona a coluna e um índice único parcial (NULL sempre livre)", () => {
    // Regressão: o check-then-insert antigo tinha uma corrida (TOCTOU) — duas
    // execuções próximas do mesmo cron podiam duplicar a mesma notificação.
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS dedupe_key text/i);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_type_dedupe_key_idx\s*\n\s*ON public\.notifications \(user_id, type, dedupe_key\)\s*\n\s*WHERE dedupe_key IS NOT NULL/i,
    );
  });
});
