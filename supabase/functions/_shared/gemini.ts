// Native Gemini adapter. Credentials stay on the server; an optional owner
// allowlist confines a test key to explicitly selected accounts.
export interface GeminiParams {
  system: string;
  messages: Array<{role: 'user' | 'assistant'; content: string | any[]}>;
  userId?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  tools?: Array<{name: string; description: string; input_schema: Record<string, unknown>}>;
}

export function geminiConfigured(userId?: string): boolean {
  if (!Deno.env.get('GEMINI_API_KEY')) return false;
  const owners = (Deno.env.get('GEMINI_ALLOWED_USER_IDS') || '').split(',').map(s => s.trim()).filter(Boolean);
  return owners.length === 0 || !!userId && owners.includes(userId);
}

export function geminiRequest(params: GeminiParams) {
  const calls = new Map<string, {name: string; id?: string}>();
  const contents = params.messages.map(message => {
    const blocks = typeof message.content === 'string' ? [{type:'text', text:message.content}] : message.content;
    const parts = blocks.map(block => {
      if (typeof block === 'string') return {text:block};
      // Preserve signed model parts across tool rounds (Gemini 3+).
      if (block.geminiPart) {
        if (block.type === 'tool_use') calls.set(block.id, block.geminiPart.functionCall);
        return block.geminiPart;
      }
      if (block.type === 'text') return {text:String(block.text || '')};
      if (['image','document','audio'].includes(block.type) && block.source?.type === 'base64') {
        return {inlineData:{mimeType:block.source.media_type, data:block.source.data}};
      }
      if (block.type === 'tool_result') {
        const call = calls.get(block.tool_use_id);
        if (!call) throw Error('gemini_tool_result_without_call');
        let response: any;
        try { response = JSON.parse(block.content); } catch { response = {result:String(block.content)}; }
        return {functionResponse:{name:call.name, ...(call.id ? {id:call.id} : {}), response}};
      }
      throw Error('gemini_unsupported_content');
    });
    return {role:message.role === 'assistant' ? 'model' : 'user', parts};
  });
  return {
    systemInstruction:{parts:[{text:params.system}]},
    contents,
    generationConfig:{maxOutputTokens:params.maxTokens ?? 1024, temperature:params.temperature ?? 0.3},
    ...(params.tools?.length ? {tools:[{functionDeclarations:params.tools.map(tool => ({
      name:tool.name, description:tool.description, parametersJsonSchema:tool.input_schema,
    }))}]} : {}),
  };
}

export async function callGemini(params: GeminiParams): Promise<{content:any[]; stop_reason:'tool_use' | 'end_turn'}> {
  if (!geminiConfigured(params.userId)) throw Error('gemini_not_configured_for_account');
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite';
  if (!/^[a-z0-9._-]+$/i.test(model)) throw Error('gemini_invalid_model');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method:'POST', headers:{'Content-Type':'application/json', 'x-goog-api-key':Deno.env.get('GEMINI_API_KEY')!},
    body:JSON.stringify(geminiRequest(params)), signal:AbortSignal.timeout(params.timeoutMs ?? 15_000),
  });
  if (!response.ok) {
    // Provider error bodies can contain request data; never log them.
    await response.body?.cancel();
    throw Error(`gemini_http_${response.status}`);
  }
  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate || candidate.finishReason && candidate.finishReason !== 'STOP') throw Error('gemini_incomplete_response');
  const content = (candidate.content?.parts || []).flatMap((part:any) => {
    if (part.thought) return [];
    if (part.functionCall) return [{type:'tool_use', id:part.functionCall.id || crypto.randomUUID(),
      name:part.functionCall.name, input:part.functionCall.args || {}, geminiPart:part}];
    return typeof part.text === 'string' && part.text.trim() ? [{type:'text', text:part.text, geminiPart:part}] : [];
  });
  if (!content.length) throw Error('gemini_empty_response');
  return {content, stop_reason:content.some((b:any) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'};
}
