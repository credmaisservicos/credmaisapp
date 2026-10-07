import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handlers, type Handler } from "./capture_serve.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const backend = "https://backend.test.invalid";
const evolution = "https://whatsapp.test.invalid";
const secret = "webhook-secret-only-for-isolated-tests";
for (const [name, value] of Object.entries({
  SUPABASE_URL: backend,
  SUPABASE_ANON_KEY: "isolated-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "isolated-service-key",
  MERCADOPAGO_ACCESS_TOKEN: "isolated-mp-token",
  MERCADOPAGO_WEBHOOK_SECRET: secret,
  BREVO_API_KEY: "isolated-email-key",
  SITE_URL: "https://app.test.invalid",
})) Deno.env.set(name, value);

interface Call { url: URL; method: string; body: Record<string, unknown> }
let calls: Call[] = [];
let jobs=new Map<string,any>();
let jobSequence=0;
let installmentOwner = owner;
let conversationOwner = owner;
let paymentAmount = 199;
let paymentStatus = "approved";
let subscriptionType = "monthly";
let providerFails = false;
let receiptsEnabled = true;
let events = new Set<string>();
let subscriptionWrites: Record<string, unknown>[] = [];
let profileWrites: Record<string, unknown>[] = [];

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const row = (value: unknown, request: Request) => json(request.headers.get("Accept")?.includes("vnd.pgrst.object") ? value : [value]);

// Todo HTTP da aplicação é simulado; o runner não concede permissão de rede.
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const body = await request.clone().text();
  const call = { url, method: request.method, body: body ? JSON.parse(body) : {} };
  calls.push(call);
  if (url.origin === backend) {
    if (url.pathname === "/auth/v1/user") return request.headers.get("Authorization") === "Bearer isolated-owner-token"
      ? json({ id: owner, email: "qa@example.invalid" }) : json({ message: "Invalid token" }, 401);
    if (url.pathname === "/auth/v1/admin/generate_link") return json({ properties: { action_link: "https://app.test.invalid/login" } });
    if (url.pathname === "/rest/v1/rpc/try_consume_rate_limit") return json({ allowed: true, remaining: 20, retry_after_ms: 0 });
    if (url.pathname === "/rest/v1/contract_installments") return row({
      id: "installment-test", user_id: installmentOwner, paid_amount: 40, amount: 100,
      installment_number: 1, clients: { name: "Cliente de teste", whatsapp: "5500000000000" }, contracts: { num_installments: 2 },
    }, request);
    if(url.pathname === "/rest/v1/whatsapp_scheduled_messages"){
      if(request.method==="POST"){
        const key=String(call.body.source_key||`job-${++jobSequence}`);
        if(!jobs.has(key))jobs.set(key,{id:`job-${++jobSequence}`,attempts:0,...call.body});
        return new Response(null,{status:201});
      }
      const matching=[...jobs.values()].filter(j=>["id","user_id","source_key","conversation_id"].every(k=>!url.searchParams.get(k)||url.searchParams.get(k)===`eq.${j[k]}`));
      if(request.method==="PATCH"){for(const j of matching)Object.assign(j,call.body);return new Response(null,{status:204});}
      if(request.headers.get("Accept")?.includes("vnd.pgrst.object"))return row(matching[0]||null,request);
      return json(matching);
    }
    if(url.pathname==="/rest/v1/rpc/claim_whatsapp_job"){
      const j=[...jobs.values()].find(j=>j.id===call.body._id&&j.user_id===call.body._user_id&&j.status==="pending");
      if(!j)return json([]);j.status="processing";j.attempts++;return json([j]);
    }
    if (url.pathname === "/rest/v1/settings") return row({
      company_name: "Empresa de teste", bot_send_receipt: receiptsEnabled,bot_enabled:true,bot_auto_send:true,
      whatsapp_api_url: evolution, whatsapp_api_key: "isolated-wa-key", whatsapp_instance: "test-instance",
    }, request);
    if (url.pathname === "/rest/v1/whatsapp_conversations" && request.method === "GET") {
      if (conversationOwner !== owner) return json({ code: "PGRST116", message: "No rows" }, 406);
      return row({ id: "conversation-test", user_id: conversationOwner, jid: "5500000000000", instance: "test-instance" }, request);
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (request.method === "PATCH") { profileWrites.push(call.body); return new Response(null, { status: 204 }); }
      return row({ id: owner, name: "QA",is_admin:true,plan_tier:"completo", subscription_type: subscriptionType }, request);
    }
    if (url.pathname === "/rest/v1/subscriptions") {
      if (request.method === "POST") subscriptionWrites.push(call.body);
      return new Response(null, { status: 201 });
    }
    if (url.pathname === "/rest/v1/webhook_events") {
      if (request.method === "POST") {
        const key = String(call.body.event_key);
        if (events.has(key)) return json({ code: "23505", message: "Duplicate" }, 409);
        events.add(key);
      }
      return new Response(null, { status: 201 });
    }
    if (["/rest/v1/audit_logs", "/rest/v1/whatsapp_messages", "/rest/v1/whatsapp_scheduled_messages", "/rest/v1/whatsapp_conversations"].includes(url.pathname)) return new Response(null, { status: 201 });
  }
  if (url.origin === "https://api.mercadopago.com" && url.pathname === "/v1/payments/123") return json({
    id: 123, status: paymentStatus, transaction_amount: paymentAmount,
    metadata: { email: "qa@example.invalid", plan_tier: "essencial" }, description: "Plano de teste",
  });
  if (url.origin === evolution && url.pathname === "/message/sendText/test-instance") return json({ ok: !providerFails }, providerFails ? 502 : 200);
  if (url.origin === "https://api.brevo.com" && url.pathname === "/v3/smtp/email") return json({ messageId: "isolated-test-message" });
  throw new Error(`HTTP não previsto e bloqueado no teste: ${url.origin}${url.pathname}`);
};

