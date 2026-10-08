import {supabase} from '@/integrations/supabase/client';
import {apiTransportUrl} from '@/integrations/supabase/transport';
import {withAbortTimeout} from '@/lib/withTimeout';
import {uploadPath,uploadReference,UPLOAD_URL_SECONDS} from '../../supabase/functions/_shared/upload_reference';
import type {UploadAccess} from '../../supabase/functions/_shared/upload_access';
export {uploadReference};
export type {UploadAccess};
const backend=import.meta.env.VITE_SUPABASE_URL || 'https://credmaisapp-supabase.fcoipz.easypanel.host';
const origins=[new URL(backend).origin,'https://credmaisapp-supabase.fcoipz.easypanel.host'];
export const privateUploadPath=(reference:unknown)=>uploadPath(reference,origins);
type Entry={expires:number;promise:Promise<string|null>};
type Waiting={reference:string;access:UploadAccess;resolve:(value:string|null)=>void};
const cache=new Map<string,Entry>();
const waiting=new Map<string,Waiting[]>();
function signedAssetUrl(value:unknown):string|null {
 if(typeof value!=='string')return null;
 try{
  const url=new URL(value);
  if(!/^\/storage\/v1\/object\/sign\/uploads\//.test(url.pathname))return null;
  // The server may use its internal Kong origin. The object is always read
  // through the configured backend and the same-domain transport on web/mobile.
  return apiTransportUrl(backend.replace(/\/$/,'')+url.pathname+url.search);
 }catch{return null;}
}
async function flush(key:string){
 const group=waiting.get(key);waiting.delete(key);if(!group)return;
 for(let i=0;i<group.length;i+=50){
  const batch=group.slice(i,i+50);
  try{
   const {data,error}=await withAbortTimeout(signal=>supabase.functions.invoke('upload-urls',{body:{references:batch.map(item=>item.reference),access:batch[0].access},signal}),10_000);
   if(error || data?.expires_in!==UPLOAD_URL_SECONDS || !Array.isArray(data.urls) || data.urls.length!==batch.length)throw Error('invalid_upload_urls');
   batch.forEach((item,index)=>item.resolve(signedAssetUrl(data.urls[index])));
  }catch{batch.forEach(item=>item.resolve(null));}
 }
}
/** References stay in the database; five-minute bearer URLs exist only in
 * memory. Cache/batches include tenant or portal credential, never just path. */
export async function resolveUploadUrl(reference:string,access:UploadAccess={kind:'owner'},ownerId?:string|null,fresh=false):Promise<string|null>{
 if(!privateUploadPath(reference))return reference.startsWith('storage://')?null:reference;
 if(access.kind==='owner' && !ownerId){
  const {data}=await supabase.auth.getSession();ownerId=data.session?.user.id;
  if(!ownerId)return null;
 }
 const scope=JSON.stringify([access.kind,access.token||'',access.kind==='owner'?ownerId:'']);
 const key=scope+'\n'+reference;
 const existing=cache.get(key);
 if(!fresh && existing && existing.expires>Date.now())return existing.promise;
 const promise=new Promise<string|null>(resolve=>{
  const list=waiting.get(scope);
  if(list)list.push({reference,access,resolve});
  else{waiting.set(scope,[{reference,access,resolve}]);setTimeout(()=>void flush(scope),0);}
 });
 cache.set(key,{promise,expires:Date.now()+240_000});
 if(cache.size>512)cache.delete(cache.keys().next().value!);
 const result=await promise;
 if(!result && cache.get(key)?.promise===promise)cache.delete(key);
 return result;
}
export function clearUploadUrlCache(){cache.clear();}
