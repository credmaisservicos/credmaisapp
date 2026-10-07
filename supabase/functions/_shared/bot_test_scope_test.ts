import {assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {testRecipientScope} from './bot_test_scope.ts';
import {deliveryPolicy} from './bot_policy.ts';
function fixture(run:()=>void){
 const keys=['BOT_TEST_OWNER_ID','BOT_TEST_RECIPIENT'],before=keys.map(k=>Deno.env.get(k));
 Deno.env.set(keys[0],'test-owner');Deno.env.set(keys[1],'5511999999999');
 try{run();}finally{keys.forEach((k,i)=>before[i]===undefined?Deno.env.delete(k):Deno.env.set(k,before[i]!));}
}
Deno.test('test mode matches confirmed Brazil recipient with optional ninth digit, retaining DDD',()=>fixture(()=>{
 assertEquals(testRecipientScope('test-owner','5511999999999@s.whatsapp.net'),true);
 assertEquals(testRecipientScope('test-owner','551199999999@s.whatsapp.net'),true);
 assertEquals(testRecipientScope('test-owner','5512999999999@s.whatsapp.net'),false);
 assertEquals(testRecipientScope('test-owner','5511999999998@s.whatsapp.net'),false);
 assertEquals(testRecipientScope('test-owner','5511999999999@g.us'),false);
 assertEquals(testRecipientScope('test-owner','5511999999999@lid'),false);
 assertEquals(testRecipientScope('real-owner','5511999999998@s.whatsapp.net'),null);
 Deno.env.delete('BOT_TEST_RECIPIENT');assertEquals(testRecipientScope('test-owner','5511999999999'),false);
}));
Deno.test('test send guard blocks another recipient even if manually approved and leaves other owners unchanged',()=>fixture(()=>{
 const settings={user_id:'test-owner',bot_enabled:true,bot_auto_send:false};
 const profile={plan_tier:'completo',subscription_type:'lifetime'};
 const target={jid:'5511999999999@s.whatsapp.net'};
 assertEquals(deliveryPolicy(settings,target,profile,{user_id:'test-owner',purpose:'bot_reply'}),null);
 assertEquals(deliveryPolicy(settings,{jid:'5511888888888@s.whatsapp.net'},profile,{user_id:'test-owner',purpose:'manual',approved_by:'test-owner'}),'test_recipient_blocked');
 assertEquals(deliveryPolicy(settings,target,profile,{user_id:'real-owner',purpose:'bot_reply'}),'approval_required');
 assertEquals(deliveryPolicy({...settings,bot_enabled:false},target,profile,{user_id:'test-owner',purpose:'bot_reply'}),'bot_disabled');
 assertEquals(deliveryPolicy(settings,{...target,bot_paused:true},profile,{user_id:'test-owner',purpose:'bot_reply'}),'human_takeover');
}));
