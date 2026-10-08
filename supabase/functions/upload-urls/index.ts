import {serve} from 'https://deno.land/std@0.168.0/http/server.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {guard} from '../_shared/rate_limit.ts';
import {allowedUploadPaths,type UploadAccess} from '../_shared/upload_access.ts';
import {publicSignedUploadUrl,uploadPath,UPLOAD_URL_SECONDS} from '../_shared/upload_reference.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json','Cache-Control':'no-store'};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(req.method!=='POST')return response({error:'method_not_allowed'},405);
 const limit=await guard(req,'upload-urls',180,3,headers);if(limit)return limit;
 try {
  const text=await req.text();if(text.length>65536)return response({error:'payload_too_large'},413);
  const input=JSON.parse(text);
  if(!Array.isArray(input.references) || !input.references.length || input.references.length>50 || input.references.some((ref:unknown)=>typeof ref!=='string'||ref.length>8192))return response({error:'invalid_references'},400);
  const references:string[]=input.references;
  const access:UploadAccess=input.access||{kind:'owner'};
  if(!['owner','brand','portal','collector','investor'].includes(access.kind))return response({error:'invalid_access'},400);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const publicUrl=Deno.env.get('SUPABASE_PUBLIC_URL')||'https://credmaisapp-supabase.fcoipz.easypanel.host';
  const origins=[url,Deno.env.get('SUPABASE_PUBLIC_URL'),'https://credmaisapp-supabase.fcoipz.easypanel.host'].filter(Boolean).map(value=>new URL(value!).origin);
  let caller:any=null;
  if(access.kind==='owner'){
   const authorization=req.headers.get('Authorization');if(!authorization)return response({error:'unauthorized'},401);
   caller=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
   const {data,error}=await caller.auth.getUser();if(error||!data.user)return response({error:'unauthorized'},401);
  }
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const byPath=new Map<string,string>();
  const allowed=await allowedUploadPaths(admin,caller,references,access,origins,byPath);
  const requested=references.map(ref=>uploadPath(ref,origins));
  const paths=[...new Set(requested.filter((path:string|null):path is string=>!!path&&allowed.has(path)&&!byPath.has(path)))];
  let links:any[]=[];
  if(paths.length){const {data,error}=await admin.storage.from('uploads').createSignedUrls(paths,UPLOAD_URL_SECONDS);if(error)throw Error('upload_signing_unavailable');links=data||[];}
  for(const row of links)if(row.signedUrl&&!row.error)byPath.set(row.path,row.signedUrl);
  return response({expires_in:UPLOAD_URL_SECONDS,urls:requested.map((path:string|null)=>path?publicSignedUploadUrl(byPath.get(path),publicUrl,url):null)});
 }catch{return response({error:'upload_urls_unavailable'},503);}
});
