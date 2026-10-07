import {assertEquals, assertRejects, assert} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {callGemini, geminiConfigured, geminiRequest} from './gemini.ts';
import {callAnthropic, hasAIProvider} from './anthropic.ts';
const params={userId:'test-owner',system:'Atendimento de teste',messages:[{role:'user' as const,content:'Olá'}]};
const keys=['GEMINI_API_KEY','GEMINI_ALLOWED_USER_IDS','GEMINI_MODEL','ANTHROPIC_API_KEY','LOVABLE_API_KEY','DEEPSEEK_API_KEY'];
async function fixture(run:()=>Promise<void>|void) {
  const previous=keys.map(k=>Deno.env.get(k)),fetch=globalThis.fetch;
  keys.forEach(k=>Deno.env.delete(k));
  Deno.env.set('GEMINI_API_KEY','test-private-key');Deno.env.set('GEMINI_ALLOWED_USER_IDS','test-owner');
  try {await run();} finally {
    globalThis.fetch=fetch;keys.forEach((k,i)=>previous[i]===undefined?Deno.env.delete(k):Deno.env.set(k,previous[i]!));
  }
}
const reply=(parts:any[],finishReason='STOP')=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts}}]}),{headers:{'Content-Type':'application/json'}});

Deno.test('Gemini test key requires matching owner; missing context and other owners are denied',()=>fixture(()=>{
  assertEquals(geminiConfigured('test-owner'),true);assertEquals(geminiConfigured('other-owner'),false);
  assertEquals(geminiConfigured(),false);assertEquals(hasAIProvider('other-owner'),false);
  Deno.env.set('GEMINI_ALLOWED_USER_IDS',' second-owner , test-owner ');assertEquals(geminiConfigured('test-owner'),true);
  Deno.env.delete('GEMINI_API_KEY');assertEquals(geminiConfigured('test-owner'),false);
}));
Deno.test('Gemini scope rejects calls before any network request',()=>fixture(async()=>{
  globalThis.fetch=()=>{throw Error('Unexpected network');};
  await assertRejects(()=>callGemini({...params,userId:'other-owner'}),Error,'gemini_not_configured_for_account');
  await assertRejects(()=>callAnthropic({...params,userId:'other-owner'}),Error,'Nenhuma chave');
}));
Deno.test('Gemini keeps roles, system instructions, PDFs, images and audio',()=>{
  const body=geminiRequest({...params,messages:[{role:'assistant',content:'Anterior'},{role:'user',content:[
    {type:'text',text:'Confira'},...['image','document','audio'].map((type,i)=>({type,source:{type:'base64',media_type:['image/png','application/pdf','audio/ogg'][i],data:'ZmljdGl0aW91cw=='}})),
  ]}]});
  assertEquals(body.contents[0].role,'model');assertEquals(body.systemInstruction.parts[0].text,params.system);
  assertEquals(body.contents[1].parts.slice(1).map((p:any)=>p.inlineData.mimeType),['image/png','application/pdf','audio/ogg']);
});
Deno.test('Gemini refuses unsupported content instead of silently dropping a document',()=>{
  let failed=false;try {geminiRequest({...params,messages:[{role:'user',content:[{type:'document',source:{type:'url',url:'https://invalid.test'}}]}]});}catch{failed=true;}
  assert(failed);
});
Deno.test('Gemini sends credential only in header and returns text without thought content',()=>fixture(async()=>{
  globalThis.fetch=async(input,init)=>{
    const r=new Request(input,init);assertEquals(r.url.includes('test-private-key'),false);
    assertEquals(r.headers.get('x-goog-api-key'),'test-private-key');
    const b=await r.json();assertEquals(b.contents[0].parts[0].text,'Olá');
    return reply([{text:'private thought',thought:true},{text:'Olá, como posso ajudar?'}]);
  };
  const r=await callGemini(params);assertEquals(r.stop_reason,'end_turn');assertEquals(r.content.length,1);
  assertEquals(r.content[0].text,'Olá, como posso ajudar?');
}));
Deno.test('Gemini preserves signed function calls and matches responses by call id',()=>fixture(async()=>{
  const signed={functionCall:{name:'consultar',args:{client_id:'verified'},id:'call-1'},thoughtSignature:'signed-test'};
  globalThis.fetch=async()=>reply([signed]);
  const r=await callGemini(params);assertEquals(r.stop_reason,'tool_use');
  const b=geminiRequest({...params,messages:[...params.messages,{role:'assistant',content:r.content},
    {role:'user',content:[{type:'tool_result',tool_use_id:r.content[0].id,content:JSON.stringify({ok:true,data:{balance:1}})}]}],
    tools:[{name:'consultar',description:'Teste',input_schema:{type:'object',properties:{client_id:{type:'string',format:'uuid'}}}}]});
  assertEquals(b.contents[1].parts[0],signed);
  assertEquals((b.contents[2].parts[0] as any).functionResponse,{name:'consultar',id:'call-1',response:{ok:true,data:{balance:1}}});
  assertEquals(b.tools?.[0].functionDeclarations[0].parametersJsonSchema.properties,{client_id:{type:'string',format:'uuid'}});
}));
Deno.test('Gemini preserves names for parallel tool results with no provider ids',()=>fixture(async()=>{
  globalThis.fetch=async()=>reply([{functionCall:{name:'first',args:{}}},{functionCall:{name:'second',args:{}}}]);
  const r=await callGemini(params);
  const b=geminiRequest({...params,messages:[...params.messages,{role:'assistant',content:r.content},{role:'user',content:r.content.map(c=>({type:'tool_result',tool_use_id:c.id,content:'{"ok":false}'}))}]});
  assertEquals(b.contents[2].parts.map((p:any)=>p.functionResponse.name),['first','second']);
}));
Deno.test('Gemini rejects tool results without an originating call',()=>{
  let failed=false;try {geminiRequest({...params,messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'unknown',content:'{}'}]}]});}catch{failed=true;}
  assert(failed);
});
Deno.test('Gemini provider errors never expose response body or key',()=>fixture(async()=>{
  globalThis.fetch=async()=>new Response('test-private-key and customer information',{status:403});
  const e=await assertRejects(()=>callGemini(params),Error,'gemini_http_403');
  assertEquals(e.message.includes('test-private-key'),false);assertEquals(e.message.includes('customer'),false);
}));
Deno.test('Gemini refuses blocked, empty and truncated model output',()=>fixture(async()=>{
  for(const [parts,finish] of [[[],'STOP'],[[{text:'incomplete'}],'MAX_TOKENS'],[[],'SAFETY']] as any[]) {
    globalThis.fetch=async()=>reply(parts,finish);
    await assertRejects(()=>callGemini(params));
  }
}));
Deno.test('Shared AI helper uses Gemini for allowed owner and preserves existing providers elsewhere',()=>fixture(async()=>{
  const urls:string[]=[];Deno.env.set('DEEPSEEK_API_KEY','test-deepseek-key');
  globalThis.fetch=async(input)=>{
    const url=String(input);urls.push(url);
    return url.includes('generativelanguage')?reply([{text:'Gemini reply'}]):new Response(JSON.stringify({choices:[{message:{content:'Existing provider reply'}}]}));
  };
  assertEquals(await callAnthropic(params),'Gemini reply');
  assertEquals(await callAnthropic({...params,userId:'other-owner'}),'Existing provider reply');
  assertEquals(urls.length,2);assert(urls[1].startsWith('https://api.deepseek.com/'));
}));
Deno.test('Gemini rejects a malformed model setting before sending credentials',()=>fixture(async()=>{
  Deno.env.set('GEMINI_MODEL','../../other?key=bad');globalThis.fetch=()=>{throw Error('Unexpected network');};
  await assertRejects(()=>callGemini(params),Error,'gemini_invalid_model');
}));
