// Pure synthetic quotes only. This container receives no application credentials.
import {serve} from 'https://deno.land/std@0.168.0/http/server.ts';
import {botLateFee,botBalance} from '../_shared/bot_finance.ts';
import {collectionPlan} from '../_shared/bot_collection.ts';
const row={id:'fictitious',amount:201,paid_amount:100,status:'pending',due_date:'2026-10-07T15:00:00Z',
  contracts:{status:'active',daily_interest_percent:.5}};
const results={
  halfCent:botLateFee(row,'2026-10-08'),
  compound:botLateFee({...row,amount:100,contracts:{daily_interest_percent:4}},'2026-10-09'),
  partialBalance:botBalance(row,'2026-10-08'),
  collectionAmount:collectionPlan([row],[{days:1}],'2026-10-08')?.amount,
  beforeBrazilMidnight:botLateFee(row,'2026-10-08T02:59:59Z'),
};
serve(()=>new Response(JSON.stringify(results),{headers:{'content-type':'application/json'}}));
