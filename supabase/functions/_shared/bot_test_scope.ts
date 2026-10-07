import {samePhoneBR} from './agent_core.ts';
/** null = ordinary account; false = restricted test account, wrong recipient. */
export function testRecipientScope(ownerId:string, recipient:string):boolean|null {
  const owner=Deno.env.get('BOT_TEST_OWNER_ID');
  if (!owner || owner !== ownerId) return null;
  const allowed=Deno.env.get('BOT_TEST_RECIPIENT') || '';
  if (!/^55\d{10,11}$/.test(allowed) || /@(?:g\.us|broadcast|lid)$/.test(recipient)) return false;
  return samePhoneBR(recipient,allowed);
}
