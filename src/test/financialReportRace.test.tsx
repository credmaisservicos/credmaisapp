import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {emptyFinancialAnalyticsReport} from '../../e2e/helpers/financialAnalytics';
import Relatorios from '@/pages/Relatorios';
const state=vi.hoisted(()=>({owner:'owner-a',requests:[] as Array<{owner:string;month:string;resolve:(value:any)=>void}>}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:state.owner},profile:{name:'Teste'}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/relatorios/ExportCenter',()=>({default:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
 from:()=>{const chain:any={};for(const name of ['select','eq','gte','lte','lt','order'])chain[name]=()=>chain;chain.range=async()=>({data:[],error:null});chain.single=async()=>({data:null,error:null});return chain;},
 rpc:(_name:string,args:any)=>new Promise(resolve=>state.requests.push({owner:state.owner,month:args._from.slice(0,7),resolve})),
 channel:()=>{const channel:any={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:()=>Promise.resolve(),
}}));
let client:QueryClient;
beforeEach(()=>{state.owner='owner-a';state.requests=[];client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});});
afterEach(()=>{cleanup();client.clear();});
const ui=()=> <QueryClientProvider client={client}><Relatorios/></QueryClientProvider>;
function response(amount:number){const report=emptyFinancialAnalyticsReport();report.receipts=[{id:'r',contract_id:null,client_id:null,installment_id:null,date:'2026-08-31T23:00:00-03:00',day:'2026-08-31',amount,principal:amount,interest:0,fees:0,unclassified:0,description:'Recebimento',category:null}];return {data:report,error:null};}
it('resposta de mês anterior não substitui os totais nem libera exportação do mês errado',async()=>{
 render(ui());await waitFor(()=>expect(state.requests).toHaveLength(1));
 const old=state.requests[0];fireEvent.change(screen.getByLabelText('Mês do relatório'),{target:{value:old.month==='2026-08'?'2026-09':'2026-08'}});
 await waitFor(()=>expect(state.requests).toHaveLength(2));expect(screen.getByRole('button',{name:/^CSV$/})).toBeDisabled();
 await act(async()=>state.requests[1].resolve(response(60)));await screen.findByText('R$ 60,00');
 await act(async()=>old.resolve(response(40)));expect(screen.queryByText('R$ 40,00')).not.toBeInTheDocument();expect(screen.getByText('R$ 60,00')).toBeInTheDocument();expect(screen.getByRole('button',{name:/^CSV$/})).toBeEnabled();
});
it('troca de proprietário não publica a resposta financeira da conta anterior',async()=>{
 const view=render(ui());await waitFor(()=>expect(state.requests).toHaveLength(1));const old=state.requests[0];state.owner='owner-b';view.rerender(ui());
 await waitFor(()=>expect(state.requests).toHaveLength(2));expect(state.requests[1].owner).toBe('owner-b');
 await act(async()=>state.requests[1].resolve(response(60)));await screen.findByText('R$ 60,00');await act(async()=>old.resolve(response(40)));
 expect(screen.queryByText('R$ 40,00')).not.toBeInTheDocument();expect(screen.getByText('R$ 60,00')).toBeInTheDocument();
});
