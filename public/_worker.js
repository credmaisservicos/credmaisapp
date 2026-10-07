const PREFIX='/api/supabase';
const BACKEND='https://credmaisapp-supabase.fcoipz.easypanel.host';
const appOrigins=new Set(['https://credmaisapp.com.br','https://www.credmaisapp.com.br','http://localhost','https://localhost','capacitor://localhost']);
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith(PREFIX+'/'))return env.ASSETS.fetch(request);
  const path=url.pathname.slice(PREFIX.length);
  const origin=request.headers.get('origin');
  const allowed=!origin||origin===url.origin||appOrigins.has(origin);
  const headers=new Headers({'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Vary':'Origin'});
  if(origin&&allowed)headers.set('Access-Control-Allow-Origin',origin);
  headers.set('Access-Control-Expose-Headers','content-range,range,x-request-id,retry-after');
  if(!allowed)return new Response(JSON.stringify({message:'Origin not allowed'}),{status:403,headers});
  if(!/^\/(?:auth|rest|storage|functions)\/v1\//.test(path))return new Response(JSON.stringify({message:'Unknown API route'}),{status:404,headers});
  if(request.method==='OPTIONS'){
   headers.set('Access-Control-Allow-Methods','GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
   headers.set('Access-Control-Allow-Headers','authorization,apikey,x-client-info,content-type,accept,prefer,range,range-unit,accept-profile,content-profile,x-upsert,x-supabase-api-version,x-supabase-client-platform,x-supabase-client-platform-version,x-supabase-client-runtime,x-supabase-client-runtime-version');
   return new Response(null,{status:204,headers});
  }
  const target=new URL(BACKEND);target.pathname=path;target.search=url.search;
  const upstreamHeaders=new Headers(request.headers);
  for(const name of ['host','cookie','cf-access-jwt-assertion'])upstreamHeaders.delete(name);
  upstreamHeaders.set('Cache-Control','no-store');
  const clientIp=request.headers.get('cf-connecting-ip');if(clientIp)upstreamHeaders.set('X-Forwarded-For',clientIp);
  try{
   const response=await fetch(target,{method:request.method,headers:upstreamHeaders,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual',signal:request.signal,cf:{cacheTtl:0,cacheEverything:false}});
   const resultHeaders=new Headers(response.headers);
   for(const name of ['set-cookie','access-control-allow-origin','access-control-allow-credentials'])resultHeaders.delete(name);
   for(const [name,value] of headers)resultHeaders.set(name,value);
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers:resultHeaders});
  }catch{
   headers.set('Content-Type','application/json');
   return new Response(JSON.stringify({message:'Servidor temporariamente indisponível',code:'upstream_unavailable'}),{status:502,headers});
  }
 }
};
