import {uploadPath,UPLOAD_URL_SECONDS} from './upload_reference.ts';
export type UploadAccess={kind:'owner'|'brand'|'portal'|'collector'|'investor';token?:string};
const UUID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** Return paths only after evaluating the same account/portal permissions that
 * returned the original file reference. Never fetch caller-supplied URLs. */
export async function allowedUploadPaths(admin:any,caller:any,references:string[],access:UploadAccess,origins:string[],ownerLinks=new Map<string,string>()):Promise<Set<string>> {
 const paths=new Set<string>();
 const requested=new Set(references.map(ref=>uploadPath(ref,origins)).filter(Boolean));
 const claims:{path:string;owner_id:string;client_id?:string}[]=[];
 const add=(value:unknown,owner:string,client?:string)=>{const path=uploadPath(value,origins);if(path&&requested.has(path)&&owner)claims.push({path,owner_id:owner,client_id:client});};
 const brand=(branding:any,owner:string)=>{if(branding)for(const key of ['company_logo_url','portal_logo_url','favicon_url'])add(branding[key],owner);};
 if(access.kind==='brand') {
  const owners=[...new Set(references.map(ref=>uploadPath(ref,origins)?.split('/')[0]).filter((id):id is string=>!!id&&UUID.test(id)))];
  if(!owners.length)return paths;
  const {data,error}=await admin.from('settings').select('user_id,company_logo_url,portal_logo_url,favicon_url').in('user_id',owners);
  if(error)throw Error('upload_authorization_unavailable');
  for(const row of data||[])brand(row,row.user_id);
 }else if(access.kind==='owner') {
  if(!caller) return paths;
  // Use RLS for ordinary files and old owner_id based objects. Failed paths
  // may still be a receipt uploaded by a portal or a shared support avatar.
  const candidate=[...new Set(references.map(ref=>uploadPath(ref,origins)).filter((p):p is string=>!!p))];
  if(!candidate.length)return paths;
  const {data,error}=await caller.storage.from('uploads').createSignedUrls(candidate,UPLOAD_URL_SECONDS);
  if(error)throw Error('upload_authorization_unavailable');
  for(const row of data||[])if(row.signedUrl && !row.error){paths.add(row.path);ownerLinks.set(row.path,row.signedUrl);}
  const missing=references.filter(ref=>{const p=uploadPath(ref,origins);return p&&!paths.has(p);});
  if(!missing.length)return paths;
  const ownerIds=[...new Set(missing.map(ref=>uploadPath(ref,origins)!.split('/')[0]).filter(id=>UUID.test(id)))];
  if(ownerIds.length){
   const {data:profiles,error:profileError}=await caller.rpc('list_public_profiles').in('id',ownerIds);
   if(profileError)throw Error('upload_authorization_unavailable');
   for(const profile of profiles||[])add(profile.avatar_url,profile.id);
  }
  for(const ref of missing) {
   const path=uploadPath(ref,origins)!;
   // These reads are made with the user's JWT, never with service_role.
   for(const [table,column] of [['contract_installments','receipt_url'],['chat_messages','file_url'],['chat_messages','user_avatar']]as const){
    const {data:rows,error:rowError}=await caller.from(table).select(column+',user_id'+(table==='contract_installments'?',client_id':'')).eq(column,ref).limit(1);
    if(rowError)throw Error('upload_authorization_unavailable');
    for(const row of rows||[])add(row[column],row.user_id,row.client_id);
   }
   const {data:receipts,error:receiptError}=await caller.from('contract_installments').select('receipt_storage_path,user_id,client_id').eq('receipt_storage_path',path).limit(1);
   if(receiptError)throw Error('upload_authorization_unavailable');
   for(const receipt of receipts||[])if(receipt.receipt_storage_path===path)claims.push({path,owner_id:receipt.user_id,client_id:receipt.client_id});
  }
 }else {
  if(!access.token || access.token.length>512)return paths;
  const rpc=access.kind==='portal'?'portal_login_by_token':access.kind==='collector'?'collector_login_by_token':'investor_portal_login';
  const {data,error}=await admin.rpc(rpc,{_token:access.token});
  if(error)throw Error('upload_authorization_unavailable');
  if(!data)return paths;
  let owner=data.owner_id;
  if(access.kind==='portal'||access.kind==='investor'){
   const table=access.kind==='portal'?'clients':'investors';
   const id=access.kind==='portal'?data.client?.id:data.investor?.id;
   if(!id)return paths;
   const {data:record,error:recordError}=await admin.from(table).select('user_id').eq('id',id).maybeSingle();
   if(recordError)throw Error('upload_authorization_unavailable');owner=record?.user_id;
  }
  if(!owner)return paths;
  brand(data.branding,owner);
  if(access.kind==='portal')for(const contract of data.contracts||[])for(const inst of contract.installments||[])add(inst.receipt_url,owner,data.client.id);
  if(access.kind==='collector')for(const client of data.clients||[])for(const inst of client.installments||[])add(inst.receipt_url,owner,client.id);
 }
 if(claims.length){
  const unique=[...new Map(claims.map(claim=>[JSON.stringify(claim),claim])).values()];
  for(let index=0;index<unique.length;index+=200){
   const {data,error}=await admin.rpc('authorize_upload_objects',{_claims:unique.slice(index,index+200)});
   if(error)throw Error('upload_authorization_unavailable');
   for(const row of data||[])if(requested.has(row.path))paths.add(row.path);
  }
 }
 return paths;
}
