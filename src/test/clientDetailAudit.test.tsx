import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ClienteDetalhe from '@/pages/ClienteDetalhe';
import NovoCliente from '@/pages/NovoCliente';
import {emptyFinancialAnalyticsReport} from '../../e2e/helpers/financialAnalytics';

const state=vi.hoisted(()=>({owner:'owner-a',clientReads:[] as string[],existingReads:[] as string[],report:undefined as any,reportError:false,deferred:null as null|((value:any)=>void),confirm:vi.fn(),toast:vi.fn(),upload:vi.fn(),remove:vi.fn(),signed:vi.fn(),folders:[] as string[],documents:false}));
const clientId='33333333-3333-4333-8333-333333333333';
const contracts=[
 {id:'active',client_id:clientId,capital:100,total_amount:100,num_installments:1,status:'active',start_date:'2026-01-01',frequency:'monthly'},
 {id:'cancelled',client_id:clientId,capital:200,total_amount:200,num_installments:1,status:'cancelled',start_date:'2026-01-01',frequency:'monthly'},
 {id:'settled',client_id:clientId,capital:40,total_amount:40,num_installments:1,status:'settled',start_date:'2026-01-01',frequency:'monthly'},
];
const installments=[
 {id:'partial',contract_id:'active',client_id:clientId,amount:100,paid_amount:20,status:'pending',due_date:'2099-12-01',installment_number:1},
 {id:'cancelled-partial',contract_id:'cancelled',client_id:clientId,amount:200,paid_amount:50,status:'cancelled',due_date:'2026-01-01',installment_number:1},
 {id:'paid',contract_id:'settled',client_id:clientId,amount:40,paid_amount:40,status:'paid',due_date:'2026-01-01',installment_number:1},
];
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:state.owner}})}));
vi.mock('@/hooks/useRealtimeSubscription',()=>({useMultiTableRealtime:()=>{}}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:state.toast})}));
vi.mock('@/components/ConfirmProvider',()=>({useConfirm:()=>state.confirm}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:(table:string)=>{
  const chain:any={};for(const method of ['select','eq','order','lt','neq'])chain[method]=()=>chain;
  chain.single=()=>{state.clientReads.push(state.owner);return state.deferred?new Promise(resolve=>{state.deferred=resolve;}):Promise.resolve({data:{id:clientId,name:`Cliente ${state.owner}`,created_at:'2026-01-01',status:'Ativo'},error:null});};
  chain.maybeSingle=async()=>{if(table==='clients')state.existingReads.push(state.owner);return {data:null,error:null};};chain.limit=async()=>({data:[],error:null});
  chain.range=async()=>({data:table==='contracts'?contracts:table==='contract_installments'?installments:table==='profits'?[{amount:999,date:'2026-01-01'}]:[],error:null});return chain;
 },
 rpc:async()=>({data:state.report,error:state.reportError?{message:'Relatório indisponível'}:null}),
 storage:{from:()=>({list:async(folder:string)=>{state.folders.push(folder);return {data:state.documents?[{id:'file',name:folder.startsWith('client-docs')?'legacy.pdf':'current.pdf',metadata:{size:1024}}]:[],error:null};},upload:state.upload,remove:state.remove,createSignedUrl:state.signed})},
}}));
let cache:QueryClient;
const ui=()=> <QueryClientProvider client={cache}><MemoryRouter initialEntries={[`/clientes/${clientId}`]}><Routes><Route path='/clientes/:id' element={<ClienteDetalhe/>}/></Routes></MemoryRouter></QueryClientProvider>;
beforeEach(()=>{
 state.owner='owner-a';state.clientReads=[];state.existingReads=[];state.deferred=null;state.reportError=false;
 state.documents=false;state.folders=[];state.confirm.mockReset();state.toast.mockReset();state.upload.mockReset().mockResolvedValue({error:null});state.remove.mockReset().mockResolvedValue({error:null});state.signed.mockReset().mockResolvedValue({data:{signedUrl:'https://example.test/document.pdf'},error:null});
 cache=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:60_000}}});
 const report=emptyFinancialAnalyticsReport();
 const receipt=(id:string,contract_id:string|null,amount:number,principal:number,interest:number,unclassified=0)=>({id,contract_id,client_id:clientId,installment_id:null,date:'2026-01-05T12:00:00Z',day:'2026-01-05',amount,principal,interest,fees:0,unclassified,description:'Recebimento',category:null});
 report.receipts=[receipt('partial','active',20,15,5),receipt('cancelled','cancelled',50,40,10),receipt('paid','settled',40,40,0),receipt('legacy',null,30,0,0,30),{...receipt('other',null,900,900,0),client_id:'another-client'}];
 report.disbursements=contracts.map(c=>({id:c.id,contract_id:c.id,client_id:clientId,amount:c.capital,date:'2026-01-01T12:00:00Z',day:'2026-01-01'}));
 report.capital=[{contract_id:'active',disbursed:100,returned:15,outstanding:85},{contract_id:'cancelled',disbursed:200,returned:40,outstanding:160},{contract_id:'settled',disbursed:40,returned:40,outstanding:0}];state.report=report;
});
afterEach(()=>{cleanup();cache.clear();});

