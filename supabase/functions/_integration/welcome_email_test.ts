import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handlers } from "./capture_serve.ts";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const backend = "https://welcome-backend.test.invalid";
const internalSecret = "internal-welcome-only-for-isolated-tests";
for (const [key, value] of Object.entries({
  SUPABASE_URL: backend, SUPABASE_ANON_KEY: "isolated-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "isolated-service-key", INTERNAL_FN_SECRET: internalSecret,
  BREVO_API_KEY: "isolated-email-key", BREVO_SENDER_EMAIL: "sender@example.invalid",
})) Deno.env.set(key, value);

interface Call { url: URL; method: string; body: Record<string, unknown> }
let calls: Call[] = [];
let email: string | undefined;
let metadata: Record<string, unknown>;
let quota: Set<string>;
let quotaMode: "ok" | "error" | "throw" | "missing" | "invalid";
let providerMode: "ok" | "error" | "throw" | "invalid-json" | "missing-id";
let profileMode: "ok" | "missing" | "error";
let authMode: "ok" | "missing" | "error";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function reset() {
  calls = []; email = "owner@example.invalid"; metadata = { name: "Nome cadastrado" };
  quota = new Set(); quotaMode = "ok"; providerMode = "ok"; profileMode = "ok"; authMode = "ok";
  Deno.env.set("INTERNAL_FN_SECRET", internalSecret); Deno.env.set("BREVO_API_KEY", "isolated-email-key");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "isolated-service-key");
}
reset();
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const raw = await request.clone().text();
  const body = raw ? JSON.parse(raw) : {};
  calls.push({ url, method: request.method, body });
  if (url.origin === backend) {
    if (url.pathname === "/auth/v1/user") return request.headers.get("Authorization") === "Bearer isolated-owner-token"
      ? json({ id: owner, email, user_metadata: metadata }) : json({ message: "Invalid token" }, 401);
    if (url.pathname === "/rest/v1/profiles") {
      if (profileMode === "error") return json({ code: "XX000", message: "private-db-error" }, 500);
      return json(profileMode === "missing" ? null : { id: other });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      if (authMode === "missing") return json({ message: "private-auth-error" }, 404);
      if (authMode === "error") return json({ message: "private-auth-error" }, 500);
      const id = url.pathname.split("/").at(-1);
      return json({ id, email: id === owner ? email : "internal@example.invalid", user_metadata: id === owner ? metadata : { name: "Identidade interna" } });
    }
    if (url.pathname === "/rest/v1/rpc/try_consume_rate_limit") {
      assertEquals(body._capacity, 1); assertEquals(body._refill_per_sec, 1 / 86_400);
      if (quotaMode === "throw") throw new TypeError("private-quota-transport-error");
      if (quotaMode === "error") return json({ code: "XX000", message: "private-quota-error" }, 500);
      if (quotaMode === "missing") return json(null);
      if (quotaMode === "invalid") return json({ allowed: "true" });
      const key = String(body._key);
      const allowed = !quota.has(key); quota.add(key);
      return json({ allowed, remaining: 0, retry_after_ms: allowed ? 0 : 86_400_000 });
    }
  }
  if (url.origin === "https://api.brevo.com" && url.pathname === "/v3/smtp/email") {
    if (providerMode === "throw") throw new TypeError("private-provider-error isolated-email-key");
    if (providerMode === "error") return json({ message: "private-provider-error isolated-email-key" }, 500);
    if (providerMode === "invalid-json") return new Response("private-provider-error", { status: 201 });
    if (providerMode === "missing-id") return json({ success: true }, 201);
    return json({ messageId: "isolated-message" }, 201);
  }
  throw new Error(`HTTP inesperado bloqueado: ${url.origin}${url.pathname}`);
};
await import("../send-welcome-email/index.ts");
const handler = handlers.at(-1)!;
const providerCalls = () => calls.filter(call => call.url.origin === "https://api.brevo.com");
const quotaCalls = () => calls.filter(call => call.url.pathname.endsWith("/try_consume_rate_limit"));
const invoke = (body: unknown = {}, authorization: "owner" | "none" | "invalid" | "internal" = "owner", method = "POST") =>
  handler(new Request("https://welcome-function.test.invalid/", { method, headers: {
    "Content-Type": "application/json",
    ...(authorization === "owner" ? { Authorization: "Bearer isolated-owner-token" } : {}),
    ...(authorization === "invalid" ? { Authorization: "Bearer invalid-token" } : {}),
    ...(authorization === "internal" ? { "x-internal-secret": internalSecret } : {}),
  }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));

for (const authorization of ["none", "invalid"] as const) Deno.test(`welcome: ${authorization} cannot send`, async () => {
  reset(); assertEquals((await invoke({ email: "arbitrary@example.invalid" }, authorization)).status, 401);
  assertEquals(providerCalls().length, 0); assertEquals(quotaCalls().length, 0);
});
Deno.test("welcome: authenticated caller cannot target arbitrary email", async () => {
  reset(); const result = await invoke({ email: "victim@example.invalid", name: "Texto arbitrário" });
  assertEquals(result.status, 403); assertEquals(providerCalls().length, 0); assertEquals(quotaCalls().length, 0);
});
Deno.test("welcome: authenticated caller cannot select another user", async () => {
  reset(); assertEquals((await invoke({ user_id: other })).status, 403); assertEquals(providerCalls().length, 0);
});
Deno.test("welcome: destination and display name come from authenticated identity", async () => {
  reset(); assertEquals((await invoke({ email: "OWNER@example.invalid", name: "Conteúdo arbitrário" })).status, 200);
  const payload = providerCalls()[0].body;
  assertEquals(payload.to, [{ email: "owner@example.invalid", name: "Nome cadastrado" }]);
  assert(String(payload.htmlContent).includes("Nome cadastrado")); assert(!String(payload.htmlContent).includes("Conteúdo arbitrário"));
  assertEquals(quotaCalls()[0].body._key, `welcome-email:${owner}`);
});
Deno.test("welcome: no destination fields still uses own identity", async () => {
  reset(); assertEquals((await invoke()).status, 200); assertEquals(providerCalls().length, 1);
});
Deno.test("welcome: metadata is escaped in HTML", async () => {
  reset(); metadata = { name: '<img src=x onerror="bad()">&\'hello' };
  assertEquals((await invoke()).status, 200); const html = String(providerCalls()[0].body.htmlContent);
  assert(html.includes("&lt;img")); assert(!html.includes("<img")); assert(html.includes("&quot;")); assert(html.includes("&#39;"));
});
Deno.test("welcome: missing or malformed identity email cannot send", async () => {
  for (const value of [undefined, "", "bad-email", "owner@example.invalid\r\nBcc: victim@example.invalid"]) {
    reset(); email = value; assertEquals((await invoke()).status, 400); assertEquals(providerCalls().length, 0);
  }
});
Deno.test("welcome: registered internal user ID retains authorized server-side sending", async () => {
  reset(); assertEquals((await invoke({ user_id: other, name: "Untrusted" }, "internal")).status, 200);
  assertEquals(providerCalls()[0].body.to, [{ email: "internal@example.invalid", name: "Identidade interna" }]);
  assertEquals(quotaCalls()[0].body._key, `welcome-email:${other}`);
});
Deno.test("welcome: legacy internal email resolves and confirms Auth identity", async () => {
  reset(); assertEquals((await invoke({ email: "INTERNAL@example.invalid", name: "Untrusted" }, "internal")).status, 200);
  assert(calls.some(call => call.url.pathname === `/auth/v1/admin/users/${other}`));
  assertEquals(providerCalls()[0].body.to, [{ email: "internal@example.invalid", name: "Identidade interna" }]);
});
Deno.test("welcome: stale internal profile cannot substitute Auth destination", async () => {
  reset(); assertEquals((await invoke({ email: "stale@example.invalid" }, "internal")).status, 403); assertEquals(providerCalls().length, 0);
});
for (const mode of ["missing", "error"] as const) Deno.test(`welcome: internal profile ${mode} fails closed`, async () => {
  reset(); profileMode = mode;
  assertEquals((await invoke({ email: "internal@example.invalid" }, "internal")).status, mode === "missing" ? 404 : 503);
  assertEquals(providerCalls().length, 0); assertEquals(quotaCalls().length, 0);
});
for (const mode of ["missing", "error"] as const) Deno.test(`welcome: internal Auth ${mode} fails closed`, async () => {
  reset(); authMode = mode;
  assertEquals((await invoke({ user_id: other }, "internal")).status, mode === "missing" ? 404 : 503); assertEquals(providerCalls().length, 0);
});
Deno.test("welcome: internal recipient must be a registered identity", async () => {
  for (const body of [{}, { user_id: "not-uuid" }, { email: "not-email" }]) {
    reset(); assertEquals((await invoke(body, "internal")).status, 400); assertEquals(providerCalls().length, 0);
  }
});
Deno.test("welcome: absent or incorrect internal secret cannot authorize sending", async () => {
  reset(); Deno.env.delete("INTERNAL_FN_SECRET"); assertEquals((await invoke({ user_id: other }, "internal")).status, 401);
  reset(); const result = await handler(new Request("https://welcome-function.test.invalid/", { method: "POST", headers: { "x-internal-secret": "incorrect" }, body: "{}" }));
  assertEquals(result.status, 401); assertEquals(providerCalls().length, 0);
});
for (const mode of ["error", "throw", "missing", "invalid"] as const) Deno.test(`welcome: quota ${mode} never falls back to memory`, async () => {
  reset(); quotaMode = mode; const result = await invoke(); assertEquals(result.status, 503);
  assertEquals(providerCalls().length, 0); assert(!JSON.stringify(await result.json()).includes("private-"));
});
Deno.test("welcome: repeated authenticated and internal requests share recipient quota", async () => {
  reset(); assertEquals((await invoke({ user_id: other }, "internal")).status, 200);
  const repeated = await invoke({ email: "internal@example.invalid" }, "internal");
  assertEquals(repeated.status, 429); assertEquals(repeated.headers.get("Retry-After"), "86400"); assertEquals(providerCalls().length, 1);
  reset(); assertEquals((await invoke()).status, 200); assertEquals((await invoke({ name: "changed" })).status, 429);
  assertEquals((await invoke({ user_id: owner }, "internal")).status, 429); assertEquals(providerCalls().length, 1);
});
Deno.test("welcome: simultaneous requests only consume one persistent quota slot", async () => {
  reset(); const results = await Promise.all([invoke(), invoke()]); assertEquals(results.map(result => result.status).sort(), [200, 429]); assertEquals(providerCalls().length, 1);
});
for (const mode of ["error", "throw", "invalid-json", "missing-id"] as const) Deno.test(`welcome: provider ${mode} is unconfirmed and never immediately resent`, async () => {
  reset(); providerMode = mode; const result = await invoke(); assertEquals(result.status, 502);
  assertEquals(await result.json(), { error: "email_delivery_unconfirmed" });
  assertEquals((await invoke()).status, 429); assertEquals(providerCalls().length, 1);
});
Deno.test("welcome: missing configuration never consumes quota or sends", async () => {
  for (const key of ["BREVO_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    reset(); Deno.env.delete(key); assertEquals((await invoke()).status, 503); assertEquals(quotaCalls().length, 0); assertEquals(providerCalls().length, 0);
  }
});
Deno.test("welcome: methods and malformed bodies do not send", async () => {
  reset(); assertEquals((await invoke({}, "none", "GET")).status, 405);
  const options = await invoke({}, "none", "OPTIONS"); assertEquals(options.status, 200); assert(options.headers.get("Access-Control-Allow-Headers")?.includes("x-internal-secret"));
  for (const body of [null, [], "string"]) assertEquals((await invoke(body)).status, 400);
  const invalid = await handler(new Request("https://welcome-function.test.invalid/", { method: "POST", headers: { Authorization: "Bearer isolated-owner-token" }, body: "{" }));
  assertEquals(invalid.status, 400); assertEquals(providerCalls().length, 0);
});
