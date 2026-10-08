/** Storage identifiers contain no bearer token. This module is also used by
 * the web app; keep it independent from Deno and the Supabase client. */
const PREFIX='storage://uploads/';
export const UPLOAD_URL_SECONDS=300;
export function validUploadPath(value:unknown):value is string {
 return typeof value==='string' && value.length>0 && value.length<=1024
  && !/[\\\x00-\x1f\x7f?#]/.test(value) && !/%[\da-f]{2}/i.test(value)
  && value.split('/').every(part=>part!=='' && part!=='.' && part!=='..');
}
export function uploadReference(path:string):string {
 if(!validUploadPath(path))throw Error('invalid_upload_path');
 return PREFIX+path.split('/').map(encodeURIComponent).join('/');
}
export function uploadPath(reference:unknown,origins:readonly string[]):string|null {
 if(typeof reference!=='string' || reference.length>8192)return null;
 let encoded:string;
 if(reference.startsWith(PREFIX))encoded=reference.slice(PREFIX.length);
 else {
  let url:URL;
  try {url=new URL(reference);}catch{return null;}
  if(!['https:','http:'].includes(url.protocol) || url.username || url.password || !origins.includes(url.origin))return null;
  const match=url.pathname.match(/^\/storage\/v1\/object\/(?:sign|public|authenticated)\/uploads\/(.+)$/);
  if(!match)return null;
  encoded=match[1];
 }
 try {const path=decodeURIComponent(encoded);return validUploadPath(path)?path:null;}catch{return null;}
}
