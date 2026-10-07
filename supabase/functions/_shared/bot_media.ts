export async function saveBotAttachment(supabase:any, ownerId:string, messageId:string, base64:string, mimeType:string) {
  const clean=base64.replace(/^data:[^;]+;base64,/,'');
  const bytes=Uint8Array.from(atob(clean),c=>c.charCodeAt(0));
  if(!bytes.length || bytes.length>15*1024*1024)throw Error('attachment_size_invalid');
  const extension=mimeType==='application/pdf'?'pdf':mimeType==='image/png'?'png':mimeType==='image/jpeg'?'jpg':mimeType.startsWith('audio/')?'ogg':'bin';
  const path=`${ownerId}/whatsapp/${messageId.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,120)}.${extension}`;
  const {error}=await supabase.storage.from('uploads').upload(path,bytes,{contentType:mimeType||'application/octet-stream',upsert:true});
  if(error)throw Error('attachment_storage_unavailable');
  return path;
}
