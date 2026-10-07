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
export const supabaseFetch:typeof fetch=(input,init)=>{
 const original=input instanceof Request?input.url:String(input);
 const target=apiTransportUrl(original);
 const request=input instanceof Request?(target!==original?new Request(target,input):input):target;
 return fetch(request,{...init,credentials:'omit',cache:'no-store'});
};
