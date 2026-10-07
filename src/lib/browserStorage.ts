/** Preferences and public caches are optional; browser privacy/quota errors are recoverable. */
const temporary=new Map<string,string>();
export function readLocalPreference(key:string):string|null{
  if(temporary.has(key))return temporary.get(key)!;
  try{return localStorage.getItem(key);}catch{return null;}
}
export function writeLocalPreference(key:string,value:string):boolean{
  try{localStorage.setItem(key,value);temporary.delete(key);return true;}catch{temporary.set(key,value);return false;}
}
