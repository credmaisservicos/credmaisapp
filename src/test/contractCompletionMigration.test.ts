// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { portalInstallmentAmount, accumulatedPaymentTotal } from '@/lib/portalAmounts';

const sql = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
const owner = "00000000-0000-0000-0000-000000000001";
const contractId = "00000000-0000-0000-0000-000000000002";
const installmentId = (number: number) => `00000000-0000-0000-0000-${String(number + 10).padStart(12, "0")}`;
let db: PGlite;

async function seed(statuses: Array<{ status: string | null; paid?: number; fee?: number }>) {
  await db.query(`INSERT INTO contracts (id, user_id, client_id, status) VALUES ($1, $2, $2, 'active')`, [contractId, owner]);
  for (const [index, row] of statuses.entries()) {
    await db.query(`INSERT INTO contract_installments
      (id, contract_id, user_id, client_id, installment_number, amount, due_date, status, paid_amount, late_fee)
      VALUES ($1, $2, $3, $3, $4, 100, current_date + 30, $5, $6, $7)`,
    [installmentId(index), contractId, owner, index + 1, row.status, row.paid ?? 0, row.fee ?? 0]);
  }
}

async function pay(number: number, total = 100, markPaid = true) {
  await db.query(`SELECT pay_installment($1::uuid, $2::numeric, $3::boolean)`, [installmentId(number), total, markPaid]);
}

