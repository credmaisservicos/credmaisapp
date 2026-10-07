// @vitest-environment node
import {it,expect,vi,afterEach} from 'vitest';
import proxy from '../../public/_worker.js';
const base='https://credmaisapp.com.br/api/supabase';
const assets=vi.fn(async()=>new Response('static asset'));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it('forwards exactly one operation with the same authorization, body and query to a fixed server',async()=>{
 const upstream=vi.fn(async()=>new Response('{"data":"test"}',{status:201,headers:{'Set-Cookie':'private','Content-Range':'0-0/1','Cache-Control':'public,max-age=3600'}}));vi.stubGlobal('fetch',upstream);
 const result=await proxy.fetch(new Request(base+'/rest/v1/clients?select=id',{method:'POST',body:'{"name":"Fictional"}',headers:{authorization:'Bearer isolated-test',apikey:'isolated-public',Cookie:'private','Origin':'https://credmaisapp.com.br'}}),{ASSETS:{fetch:assets}});
 expect(upstream).toHaveBeenCalledTimes(1);const [target,options]=upstream.mock.calls[0] as unknown as [URL,RequestInit];
 expect(target.href).toBe('https://credmaisapp-supabase.fcoipz.easypanel.host/rest/v1/clients?select=id');expect(options.method).toBe('POST');expect(await new Response(options.body).text()).toBe('{"name":"Fictional"}');
 const headers=new Headers(options.headers);expect(headers.get('authorization')).toBe('Bearer isolated-test');expect(headers.get('apikey')).toBe('isolated-public');expect(headers.has('cookie')).toBe(false);
 expect(result.status).toBe(201);expect(result.headers.get('Cache-Control')).toBe('no-store, private');expect(result.headers.has('Set-Cookie')).toBe(false);expect(result.headers.get('Content-Range')).toBe('0-0/1');
});
it.each([401,403,429])('preserves a backend denial %s without retries or bypasses',async status=>{
 const upstream=vi.fn(async()=>new Response('{"message":"denied"}',{status}));vi.stubGlobal('fetch',upstream);
 expect((await proxy.fetch(new Request(base+'/auth/v1/user'),{ASSETS:{fetch:assets}})).status).toBe(status);expect(upstream).toHaveBeenCalledTimes(1);
});
it('returns an API error on upstream failure instead of an HTML shell',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Failed to fetch');}));
 const response=await proxy.fetch(new Request(base+'/rest/v1/profiles'),{ASSETS:{fetch:assets}});expect(response.status).toBe(502);expect(await response.json()).toEqual({message:'Servidor temporariamente indisponível',code:'upstream_unavailable'});expect(assets).not.toHaveBeenCalled();
});
it('limits API routes and rejects cross-site origins',async()=>{
 const upstream=vi.fn();vi.stubGlobal('fetch',upstream);
 expect((await proxy.fetch(new Request(base+'/anything'),{ASSETS:{fetch:assets}})).status).toBe(404);
 expect((await proxy.fetch(new Request(base+'/auth/v1/user',{headers:{Origin:'https://unrelated.invalid'}}),{ASSETS:{fetch:assets}})).status).toBe(403);expect(upstream).not.toHaveBeenCalled();
});
it.each(['http://localhost','https://localhost','capacitor://localhost','https://www.credmaisapp.com.br'])('app preflight allows %s without forwarding credentials',async origin=>{
 const upstream=vi.fn();vi.stubGlobal('fetch',upstream);const response=await proxy.fetch(new Request(base+'/auth/v1/token',{method:'OPTIONS',headers:{Origin:origin}}),{ASSETS:{fetch:assets}});
 expect(response.status).toBe(204);expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);expect(response.headers.get('Access-Control-Allow-Headers')).toContain('apikey');expect(upstream).not.toHaveBeenCalled();
});
it('serves other paths as static assets',async()=>{expect(await (await proxy.fetch(new Request('https://credmaisapp.com.br/dashboard'),{ASSETS:{fetch:assets}})).text()).toBe('static asset');});
