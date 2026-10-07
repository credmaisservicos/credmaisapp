import {createClient} from '@supabase/supabase-js';
import {it,expect,vi} from 'vitest';
import {createRememberMeStorage} from '@/integrations/supabase/remember';
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'isolated@example.test',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const encoded=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
it('the real auth SDK can sign in, read its session, and sign out with both browser stores unavailable',async()=>{
 const denied=()=>{throw new DOMException('Blocked','SecurityError');};
 const state=createRememberMeStorage(denied,denied);state.setRememberMe(false);
 const exp=Math.floor(Date.now()/1000)+3600;
 const token=encoded({alg:'HS256',typ:'JWT'})+'.'+encoded({sub:user.id,role:'authenticated',exp})+'.isolated';
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
  const path=new URL(String(input)).pathname;
  if(path==='/auth/v1/token')return new Response(JSON.stringify({access_token:token,refresh_token:'isolated-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user}),{headers:{'Content-Type':'application/json'}});
  if(path==='/auth/v1/logout')return new Response('{}');
  throw new Error('Unexpected external request in isolated auth test');
 });
 const client=createClient('https://auth-storage.test.invalid','isolated-public',{auth:{storage:state.rememberMeStorage,storageKey:'sb-isolated-auth-token',autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}});
 try{
  expect((await client.auth.getSession()).data.session).toBeNull();
  const login=await client.auth.signInWithPassword({email:user.email,password:'IsolatedPassword123!'});
  expect(login.error).toBeNull();expect(login.data.user?.id).toBe(user.id);
  expect((await client.auth.getSession()).data.session?.access_token).toBe(token);
  expect((await client.auth.signOut({scope:'local'})).error).toBeNull();
  expect((await client.auth.getSession()).data.session).toBeNull();expect(state.rememberMeStorage.getItem('sb-isolated-auth-token')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
 }finally{
  await client.auth.stopAutoRefresh();
  (client.auth as unknown as {broadcastChannel?:BroadcastChannel}).broadcastChannel?.close();
 }
});
