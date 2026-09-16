import { describe, expect, it } from 'vitest';
import { addBillingPeriod, money, rentalPeriods, splitReceivables } from '@/lib/commercial';

describe('operações comerciais', () => {
  it('divide venda parcelada em centavos exatos e preserva o vencimento mensal', () => {
    const rows = splitReceivables(100, 10, 3, '2026-01-31', 'monthly');
    expect(rows.map(row => row.amount)).toEqual([30, 30, 30]);
    expect(rows.map(row => row.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(rows.reduce((sum, row) => sum + row.amount, 10)).toBe(100);
  });

  it('calcula ciclos de locação ancorados na data de saída', () => {
    expect(rentalPeriods('2026-01-15', '2026-02-15', 'monthly')).toBe(1);
    expect(rentalPeriods('2026-01-15', '2026-01-18', 'daily')).toBe(3);
    expect(addBillingPeriod('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
  });

  it('recusa parcela menor que um centavo', () => {
    expect(() => splitReceivables(0.02, 0, 3, '2026-01-01', 'monthly')).toThrow();
  });

  it('exibe zero quando um valor financeiro legado é inválido', () => {
    expect(money('valor inválido')).toContain('0,00');
  });
});
