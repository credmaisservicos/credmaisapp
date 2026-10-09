// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
const load = (path: string) => db.exec(readFileSync(path, 'utf8'));
async function scalar(query: string, args: unknown[] = []) {
  return Object.values((await db.query(query, args)).rows[0])[0] as any;
}
const wallet = (days: number | null = null, search = '') => scalar('SELECT wallet_cash_report($1::int,$2::text)', [days, search]);
beforeAll(async () => {
  db = new PGlite();
  for (const name of ['financialDatabase', 'paymentReceiptDatabase', 'walletCashDatabase', 'commercialDatabase']) await load(`src/test/fixtures/${name}.sql`);
  for (const name of ['20260922130000_dynamic_late_fee_tracks_settlement.sql', '20260922100000_reverse_percentage_settlement.sql',
    '20261007210000_incremental_payment_ledger.sql', '20261007220000_financial_calendar_atomic_charges.sql',
    '20260912010000_commercial_operations.sql', '20261008000000_wallet_cash_report.sql']) await load(`supabase/migrations/${name}`);
  // Without the corrective migrations the same behavior reproduces the original defects.
  for (const name of ['20261009000000_commercial_payment_alias.sql', '20261009010000_wallet_commercial_cash.sql']) {
    const path = `supabase/migrations/${name}`;
    if (existsSync(path) && process.env.COMMERCIAL_CASH_BASELINE !== '1') await load(path);
  }
}, 30_000);
beforeEach(async () => {
  await db.exec(`RESET ROLE;SET test.owner='${owner}';
    TRUNCATE business_payments,business_receivables,business_operations,business_assets,loan_collateral,
      clients,contracts,contract_installments,transactions,profits,expenses,audit_logs,auth.users CASCADE;
    INSERT INTO auth.users(id) VALUES('${owner}'),('${other}');
    INSERT INTO clients(id,user_id,name) VALUES('${owner}','${owner}','Empresa QA'),('${other}','${other}','Outra empresa');`);
});
afterAll(async () => { await db?.close(); });

async function operation(kind: 'sale' | 'rental', tenant = owner) {
  await db.exec(`SET test.owner='${tenant}'`);
  const asset = await scalar('SELECT save_business_asset($1::jsonb)', [{ kind: kind === 'sale' ? 'phone' : 'car', label: 'Bem fictício QA', identifier: kind === 'sale' ? '000000000000000' : 'TST0A00', cost: 1, price: 3 }]);
  return scalar('SELECT create_business_operation($1::jsonb,$2::uuid)', [{ kind, client_id: tenant, asset_id: asset,
    total: 3, down_payment: kind === 'sale' ? 1 : 0, installments: 2, start_date: '2026-10-08', first_due: '2026-10-09',
    end_date: '2026-10-09', billing: kind === 'sale' ? 'monthly' : 'daily', rate: 2, deposit: kind === 'rental' ? 1 : 0, method: 'pix' }, crypto.randomUUID()]);
}
async function receivables(op: string) {
  return (await db.query<{ id: string; amount: number; paid_amount: number; status: string }>('SELECT id,amount::float8 AS amount,paid_amount::float8 AS paid_amount,status FROM business_receivables WHERE operation_id=$1 ORDER BY number', [op])).rows;
}
const receive = (id: string, amount: number, request = crypto.randomUUID()) => scalar('SELECT receive_business_payment($1::uuid,$2::numeric,$3::text,$4::uuid)', [id, amount, 'pix', request]);
const state = (id: string) => scalar('SELECT status FROM business_operations WHERE id=$1', [id]);

it('baixa parcial e quitação preservam saldo e concluem venda somente após todas as parcelas', async () => {
  const op = await operation('sale'), rows = await receivables(op);
  await receive(rows[1].id, 1);
  expect(await state(op)).toBe('active');
  await receive(rows[0].id, 0.4);
  expect(await state(op)).toBe('active');
  expect((await receivables(op))[0]).toMatchObject({ paid_amount: 0.4, status: 'pending' });
  await receive(rows[0].id, 0.6);
  expect(await state(op)).toBe('completed');
  expect((await receivables(op)).every(r => r.status === 'paid')).toBe(true);
  expect((await wallet()).totals.balance).toBe(3);
});

it('repetir o mesmo pedido de recebimento não duplica pagamento nem caixa', async () => {
  const op = await operation('sale'), [row] = await receivables(op), request = crypto.randomUUID();
  const first = await receive(row.id, 1, request);
  expect(await receive(row.id, 1, request)).toBe(first);
  expect(await scalar("SELECT count(*)::int FROM business_payments WHERE kind='receipt'")).toBe(1);
  expect((await wallet()).totals.balance).toBe(2);
});