await import("../auto-receipt/index.ts");
const receipt = handlers.at(-1)!;
await import("../whatsapp-send/index.ts");
const whatsapp = handlers.at(-1)!;
await import("../mercadopago-webhook/index.ts");
const webhook = handlers.at(-1)!;

function reset() {
  calls = []; installmentOwner = owner; conversationOwner = owner;
  paymentAmount = 199; paymentStatus = "approved"; subscriptionType = "monthly";
  providerFails = false; receiptsEnabled = true;
  events = new Set(); subscriptionWrites = []; profileWrites = []; jobs=new Map();jobSequence=0;
}

function invoke(handler: Handler, body: unknown, authenticated = true) {
  return handler(new Request("https://function.test.invalid/", { method: "POST", headers: {
    "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer isolated-owner-token" } : {}),
  }, body: JSON.stringify(body) }));
}

async function signedWebhook(valid = true) {
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:123;request-id:isolated-request;ts:${ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const v1 = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
  return webhook(new Request("https://function.test.invalid/", { method: "POST", headers: {
    "Content-Type": "application/json", "x-request-id": "isolated-request", "x-signature": `ts=${ts},v1=${valid ? v1 : "invalid"}`,
  }, body: JSON.stringify({ type: "payment", data: { id: "123" } }) }));
}

Deno.test("recibo: visitante não consulta nem envia dados", async () => {
  reset(); assertEquals((await invoke(receipt, { installment_id: "installment-test" }, false)).status, 401);
  assertEquals(calls.length, 0);
});
Deno.test("recibo: usuário não pode enviar recibo da parcela de outro dono", async () => {
  reset(); installmentOwner = other;
  assertEquals((await invoke(receipt, { installment_id: "installment-test", user_id: other })).status, 403);
  assert(!calls.some(call => call.url.origin === evolution));
});
Deno.test("recibo: pagamento parcial usa o valor efetivamente recebido", async () => {
  reset(); const response = await invoke(receipt, { installment_id: "installment-test", user_id: other });
  assertEquals(response.status, 200); assertEquals((await response.json()).sent, true);
  const sent = calls.find(call => call.url.origin === evolution)!;
  assert(String(sent.body.text).includes("R$ 40.00"));
  const audit = calls.find(call => call.url.pathname === "/rest/v1/audit_logs")!;
  assertEquals(audit.body.user_id, owner);
});
Deno.test("recibo: envio desativado não chama o provedor", async () => {
  reset(); receiptsEnabled = false; assertEquals((await invoke(receipt, { installment_id: "installment-test" })).status, 200);
  assert(!calls.some(call => call.url.origin === evolution));
});
Deno.test("WhatsApp: visitante é recusado", async () => {
  reset(); assertEquals((await invoke(whatsapp, { conversation_id: "conversation-test", text: "Teste" }, false)).status, 401);
  assertEquals(calls.length, 0);
});
Deno.test("WhatsApp: conversa de outro dono não permite envio", async () => {
  reset(); conversationOwner = other;
  assertEquals((await invoke(whatsapp, { conversation_id: "conversation-test", text: "Teste" })).status, 404);
  assertEquals(calls.find(call => call.url.pathname === "/rest/v1/whatsapp_conversations")!.url.searchParams.get("user_id"), `eq.${owner}`);
  assert(!calls.some(call => call.url.origin === evolution));
});
Deno.test("WhatsApp: mensagem enviada é registrada no dono autenticado", async () => {
  reset(); assertEquals((await invoke(whatsapp, { conversation_id: "conversation-test", text: "Mensagem de teste", user_id: other })).status, 200);
  const message = calls.find(call => call.url.pathname === "/rest/v1/whatsapp_messages")!;
  assertEquals(message.body.user_id, owner); assertEquals(message.body.content, "Mensagem de teste");
  const conversation = calls.find(call => call.url.pathname === "/rest/v1/whatsapp_conversations" && call.method === "PATCH")!;
  assert(calls.some(c=>c.url.pathname==="/rest/v1/whatsapp_conversations"&&c.method==="PATCH"&&c.body.bot_paused===true));
});
Deno.test("WhatsApp: falha no provedor não grava sucesso", async () => {
  reset(); providerFails = true;
  assertEquals((await invoke(whatsapp, { conversation_id: "conversation-test", text: "Teste" })).status, 502);
  assert(!calls.some(call => call.url.pathname === "/rest/v1/whatsapp_messages"));
});
Deno.test("WhatsApp: agendamento não envia mensagem imediatamente", async () => {
  reset(); assertEquals((await invoke(whatsapp, { conversation_id: "conversation-test", text: "Teste", schedule_for: new Date(Date.now() + 3600000).toISOString() })).status, 200);
  assert(!calls.some(call => call.url.origin === evolution));
  assertEquals(calls.find(call => call.url.pathname === "/rest/v1/whatsapp_scheduled_messages")!.body.user_id, owner);
});
Deno.test("Mercado Pago: assinatura inválida não altera assinaturas", async () => {
  reset(); assertEquals((await signedWebhook(false)).status, 401); assertEquals(subscriptionWrites.length, 0);
  assert(!calls.some(call => call.url.origin === "https://api.mercadopago.com"));
});
Deno.test("Mercado Pago: valor insuficiente não libera acesso", async () => {
  reset(); paymentAmount = 0.01; const response = await signedWebhook();
  assertEquals(response.status, 200); assertEquals(subscriptionWrites[0].status, "inactive"); assertEquals(profileWrites.length, 0);
});
Deno.test("Mercado Pago: pagamento aprovado libera acesso por prazo definido", async () => {
  reset(); assertEquals((await signedWebhook()).status, 200); assertEquals(subscriptionWrites[0].status, "active");
  assertEquals(profileWrites[0].is_blocked, false); assertEquals(profileWrites[0].subscription_type, "monthly");
  const expires = new Date(String(profileWrites[0].subscription_expires_at)).getTime();
  assert(expires > Date.now() + 30 * 86400000 && expires <= Date.now() + 32 * 86400000);
});
Deno.test("Mercado Pago: evento repetido não duplica ativação ou e-mail", async () => {
  reset(); assertEquals((await signedWebhook()).status, 200); assertEquals((await signedWebhook()).status, 200);
  assertEquals(subscriptionWrites.length, 1); assertEquals(calls.filter(call => call.url.origin === "https://api.brevo.com").length, 1);
});
Deno.test("Mercado Pago: assinatura vitalícia é preservada", async () => {
  reset(); subscriptionType = "lifetime"; assertEquals((await signedWebhook()).status, 200);
  assertEquals(profileWrites[0].subscription_type, undefined); assertEquals(profileWrites[0].subscription_expires_at, undefined);
});

Deno.test("WhatsApp: retry of an accepted request does not resend",async()=>{
  reset();const body={conversation_id:"conversation-test",text:"Teste único",request_id:"stable-test-request"};
  assertEquals((await invoke(whatsapp,body)).status,200);assertEquals((await invoke(whatsapp,body)).status,200);
  assertEquals(calls.filter(c=>c.url.origin===evolution).length,1);
});
Deno.test("WhatsApp: uncertain provider outcome is not retried automatically",async()=>{
  reset();providerFails=true;const body={conversation_id:"conversation-test",text:"Teste",request_id:"uncertain-request"};
  assertEquals((await invoke(whatsapp,body)).status,502);assertEquals((await invoke(whatsapp,body)).status,502);
  assertEquals(calls.filter(c=>c.url.origin===evolution).length,1);
});
Deno.test("WhatsApp: scheduled attachment retains its media",async()=>{
  reset();assertEquals((await invoke(whatsapp,{conversation_id:"conversation-test",media_url:"https://files.test.invalid/file.pdf",media_type:"document",caption:"Arquivo",schedule_for:new Date(Date.now()+3600000).toISOString()})).status,200);
  const job=[...jobs.values()][0];assertEquals(job.media_type,"document");assertEquals(job.media_url,"https://files.test.invalid/file.pdf");
  assert(!calls.some(c=>c.url.origin===evolution));
});
Deno.test("WhatsApp: approval checks job ownership",async()=>{
  reset();jobs.set("foreign",{id:"foreign-job",user_id:other,conversation_id:"conversation-test",status:"awaiting_approval"});
  assertEquals((await invoke(whatsapp,{conversation_id:"conversation-test",action:"approve_job",job_id:"foreign-job"})).status,404);
  assertEquals(jobs.get("foreign").status,"awaiting_approval");
});
