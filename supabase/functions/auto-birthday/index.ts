import {serve} from 'https://deno.land/std@0.168.0/http/server.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import {checkSharedSecret} from '../_shared/guard.ts';
import {testRecipientScope} from '../_shared/bot_test_scope.ts';
import {financialDay} from '../_shared/financial_calendar.ts';
import {botRows} from '../_shared/bot_data.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json'};
serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 if(!checkSharedSecret(req,'CRON_SECRET'))return new Response(JSON.stringify({error:'unauthorized'}),{status:401,headers});
 try {
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const day=financialDay(new Date())!,monthDay=day.slice(5);
  const clients=await botRows(()=>db.from('clients').select('id,user_id,whatsapp,phone,birth_date').not('birth_date','is',null).order('id'));
  let total=0,queued=0,duplicates=0;
  for(const client of clients){
   if(financialDay(client.birth_date)?.slice(5)!==monthDay)continue;
   total++;
   const {data,error}=await db.rpc('enqueue_birthday_greeting',{_client_id:client.id,_user_id:client.user_id,_day:day,
    _allow_message:testRecipientScope(client.user_id,String(client.whatsapp||client.phone||''))!==false});
   if(error||!data)throw Error('birthday_queue_unavailable');
   if(data.queued){if(data.duplicate)duplicates++;else queued++;}
  }
  return new Response(JSON.stringify({total,queued,duplicates,sent:0}),{headers});
 }catch{return new Response(JSON.stringify({error:'birthday_queue_unavailable'}),{status:503,headers});}
});
