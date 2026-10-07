import { afterEach, expect, it, vi } from 'vitest';
const pdf = vi.hoisted(() => ({ table: vi.fn(), text: vi.fn(), save: vi.fn(), load: vi.fn() }));
vi.mock('@/utils/pdfLib', () => ({ loadPdfLib: async () => {
  pdf.load();
  return { jsPDF: class {
    internal = { pageSize: { getWidth: () => 210 }, pages: [[], []] };
    lastAutoTable = { finalY: 120 };
    setFillColor() {} rect() {} setTextColor() {} setFontSize() {} setFont() {} setLineWidth() {} line() {} addPage() {} setPage() {}
    text = pdf.text; save = pdf.save;
  }, autoTable: pdf.table };
} }));
import { generatePortalReceiptPdf, generatePortalStatementPdf } from '@/utils/portalPdf';
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
it('extrato inclui pagamentos parciais, saldo com multa e histórico cancelado sem cobrança', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 7, 23, 16));
  await generatePortalStatementPdf({ name: 'Cliente fictício' }, [{ status: 'active', capital: 200, num_installments: 3, daily_interest_percent: 1, daily_penalty_type: 'fixed', daily_penalty_value: 3, installments: [
    { installment_number: 1, amount: 100, due_date: '2026-08-21', status: 'pending', paid_amount: 40 },
    { installment_number: 2, amount: 100, due_date: '2026-08-21', status: 'paid', paid_amount: 0 },
    { installment_number: 3, amount: 500, due_date: '2026-08-01', status: 'cancelled', paid_amount: 10 },
  ] }], {});
  const tables = pdf.table.mock.calls.map(call => call[1]);
  expect(tables[0].body[0]).toEqual(['R$ 200,00', 'R$ 68,01', 'R$ 50,00', 'R$ 68,01']);
  expect(tables[1].body[0]).toEqual(['#1', '21/08/2026', 'R$ 100,00', 'ATRASO', '—', 'R$ 40,00', 'R$ 68,01']);
  expect(tables[1].body[1][5]).toBe('R$ 0,00');
  expect(tables[1].body[2][3]).toBe('CANCELADO'); expect(tables[1].body[2][6]).toBe('R$ 0,00');
});
it.each(['pending', 'overdue', 'cancelled'])('não gera recibo de quitação para parcela %s', async status => {
  await expect(generatePortalReceiptPdf({ name: 'Fictício' }, { status, amount: 100, paid_amount: 40 }, {})).rejects.toThrow('pagamento confirmado');
  expect(pdf.load).not.toHaveBeenCalled(); expect(pdf.save).not.toHaveBeenCalled();
});
it('recibo respeita zero explícito e não inventa data de confirmação', async () => {
  await generatePortalReceiptPdf({ name: 'Fictício' }, { status: 'paid', installment_number: 1, amount: 100, paid_amount: 0 }, {});
  expect(pdf.table.mock.calls[0][1].body).toContainEqual(['Valor Pago', 'R$ 0,00']);
  expect(pdf.table.mock.calls[0][1].body).toContainEqual(['Data do Pagamento', 'Não informada']);
});
