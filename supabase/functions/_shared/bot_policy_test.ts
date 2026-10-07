import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { automationAccountActive, deliveryPolicy, withinBotHours } from './bot_policy.ts';
import { botBalance, botLateFee } from './bot_finance.ts';
const profile={plan_tier:'completo',subscription_type:'lifetime'};
const settings={bot_enabled:true,bot_auto_send:true};
Deno.test('automation stops for disabled, blocked, paused and pending-human conversations',()=>{
  assertEquals(deliveryPolicy({...settings,bot_enabled:false},{},profile,{purpose:'bot_reply'}),'bot_disabled');
  assertEquals(deliveryPolicy(settings,{bot_paused:true},profile,{purpose:'session_timeout'}),'human_takeover');
  assertEquals(deliveryPolicy(settings,{needs_human:true},profile,{purpose:'bot_reply'}),'human_takeover');
  assertEquals(deliveryPolicy(settings,{blocked:true},profile,{purpose:'manual'}),'conversation_blocked');
  assertEquals(deliveryPolicy(settings,{}, {...profile,is_blocked:true},{purpose:'bot_reply'}),'automation_unavailable');
});
Deno.test('manual approval is required and approved human sends may continue a paused conversation',()=>{
  assertEquals(deliveryPolicy({...settings,bot_auto_send:false},{},profile,{purpose:'bot_reply'}),'approval_required');
  assertEquals(deliveryPolicy({...settings,bot_enabled:false},{bot_paused:true},profile,{purpose:'manual'}),null);
  assertEquals(deliveryPolicy(settings,{needs_human:true},profile,{purpose:'bot_reply',approved_by:'owner'}),null);
});
Deno.test('business hours use Sao Paulo and support overnight windows',()=>{
  const hours={bot_business_hours_only:true,bot_work_days:['wed'],bot_business_start:'08:00',bot_business_end:'18:00'};
  assertEquals(withinBotHours(hours,new Date('2026-10-07T10:59:00Z')),false);
  assertEquals(withinBotHours(hours,new Date('2026-10-07T11:00:00Z')),true);
  assertEquals(withinBotHours(hours,new Date('2026-10-07T21:00:00Z')),false);
  assertEquals(withinBotHours({...hours,bot_business_start:'22:00',bot_business_end:'06:00'},new Date('2026-10-07T06:00:00Z')),true);
});
Deno.test('subscription and blocked account decisions fail closed',()=>{
  assertEquals(automationAccountActive(null),false);
  assertEquals(automationAccountActive({plan_tier:'completo',subscription_expires_at:'2020-01-01'}),false);
  assertEquals(automationAccountActive({plan_tier:'essencial',subscription_type:'lifetime'}),false);
  assertEquals(automationAccountActive(profile),true);
});
Deno.test('remaining charges subtract all received money',()=>{
  assertEquals(botBalance({amount:100,late_fee:20,paid_amount:110}),10);
  assertEquals(botBalance({amount:100,late_fee:20,paid_amount:130}),0);
});
Deno.test('compound charge, fixed penalties, cap and settlement match the ledger rules',()=>{
  const r={amount:100,late_fee:0,paid_amount:0,status:'overdue',due_date:'2026-10-01',contracts:{status:'active',daily_interest_percent:1,daily_penalty_type:'fixed',daily_penalty_value:2,max_interest_cap_percent:20}};
  assertEquals(botLateFee(r,'2026-10-03'),6.01);
  assertEquals(botLateFee(r,'2026-11-01'),20);
  assertEquals(botLateFee({...r,late_fee:7,pre_settlement_snapshot:{}},'2026-11-01'),7);
});
