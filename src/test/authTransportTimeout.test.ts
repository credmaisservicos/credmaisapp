import {it,expect,vi,afterEach} from 'vitest';
import {supabaseFetch,AUTH_FETCH_TIMEOUT_MS} from '@/integrations/supabase/transport';
const endpoint='https://credmaisapp-supabase.fcoipz.easypanel.host/auth/v1/token';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('aborts stalled auth requests and never retries writes',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;
 const fetcher=vi.fn((_input,init)=>new Promise<Response>((_resolve,reject)=>{signal=init.signal;signal?.addEventListener('abort',()=>reject(signal!.reason));}));vi.stubGlobal('fetch',fetcher);
 const pending=supabaseFetch(endpoint,{method:'POST',body:'isolated'}).then(()=>null,error=>error);
 await vi.advanceTimersByTimeAsync(AUTH_FETCH_TIMEOUT_MS);expect((await pending).name).toBe('TimeoutError');expect(signal?.aborted).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps the timeout active when headers arrive but the auth response body stalls',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(async(_input,init)=>new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(init.signal.reason));}}))));
 const pending=supabaseFetch(endpoint).then(()=>null,error=>error);await vi.advanceTimersByTimeAsync(AUTH_FETCH_TIMEOUT_MS);expect((await pending).name).toBe('TimeoutError');
});
it('cleans up timeouts after success and propagates external cancellation',async()=>{
 vi.useFakeTimers();let forwarded:AbortSignal|undefined;
 vi.stubGlobal('fetch',vi.fn(async(_input,init)=>{forwarded=init.signal;return new Response('{"session":"isolated"}',{status:201});}));
 const response=await supabaseFetch(endpoint,{method:'POST'});expect(response.status).toBe(201);expect(await response.json()).toEqual({session:'isolated'});
 await vi.advanceTimersByTimeAsync(AUTH_FETCH_TIMEOUT_MS);expect(forwarded?.aborted).toBe(false);
 const parent=new AbortController();vi.stubGlobal('fetch',vi.fn((_input,init)=>new Promise<Response>((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)))));
 const pending=supabaseFetch(endpoint,{signal:parent.signal}).then(()=>null,error=>error);parent.abort();expect((await pending).name).toBe('AbortError');
});
