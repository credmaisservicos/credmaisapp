// @vitest-environment-options {"url":"https://credmaisapp.com.br"}
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import DangerZone from '@/components/perfil/DangerZone';
const mocks=vi.hoisted(()=>({toast:vi.fn(),getSession:vi.fn()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'isolated-owner',email:'owner@example.test'},signOut:vi.fn()})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:mocks.getSession},functions:{invoke:vi.fn()}}}));
beforeEach(()=>{
 mocks.toast.mockReset();mocks.getSession.mockResolvedValue({data:{session:{access_token:'isolated-token'}}});
 vi.stubEnv('VITE_SUPABASE_URL','https://credmaisapp-supabase.fcoipz.easypanel.host');
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:isolated-download'),revokeObjectURL:vi.fn()}));
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('exporta pelo domínio do app quando a rede bloqueia o domínio do backend',async()=>{
 const network=vi.fn(async(input:RequestInfo|URL,_options?:RequestInit)=>{
  const url=String(input);
  if(url!=='https://credmaisapp.com.br/api/supabase/functions/v1/export-user-data')throw new TypeError('Direct backend blocked');
  return new Response('{"clients":[]}',{headers:{'content-type':'application/json'}});
 });vi.stubGlobal('fetch',network);
 render(<DangerZone/>);fireEvent.click(screen.getByRole('button',{name:'Baixar meus dados (JSON)'}));
 await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Download iniciado'})));
 expect(network).toHaveBeenCalledTimes(1);
 expect(network.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'omit',headers:{Authorization:'Bearer isolated-token'}});
 expect(URL.createObjectURL).toHaveBeenCalledTimes(1);expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
 expect(screen.getByRole('button',{name:'Baixar meus dados (JSON)'})).toBeEnabled();
});
it('não anuncia download quando o servidor falha e permite tentar novamente',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
 render(<DangerZone/>);fireEvent.click(screen.getByRole('button',{name:'Baixar meus dados (JSON)'}));
 await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao exportar',description:'HTTP 503'})));
 expect(URL.createObjectURL).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Baixar meus dados (JSON)'})).toBeEnabled();
});
it('sessão expirada não inicia requisição nem download',async()=>{
 mocks.getSession.mockResolvedValue({data:{session:null}});const network=vi.fn();vi.stubGlobal('fetch',network);
 render(<DangerZone/>);fireEvent.click(screen.getByRole('button',{name:'Baixar meus dados (JSON)'}));
 await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Falha ao exportar'})));
 expect(network).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
