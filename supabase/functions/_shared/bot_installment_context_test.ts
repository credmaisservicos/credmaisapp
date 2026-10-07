import {assertEquals} from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {parseInstallmentReference,resolveInstallmentReference,continueInstallmentRequest} from './bot_installment_context.ts';
import {parseMemory,serializeMemory,mergeMemory} from './memory.ts';

const now=new Date('2026-10-07T12:00:00Z').getTime(),today='2026-10-07';
const rows=[{id:'a1',contract_id:'aaaa1111',installment_number:1,due_date:'2026-10-01'},
 {id:'a2',contract_id:'aaaa1111',installment_number:2,due_date:'2026-10-10'},
 {id:'a12',contract_id:'aaaa1111',installment_number:12,due_date:'2027-08-10'},
 {id:'b2',contract_id:'bbbb2222',installment_number:2,due_date:'2026-10-20'}];
const selected={pending_payment_installment_id:'b2',pending_payment_set_at:'2026-10-07T11:00:00Z'};
Deno.test('parcel reference understands numbers, ordinals, dates and contract together',()=>{
 for(const [text,number] of [['parcela número 12',12],['12ª parcela',12],['décima segunda parcela',12],['parcela #2',2]] as const)assertEquals(parseInstallmentReference(text,{},now)?.number,number);
 const reference=parseInstallmentReference('PIX da parcela 2 contrato bbbb2222',{},now)!;
 assertEquals(resolveInstallmentReference(rows,reference,{},today,now).map(row=>row.id),['b2']);
 for(const text of ['parcela que vence dia 20','parcela de 20/10/2026','parcela vencimento 20/10'])assertEquals(resolveInstallmentReference(rows,parseInstallmentReference(text,{},now)!,{},today,now).map(row=>row.id),['b2']);
});
Deno.test('repeated installment numbers across contracts require disambiguation',()=>{
 assertEquals(resolveInstallmentReference(rows,parseInstallmentReference('parcela 2')!,{},today,now).map(row=>row.id),['a2','b2']);
});
Deno.test('last installment is chosen per contract rather than first matching record',()=>{
 assertEquals(resolveInstallmentReference(rows,parseInstallmentReference('última parcela')!,{},today,now).map(row=>row.id),['a12','b2']);
 assertEquals(resolveInstallmentReference(rows,parseInstallmentReference('última parcela contrato aaaa1111')!,{},today,now).map(row=>row.id),['a12']);
});
Deno.test('next installment excludes overdue debt even if it is the oldest record',()=>{
 assertEquals(resolveInstallmentReference(rows,parseInstallmentReference('próxima parcela')!,{},today,now).map(row=>row.id),['a2']);
});
Deno.test('short payment followups keep the selected installment',()=>{
 for(const text of ['pix','qual o valor?','quando vence?','quanto?','quando?','quanto falta?','pode mandar','segunda via do PIX','2ª via PIX']){
   const reference=parseInstallmentReference(text,selected,now)!;
   assertEquals(reference.context,true);
   assertEquals(resolveInstallmentReference(rows,reference,selected,today,now).map(row=>row.id),['b2']);
 }
});
Deno.test('short ordinal followups change selection only in an active payment context',()=>{
 assertEquals(parseInstallmentReference('e a segunda?',selected,now)?.number,2);
 assertEquals(parseInstallmentReference('a última',selected,now)?.order,'last');
 assertEquals(parseInstallmentReference('segunda',{},now),null);
 assertEquals(parseInstallmentReference('primeira atrasada')?.order,'oldest');
});
Deno.test('expired, future-dated or removed selection never falls back to another debt',()=>{
 for(const memory of [{...selected,pending_payment_set_at:'2026-10-01T11:00:00Z'},{...selected,pending_payment_set_at:'2099-01-01T00:00:00Z'},{...selected,pending_payment_installment_id:'foreign'}])assertEquals(resolveInstallmentReference(rows,{context:true},memory,today,now),[]);
});
Deno.test('selection options accept only displayed and still active records',()=>{
 const memory={installment_choice_ids:['b2','a2','foreign'],installment_choice_set_at:'2026-10-07T11:00:00Z'};
 assertEquals(resolveInstallmentReference(rows,parseInstallmentReference('1',memory,now)!,memory,today,now).map(row=>row.id),['b2']);
 for(const option of [0,3,4])assertEquals(resolveInstallmentReference(rows,{option},memory,today,now),[]);
});
Deno.test('invalid dates do not roll over to a different due date',()=>{
 for(const text of ['parcela de 31/02/2026','parcela vence dia 32','parcela 0'])assertEquals(resolveInstallmentReference(rows,parseInstallmentReference(text)!,{},today,now),[]);
});
Deno.test('loan and receipt messages are not hijacked as payment queries',()=>{
 for(const text of ['qual valor mínimo do empréstimo?','comprovante parcela 2','paguei parcela 2','qual renda precisa?'])assertEquals(parseInstallmentReference(text,selected,now),null);
 for(const text of ['1','2','3'])assertEquals(parseInstallmentReference(text,{service_menu_stage:'loan_type'},now),null);
});
Deno.test('choice context survives memory compaction and cannot be replaced by AI',()=>{
 const memory=parseMemory(JSON.stringify({...selected,installment_choice_ids:['a2','b2',null,{id:'foreign'}],installment_choice_set_at:'2026-10-07T11:00:00Z',fatos:['x'.repeat(10000)]}));
 const next=parseMemory(serializeMemory(mergeMemory(memory,{installment_choice_ids:['foreign'],pending_payment_installment_id:'foreign'},today)));
 assertEquals(next.installment_choice_ids,['a2','b2']);assertEquals(next.pending_payment_installment_id,'b2');
});

