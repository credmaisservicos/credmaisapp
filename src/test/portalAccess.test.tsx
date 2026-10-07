import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import CobradorExterno from '@/pages/CobradorExterno';
import PortalCliente from '@/pages/PortalCliente';
import {clearPortalSession,getPortalToken} from '@/lib/portalSession';
import {tabSessionStorage} from '@/lib/tabSessionStorage';

const api=vi.hoisted(()=>({rpc:vi.fn(),toast:vi.fn(),signals:[]as AbortSignal[],callbacks:[]as (()=>void)[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 auth:{getSession:()=>Promise.resolve({data:{session:null}}),signOut:()=>Promise.resolve({error:null}),admin:{signOut:()=>Promise.resolve({error:null})}},
 rpc:(name:string,args:unknown)=>{const promise=Promise.resolve(api.rpc(name,args));return Object.assign(promise,{abortSignal:(signal:AbortSignal)=>{api.signals.push(signal);return promise;}});},
 channel:()=>{const channel={on:(_event:unknown,_filter:unknown,callback:()=>void)=>{api.callbacks.push(callback);return channel;},subscribe:()=>channel};return channel;},
 removeChannel:vi.fn(),
}}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:api.toast})}));
vi.mock('@/utils/portalPdf',()=>({generatePortalStatementPdf:vi.fn()}));
vi.mock('@/components/ClientPortal/NotificationsBell',()=>({NotificationsBell:()=>null}));
vi.mock('@/components/ClientPortal/PaymentModal',()=>({PaymentModal:()=>null}));
const collector={collector:{id:'collector-test',name:'Cobrador teste'},owner_id:'owner-test',owner:{name:'Empresa teste'},clients:[]};
const client={client:{id:'client-test',name:'Cliente teste'},session_token:'550e8400-e29b-41d4-a716-446655440000',contracts:[],owner:{name:'Empresa teste'}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
beforeEach(()=>{
 vi.useFakeTimers();vi.resetAllMocks();api.signals=[];api.callbacks=[];
 clearPortalSession();tabSessionStorage.removeItem('cobrador-token');tabSessionStorage.removeItem('portal-cliente-attempts');sessionStorage.clear();
 window.history.replaceState({},'','/');api.rpc.mockResolvedValue({data:collector,error:null,status:200});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();window.history.replaceState({},'','/');});
const collectorLogin=async()=>{
 const view=render(<CobradorExterno/>);fireEvent.change(screen.getByLabelText('Token de acesso'),{target:{value:'isolated-collector'}});
 await act(async()=>{fireEvent.submit(screen.getByLabelText('Token de acesso').closest('form')!);await vi.advanceTimersByTimeAsync(0);});
 return view;
};
it('a collector timeout releases the form and cancels its request without announcing an invalid token',async()=>{
 api.rpc.mockReturnValue(new Promise(()=>{}));await collectorLogin();expect(screen.getByRole('button',{name:'Verificando…'})).toBeDisabled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
 expect(screen.getByRole('button',{name:'Acessar Portal'})).toBeEnabled();expect(api.rpc).toHaveBeenCalledTimes(1);expect(api.signals[0].aborted).toBe(true);
 expect(api.toast).toHaveBeenLastCalledWith(expect.objectContaining({title:'Não foi possível carregar o portal'}));
});
it('a collector request exception allows correction and retry',async()=>{
 api.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));await collectorLogin();
 expect(screen.getByRole('button',{name:'Acessar Portal'})).toBeEnabled();
 await act(async()=>{fireEvent.submit(screen.getByLabelText('Token de acesso').closest('form')!);});
 expect(screen.getByText('Cobrador teste',{exact:true})).toBeVisible();
});
it('a delayed collector refresh cannot restore the portal after logout',async()=>{
 await collectorLogin();const pending=deferred<unknown>();api.rpc.mockReturnValueOnce(pending.promise);
 await act(async()=>{api.callbacks[0]();});fireEvent.click(screen.getByRole('button',{name:'Sair do portal'}));
 await act(async()=>{pending.resolve({data:collector,error:null,status:200});});
 expect(screen.getByLabelText('Token de acesso')).toBeVisible();expect(screen.queryByText('Cobrador teste',{exact:true})).toBeNull();expect(tabSessionStorage.getItem('cobrador-token')).toBeNull();
});
it('a revoked collector credential removes the existing view and its cached token',async()=>{
 await collectorLogin();api.rpc.mockResolvedValueOnce({data:null,error:null,status:200});
 await act(async()=>{api.callbacks[0]();});expect(screen.getByLabelText('Token de acesso')).toBeVisible();expect(tabSessionStorage.getItem('cobrador-token')).toBeNull();
});
it('a delayed linked client login cannot save a session after the portal has unmounted',async()=>{
 window.history.replaceState({},'','/portal-cliente?t=22222222-2222-4222-8222-222222222222');
 const pending=deferred<unknown>();api.rpc.mockReturnValueOnce(pending.promise);const view=render(<PortalCliente/>);
 expect(window.location.search).toBe('');view.unmount();
 await act(async()=>{pending.resolve({data:client,error:null,status:200});});expect(getPortalToken()).toBeNull();
});
it('a payment response after leaving the collector portal does not log back in or announce success',async()=>{
 api.rpc.mockResolvedValueOnce({data:{...collector,clients:[{id:'client-test',name:'Cliente atribuido',installments:[{id:'installment-test',amount:100,paid_amount:0,status:'pending',due_date:'2099-01-01',installment_number:1}]}]},error:null,status:200});
 const view=await collectorLogin();fireEvent.click(screen.getByText('Cliente atribuido',{exact:true}));fireEvent.click(screen.getByRole('button',{name:'Pagar'}));
 const pending=deferred<unknown>();api.rpc.mockReturnValueOnce(pending.promise);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Confirmar pagamento'}));});
 expect(api.rpc).toHaveBeenCalledWith('collector_register_payment',expect.objectContaining({_token:'isolated-collector',_installment_id:'installment-test',_paid_total:100}));
 view.unmount();tabSessionStorage.removeItem('cobrador-token');await act(async()=>{pending.resolve({data:null,error:null,status:200});});
 expect(api.rpc).toHaveBeenCalledTimes(2);expect(tabSessionStorage.getItem('cobrador-token')).toBeNull();expect(api.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:'✓ Pagamento registrado!'}));
});
