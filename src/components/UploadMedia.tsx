import {useEffect,useRef,useState,type ImgHTMLAttributes,type AudioHTMLAttributes,type AnchorHTMLAttributes} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import {privateUploadPath,resolveUploadUrl,type UploadAccess} from '@/lib/uploadUrls';
import {toast} from '@/hooks/use-toast';
type Scope={access?:UploadAccess};
function useUploadSource(reference:string|undefined,access:UploadAccess={kind:'owner'}){
 const {user}=useAuth();
 const kind=access.kind,token=access.token;
 const [state,setState]=useState<{key:string;url:string|undefined}>({key:'',url:undefined});
 const privateFile=!!privateUploadPath(reference);
 const key=JSON.stringify([reference,kind,token,user?.id]);
 useEffect(()=>{
  if(!privateFile || !reference)return;
  let active=true,inFlight=false;let timer:ReturnType<typeof setTimeout>;
  const refresh=async()=>{
   if(inFlight)return;inFlight=true;clearTimeout(timer);
   const url=await resolveUploadUrl(reference,{kind,token},user?.id).catch(()=>null);inFlight=false;
   if(!active)return;
   setState({key,url:url||undefined});
   timer=setTimeout(()=>void refresh(),240_000);
  };
  const resume=()=>{if(document.visibilityState==='visible')void refresh();};
  void refresh();document.addEventListener('visibilitychange',resume);
  return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',resume);};
 },[key,privateFile,reference,kind,token,user?.id]);
 return privateFile?(state.key===key?state.url:undefined):reference?.startsWith('storage://')?undefined:reference;
}
export function UploadImage({src,access,...props}:ImgHTMLAttributes<HTMLImageElement>&Scope){
 const source=useUploadSource(src,access);
 return <img {...props} src={source} loading={props.loading||'lazy'}/>;
}
export function UploadAudio({src,access,...props}:AudioHTMLAttributes<HTMLAudioElement>&Scope){
 const source=useUploadSource(src,access);return <audio {...props} src={source}/>;
}
export function UploadLink({href,access={kind:'owner'},onClick,children,...props}:AnchorHTMLAttributes<HTMLAnchorElement>&Scope){
 const {user}=useAuth();const busy=useRef(false);
 const currentScope=JSON.stringify([user?.id,access.kind,access.token,href]);
 const scope=useRef(currentScope);scope.current=currentScope;
 const privateFile=!!privateUploadPath(href);
 const safeHref=href && !/^\s*(?:javascript|data|storage):/i.test(href)?href:undefined;
 return <a {...props} href={privateFile?'#':safeHref} onClick={async event=>{
  onClick?.(event);if(event.defaultPrevented || !privateFile || !href)return;
  event.preventDefault();if(busy.current)return;busy.current=true;
  const popup=props.target==='_blank'?window.open('about:blank','_blank'):null;
  if(popup)popup.opener=null;
  try{
   const url=await resolveUploadUrl(href,access,user?.id,true);
   if(!url || scope.current!==currentScope)throw Error('upload_unavailable');
   if(popup)popup.location.replace(url);else window.location.assign(url);
  }catch{popup?.close();toast({title:'Não foi possível abrir o arquivo',description:'Verifique sua conexão e tente novamente.',variant:'destructive'});}
  finally{busy.current=false;}
 }}>{children}</a>;
}
