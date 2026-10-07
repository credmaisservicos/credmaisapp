const REMEMBER_KEY='sj_remember_me';
const authKey=(key:string)=>key.includes('-auth-token');
type Store=()=>Storage;

/** Browser storage is optional; an unavailable disk must not prevent login. */
export function createRememberMeStorage(local:Store=()=>localStorage,temporary:Store=()=>sessionStorage){
  const shadow=new Map<string,string|null>();
  const pending=new Set<string>();
  let preference:boolean|undefined;
  const getRememberMe=()=>{
    if(preference!==undefined)return preference;
    try{return local().getItem(REMEMBER_KEY)!=='false';}catch{return true;}
  };
  const selected=()=>getRememberMe()?local():temporary();
  const keys=(store:Store)=>{
    const found=new Set<string>();
    try{const disk=store();for(let i=0;i<disk.length;i++){const key=disk.key(i);if(key!==null)found.add(key);}}catch{/* Use the session held in this window. */}
    return found;
  };
  const adapter:Storage={
    get length(){return visibleKeys().length;},
    key:(index)=>visibleKeys()[index]??null,
    getItem:(key)=>{
      if(pending.has(key))return shadow.get(key)??null;
      try{const value=selected().getItem(key);shadow.set(key,value);return value;}catch{return shadow.get(key)??null;}
    },
    setItem:(key,value)=>{
      shadow.set(key,String(value));pending.add(key);
      try{selected().setItem(key,String(value));pending.delete(key);}catch{/* Keep this session only in memory. */}
    },
    removeItem:(key)=>{
      shadow.set(key,null);pending.add(key);
      let removed=true;
      // Remove inactive copies too, so changing the preference cannot revive logout.
      for(const source of authKey(key)?[local,temporary]:[selected]){
        try{source().removeItem(key);}catch{removed=false;/* The tombstone still applies in this window. */}
      }
      if(removed)pending.delete(key);
    },
    clear:()=>{
      const found=new Set([...keys(local),...keys(temporary),...shadow.keys()]);
      for(const key of found)if(authKey(key))adapter.removeItem(key);
    },
  };
  function visibleKeys(){
    const found=keys(selected);for(const [key,value] of shadow)if(pending.has(key)){if(value===null)found.delete(key);else found.add(key);}
    return [...found];
  }
  const setRememberMe=(remember:boolean)=>{
    const previous=getRememberMe();
    preference=remember;
    try{local().setItem(REMEMBER_KEY,String(remember));preference=undefined;}catch{/* Honor the choice for this window even without storage. */}
    if(previous===remember)return;
    const source=previous?local:temporary;
    const target=remember?local:temporary;
    const found=new Set([...keys(source),...shadow.keys()]);
    for(const key of found){
      if(!authKey(key))continue;
      let value=shadow.get(key)??null;
      if(!pending.has(key)){try{value=source().getItem(key);}catch{/* Reuse the last value read by the SDK. */}}
      if(value===null)continue;
      shadow.set(key,value);pending.add(key);
      try{target().setItem(key,value);pending.delete(key);}catch{/* Migration still retains the session in this window. */}
      try{source().removeItem(key);}catch{/* The active store and memory take precedence. */}
    }
  };
  const isAuthSessionTemporary=()=>[...pending].some(key=>key.endsWith('-auth-token')&&shadow.get(key)!=null);
  return {rememberMeStorage:adapter,getRememberMe,setRememberMe,isAuthSessionTemporary};
}

export const {rememberMeStorage,getRememberMe,setRememberMe,isAuthSessionTemporary}=createRememberMeStorage();
