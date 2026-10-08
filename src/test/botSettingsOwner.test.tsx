import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,expect,it,vi} from 'vitest';
import BotSettings from '@/components/agent/BotSettings';
const state=vi.hoisted(()=>({owner:'company-a',updates:[] as {owner:string;values:unknown}[]}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:state.owner}})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/components/agent/BotTemplates',()=>({default:()=>null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
 let owner='',values:unknown;
 const query={select:()=>query,eq:(_key:string,value:string)=>{owner=value;return query;},update:(next:unknown)=>{values=next;return query;},
 single:async()=>{if(values){state.updates.push({owner,values});return {data:{id:owner},error:null};}
 return {data:{id:owner,user_id:owner,bot_greeting_message:owner==='company-a'?'Saudação A':'Saudação B',bot_send_birthday:false},error:null};}};
 return query;
}}}));
beforeEach(()=>{state.owner='company-a';state.updates=[];});
it('descarta edição da conta anterior quando troca de titular',async()=>{
 const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const component=()=> <QueryClientProvider client={cache}><BotSettings/></QueryClientProvider>;
 const view=render(component());
 const field=await screen.findByLabelText('Saudação');
 fireEvent.change(field,{target:{value:'Rascunho da empresa A'}});
 state.owner='company-b';view.rerender(component());
 await waitFor(()=>expect(screen.getByLabelText('Saudação')).toHaveValue('Saudação B'));
 expect(screen.getAllByRole('button',{name:'Salvar alterações'})[0]).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Saudação'),{target:{value:'Nova saudação B'}});
 fireEvent.click(screen.getAllByRole('button',{name:'Salvar alterações'})[0]);
 await waitFor(()=>expect(state.updates).toEqual([{owner:'company-b',values:{bot_greeting_message:'Nova saudação B'}}]));
 view.unmount();cache.clear();
});
