import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({user:{id:'company-a'},pending:new Map<string,(value:unknown)=>void>()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:state.user})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 let owner='';const query={select:()=>query,eq:(_key:string,id:string)=>{owner=id;return query;},
 maybeSingle:()=>new Promise(resolve=>state.pending.set(owner,resolve))};return query;
}}}));
import {WhiteLabelProvider,useWhiteLabel} from '@/contexts/WhiteLabelContext';
function Brand(){const {config}=useWhiteLabel();return <p>{config.companyName} / {String(config.modulesEnabled.analises)}</p>;}
beforeEach(()=>{state.user={id:'company-a'};state.pending.clear();localStorage.removeItem('credmais-public-brand');});
afterEach(cleanup);
it('resposta atrasada da empresa anterior não muda marca nem módulos da atual',async()=>{
 const view=render(<WhiteLabelProvider><Brand/></WhiteLabelProvider>);
 await waitFor(()=>expect(state.pending.has('company-a')).toBe(true));
 state.user={id:'company-b'};view.rerender(<WhiteLabelProvider><Brand/></WhiteLabelProvider>);
 await waitFor(()=>expect(state.pending.has('company-b')).toBe(true));
 await act(async()=>state.pending.get('company-b')!({data:{company_name:'Empresa B',modules_enabled:{analises:true}}}));
 expect(screen.getByText('Empresa B / true')).toBeInTheDocument();
 await act(async()=>state.pending.get('company-a')!({data:{company_name:'Empresa A',modules_enabled:{analises:false}}}));
 expect(screen.getByText('Empresa B / true')).toBeInTheDocument();
 expect(JSON.parse(localStorage.getItem('credmais-public-brand')!).companyName).toBe('Empresa B');
});
it('não mantém marca ou módulos da empresa anterior enquanto a nova conta carrega ou falha',async()=>{
 const view=render(<WhiteLabelProvider><Brand/></WhiteLabelProvider>);
 await act(async()=>state.pending.get('company-a')!({data:{company_name:'Empresa A',favicon_url:'https://example.com/a.ico',modules_enabled:{analises:false}}}));
 expect(screen.getByText('Empresa A / false')).toBeInTheDocument();
 state.user={id:'company-b'};view.rerender(<WhiteLabelProvider><Brand/></WhiteLabelProvider>);
 await waitFor(()=>expect(state.pending.has('company-b')).toBe(true));
 expect(screen.getByText('CREDMAIS APP / true')).toBeInTheDocument();
 expect(document.querySelector<HTMLLinkElement>("link[rel~='icon']")?.getAttribute('href')).toBe('/favicon.ico');
 await act(async()=>state.pending.get('company-b')!({data:null,error:{message:'unavailable'}}));
 expect(screen.getByText('CREDMAIS APP / true')).toBeInTheDocument();
});
