const PREFIX='/api/supabase';
const BACKEND='https://credmaisapp-supabase.fcoipz.easypanel.host';
const appOrigins=new Set(['https://credmaisapp.com.br','https://www.credmaisapp.com.br','http://localhost','https://localhost','capacitor://localhost']);
async function staticResponse(request,env,url){
 const response=await env.ASSETS.fetch(request);
 if(!url.pathname.startsWith('/assets/')||response.status===304)return response;
 const type=(response.headers.get('content-type')||'').toLowerCase();
 const invalid=response.ok&&(type.includes('text/html')||
  (/\.(?:js|mjs)$/i.test(url.pathname)&&!/(?:java|ecma)script/.test(type))||
  (/\.css$/i.test(url.pathname)&&!type.includes('text/css')));
 if(!invalid&&response.status<400)return response;
 // SPA fallback HTML must never become an immutable JavaScript cache entry.
 const headers=invalid?new Headers({'Content-Type':'text/plain; charset=utf-8','X-Content-Type-Options':'nosniff'}):new Headers(response.headers);
 headers.set('Cache-Control','no-store');
 headers.set('CDN-Cache-Control','no-store');
 headers.set('Cloudflare-CDN-Cache-Control','no-store');
 if(invalid)return new Response(request.method==='HEAD'?null:'Arquivo do aplicativo indisponível. Tente novamente.',{status:404,headers});
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(!url.pathname.startsWith(PREFIX+'/'))return staticResponse(request,env,url);
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
   headers.set('Access-Control-Allow-Headers','authorization,apikey,x-client-info,x-retry-count,content-type,accept,prefer,range,range-unit,accept-profile,content-profile,x-upsert,x-supabase-api-version,x-supabase-client-platform,x-supabase-client-platform-version,x-supabase-client-runtime,x-supabase-client-runtime-version');
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
   // Uploaded documents must not acquire the application's origin when opened.
   // A separate CSP policy also constrains permissive upstream policies.
   if(['GET','HEAD'].includes(request.method)&&path.startsWith('/storage/v1/object/'))resultHeaders.append('Content-Security-Policy','sandbox');
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers:resultHeaders});
  }catch{
   headers.set('Content-Type','application/json');
   return new Response(JSON.stringify({message:'Servidor temporariamente indisponível',code:'upstream_unavailable'}),{status:502,headers});
  }
 }
};
