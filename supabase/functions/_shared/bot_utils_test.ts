import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractJsonObject,
  sanitizeAiResult,
  shouldTrustReceipt,
  isEchoOfLastReply,
  computeRolloverInterest,
  receiptOutcomeReply,
  isRecentDuplicateReply,
  splitWhatsAppText,
} from "./bot_utils.ts";

Deno.test("extractJsonObject: JSON puro", () => {
  const o = extractJsonObject('{"a":1,"b":"x"}');
  assertEquals(o.a, 1);
});

Deno.test("extractJsonObject: JSON com texto antes/depois", () => {
  const o = extractJsonObject('Aqui está: {"reply":"ok","n":2} fim');
  assertEquals(o.reply, "ok");
  assertEquals(o.n, 2);
});

Deno.test("extractJsonObject: cercas markdown ```json", () => {
  const o = extractJsonObject('```json\n{"x":true}\n```');
  assertEquals(o.x, true);
});

Deno.test("extractJsonObject: chaves dentro de string não confundem", () => {
  const o = extractJsonObject('lixo {"reply":"o cliente disse: { quero pagar }","ok":1}');
  assertEquals(o.ok, 1);
  assert(o.reply.includes("{ quero pagar }"));
});

Deno.test("extractJsonObject: devolve null sem lançar para entrada inválida", () => {
  assertEquals(extractJsonObject(""), null);
  assertEquals(extractJsonObject("sem json aqui"), null);
  assertEquals(extractJsonObject("{ inacabado"), null);
});

Deno.test("sanitizeAiResult: aplica defaults seguros para tudo", () => {
  const s = sanitizeAiResult(null);
  assertEquals(s.reply, "");
  assertEquals(s.is_receipt, false);
  assertEquals(s.receipt_value, 0);
  assertEquals(s.promise_date, null);
  assertEquals(s.intent, "outro");
});

Deno.test("sanitizeAiResult: coage números e datas inválidas", () => {
  const s = sanitizeAiResult({
    reply: "ok ```",
    receipt_value: "150,50",
    promise_date: "amanha",
    is_receipt: 1,
    intent: "x".repeat(200),
  });
  assertEquals(s.receipt_value, 150.5);
  assertEquals(s.promise_date, null);
  assertEquals(s.is_receipt, true);
  assert(s.reply.indexOf("`") === -1, "não pode ter cerca de markdown");
  assert(s.intent.length <= 32);
});

Deno.test("sanitizeAiResult: aceita data ISO válida", () => {
  const s = sanitizeAiResult({ promise_date: "2026-07-15" });
  assertEquals(s.promise_date, "2026-07-15");
});

Deno.test("shouldTrustReceipt: aceita mídia (imagem) com valor", () => {
  assert(shouldTrustReceipt({ messageType: "image", hasMedia: true, incomingText: "", receiptValue: 100 }));
});

Deno.test("shouldTrustReceipt: aceita texto com palavra-chave + valor", () => {
  assert(shouldTrustReceipt({ messageType: "text", hasMedia: false, incomingText: "paguei R$ 250,00", receiptValue: 250 }));
});

Deno.test("shouldTrustReceipt: rejeita 'vou pagar amanhã' (sem prova)", () => {
  assertEquals(
    shouldTrustReceipt({ messageType: "text", hasMedia: false, incomingText: "vou pagar amanhã", receiptValue: 100 }),
    false,
  );
});

Deno.test("shouldTrustReceipt: rejeita valor zero/negativo", () => {
  assertEquals(
    shouldTrustReceipt({ messageType: "image", hasMedia: true, incomingText: "", receiptValue: 0 }),
    false,
  );
});

Deno.test("isEchoOfLastReply: bloqueia repetição dentro do TTL", () => {
  const map = new Map<string, { text: string; ts: number }>();
  map.set("jid1", { text: "Olá, tudo bem?", ts: Date.now() });
  assert(isEchoOfLastReply(map, "jid1", "Olá, tudo bem?"));
  assertEquals(isEchoOfLastReply(map, "jid1", "Outra coisa"), false);
});

Deno.test("isEchoOfLastReply: libera após TTL", () => {
  const map = new Map<string, { text: string; ts: number }>();
  map.set("jid1", { text: "X", ts: Date.now() - 120_000 });
  assertEquals(isEchoOfLastReply(map, "jid1", "X", 60_000), false);
});

Deno.test("computeRolloverInterest: usa capital * taxa quando disponível", () => {
  const v = computeRolloverInterest({ capital: 1000, interestRate: 20, installmentAmount: 0 });
  assertEquals(v, 200);
});

