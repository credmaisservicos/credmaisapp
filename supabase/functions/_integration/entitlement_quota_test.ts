import {assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {enforceEntitlement,entitlementResponse} from '../_shared/entitlement.ts';
const backend='https://entitlement-backend.test.invalid';
Deno.env.set('SUPABASE_URL',backend);Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','isolated-service-key');
let quota:any={allowed:true,remaining:4,retry_after_ms:0},httpError=false,networkError=false;
globalThis.fetch=async(input,init)=>{
 const request=new Request(input,init),url=new URL(request.url);
 if(url.origin!==backend)throw Error('Unexpected outbound provider call blocked');
 if(url.pathname==='/rest/v1/profiles')return Response.json({is_admin:false,is_blocked:false,plan_tier:'completo',subscription_type:'lifetime'});
 if(url.pathname==='/rest/v1/rpc/try_consume_rate_limit'){
  if(networkError)throw new TypeError('Synthetic quota network failure');
  return Response.json(httpError?{code:'42883',message:'missing quota routine'}:quota,{status:httpError?404:200});
 }
 throw Error('Unexpected synthetic endpoint');
};
const reset=()=>{quota={allowed:true,remaining:4,retry_after_ms:0};httpError=false;networkError=false;};
const verify=()=>enforceEntitlement('fictional-owner','expensive-provider');
Deno.test('entitlement requires a valid durable quota before allowing the provider',async()=>{reset();assertEquals(await verify(),{ok:true,tier:'completo'});});
for(const invalid of [null,{}, {allowed:'true'}, {allowed:true,remaining:-1,retry_after_ms:0},{allowed:true,remaining:1,retry_after_ms:-1}]){
 Deno.test(`entitlement fails closed with invalid quota ${JSON.stringify(invalid)}`,async()=>{reset();quota=invalid;assertEquals<unknown>(await verify(),{ok:false,status:503,error:'entitlement_unavailable'});});
}
Deno.test('entitlement fails closed when the quota RPC is missing',async()=>{reset();httpError=true;assertEquals<unknown>(await verify(),{ok:false,status:503,error:'entitlement_unavailable'});});
Deno.test('entitlement fails closed on quota transport failure',async()=>{reset();networkError=true;assertEquals<unknown>(await verify(),{ok:false,status:503,error:'entitlement_unavailable'});});
Deno.test('entitlement returns the durable quota denial and retry period',async()=>{reset();quota={allowed:false,remaining:0,retry_after_ms:1500};const result=await verify();assertEquals(result,{ok:false,status:429,error:'rate_limit_exceeded',retryAfterMs:1500});if(result.ok)throw Error('Denied quota allowed');assertEquals(entitlementResponse(result,{}).headers.get('Retry-After'),'2');});
