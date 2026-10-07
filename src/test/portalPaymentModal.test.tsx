import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: api.invoke } } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: api.toast }) }));
import { PaymentModal } from '@/components/ClientPortal/PaymentModal';
const installment = { id: 'first', amount: 100, paid_amount: 0, due_date: '2099-01-01', status: 'pending', installment_number: 1 };
const props = { isOpen: true, onOpenChange: vi.fn(), installment, ownerProfile: {}, clientData: { name: 'Fictício' }, sessionToken: 'fictional-session' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function file(read: () => Promise<ArrayBuffer>) { return Object.assign(new File(['fictional'], 'fixture.pdf', { type: 'application/pdf' }), { arrayBuffer: read }); }
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
it('comprovante de uma parcela não aparece ao abrir outra', () => {
  const view = render(<PaymentModal {...props} installment={{ ...installment, receipt_url: 'https://example.invalid/first.pdf' }}/>);
  expect(screen.getByRole('link',{ name:'Ver' })).toHaveAttribute('href','https://example.invalid/first.pdf');
  view.rerender(<PaymentModal {...props} installment={{ ...installment, id:'second', installment_number:2 }}/>);
  expect(screen.queryByText('Comprovante enviado')).toBeNull(); expect(screen.getByLabelText('Anexar foto/PDF do comprovante')).toBeEnabled();
});
it('resposta atrasada de envio não altera outra parcela nem anuncia sucesso', async () => {
  const pending = deferred<unknown>(); api.invoke.mockReturnValueOnce(pending.promise);
  const view = render(<PaymentModal {...props}/>);
  await act(async () => { fireEvent.change(screen.getByLabelText('Anexar foto/PDF do comprovante'),{target:{files:[file(async () => new ArrayBuffer(1))]}}); });
  expect(api.invoke).toHaveBeenCalledWith('portal-upload-receipt',expect.objectContaining({body:expect.objectContaining({installment_id:'first',session_token:'fictional-session'})}));
  view.rerender(<PaymentModal {...props} installment={{ ...installment, id:'second', installment_number:2 }}/>);
  await act(async () => { pending.resolve({data:{url:'https://example.invalid/first.pdf'},error:null}); });
  expect(screen.queryByText('Comprovante enviado')).toBeNull(); expect(api.toast).not.toHaveBeenCalled();
});
it('sair antes de ler o arquivo impede iniciar seu envio', async () => {
  const pending = deferred<ArrayBuffer>(); const view = render(<PaymentModal {...props}/>);
  fireEvent.change(screen.getByLabelText('Anexar foto/PDF do comprovante'),{target:{files:[file(() => pending.promise)]}});
  view.rerender(<PaymentModal {...props} isOpen={false}/>);
  await act(async () => { pending.resolve(new ArrayBuffer(1)); }); expect(api.invoke).not.toHaveBeenCalled(); expect(api.toast).not.toHaveBeenCalled();
});
it.each([{status:'cancelled'}, {contract_status:'cancelled'}, {paid_amount:100}])('não oferece cobrança para parcela encerrada ou sem saldo: %o', extra => {
  render(<PaymentModal {...props} installment={{...installment,...extra}}/>); expect(screen.queryByRole('dialog')).toBeNull();
});
