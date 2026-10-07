import {Capacitor} from '@capacitor/core';
const backend='https://credmaisapp-supabase.fcoipz.easypanel.host';
/** Keep the SDK URL/storage key unchanged while routing HTTP through the app's domain. */
export function apiTransportUrl(input:string,appOrigin=window.location.origin,native=Capacitor.isNativePlatform()){
 const url=new URL(input);
 const app=new URL(appOrigin);
 const production=app.protocol==='https:'&&(['credmaisapp.com.br','www.credmaisapp.com.br','credmaisapp-vtf.pages.dev'].includes(app.hostname)||app.hostname.endsWith('.credmaisapp-vtf.pages.dev'));
 if(url.origin!==backend||(!production&&!native))return input;
 if(!/^\/(?:auth|rest|storage|functions)\/v1\//.test(url.pathname))return input;
 return (native?'https://credmaisapp.com.br':app.origin)+'/api/supabase'+url.pathname+url.search;
}
export const AUTH_FETCH_TIMEOUT_MS=15_000;
export const supabaseFetch:typeof fetch=async(input,init)=>{
 const original=input instanceof Request?input.url:String(input);
 const target=apiTransportUrl(original);
 const request=input instanceof Request?(target!==original?new Request(target,input):input):target;
 const options:RequestInit={...init,credentials:'omit',cache:'no-store'};
 if(!new URL(original).pathname.startsWith('/auth/v1/'))return fetch(request,options);
 // Abort the network too: only timing out the UI leaves the SDK's auth lock busy.
 const controller=new AbortController();
 const parent=init?.signal || (input instanceof Request?input.signal:null);
 const abort=()=>controller.abort(parent?.reason);
 if(parent?.aborted)abort();else parent?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('A conexão com o servidor demorou demais.','TimeoutError')),AUTH_FETCH_TIMEOUT_MS);
 try{
   const response=await fetch(request,{...options,signal:controller.signal});
   // Auth responses are small JSON. Keep the timeout through the body read as well.
   const body=await response.arrayBuffer();
   const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
   return new Response([204,205,304].includes(response.status)||options.method==='HEAD'?null:body,{status:response.status,statusText:response.statusText,headers});
 }finally{
   clearTimeout(timer);parent?.removeEventListener('abort',abort);
 }
};