Deno.test("computeRolloverInterest: fallback usa parcela - amortização", () => {
  // capital 1200, 12x => amort 100/parcela; parcela 150 => juros 50
  const v = computeRolloverInterest({ capital: 1200, interestRate: 0, installmentAmount: 150, numInstallments: 12 });
  assertEquals(v, 50);
});

Deno.test("computeRolloverInterest: nunca devolve negativo", () => {
  const v = computeRolloverInterest({ capital: 1000, interestRate: 0, installmentAmount: 50, numInstallments: 1 });
  assert(v > 0);
});

Deno.test("isRecentDuplicateReply: bloqueia repetição persistida recente", () => {
  const now = Date.now();
  assert(isRecentDuplicateReply({ content: "Sua parcela vence amanhã.", created_at: new Date(now - 10_000).toISOString() }, " sua parcela  vence amanhã. ", now));
  assertEquals(isRecentDuplicateReply({ content: "Mensagem antiga", created_at: new Date(now - 120_000).toISOString() }, "Mensagem antiga", now), false);
});

Deno.test("splitWhatsAppText: parágrafos normais seguem em uma mensagem", () => {
  assertEquals(splitWhatsAppText("Primeiro parágrafo.\n\nSegundo parágrafo."), ["Primeiro parágrafo.\n\nSegundo parágrafo."]);
});

Deno.test("splitWhatsAppText: texto longo é dividido sem perder conteúdo", () => {
  const input = Array.from({ length: 120 }, (_, i) => `linha-${i}`).join(" ");
  const chunks = splitWhatsAppText(input, 100);
  assert(chunks.length > 1);
  assert(chunks.every(chunk => chunk.length <= 100));
  assertEquals(chunks.join(" "), input);
});

Deno.test("receiptOutcomeReply: nunca confirma comprovante rejeitado", () => {
  const reply = receiptOutcomeReply({
    isVerified: false, isTrusted: false, hasOpenBalance: true,
    originalReply: "Pagamento confirmado.",
  });
  assert(!/pagamento confirmado/i.test(reply));
  assert(/não consegui validar/i.test(reply));
});

Deno.test("receiptOutcomeReply: comprovante duplicado não gera nova baixa", () => {
  const reply = receiptOutcomeReply({
    isVerified: false, isTrusted: false, isDuplicate: true, hasOpenBalance: true,
  });
  assert(/já foi utilizado/i.test(reply));
  assert(/não fiz uma nova baixa/i.test(reply));
});

Deno.test("receiptOutcomeReply: revisão humana informa baixa pendente", () => {
  const reply = receiptOutcomeReply({
    isVerified: true, isTrusted: false, hasOpenBalance: true,
  });
  assert(/baixa ainda não foi realizada/i.test(reply));
});

Deno.test("receiptOutcomeReply: sem dívida não confirma pagamento", () => {
  const reply = receiptOutcomeReply({
    isVerified: true, isTrusted: true, hasOpenBalance: false,
    originalReply: "Pagamento confirmado.",
  });
  assert(/não encontrei parcela em aberto/i.test(reply));
});

// ─── validateReceipt ─────────────────────────────────────────────────────────
import { validateReceipt, sha256Hex } from "./bot_utils.ts";

const baseInsts = [
  { id: "i1", amount: 250, due_date: "2026-06-10", late_fee: 0, installment_number: 1 },
  { id: "i2", amount: 250, due_date: "2026-06-17", late_fee: 0, installment_number: 2 },
];
const TODAY = "2026-06-16";

Deno.test("validateReceipt: confiança alta com mídia + valor exato", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "comprovante",
    receiptValue: 250, installments: [baseInsts[0]], todayStr: TODAY,
  });
  assert(r.trusted);
  assertEquals(r.matchType, "exact");
  assertEquals(r.matchedInstallmentId, "i1");
  assert(r.riskScore < 50);
});

Deno.test("validateReceipt: valores iguais não identificam uma parcela única", () => {
  for (const receiptValue of [250, 253]) {
    const r=validateReceipt({messageType:'image',hasMedia:true,incomingText:'comprovante',receiptValue,installments:baseInsts,todayStr:TODAY});
    assertEquals(r.matchedInstallmentId,undefined);
    assert(r.reasons.some(reason=>reason.startsWith('varias_parcelas_')));
  }
});

Deno.test("validateReceipt: compara comprovante com saldo após pagamento parcial", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "comprovante",
    receiptValue: 100,
    installments: [{ id: "parcial", amount: 250, paid_amount: 150, late_fee: 0 }],
    todayStr: TODAY,
  });
  assert(r.trusted);
  assertEquals(r.matchType, "exact");
  assertEquals(r.matchedInstallmentId, "parcial");
});