async function state() {
  const result = await db.query<{ status: string; lifecycle_stage: string }>(
    `SELECT status, lifecycle_stage FROM contracts WHERE id = $1`, [contractId],
  );
  return result.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${owner}'::uuid $$;
    INSERT INTO auth.users VALUES ('${owner}');
    CREATE TABLE clients (id uuid PRIMARY KEY);
    INSERT INTO clients VALUES ('${owner}');
    CREATE TABLE contracts (
      id uuid PRIMARY KEY, user_id uuid, client_id uuid, status text,
      signature_status text DEFAULT 'not_required', daily_interest_percent numeric DEFAULT 4,
      daily_penalty_value numeric DEFAULT 0, daily_penalty_type text DEFAULT 'percentage',
      max_interest_cap_percent numeric DEFAULT 0
    );
    CREATE TABLE contract_installments (
      id uuid PRIMARY KEY, contract_id uuid REFERENCES contracts(id) ON DELETE CASCADE,
      user_id uuid, client_id uuid, installment_number integer, amount numeric, due_date date,
      status text, paid_amount numeric DEFAULT 0, late_fee numeric DEFAULT 0,
      scheduled_interest numeric DEFAULT 10, scheduled_principal numeric DEFAULT 90,
      paid_fees numeric DEFAULT 0, paid_interest numeric DEFAULT 0, paid_principal numeric DEFAULT 0,
      paid_at timestamptz, payment_method text, receipt_url text, pre_settlement_snapshot jsonb
    );
    CREATE TABLE transactions (
      user_id uuid, amount numeric, type text, category text, description text,
      client_id uuid, contract_id uuid, installment_id uuid, principal_amount numeric,
      interest_amount numeric, fee_amount numeric, source_key text
    );
    CREATE TABLE profits (user_id uuid, amount numeric, description text, client_id uuid, installment_id uuid);
    CREATE UNIQUE INDEX uq_profit_installment ON profits(installment_id) WHERE installment_id IS NOT NULL;
    CREATE TABLE collector_tokens(id uuid,token text,collector_id uuid,user_id uuid,is_active boolean);
    CREATE TABLE collectors(id uuid,is_active boolean,name text);
    CREATE TABLE collector_assignments(collector_id uuid,user_id uuid,client_id uuid);
    CREATE TABLE collection_attempts(user_id uuid,client_id uuid,contract_id uuid,installment_id uuid,channel text,message_preview text);
  `);
  await db.exec(sql("20260905110000_contract_lifecycle.sql"));
  await db.exec(sql("20260922130000_dynamic_late_fee_tracks_settlement.sql"));
  await db.exec(sql("20261006120000_guard_contract_completion.sql"));
}, 30_000);

beforeEach(async () => {
  await db.exec("TRUNCATE contracts, transactions, profits CASCADE");
  await db.exec(sql("20261007210000_incremental_payment_ledger.sql"));
});

afterAll(async () => { await db?.close(); });

describe("conclusão do contrato no banco", () => {
  it.each([
    { penalty: 'fixed', value: 3, stored: 0, cap: 0, snapshot: false },
    { penalty: 'percentage', value: 2, stored: 0, cap: 0, snapshot: false },
    { penalty: 'fixed', value: 3, stored: 15, cap: 5, snapshot: false },
    { penalty: 'fixed', value: 3, stored: 15, cap: 0, snapshot: true },
  ])('o saldo exibido quita exatamente o saldo da função SQL: %o', async ({ penalty, value, stored, cap, snapshot }) => {
    await seed([{ status: 'pending', paid: 40, fee: stored }]);
    await db.query('UPDATE contracts SET daily_interest_percent=1, daily_penalty_type=$1, daily_penalty_value=$2, max_interest_cap_percent=$3', [penalty, value, cap]);
    await db.query("UPDATE contract_installments SET due_date=current_date-2, pre_settlement_snapshot=$1::jsonb", [snapshot ? '{}' : null]);
    const { rows: [row] } = await db.query<{ due_date: string; today: string }>('SELECT due_date::text, current_date::text AS today FROM contract_installments');
    const [year, month, day] = row.today.split('-').map(Number);
    const input = { amount: 100, paid_amount: 40, late_fee: stored, due_date: row.due_date, status: 'pending', daily_interest_percent: 1, daily_penalty_type: penalty, daily_penalty_value: value, max_interest_cap_percent: cap, has_active_settlement: snapshot };
    const due = portalInstallmentAmount(input, new Date(year, month-1, day, 16));
    const result = await db.query<{ result: { remaining: number; received: number; status: string } }>('SELECT pay_installment($1::uuid,$2::numeric) AS result', [installmentId(0), accumulatedPaymentTotal(input, due)]);
    expect(result.rows[0].result).toMatchObject({ remaining: 0, received: due, status: 'paid' });
  });
  it.each(["pending", "overdue"])("pagar a última parcela não conclui com outra parcela %s", async (status) => {
    await seed([{ status }, { status: "pending" }]);
    await pay(1);
    // Simula outra rotina/gatilho tentando concluir pela última parcela.
    await db.query("UPDATE contracts SET status = 'completed' WHERE id = $1", [contractId]);
    expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
    const events = await db.query("SELECT * FROM contract_events WHERE to_stage = 'completed'");
    expect(events.rows).toHaveLength(0);
  });

  it("mantém o contrato aberto com pagamento parcial de uma parcela anterior", async () => {
    await seed([{ status: "pending" }, { status: "pending" }]);
    await pay(0, 40, false);
    await pay(1);
    await db.query("UPDATE contracts SET status = 'completed' WHERE id = $1", [contractId]);
    expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
    const result = await db.query<{ paid_amount: string }>("SELECT paid_amount FROM contract_installments WHERE id = $1", [installmentId(0)]);
    expect(Number(result.rows[0].paid_amount)).toBe(40);
  });

  it("não baixa uma parcela quando o pagamento cobre a base mas deixa encargos", async () => {
    await seed([{ status: "pending", fee: 20 }, { status: "pending" }]);
    await pay(0, 100, false);
    const result = await db.query<{ status: string; paid_amount: string }>(
      "SELECT status, paid_amount FROM contract_installments WHERE id = $1", [installmentId(0)],
    );
    expect(result.rows[0].status).toBe("pending");
    expect(Number(result.rows[0].paid_amount)).toBe(100);
    await pay(1);
    expect((await state()).status).toBe("active");
    await pay(0, 120);
    expect(await state()).toEqual({ status: "completed", lifecycle_stage: "completed" });
  });

  it("permite quitar com desconto explícito nos encargos", async () => {
    await seed([{ status: "pending", fee: 20 }]);
    await db.query("SELECT pay_installment($1::uuid, 100, true, 'pix', NULL, NULL, 20)", [installmentId(0)]);
    expect(await state()).toEqual({ status: "completed", lifecycle_stage: "completed" });
  });

  it("bloqueia a conclusão indevida por um gatilho legado durante a própria baixa", async () => {
    await seed([{ status: "overdue", paid: 40 }, { status: "pending" }]);
    await db.exec(`
      CREATE FUNCTION legacy_complete_last_installment() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'paid' AND NEW.installment_number = 2 THEN
          UPDATE contracts SET status = 'completed' WHERE id = NEW.contract_id;
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trg_legacy_complete_last_installment
        AFTER UPDATE OF status ON contract_installments
        FOR EACH ROW EXECUTE FUNCTION legacy_complete_last_installment();
    `);
    try {
      await pay(1);
      expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
      expect((await db.query("SELECT * FROM contract_events WHERE to_stage = 'completed'")).rows).toHaveLength(0);
    } finally {
      await db.exec("DROP TRIGGER trg_legacy_complete_last_installment ON contract_installments; DROP FUNCTION legacy_complete_last_installment()");
    }
  });

  it("conclui quando a última pendência é quitada, mesmo fora da ordem das parcelas", async () => {
    await seed([{ status: "pending" }, { status: "pending" }, { status: "pending" }]);
    await pay(2);
    await pay(0, 40, false);
    await pay(1);
    expect((await state()).status).toBe("active");
    await pay(0);
    expect(await state()).toEqual({ status: "completed", lifecycle_stage: "completed" });
  });

  it("não confunde status pago com saldo quitado, incluindo encargos", async () => {
    await seed([{ status: "paid", paid: 100, fee: 20 }, { status: "pending" }]);
    await pay(1);
    expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
  });

  it("trata status desconhecido ou nulo como pendência", async () => {
    await seed([{ status: null }, { status: "pending" }]);
    await pay(1);
    await db.query("UPDATE contracts SET status = 'completed' WHERE id = $1", [contractId]);
    expect((await state()).status).toBe("active");
  });

  it("ignora parcelas canceladas na quitação", async () => {
    await seed([{ status: "cancelled" }, { status: "pending" }]);
    await pay(1);
    expect(await state()).toEqual({ status: "completed", lifecycle_stage: "completed" });
  });

  it("reabre status e estágio quando uma parcela quitada volta a ter saldo", async () => {
    await seed([{ status: "pending" }]);
    await pay(0);
    await db.query("UPDATE contract_installments SET status = 'pending', paid_amount = 0 WHERE id = $1", [installmentId(0)]);
    expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
  });

  it("reabre quando um ajuste de valor deixa saldo ou uma nova parcela é inserida", async () => {
    await seed([{ status: "pending" }]);
    await pay(0);
    await db.query("UPDATE contract_installments SET amount = 120 WHERE id = $1", [installmentId(0)]);
    expect((await state()).status).toBe("active");
    await db.query("UPDATE contract_installments SET amount = 100 WHERE id = $1", [installmentId(0)]);
    await db.query("UPDATE contracts SET status = 'completed' WHERE id = $1", [contractId]);
    await db.query(`INSERT INTO contract_installments (id, contract_id, status, amount) VALUES ($1, $2, 'pending', 100)`, [installmentId(1), contractId]);
    expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
  });

  it.each(["cancelled", "renegotiated", "pending_signature"])("preserva contratos %s", async (status) => {
    await seed([{ status: "pending" }]);
    await db.query("UPDATE contracts SET status = $1 WHERE id = $2", [status, contractId]);
    const previous = await state();
    await db.query("UPDATE contracts SET status = 'completed' WHERE id = $1", [contractId]);
    expect(await state()).toEqual(previous);
    await db.query("UPDATE contract_installments SET paid_amount = 40 WHERE id = $1", [installmentId(0)]);
    expect(await state()).toEqual(previous);
  });

  it("corrige contratos antigos concluídos com dívida sem alterar pagamentos ou parcelas", async () => {
    await seed([{ status: "overdue", paid: 40 }, { status: "paid", paid: 100 }]);
    await db.exec("ALTER TABLE contracts DISABLE TRIGGER trg_normalize_contract_lifecycle");
    await db.query("UPDATE contracts SET status = 'completed', lifecycle_stage = 'completed' WHERE id = $1", [contractId]);
    await db.exec("ALTER TABLE contracts ENABLE TRIGGER trg_normalize_contract_lifecycle");
    const installments = await db.query("SELECT * FROM contract_installments ORDER BY id");
    await db.exec(sql("20261006120000_guard_contract_completion.sql"));
    expect(await state()).toEqual({ status: "active", lifecycle_stage: "active" });
    expect((await db.query("SELECT * FROM contract_installments ORDER BY id")).rows).toEqual(installments.rows);
    expect((await db.query("SELECT * FROM transactions")).rows).toHaveLength(0);
  });

  it("a correção histórica preserva contratos realmente quitados", async () => {
    await seed([{ status: "pending" }]);
    await pay(0);
    const transactions = await db.query("SELECT * FROM transactions");
    await db.exec(sql("20261006120000_guard_contract_completion.sql"));
    expect(await state()).toEqual({ status: "completed", lifecycle_stage: "completed" });
    expect((await db.query("SELECT * FROM transactions")).rows).toEqual(transactions.rows);
  });

  it("preserva quitações antigas com divergência apenas em encargos para conciliação", async () => {
    await seed([{ status: "pending" }]);
    await pay(0);
    await db.exec("ALTER TABLE contract_installments DISABLE TRIGGER trg_sync_paid_installment_status; ALTER TABLE contract_installments DISABLE TRIGGER trg_reopen_contract_with_unsettled_installments");
    await db.query("UPDATE contract_installments SET late_fee = 20 WHERE id = $1", [installmentId(0)]);
    await db.exec("ALTER TABLE contract_installments ENABLE TRIGGER trg_sync_paid_installment_status; ALTER TABLE contract_installments ENABLE TRIGGER trg_reopen_contract_with_unsettled_installments");
    const installments = await db.query("SELECT * FROM contract_installments");
    await db.exec(sql("20261006120000_guard_contract_completion.sql"));
    expect(await state()).toEqual({ status: "completed", lifecycle_stage: "completed" });
    expect((await db.query("SELECT * FROM contract_installments")).rows).toEqual(installments.rows);
  });
});
