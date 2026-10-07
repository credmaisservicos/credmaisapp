import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { botRenewalQuote,botLateFee,botBalance } from './bot_finance.ts';
import {financialDay} from './financial_calendar.ts';
const contract={status:'active',capital:1000,interest_rate:10,total_interest:300,num_installments:3,loan_mode:'fixed',installment_amount:450};
const installment={status:'pending',amount:450,paid_amount:0,late_fee:5,installment_number:2};
Deno.test('renewal quote uses saved period interest and stored fees',()=>{
  assertEquals(botRenewalQuote({...installment,scheduled_interest:43.21,stored_late_fee:2,late_fee:100},contract),45.21);
});
Deno.test('renewal refuses partial payments and closed records',()=>{
  assertEquals(botRenewalQuote({...installment,paid_amount:0.01},contract),null);
  assertEquals(botRenewalQuote({...installment,status:'paid'},contract),null);
  assertEquals(botRenewalQuote(installment,{...contract,status:'completed'}),null);
  assertEquals(botRenewalQuote(installment,null),null);
});
Deno.test('renewal respects bullet and interest-only financial modes',()=>{
  assertEquals(botRenewalQuote({...installment,scheduled_interest:40},{...contract,loan_mode:'bullet'}),305);
  assertEquals(botRenewalQuote({...installment,scheduled_interest:40},{...contract,loan_mode:'percentage'}),105);
  assertEquals(botRenewalQuote(installment,{...contract,loan_mode:'interest_only'}),105);
});
Deno.test('stored zero total interest is not replaced by the contract total',()=>{
  assertEquals(botRenewalQuote({...installment,late_fee:0},{...contract,total_interest:0,total_amount:1300}),null);
});
Deno.test('fee quotes use Brazil midnight and PostgreSQL half-cent rounding',()=>{
 const row={amount:201,paid_amount:100,status:'pending',due_date:'2026-10-07',contracts:{daily_interest_percent:.5}};
 assertEquals(botLateFee(row,financialDay(new Date('2026-10-08T02:59:59Z'))!),0);
 assertEquals(botLateFee(row,financialDay(new Date('2026-10-08T03:00:00Z'))!),1.01);
 assertEquals(botBalance(row,'2026-10-08'),102.01);
});
Deno.test('stored fees, partial principal and active snapshots preserve the payment quote',()=>{
 const row={amount:100,paid_amount:40,late_fee:15,status:null,due_date:'2026-10-07T15:00:00Z',contracts:{daily_interest_percent:1,daily_penalty_type:'fixed',daily_penalty_value:2,max_interest_cap_percent:10}};
 assertEquals(botLateFee(row,'2026-10-09'),15);assertEquals(botBalance(row,'2026-10-09'),75);
 assertEquals(botLateFee({...row,late_fee:7,pre_settlement_snapshot:{}},'2026-11-01'),7);
});
