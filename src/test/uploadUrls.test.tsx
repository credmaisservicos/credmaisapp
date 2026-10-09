import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({owner:'company-a',invoke:vi.fn()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:state.owner}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:state.invoke},auth:{getSession:async()=>({data:{session:{user:{id:state.owner}}}})}}}));
vi.mock('@/hooks/use-toast',()=>({toast:vi.fn()}));
import {clearUploadUrlCache,resolveUploadUrl} from '@/lib/uploadUrls';
import {UploadImage} from '@/components/UploadMedia';
const ref='storage://uploads/owner/file.pdf';
const signed=(suffix='current')=>'https://credmaisapp-supabase.fcoipz.easypanel.host/storage/v1/object/sign/uploads/owner/file.pdf?token='+suffix;
const rendered=(suffix='current')=>signed(suffix).replace('https://credmaisapp-supabase.fcoipz.easypanel.host',import.meta.env.VITE_SUPABASE_URL);
beforeEach(()=>{cleanup();clearUploadUrlCache();state.owner='company-a';vi.clearAllMocks();state.invoke.mockImplementation(async(_name,options)=>({data:{expires_in:300,urls:options.body.references.map(()=>signed())},error:null}));});
afterEach(cleanup);
it('comprovante legado por caminho recebe autorização nova e não vira rota relativa',async()=>{
 const path='portal-receipts/11111111-1111-4111-8111-111111111111/receipt.pdf';
 const url=await resolveUploadUrl(path,{kind:'portal',token:'session-a'});
 expect(state.invoke).toHaveBeenCalledTimes(1);
 expect(state.invoke.mock.calls[0][1].body).toEqual({references:[path],access:{kind:'portal',token:'session-a'}});
 expect(url).toBe(rendered());
});
it('comprovante legado sem autorização não devolve o caminho como link navegável',async()=>{
 state.invoke.mockResolvedValueOnce({data:{expires_in:300,urls:[null]},error:null});
 expect(await resolveUploadUrl('portal-receipts/11111111-1111-4111-8111-111111111111/receipt.pdf',{kind:'portal',token:'foreign-session'})).toBeNull();
});
it('agrupa a leitura dos arquivos e compartilha somente cache do mesmo titular',async()=>{
 const first=resolveUploadUrl(ref,{kind:'owner'},'company-a');
 const repeated=resolveUploadUrl(ref,{kind:'owner'},'company-a');
 const second=resolveUploadUrl('storage://uploads/owner/second.pdf',{kind:'owner'},'company-a');
 await Promise.all([first,repeated,second]);expect(state.invoke).toHaveBeenCalledTimes(1);
 expect(state.invoke.mock.calls[0][1].body.references).toHaveLength(2);
 await resolveUploadUrl(ref,{kind:'owner'},'company-b');expect(state.invoke).toHaveBeenCalledTimes(2);
});
it('tokens de portais não compartilham autorização nem cache',async()=>{
 await resolveUploadUrl(ref,{kind:'portal',token:'session-a'});
 await resolveUploadUrl(ref,{kind:'portal',token:'session-b'});
 expect(state.invoke).toHaveBeenCalledTimes(2);
 expect(state.invoke.mock.calls[1][1].body.access).toEqual({kind:'portal',token:'session-b'});
});
it('abre arquivos com URL nova mesmo quando há cache válido',async()=>{
 await resolveUploadUrl(ref,{kind:'owner'},'company-a');
 await resolveUploadUrl(ref,{kind:'owner'},'company-a',true);
 expect(state.invoke).toHaveBeenCalledTimes(2);
});
it('erro de autorização não reutiliza a URL de longa duração nem fica em cache',async()=>{
 state.invoke.mockResolvedValueOnce({data:{expires_in:300,urls:[null]},error:null});
 const legacy=signed('old-long-token');expect(await resolveUploadUrl(legacy,{kind:'owner'},'company-a')).toBeNull();
 await resolveUploadUrl(legacy,{kind:'owner'},'company-a');expect(state.invoke).toHaveBeenCalledTimes(2);
});
it('resposta atrasada da conta anterior não aparece na imagem da nova conta',async()=>{
 let finish!:(value:unknown)=>void;
 state.invoke.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const view=render(<UploadImage src={ref} alt="Arquivo privado"/>);
 await waitFor(()=>expect(state.invoke).toHaveBeenCalledTimes(1));
 state.owner='company-b';view.rerender(<UploadImage src={ref} alt="Arquivo privado"/>);
 await waitFor(()=>expect(state.invoke).toHaveBeenCalledTimes(2));
 const image=screen.getByAltText('Arquivo privado');await waitFor(()=>expect(image).toHaveAttribute('src',rendered()));
 await act(async()=>{finish({data:{expires_in:300,urls:[signed('from-company-a')]},error:null});});
 expect(image).toHaveAttribute('src',rendered());
});
it('recusa esquema de referência inválido e preserva a prévia local sem fazer consultas',async()=>{
 expect(await resolveUploadUrl('storage://uploads/../private')).toBeNull();
 expect(await resolveUploadUrl('blob:local-preview')).toBe('blob:local-preview');expect(state.invoke).not.toHaveBeenCalled();
});
