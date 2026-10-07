export const FINANCIAL_TIME_ZONE='America/Sao_Paulo';
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:FINANCIAL_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});

/** Date columns are civil days; timestamps and Date objects are instants. */
export function financialDay(input:string|Date|null|undefined=new Date()):string|null{
 if(input==null||input==='')return null;
 if(typeof input==='string'){
  const value=input.trim();
  const civil=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const brazilian=value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if(civil||brazilian){
   let year=civil?Number(civil[1]):Number(brazilian![3]);
   if(brazilian&&year<100)year+=2000;
   const month=Number(civil?civil[2]:brazilian![2]),day=Number(civil?civil[3]:brazilian![1]);
   const key=`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
   const parsed=new Date(key+'T12:00:00Z');
   return Number.isFinite(parsed.getTime())&&parsed.getUTCFullYear()===year&&parsed.getUTCMonth()+1===month&&parsed.getUTCDate()===day?key:null;
  }
  // A timestamp without an offset denotes a civil time, not the device's zone.
  const timestamp=value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
  if(timestamp&&(!financialDay(timestamp[1])||Number(timestamp[2])>23||Number(timestamp[3])>59||Number(timestamp[4]||0)>59))return null;
  const unzoned=value.match(/^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/);
  if(unzoned)return financialDay(unzoned[1]);
 }
 const instant=input instanceof Date?input:new Date(input);
 if(!Number.isFinite(instant.getTime()))return null;
 const parts=formatter.formatToParts(instant);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
}

/** Calendar difference, unaffected by daylight-saving days of 23/25 hours. */
export function financialDaysBetween(from:string|Date|null|undefined,to:string|Date=new Date()):number{
 if(from==null||from==='')return 0;
 const start=financialDay(from),end=financialDay(to);
 return start&&end?(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000:0;
}
