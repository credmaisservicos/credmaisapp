import {it,expect,vi,afterEach} from 'vitest';
import {apiTransportUrl,supabaseFetch} from '@/integrations/supabase/transport';
const backend='https://credmaisapp-supabase.fcoipz.easypanel.host';
afterEach(()=>vi.unstubAllGlobals());
it.each(['https://credmaisapp.com.br','https://www.credmaisapp.com.br','https://build.credmaisapp-vtf.pages.dev'])('uses the app domain for HTTP on %s',origin=>{
 expect(apiTransportUrl(backend+'/auth/v1/token?grant_type=password',origin,false)).toBe(origin+'/api/supabase/auth/v1/token?grant_type=password');
});
it('native login uses the production app domain',()=>expect(apiTransportUrl(backend+'/rest/v1/profiles?select=id','https://localhost',true)).toBe('https://credmaisapp.com.br/api/supabase/rest/v1/profiles?select=id'));
it('keeps local tests, staging backends and realtime separate',()=>{
 expect(apiTransportUrl(backend+'/auth/v1/user','http://localhost:8080',false)).toBe(backend+'/auth/v1/user');
 expect(apiTransportUrl('https://staging.supabase.co/rest/v1/profiles','https://credmaisapp.com.br',false)).toBe('https://staging.supabase.co/rest/v1/profiles');
 expect(apiTransportUrl(backend+'/realtime/v1','https://credmaisapp.com.br',false)).toBe(backend+'/realtime/v1');
});
it('preserves a Request body, authorization and abort signal without retries or cookies',async()=>{
 const stub=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',stub);
 const controller=new AbortController();const request=new Request(backend+'/auth/v1/token',{method:'POST',body:'private-test',headers:{authorization:'Bearer isolated-test'},signal:controller.signal});
 await supabaseFetch(request);expect(stub).toHaveBeenCalledTimes(1);
 const [forwarded,options]=stub.mock.calls[0] as unknown as [Request,RequestInit];
 expect(await forwarded.text()).toBe('private-test');expect(forwarded.method).toBe('POST');expect(forwarded.headers.get('authorization')).toBe('Bearer isolated-test');
 controller.abort();expect(forwarded.signal.aborted).toBe(true);expect(options.credentials).toBe('omit');expect(options.cache).toBe('no-store');
});
