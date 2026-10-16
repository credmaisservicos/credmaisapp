// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";

const owner = "11111111-1111-4111-8111-111111111111";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("src/test/fixtures/contractCreationDatabase.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261014100000_contract_installment_schedule_components.sql", "utf8"));
});
afterAll(async () => { await db?.close(); });

it("persists scheduled principal and interest for each new installment", async () => {
  await db.exec(`SET test.owner='${owner}'`);
  const client = { name: "Cliente de teste" };
  const contract = {
    capital: 150, interest_rate: 20, num_installments: 3, installment_amount: 60,
    frequency: "monthly", start_date: "2026-10-14T12:00:00Z", total_amount: 180,
    total_interest: 30,
  };
  const installments = [
    { installment_number: 1, amount: 60, due_date: "2026-11-14T12:00:00Z", scheduled_principal: 50, scheduled_interest: 10 },
    { installment_number: 2, amount: 60, due_date: "2026-12-14T12:00:00Z", scheduled_principal: 50, scheduled_interest: 10 },
    { installment_number: 3, amount: 60, due_date: "2027-01-14T12:00:00Z", scheduled_principal: 50 },
  ];
  await db.query(
    "SELECT public.create_client_contract(NULL, $1::jsonb, $2::jsonb, $3::jsonb)",
    [JSON.stringify(client), JSON.stringify(contract), JSON.stringify(installments)],
  );

  const { rows } = await db.query(
    "SELECT installment_number, scheduled_principal::float8, scheduled_interest::float8 FROM public.contract_installments ORDER BY installment_number",
  );
  expect(rows).toEqual([
    { installment_number: 1, scheduled_principal: 50, scheduled_interest: 10 },
    { installment_number: 2, scheduled_principal: 50, scheduled_interest: 10 },
    { installment_number: 3, scheduled_principal: 50, scheduled_interest: 0 },
  ]);
});