it('recusa pagamento de parcela de outra empresa sem alterar valores', async () => {
  const op = await operation('sale', other), [row] = await receivables(op);
  await db.exec(`SET test.owner='${owner}'`);
  await expect(receive(row.id, 1)).rejects.toThrow('Operação não encontrada');
  expect((await receivables(op))[0].paid_amount).toBe(0);
  expect((await wallet()).totals.balance).toBe(0);
});

it('recusa valor acima do saldo sem gravar recebimento', async () => {
  const op = await operation('sale'), [row] = await receivables(op);
  await expect(receive(row.id, 1.01)).rejects.toThrow('Pagamento deve ser maior que zero');
  expect((await receivables(op))[0].paid_amount).toBe(0);
  expect(await scalar("SELECT count(*)::int FROM business_payments WHERE kind='receipt'")).toBe(0);
});

it('aluguel recebido e caução devolvida aparecem no caixa uma única vez', async () => {
  const op = await operation('rental'), [row] = await receivables(op);
  expect((await wallet()).totals.balance).toBe(1);
  await receive(row.id, 2);
  expect(await state(op)).toBe('active');
  const request = crypto.randomUUID();
  await scalar('SELECT close_business_operation($1::uuid,$2::text,$3::jsonb,$4::uuid)', [op, 'return', { odometer: 1, method: 'pix' }, request]);
  await scalar('SELECT close_business_operation($1::uuid,$2::text,$3::jsonb,$4::uuid)', [op, 'return', { odometer: 1, method: 'pix' }, request]);
  expect(await state(op)).toBe('completed');
  expect(await scalar("SELECT count(*)::int FROM business_payments WHERE kind='deposit_refund'")).toBe(1);
  const report = await wallet();
  expect(report.totals).toMatchObject({ inflows: 3, outflows: 1, balance: 2, profit: 0, receipts: 0 });
  expect(report.timeline).toHaveLength(3);
  expect(report.timeline.every((r: any) => !r.removable)).toBe(true);
});

it('cancelamento da venda devolve a entrada e restaura saldo sem duplicação', async () => {
  const op = await operation('sale');
  expect((await wallet()).totals.balance).toBe(1);
  const request = crypto.randomUUID();
  await scalar('SELECT close_business_operation($1::uuid,$2::text,$3::jsonb,$4::uuid)', [op, 'cancel', { method: 'pix' }, request]);
  await scalar('SELECT close_business_operation($1::uuid,$2::text,$3::jsonb,$4::uuid)', [op, 'cancel', { method: 'pix' }, request]);
  expect((await wallet()).totals).toMatchObject({ inflows: 1, outflows: 1, balance: 0 });
});

it('inclui receita e caução existentes sem gravar ou somar lucros previstos', async () => {
  await db.exec(`INSERT INTO transactions(user_id,type,amount,description) VALUES('${owner}','capital_injection',2.8,'Saldo inicial QA'),
    ('${owner}','business_income',3,'Venda à vista'),('${owner}','business_income',1,'Entrada venda'),
    ('${owner}','security_deposit',1,'Caução');`);
  const before = await scalar('SELECT count(*)::int FROM transactions');
  expect((await wallet()).totals).toMatchObject({ inflows: 7.8, balance: 7.8, profit: 0 });
  expect((await wallet()).timeline).toHaveLength(4);
  expect(await scalar('SELECT count(*)::int FROM transactions')).toBe(before);
});

it('filtros de data e busca preservam saldo completo e isolamento comercial', async () => {
  await db.exec(`INSERT INTO transactions(user_id,type,amount,description,date) VALUES
    ('${owner}','business_income',3,'Venda anterior',now()-interval '20 days'),
    ('${owner}','security_deposit',1,'Caução atual',now()),
    ('${owner}','business_refund',0.5,'Devolução atual',now()),
    ('${owner}','business_income',100,'Entrada futura',now()+interval '2 days'),
    ('${other}','business_income',999,'Outra empresa',now());`);
  const report = await wallet(7, 'Caução');
  expect(report.totals).toMatchObject({ inflows: 4, outflows: 0.5, balance: 3.5 });
  expect(report.period).toMatchObject({ inflows: 1, outflows: 0.5, opening_balance: 3, closing_balance: 3.5 });
  expect(report.timeline).toHaveLength(1);
  expect(report.warnings.future_amount).toBe(100);
});
