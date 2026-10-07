/** Private portal credentials stay in this tab; unavailable storage uses memory only. */
export function createTabSessionStorage(store:()=>Storage=()=>sessionStorage){
  const pending=new Map<string,string|null>();
  const lastRead=new Map<string,string|null>();
  return {
    getItem(key:string):string|null{
      if(pending.has(key))return pending.get(key)??null;
      try{const value=store().getItem(key);lastRead.set(key,value);return value;}catch{return lastRead.get(key)??null;}
    },
    setItem(key:string,value:string):boolean{
      lastRead.set(key,value);
      try{store().setItem(key,value);pending.delete(key);return true;}catch{pending.set(key,value);return false;}
    },
    removeItem(key:string):void{
      lastRead.set(key,null);pending.set(key,null);
      try{store().removeItem(key);pending.delete(key);}catch{/* Ignore stale disk copies in this tab. */}
    },
  };
}
export const tabSessionStorage=createTabSessionStorage();