Deno.test("validateReceipt: rejeita sem evidência mínima", () => {
  const r = validateReceipt({
    messageType: "text", hasMedia: false, incomingText: "vou pagar amanhã",
    receiptValue: 250, installments: baseInsts, todayStr: TODAY,
  });
  assertEquals(r.trusted, false);
  assert(r.reasons.includes("sem_evidencia_minima"));
});

Deno.test("validateReceipt: rejeita valor zero", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 0, installments: baseInsts, todayStr: TODAY,
  });
  assertEquals(r.trusted, false);
  assertEquals(r.riskScore, 100);
});

Deno.test("validateReceipt: aceita tolerância de 2% (multa pequena)", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 253, installments: baseInsts, todayStr: TODAY,
  });
  assert(r.trusted);
  assertEquals(r.matchType, "tolerance");
});

Deno.test("validateReceipt: aceita soma de atrasos", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "paguei tudo",
    receiptValue: 500, installments: baseInsts, todayStr: TODAY,
  });
  assert(r.trusted);
  assertEquals(r.matchType, "sum_overdue");
});

Deno.test("validateReceipt: pagamento parcial aumenta risco mas pode passar", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 100, installments: baseInsts, todayStr: TODAY, // 40% da menor parcela
  });
  assertEquals(r.matchType, "partial");
  assert(r.reasons.includes("pagamento_parcial"));
});

Deno.test("validateReceipt: valor irrisório (< R$ 1) é rejeitado", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 0.5, installments: baseInsts, todayStr: TODAY,
  });
  assertEquals(r.trusted, false);
  assert(r.reasons.includes("valor_irrisorio"));
});

Deno.test("validateReceipt: valor 10x maior que parcela é suspeito", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 5000, installments: baseInsts, todayStr: TODAY,
  });
  assertEquals(r.trusted, false);
  assert(r.reasons.includes("valor_acima_do_razoavel"));
});

Deno.test("validateReceipt: data no futuro além de 1d é rejeitada", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 250, installments: baseInsts, todayStr: TODAY,
    receiptDate: "2026-06-25",
  });
  assertEquals(r.outOfWindow, true);
  assert(r.reasons.some(x => x.startsWith("data_no_futuro")));
});

Deno.test("validateReceipt: data muito antiga (> 30d) é suspeita", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 250, installments: baseInsts, todayStr: TODAY,
    receiptDate: "2026-04-01",
  });
  assertEquals(r.outOfWindow, true);
  assert(r.reasons.some(x => x.startsWith("data_muito_antiga")));
});

Deno.test("validateReceipt: hash duplicado bloqueia (anti-reuso)", () => {
  const seen = new Set(["abc123"]);
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 250, installments: baseInsts, todayStr: TODAY,
    mediaHash: "abc123", seenHashes: seen,
  });
  assertEquals(r.trusted, false);
  assertEquals(r.duplicate, true);
  assertEquals(r.riskScore, 100);
});

Deno.test("validateReceipt: palavras de alerta de fraude aumentam risco", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "olha o photoshop",
    receiptValue: 250, installments: baseInsts, todayStr: TODAY,
  });
  assert(r.reasons.includes("palavras_de_alerta"));
});

Deno.test("validateReceipt: combinação tóxica derruba confiança mesmo com mídia", () => {
  const r = validateReceipt({
    messageType: "image", hasMedia: true, incomingText: "",
    receiptValue: 73.21, installments: baseInsts, todayStr: TODAY,
    receiptDate: "2026-03-01",
  });
  assertEquals(r.trusted, false);
  assert(r.riskScore >= 50);
});

Deno.test("sha256Hex: produz hex determinístico de 64 chars", async () => {
  const a = await sha256Hex("hello world");
  const b = await sha256Hex("hello world");
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]{64}$/.test(a));
});

Deno.test("sha256Hex: aceita base64 (data URL e raw)", async () => {
  const dataUrl = "data:image/png;base64,SGVsbG8=";
  const raw = "SGVsbG8=";
  const a = await sha256Hex(dataUrl);
  const b = await sha256Hex(raw);
  assertEquals(a, b);
});

Deno.test("sha256Hex: bytes diferentes → hashes diferentes", async () => {
  const a = await sha256Hex(new Uint8Array([1, 2, 3]));
  const b = await sha256Hex(new Uint8Array([1, 2, 4]));
  assert(a !== b);
});
