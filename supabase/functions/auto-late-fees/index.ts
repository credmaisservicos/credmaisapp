import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';
import { checkSharedSecret } from '../_shared/guard.ts';

const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
const response = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const counters = ['scanned','fees_updated','status_updated','client_notifications','owner_notifications'] as const;
interface ChargeBatch {
  scanned:number;fees_updated:number;status_updated:number;
  client_notifications:number;owner_notifications:number;
  next_cursor:string|null;errors:unknown[];
}

serve(async req => {
  if (!checkSharedSecret(req,'CRON_SECRET')) return response({error:'unauthorized'},401);
  if (!['GET','POST'].includes(req.method)) return response({error:'method_not_allowed'},405);
  const totals = {scanned:0,fees_updated:0,status_updated:0,client_notifications:0,owner_notifications:0};
  const errors:unknown[] = [];
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
      auth:{persistSession:false,autoRefreshToken:false},
    });
    let cursor:string|null = null;
    do {
      // SQL locks each batch before reading the current balance. No external
      // sends or REST writes calculated from stale payment snapshots.
      const {data,error}:{data:ChargeBatch|null;error:unknown} = await db.rpc('refresh_installment_charges',{_after_id:cursor,_limit:250});
      if(error) throw Error('charge_batch_unavailable');
      if(!data || counters.some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)
        || !Array.isArray(data.errors) || data.scanned > 250
        || (data.next_cursor !== null && (typeof data.next_cursor !== 'string'
          || !uuid.test(data.next_cursor) || (cursor !== null && data.next_cursor <= cursor)
          || data.scanned !== 250))) throw Error('charge_batch_invalid');
      for(const key of counters) totals[key] += data[key];
      errors.push(...data.errors);
      cursor = data.next_cursor;
    } while(cursor !== null);
    return response({...totals,errors},errors.length ? 500 : 200);
  } catch(error) {
    console.error('auto-late-fees:',error instanceof Error ? error.message : 'charge_refresh_failed');
    return response({...totals,errors,error:'charge_refresh_failed'},500);
  }
});
