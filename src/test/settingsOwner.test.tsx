import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({owner:'company-a',profile:{},pending:new Map<string,(value:unknown)=>void>()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:state.owner},profile:state.profile,isPlatformAdmin:false})}));
vi.mock('@/contexts/WhiteLabelContext',()=>({useWhiteLabel:()=>({refresh:vi.fn()}),DEFAULT_MODULES:{analises:true}}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/ConfirmProvider',()=>({useConfirm:()=>vi.fn()}));
vi.mock('@/hooks/usePwaInstall',()=>({usePwaInstall:()=>({installed:false,canPrompt:false,install:vi.fn()})}));
vi.mock('@/components/configuracoes/SectionRenderer',()=>({default:({ctx}:any)=><input aria-label="Empresa do formulário" value={ctx.form.company_name} onChange={e=>ctx.setForm({...ctx.form,company_name:e.target.value})}/>}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
 let owner='';const query={select:()=>query,eq:(_key:string,id:string)=>{owner=id;return query;},
 order:async()=>({data:[]}),maybeSingle:()=>table==='settings_safe'?new Promise(resolve=>state.pending.set(owner,resolve)):Promise.resolve({data:{role:'admin'}})};
 return query;
}}}));
import Configuracoes from '@/pages/Configuracoes';
beforeEach(()=>{state.owner='company-a';state.pending.clear();});
it('descarta formulário de A e bloqueia salvar B enquanto sua configuração não foi lida',async()=>{
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const component=()=><MemoryRouter><QueryClientProvider client={cache}><Configuracoes/></QueryClientProvider></MemoryRouter>;
 const view=render(component());
 await waitFor(()=>expect(state.pending.has('company-a')).toBe(true));
 await act(async()=>state.pending.get('company-a')!({data:{user_id:'company-a',company_name:'Empresa A'}}));
 await waitFor(()=>expect(screen.getByLabelText('Empresa do formulário')).toHaveValue('Empresa A'));
 fireEvent.change(screen.getByLabelText('Empresa do formulário'),{target:{value:'Rascunho A'}});
 state.owner='company-b';view.rerender(component());
 await waitFor(()=>expect(state.pending.has('company-b')).toBe(true));
 expect(screen.getByLabelText('Empresa do formulário')).toHaveValue('');
 expect(screen.getByRole('button',{name:'Salvar configurações'})).toBeDisabled();
 await act(async()=>state.pending.get('company-b')!({data:null,error:{message:'indisponível'}}));
 expect(screen.getByLabelText('Empresa do formulário')).toHaveValue('');
 expect(screen.getByRole('button',{name:'Salvar configurações'})).toBeDisabled();
 view.unmount();cache.clear();
});
