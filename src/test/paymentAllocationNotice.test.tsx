import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PaymentAllocationNotice} from '@/components/PaymentAllocationNotice';
import {paymentReviewDescription} from '@/lib/paymentFeedback';
const api=vi.hoisted(()=>({rpc:vi.fn(),owner:'owner-test'}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:api.owner?{id:api.owner}:null})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:(...args:unknown[])=>({abortSignal:()=>api.rpc(...args)})}}));
const clear={allocation_review_count:0,unallocated_received_total:0,overallocated_received_total:0,installments:[]};
const pending={allocation_review_count:1,unallocated_received_total:100,overallocated_received_total:0,installments:[{id:'installment-test',client_id:'client-test',installment_number:2,received:100,allocated:0}]};
const open=()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
 return render(<PaymentAllocationNotice/>,{wrapper});
};
beforeEach(()=>{api.owner='owner-test';vi.clearAllMocks();api.rpc.mockResolvedValue({data:clear,error:null});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('mostra a composição desconhecida sem transformar essa diferença em nova dívida',async()=>{
 api.rpc.mockResolvedValue({data:pending,error:null});open();
 expect(await screen.findByText('1 parcela(s) com recebimentos para revisar')).toBeVisible();
 expect(screen.getByText('Sem classificação: R$ 100,00')).toBeVisible();
 expect(screen.getByText(/valores recebidos estão preservados/)).toBeVisible();
 expect(screen.getByRole('link',{name:'Ver cliente'})).toHaveAttribute('href','/clientes/client-test');
 expect(api.rpc).toHaveBeenCalledExactlyOnceWith('payment_allocation_review');
});
it('falha na conferência permite tentar novamente e não afirma que o razão está correto',async()=>{
 api.rpc.mockResolvedValueOnce({data:null,error:{message:'Failed to fetch'}});open();
 expect(await screen.findByText('Não foi possível conferir a classificação dos recebimentos.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Conferir novamente'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
 expect(api.rpc).toHaveBeenCalledTimes(2);
});
it('dados ausentes ou inválidos não viram uma conferência bem-sucedida',async()=>{
 api.rpc.mockResolvedValue({data:null,error:null});open();
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir');
});
it('não expõe uma resposta atrasada da conta anterior',async()=>{
 let finish!:(value:unknown)=>void;
 api.rpc.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const view=open();await waitFor(()=>expect(api.rpc).toHaveBeenCalledTimes(1));
 api.owner='other-owner';view.rerender(<PaymentAllocationNotice/>);
 await waitFor(()=>expect(api.rpc).toHaveBeenCalledTimes(2));
 await act(async()=>{finish({data:pending,error:null});});
 expect(screen.queryByText(/recebimentos para revisar/)).toBeNull();
 expect(screen.queryByRole('link',{name:'Ver cliente'})).toBeNull();
});
it('não consulta recebimentos sem uma conta autenticada',()=>{
 api.owner='';open();expect(api.rpc).not.toHaveBeenCalled();
});
it('fecha a conferência e descarta resposta atrasada ao trocar de empresa',async()=>{
 const installment='33333333-3333-4333-8333-333333333333';
 let finish!:(value:unknown)=>void;
 api.owner='11111111-1111-4111-8111-111111111111';
 api.rpc.mockImplementation((name:string)=>name==='payment_classification_detail'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:api.owner.startsWith('111')?{...pending,installments:[{...pending.installments[0],id:installment}]}:clear,error:null}));
 const view=open();fireEvent.click(await screen.findByRole('button',{name:'Conferir recebimentos'}));
 expect(await screen.findByRole('dialog')).toBeVisible();
 await waitFor(()=>expect(finish).toBeTypeOf('function'));
 api.owner='22222222-2222-4222-8222-222222222222';view.rerender(<PaymentAllocationNotice/>);
 await act(async()=>finish({data:{version:'c'.repeat(32),can_reconcile:true,installment:{id:installment,paid_amount:100},transactions:[],history:[]},error:null}));
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.queryByText(/recebimentos para revisar/)).toBeNull();
 expect(api.rpc.mock.calls.some(call=>call[0]==='reclassify_payment_receipt')).toBe(false);
});
it('o aviso de pagamento usa somente a indicação confirmada pelo servidor',()=>{
 expect(paymentReviewDescription({allocation_pending_review:true})).toContain('recebimento foi registrado');
 for(const value of [null,{},'pending',{allocation_pending_review:'true'},{allocation_pending_review:false}])expect(paymentReviewDescription(value)).toBeUndefined();
});
