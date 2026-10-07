import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { collectionPlan, collectionCooldownHours, collectionAiBudget, saoPauloDay } from './bot_collection.ts';
const debt=(id:string,date:string,paid=0)=>({id,due_date:date,amount:100,paid_amount:paid,late_fee:0,status:'pending',contracts:{status:'active'}});
const rules=[{days:1},{days:7},{days:-3},{days:0}];
Deno.test('collection: overdue totals never accelerate future installments',()=>{
  const plan=collectionPlan([debt('future','2026-10-10'),debt('late','2026-10-01',40),debt('today','2026-10-07')],rules,'2026-10-07')!;
  assertEquals(plan.amount,160);assertEquals(plan.installments.map(r=>r.id),['late','today']);assertEquals(plan.rule.days,1);
});
Deno.test('collection: reminder selects only installments due on the selected date',()=>{
  const plan=collectionPlan([debt('later','2026-10-12'),debt('reminder','2026-10-10')],rules,'2026-10-07')!;
  assertEquals(plan.amount,100);assertEquals(plan.isPreDue,true);assertEquals(plan.rule.days,-3);
});
Deno.test('collection: fully received, inactive and cancelled debt stays out',()=>{
  assertEquals(collectionPlan([debt('received','2026-10-01',100),{...debt('cancelled','2026-10-01'),status:'cancelled'},{...debt('closed','2026-10-01'),contracts:{status:'completed'}}],rules,'2026-10-07'),null);
});
Deno.test('collection: highest reached stage and exact reminder dates',()=>{
  assertEquals(collectionPlan([debt('late','2026-09-01')],rules,'2026-10-07')?.rule.days,7);
  assertEquals(collectionPlan([debt('future','2026-10-09')],rules,'2026-10-07'),null);
});
Deno.test('collection: configured interval is respected without severity reductions',()=>{
  assertEquals(collectionCooldownHours(24),24);assertEquals(collectionCooldownHours(72),72);assertEquals(collectionCooldownHours(0),24);assertEquals(collectionCooldownHours('invalid'),24);
});
Deno.test('collection: Brazilian agreement date differs from UTC near midnight',()=>{
  assertEquals(saoPauloDay(new Date('2026-10-08T02:59:00Z')),'2026-10-07');
});
Deno.test('collection: slow AI exhausts shared budget and falls back for later clients',async()=>{
  let now=0,calls=0;const generate=collectionAiBudget(6000,()=>now);
  const slow=async(timeout:number)=>{calls++;now+=timeout;throw Error('timeout');};
  assertEquals(await generate(slow),'');assertEquals(await generate(slow),'');assertEquals(await generate(slow),'');assertEquals(calls,2);
});