it('editar juros zero informa a taxa efetiva e acompanha a alteração sem salvar',async()=>{
 render(ui());await screen.findByRole('heading',{name:'Cliente owner-a'});
 fireEvent.click(screen.getAllByTitle('Editar empréstimo')[0]);
 const dialog=screen.getByRole('dialog',{name:'Editar Empréstimo'});
 expect(within(dialog).getByText(/0 ou vazio usa 4% de juros ao dia/)).toBeInTheDocument();
 fireEvent.change(within(dialog).getByRole('spinbutton',{name:'Juros de atraso ao dia'}),{target:{value:'0.5'}});
 expect(within(dialog).queryByText(/0 ou vazio usa/)).not.toBeInTheDocument();
 expect(within(dialog).getByText(/0,5% ao dia/)).toBeInTheDocument();
});

it('não mostra o cliente da conta anterior enquanto a nova conta carrega o mesmo endereço',async()=>{
 cache.setQueryData(['client-detail',clientId],{id:clientId,name:'Dado privado da conta anterior',created_at:'2026-01-01',status:'Ativo'});
 state.owner='owner-b';state.deferred=()=>{};render(ui());
 expect(screen.queryByText('Dado privado da conta anterior')).not.toBeInTheDocument();
 await waitFor(()=>expect(state.clientReads).toEqual(['owner-b']));
 await act(async()=>state.deferred!({data:null,error:{message:'Cliente não encontrado'}}));
 expect(screen.queryByText('Dado privado da conta anterior')).not.toBeInTheDocument();
});
it('troca de conta não reutiliza consultas frescas nem publica resposta tardia da conta anterior',async()=>{
 state.deferred=()=>{};const view=render(ui());await waitFor(()=>expect(state.clientReads).toHaveLength(1));const old=state.deferred!;
 state.owner='owner-b';view.rerender(ui());await waitFor(()=>expect(state.clientReads).toEqual(['owner-a','owner-b']));
 await act(async()=>state.deferred!({data:{id:clientId,name:'Cliente atual',created_at:'2026-01-01',status:'Ativo'},error:null}));
 await screen.findByText('Cliente atual');await act(async()=>old({data:{id:clientId,name:'Cliente anterior',created_at:'2026-01-01',status:'Ativo'},error:null}));
 expect(screen.queryByText('Cliente anterior')).not.toBeInTheDocument();
});
it('novo empréstimo não reutiliza o cliente em cache de outra conta',async()=>{
 cache.setQueryData(['existing-client-for-new-contract',clientId],{id:clientId,name:'Cliente privado anterior'});
 state.owner='owner-b';render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[`/clientes/novo?clientId=${clientId}`]}><NovoCliente/></MemoryRouter></QueryClientProvider>);
 expect(screen.queryByText('Cliente privado anterior')).not.toBeInTheDocument();await waitFor(()=>expect(state.existingReads).toEqual(['owner-b']));
});
it('detalhes incluem parciais, preservam capital sem devolução e usam juros comprovados',async()=>{
 render(ui());await screen.findByRole('heading',{name:'Cliente owner-a'});
 const summary=screen.getByRole('region',{name:'Resumo financeiro'});
 const metric=(label:string)=>within(summary).getByText(label).closest('article')!;
 expect(metric('Total recebido')).toHaveTextContent('140,00');
 expect(metric('Capital em aberto')).toHaveTextContent('245,00');
 expect(metric('Juros e encargos recebidos')).toHaveTextContent('15,00');
 expect(metric('Saldo em aberto')).toHaveTextContent('80,00');
 expect(screen.getByText(/R\$ 30,00.*sem classificação/)).toBeInTheDocument();
});
it('falha no relatório não exibe valores presumidos de recebimento e capital',async()=>{
 state.reportError=true;render(ui());await screen.findByRole('heading',{name:'Cliente owner-a'});
 await screen.findByText(/Não foi possível conferir os recebimentos/);
 expect(within(screen.getByRole('region',{name:'Resumo financeiro'})).queryByText('40,00')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Extrato PDF'}));expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Aguarde a conferência financeira'}));
});
it('documentos novos usam a pasta da conta e preservam os arquivos anteriores sem mover dados',async()=>{
 state.documents=true;render(ui());await screen.findByRole('heading',{name:'Cliente owner-a'});
 fireEvent.click(screen.getByRole('button',{name:/Documentos.*arquivos anexados/}));
 await screen.findByText('legacy.pdf');expect(screen.getByText('current.pdf')).toBeInTheDocument();
 const input=screen.getByText('Anexar arquivo').closest('label')!.querySelector('input')!;
 fireEvent.change(input,{target:{files:[new File(['fictional'],'test.pdf',{type:'application/pdf'})]}});
 await waitFor(()=>expect(state.upload).toHaveBeenCalledTimes(1));
 expect(state.upload.mock.calls[0][0]).toMatch(new RegExp(`^owner-a/client-docs/${clientId}/\\d+-test\\.pdf$`));
 expect(state.folders).toContain(`owner-a/client-docs/${clientId}`);expect(state.folders).toContain(`client-docs/${clientId}`);
});
it('cancelar a confirmação assíncrona de remoção não exclui o documento',async()=>{
 state.documents=true;let answer!:(v:boolean)=>void;state.confirm.mockReturnValue(new Promise<boolean>(resolve=>{answer=resolve;}));
 render(ui());await screen.findByRole('heading',{name:'Cliente owner-a'});fireEvent.click(screen.getByRole('button',{name:/Documentos.*arquivos anexados/}));await screen.findByText('current.pdf');
 fireEvent.click(screen.getAllByTitle('Remover')[0]);expect(state.confirm).toHaveBeenCalledTimes(1);expect(state.remove).not.toHaveBeenCalled();
 await act(async()=>answer(false));expect(state.remove).not.toHaveBeenCalled();
});
it('remover um arquivo anterior usa seu caminho original após a confirmação',async()=>{
 state.documents=true;state.confirm.mockResolvedValue(true);render(ui());await screen.findByRole('heading',{name:'Cliente owner-a'});fireEvent.click(screen.getByRole('button',{name:/Documentos.*arquivos anexados/}));
 const legacy=await screen.findByText('legacy.pdf');fireEvent.click(within(legacy.closest('.group') as HTMLElement).getByTitle('Remover'));
 await waitFor(()=>expect(state.remove).toHaveBeenCalledExactlyOnceWith([`client-docs/${clientId}/legacy.pdf`]));
});
