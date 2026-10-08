import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/useCommercial', () => ({ commercialRpc: mocks.rpc, useCommercial: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { OperationDialog } from '@/pages/Comercial';

describe('formulário de operação comercial', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation(async (_name: string, args: { _data: { kind?: string } }) => {
      // Contrato da RPC real: o tipo é obrigatório para distinguir venda de locação.
      if (!['sale', 'rental'].includes(args._data.kind || '')) throw new Error('Operação inválida');
      return 'operacao-ficticia';
    });
  });

  it.each(['cash', 'installments'] as const)('registra venda %s com tipo e valores reconhecidos pelo servidor', async mode => {
    const onClose = vi.fn(), onSaved = vi.fn().mockResolvedValue(undefined);
    render(<OperationDialog kind="sale" clients={[{ id: 'cliente-qa', name: 'Cliente QA' }]} assets={[{ id: 'celular-qa', label: 'Celular QA', identifier: '000000000000000' }]} onClose={onClose} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 'cliente-qa' } });
    fireEvent.change(screen.getByLabelText('Celular / IMEI'), { target: { value: 'celular-qa' } });
    fireEvent.change(screen.getByLabelText('Total da venda (R$)'), { target: { value: '3' } });
    if (mode === 'cash') fireEvent.click(screen.getByRole('button', { name: 'À vista' }));
    else {
      fireEvent.change(screen.getByLabelText('Entrada opcional (R$)'), { target: { value: '1' } });
      fireEvent.change(screen.getByLabelText('Parcelas'), { target: { value: '2' } });
      fireEvent.change(screen.getByLabelText('Primeiro vencimento'), { target: { value: '2026-10-09' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('create_business_operation', expect.objectContaining({
      _data: expect.objectContaining({ kind: 'sale', client_id: 'cliente-qa', asset_id: 'celular-qa', total: 3, down_payment: mode === 'cash' ? 3 : 1, installments: mode === 'cash' ? 1 : 2 }),
    }));
  });

  it('registra locação com tipo, período, preço e caução', async () => {
    const onClose = vi.fn(), onSaved = vi.fn().mockResolvedValue(undefined);
    render(<OperationDialog kind="rental" clients={[{ id: 'cliente-qa', name: 'Cliente QA' }]} assets={[{ id: 'carro-qa', label: 'Carro QA', identifier: 'TST0A00' }]} onClose={onClose} onSaved={onSaved} />);
    for (const [label, value] of [['Cliente', 'cliente-qa'], ['Veículo / placa', 'carro-qa'], ['Início', '2026-10-08'], ['Devolução prevista', '2026-10-09'], ['Cobrança', 'daily'], ['Valor por período (R$)', '2'], ['Caução opcional (R$)', '1']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar operação' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledWith('create_business_operation', expect.objectContaining({
      _data: expect.objectContaining({ kind: 'rental', client_id: 'cliente-qa', asset_id: 'carro-qa', billing: 'daily', total: 2, rate: 2, deposit: 1, start_date: '2026-10-08', end_date: '2026-10-09' }),
    }));
  });
});