const pending={installment_choice_ids:['a2','b2'],installment_choice_set_at:'2026-10-07T11:00:00Z',installment_choice_reference:{number:2},installment_choice_intent:'payment'};
Deno.test('contract fragment completes the earlier parcel reference and keeps payment intent',()=>{
 const result=continueInstallmentRequest(parseInstallmentReference('contrato bbbb2222')!,'summary',pending,now);
 assertEquals(result.reference,{number:2,contract:'bbbb2222'});assertEquals(result.intent,'payment');
 assertEquals(resolveInstallmentReference(rows,result.reference,pending,today,now).map(row=>row.id),['b2']);
});
Deno.test('explicit questions override pending payment intent without replacing its selection',()=>{
 const result=continueInstallmentRequest({context:true},'due_date',pending,now);
 assertEquals(result.reference,{number:2});assertEquals(result.intent,'due_date');
});
Deno.test('new parcel replaces the prior number and date but can retain the requested contract',()=>{
 const memory={...pending,installment_choice_reference:{number:1,date:'2026-10-01',contract:'aaaa1111'}};
 assertEquals(continueInstallmentRequest({number:2},'summary',memory,now).reference,{number:2,contract:'aaaa1111'});
 assertEquals(continueInstallmentRequest({number:2,contract:'bbbb2222'},'payment',memory,now).reference,{number:2,contract:'bbbb2222'});
});
Deno.test('list, expired and future requests never inherit a previous payment intention',()=>{
 for(const setAt of ['2026-10-01T11:00:00Z','2099-01-01T00:00:00Z'])assertEquals(continueInstallmentRequest({contract:'bbbb2222'},'summary',{...pending,installment_choice_set_at:setAt},now),{reference:{contract:'bbbb2222'},intent:'summary'});
 assertEquals(continueInstallmentRequest({list:true},'summary',pending,now),{reference:{list:true},intent:'summary'});
});
Deno.test('fragment intent and reference survive compaction and cannot be rewritten by AI',()=>{
 const memory=parseMemory(JSON.stringify({...pending,fatos:['x'.repeat(10000)]}));
 const next=parseMemory(serializeMemory(mergeMemory(memory,{installment_choice_reference:{number:12},installment_choice_intent:'due_date'},today)));
 assertEquals(next.installment_choice_reference,{number:2});assertEquals(next.installment_choice_intent,'payment');
});
Deno.test('memory discards malformed references and unexpected intent values',()=>{
 const memory=parseMemory(JSON.stringify({installment_choice_intent:'approve_payment',installment_choice_reference:{number:-1,contract:'foreign secret!',day:32,order:'arbitrary',option:1,id:'foreign',context:true}}));
 assertEquals(memory.installment_choice_intent,undefined);assertEquals(memory.installment_choice_reference,{});
});
