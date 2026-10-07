// Utilitários do bot WhatsApp. Mantidos isolados para serem testáveis.

/** Extrai o primeiro objeto JSON balanceado de um texto livre da IA. */
export function extractJsonObject(text: string): any | null {
  if (!text || typeof text !== "string") return null;
  // tenta direto
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
  }
  // procura cercas markdown ```json ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fallthrough */ }
  }
  // varredura: encontra o primeiro `{` e busca o `}` que fecha (respeitando strings/escape)
  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== "{") continue;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1);
          try { return JSON.parse(candidate); } catch { break; }
        }
      }
    }
  }
  return null;
}

/** Saneia o resultado da IA, devolvendo um payload sempre válido (sem campos undefined). */
export function sanitizeAiResult(raw: any): {
  reply: string;
  is_receipt: boolean;
  is_rollover: boolean;
  is_promise: boolean;
  promise_date: string | null;
  receipt_value: number;
  receipt_date: string | null;
  needs_human: boolean;
  intent: string;
  summary: string;
  thought: string;
  memory_update: any;
} {
  const r = raw && typeof raw === "object" ? raw : {};
  const replyRaw = typeof r.reply === "string" ? r.reply : "";
  // remove markdown code-fences acidentais e limita
  const reply = replyRaw.replace(/```/g, "").trim().slice(0, 1500);
  const num = (v: any) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const dateOk = (s: any): string | null => {
    if (typeof s !== "string") return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  return {
    reply,
    is_receipt: Boolean(r.is_receipt),
    is_rollover: Boolean(r.is_rollover),
    is_promise: Boolean(r.is_promise),
    promise_date: dateOk(r.promise_date),
    receipt_value: num(r.receipt_value),
    receipt_date: dateOk(r.receipt_date),
    needs_human: Boolean(r.needs_human),
    intent: typeof r.intent === "string" ? r.intent.slice(0, 32) : "outro",
    summary: typeof r.summary === "string" ? r.summary.slice(0, 200) : "",
    thought: typeof r.thought === "string" ? r.thought.slice(0, 500) : "",
    memory_update: r.memory_update && typeof r.memory_update === "object" ? r.memory_update : null,
  };
}

/**
 * (Compat) — versão simples mantida para callers antigos.
 * Para produção use `validateReceipt`, que devolve um diagnóstico completo.
 */
export function shouldTrustReceipt(opts: {
  messageType: string;
  hasMedia: boolean;
  incomingText: string;
  receiptValue: number;
}): boolean {
  if (opts.receiptValue <= 0) return false;
  if (opts.hasMedia && (opts.messageType === "image" || opts.messageType === "document")) return true;
  const t = (opts.incomingText || "").toLowerCase();
  const KEYWORDS = ["paguei", "pago", "comprovante", "transferi", "depositei", "pix enviado", "feito o pix"];
  const hasKeyword = KEYWORDS.some(k => t.includes(k));
  const hasMoneySignal = /(r\$|reais|\d+,\d{2}|\d+\.\d{2})/.test(t);
  return hasKeyword && hasMoneySignal;
}

// ─── Validação avançada de comprovante ─────────────────────────────────────────

export interface InstallmentLike {
  id: string;
  amount: number | string;
  paid_amount?: number | string | null;
  due_date?: string;
  late_fee?: number | string | null;
  contract_id?: string;
  installment_number?: number;
}

export interface ReceiptValidationInput {
  messageType: string;          // "text" | "image" | "document" | "audio"
  hasMedia: boolean;
  incomingText: string;
  receiptValue: number;          // valor extraído pela IA
  receiptDate?: string | null;   // YYYY-MM-DD (opcional — vindo de OCR)
  installments: InstallmentLike[];
  todayStr: string;              // YYYY-MM-DD (hoje no fuso BR)
  mediaHash?: string | null;     // SHA-256 hex do binário (anti-reuso)
  seenHashes?: Set<string>;      // hashes já usados antes (audit_logs)
  tolerancePct?: number;         // default 2% (acomoda multa pequena)
  maxFutureDays?: number;        // default 1 (recibo não pode ser do futuro além de 1d)
  maxPastDays?: number;          // default 30 (recibo muito antigo é suspeito)
}

export interface ReceiptValidation {
  trusted: boolean;
  riskScore: number;          // 0 (limpo) – 100 (rejeição)
  reasons: string[];          // motivos legíveis (logs/auditoria)
  matchedInstallmentId?: string;
  matchType?: "exact" | "tolerance" | "sum_overdue" | "total" | "partial" | "none";
  duplicate?: boolean;
  suspiciousAmount?: boolean;
  outOfWindow?: boolean;
}

/** Resposta segura ao cliente depois da validação do comprovante. */
export function receiptOutcomeReply(opts: {
  isVerified: boolean;
  isTrusted: boolean;
  isDuplicate?: boolean;
  hasOpenBalance: boolean;
  originalReply?: string;
}): string {
  if (!opts.hasOpenBalance) {
    return "Recebi o comprovante, mas não encontrei parcela em aberto para realizar a baixa. Encaminhei para conferência da equipe.";
  }
  if (opts.isDuplicate) {
    return "Este comprovante já foi utilizado anteriormente. Não fiz uma nova baixa e encaminhei o caso para conferência da equipe.";
  }
  if (!opts.isVerified) {
    return "Recebi o comprovante, mas não consegui validar os dados com segurança. A cobrança foi pausada e a equipe fará a conferência.";
  }
  if (!opts.isTrusted) {
    return "Recebi o comprovante e ele está aguardando conferência da equipe. A baixa ainda não foi realizada.";
  }
  return (opts.originalReply || "Pagamento confirmado e baixa realizada com sucesso.").trim();
}

const FRAUD_HINTS = [
  "editado", "photoshop", "comprovante falso", "print antigo",
  "screenshot antigo", "ja paguei isso", "já paguei isso",
];

const STRONG_KEYWORDS = ["paguei", "comprovante", "transferi", "depositei", "pix enviado", "feito o pix"];

function num(v: any): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + "T12:00:00").getTime();
  const db = new Date(b + "T12:00:00").getTime();
  if (!isFinite(da) || !isFinite(db)) return 0;
  return Math.round((db - da) / 86_400_000);
}

/**
 * Validação completa de comprovante com pontuação de risco.
 *
 * Camadas:
 *  1. Evidência mínima (mídia OU texto com palavra-chave + R$).
 *  2. Sanidade de valor: precisa bater (com tolerância) com alguma parcela,
 *     soma dos atrasos ou total — senão é "suspicious_amount".
 *  3. Competência da data: rejeita data futura (> maxFutureDays) ou muito antiga
 *     (> maxPastDays). Padrão BR: hoje±1d a 30d.
 *  4. Anti-reuso: se o hash do arquivo já existe no histórico → rejeita.
 *  5. Detecção de tentativa de fraude por texto (FRAUD_HINTS).
 *
 * Decisão final: `trusted = riskScore < 50 && !duplicate && houver evidência`.
 */
export function validateReceipt(opts: ReceiptValidationInput): ReceiptValidation {
  const reasons: string[] = [];
  let risk = 0;

  const value = num(opts.receiptValue);
  if (value <= 0) {
    return { trusted: false, riskScore: 100, reasons: ["valor_zero_ou_negativo"], matchType: "none" };
  }

  const text = (opts.incomingText || "").toLowerCase();
  const hasMedia = opts.hasMedia && (opts.messageType === "image" || opts.messageType === "document");
  const hasKeyword = STRONG_KEYWORDS.some(k => text.includes(k));
  const hasMoneySignal = /(r\$|reais|\d+,\d{2}|\d+\.\d{2})/.test(text);

  // 1) Evidência mínima
  if (!hasMedia && !(hasKeyword && hasMoneySignal)) {
    return {
      trusted: false,
      riskScore: 80,
      reasons: ["sem_evidencia_minima"],
      matchType: "none",
    };
  }
  if (!hasMedia) {
    risk += 20;
    reasons.push("sem_midia_anexada");
  }

  // 2) Sanidade de valor
  const tolerance = (opts.tolerancePct ?? 2) / 100;
  const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, b * tolerance);
  const insts = (opts.installments || []).map(i => ({
    ...i,
    amt: Math.max(0, num(i.amount) + num(i.late_fee) - num(i.paid_amount)),
  }));

  let matchedInstallmentId: string | undefined;
  let matchType: ReceiptValidation["matchType"] = "none";

  // valor exato
  const exact = insts.filter(i => i.amt === value);
  if (exact.length) {
    if(exact.length===1)matchedInstallmentId = exact[0].id;
    else reasons.push('varias_parcelas_com_mesmo_valor');
    matchType = "exact";
  } else {
    // dentro da tolerância
    const tol = insts.filter(i => within(value, i.amt));
    if (tol.length) {
      if(tol.length===1)matchedInstallmentId = tol[0].id;
      else reasons.push('varias_parcelas_com_valor_proximo');
      matchType = "tolerance";
    } else {
      // soma de atrasos
      const totalOverdue = insts.reduce((s, i) => s + i.amt, 0);
      if (totalOverdue > 0 && within(value, totalOverdue)) {
        matchType = "sum_overdue";
      } else {
        // pagamento parcial (>= 30% da menor parcela e < menor parcela)
        const positiveBalances = insts.map(i => i.amt).filter(amount => amount > 0);
        const minAmt = positiveBalances.length ? Math.min(...positiveBalances) : 0;
        if (minAmt > 0 && value >= minAmt * 0.3 && value < minAmt) {
          matchType = "partial";
          risk += 15;
          reasons.push("pagamento_parcial");
        } else {
          // valor não bate com nada → suspeito
          risk += 40;
          reasons.push("valor_nao_corresponde_parcelas");
        }
      }
    }
  }

  // valor absurdamente alto (10× a maior parcela) ou ridículo (< R$ 1)
  const maxAmt = insts.length ? Math.max(...insts.map(i => i.amt)) : 0;
  if (value < 1) {
    risk += 30;
    reasons.push("valor_irrisorio");
  }
  if (maxAmt > 0 && value > maxAmt * 10) {
    risk += 35;
    reasons.push("valor_acima_do_razoavel");
  }

  // 3) Janela temporal
  const maxFuture = opts.maxFutureDays ?? 1;
  const maxPast = opts.maxPastDays ?? 30;
  let outOfWindow = false;
  if (opts.receiptDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.receiptDate)) {
    const delta = diffDays(opts.receiptDate, opts.todayStr); // dias entre recibo→hoje
    if (delta < -maxFuture) {
      risk += 40;
      reasons.push(`data_no_futuro:${-delta}d`);
      outOfWindow = true;
    } else if (delta > maxPast) {
      risk += 25;
      reasons.push(`data_muito_antiga:${delta}d`);
      outOfWindow = true;
    }
  }

  // 4) Anti-reuso (hash)
  let duplicate = false;
  if (opts.mediaHash && opts.seenHashes && opts.seenHashes.has(opts.mediaHash)) {
    duplicate = true;
    risk = 100;
    reasons.push("comprovante_ja_utilizado");
  }

  // 5) Indícios textuais de fraude
  if (FRAUD_HINTS.some(h => text.includes(h))) {
    risk += 30;
    reasons.push("palavras_de_alerta");
  }

  const suspiciousAmount = reasons.some(r => r.startsWith("valor_"));
  const trusted = !duplicate && risk < 50;

  return {
    trusted,
    riskScore: Math.min(100, risk),
    reasons,
    matchedInstallmentId,
    matchType,
    duplicate,
    suspiciousAmount,
    outOfWindow,
  };
}

/** SHA-256 em hex. Aceita string base64 ou Uint8Array — útil para hash do binário do comprovante. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    // base64 → bytes
    try {
      const bin = atob(input.replace(/^data:[^;]+;base64,/, ""));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      bytes = new TextEncoder().encode(input);
    }
  } else {
    bytes = input;
  }
  const hash = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Anti-eco: bloqueia envio de resposta idêntica à última feita ao mesmo JID em < TTL. */
export function isEchoOfLastReply(
  lastBotReply: Map<string, { text: string; ts: number }>,
  jid: string,
  text: string,
  ttlMs = 60_000,
): boolean {
  const last = lastBotReply.get(jid);
  if (!last) return false;
  if (Date.now() - last.ts > ttlMs) return false;
  return last.text.trim() === (text || "").trim();
}

/** Bloqueia a mesma resposta mesmo quando veio de outro isolate da Edge Function. */
export function isRecentDuplicateReply(
  previous: { content?: string | null; created_at?: string | null } | null | undefined,
  nextText: string,
  nowMs = Date.now(),
  ttlMs = 90_000,
): boolean {
  if (!previous?.content || !previous.created_at) return false;
  const previousAt = new Date(previous.created_at).getTime();
  if (!Number.isFinite(previousAt) || nowMs - previousAt < 0 || nowMs - previousAt > ttlMs) return false;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  return normalize(previous.content) === normalize(nextText || "");
}

/** Mantém respostas comuns em uma mensagem e só fatia textos realmente longos. */
export function splitWhatsAppText(text: string, maxLength = 3500): string[] {
  const clean = String(text || "").trim();
  if (!clean) return [];
  if (clean.length <= maxLength) return [clean];
  const chunks: string[] = [];
  let remaining = clean;
  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const paragraph = window.lastIndexOf("\n\n");
    const line = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    const cut = paragraph > maxLength * 0.55 ? paragraph
      : line > maxLength * 0.55 ? line
      : space > maxLength * 0.55 ? space
      : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Calcula valor de renovação (pagar só os juros) de forma estável.
 * Prioriza taxa explícita do contrato; cai pra (parcela - capital) só se taxa não existir.
 */
export function computeRolloverInterest(opts: {
  capital: number;
  interestRate: number; // % do contrato (ex: 20 = 20%)
  installmentAmount: number;
  numInstallments?: number;
}): number {
  const capital = Number(opts.capital) || 0;
  const rate = Number(opts.interestRate) || 0;
  const inst = Number(opts.installmentAmount) || 0;
  if (capital > 0 && rate > 0) {
    return +(capital * (rate / 100)).toFixed(2);
  }
  // fallback: parcela - amortização média
  const n = Math.max(1, Number(opts.numInstallments) || 1);
  const amort = capital / n;
  const diff = inst - amort;
  return diff > 0 ? +diff.toFixed(2) : +inst.toFixed(2);
}

/**
 * Valida e corrige a resposta do bot para garantir:
 *  1. Se mencionar PIX, a chave EXATA configurada aparece (e nenhuma outra chave).
 *  2. Todos os valores "R$ X,XX" citados existem na lista autorizada
 *     (parcelas reais, totais oficiais, juros de rollover).
 * Quando há discrepância, anexa um bloco "Dados oficiais" no final
 * com os valores corretos — nunca apaga o texto da IA.
 */
export interface PixReplyValidationInput {
  reply: string;
  pixKey?: string | null;
  pixKeyType?: string | null;
  installments: Array<{
    installment_number?: number;
    amount: number;
    late_fee?: number | null;
    contract_id?: string | null;
    due_date?: string;
  }>;
  overdue: Array<{ amount: number; late_fee?: number | null; contract_id?: string | null; installment_number?: number }>;
  dueToday: Array<{ amount: number; contract_id?: string | null; installment_number?: number }>;
  totalOverdue: number;
  totalDueToday: number;
  rolloverOptions: Array<{ interestOnly: number; contractId?: string }>;
}

export interface PixReplyValidationResult {
  reply: string;
  fixed: boolean;
  reasons: string[];
}

const PIX_KEY_LOOKS_LIKE = /\b(?:\d{11,14}|[\w.+-]+@[\w.-]+\.\w{2,}|\+?\d{10,14}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;
const MONEY_RE = /R\$\s*([0-9]{1,3}(?:[.\s][0-9]{3})*(?:,[0-9]{2})|[0-9]+(?:[.,][0-9]{1,2})?)/gi;

function parseMoney(s: string): number {
  const cleaned = s.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? +n.toFixed(2) : NaN;
}

function near(a: number, b: number) { return Math.abs(a - b) <= 0.02; }

export function validatePixReply(input: PixReplyValidationInput): PixReplyValidationResult {
  const reasons: string[] = [];
  let reply = input.reply || "";
  if (!reply.trim()) return { reply, fixed: false, reasons };

  const mentionsPix = /\bpix\b|\bchave\b/i.test(reply);
  const pixKey = (input.pixKey || "").trim();

  // 1. Validação da chave PIX
  if (mentionsPix && pixKey) {
    const hasCorrectKey = reply.includes(pixKey);
    if (!hasCorrectKey) {
      // procura "chaves" estranhas no texto e remove
      const suspicious = reply.match(PIX_KEY_LOOKS_LIKE) || [];
      const wrong = suspicious.filter(s => s !== pixKey && s.length >= 8);
      if (wrong.length) reasons.push(`pix_key_mismatch:${wrong.join(",").slice(0,80)}`);
      else reasons.push("pix_key_missing");
    }
  }

  // 2. Conjunto de valores permitidos (com tolerância)
  const allowed: number[] = [];
  const pushIf = (n: number) => { if (Number.isFinite(n) && n > 0) allowed.push(+n.toFixed(2)); };
  const overdueAmts: number[] = [];
  const dueTodayAmts: number[] = [];
  for (const i of input.installments || []) {
    pushIf(Number(i.amount));
    pushIf(Number(i.amount) + Number(i.late_fee || 0));
  }
  for (const i of input.overdue || []) {
    const v = Number(i.amount) + Number(i.late_fee || 0);
    pushIf(v);
    overdueAmts.push(+v.toFixed(2));
  }
  for (const i of input.dueToday || []) {
    pushIf(Number(i.amount));
    dueTodayAmts.push(+Number(i.amount).toFixed(2));
  }
  pushIf(input.totalOverdue);
  pushIf(input.totalDueToday);
  pushIf(input.totalOverdue + input.totalDueToday);
  for (const r of input.rolloverOptions || []) pushIf(Number(r.interestOnly));

  // Somas de subconjuntos (até 5 itens) — cliente pode negociar 2/3 parcelas
  const allAmts = [...overdueAmts, ...dueTodayAmts];
  const maxSubset = Math.min(allAmts.length, 5);
  const subsetSums = new Set<number>();
  const enumerate = (start: number, sum: number, depth: number) => {
    if (depth > 0) subsetSums.add(+sum.toFixed(2));
    if (depth >= maxSubset) return;
    for (let i = start; i < allAmts.length; i++) enumerate(i + 1, sum + allAmts[i], depth + 1);
  };
  if (allAmts.length && allAmts.length <= 8) enumerate(0, 0, 0);
  for (const s of subsetSums) pushIf(s);

  const moneyMatches = [...reply.matchAll(MONEY_RE)];
  const invented: string[] = [];
  for (const m of moneyMatches) {
    const v = parseMoney(m[1]);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!allowed.some(a => near(a, v))) invented.push(m[0]);
  }
  if (invented.length) reasons.push(`invented_values:${invented.slice(0,5).join("|")}`);

  // Se nada errado, retorna como está
  if (!reasons.length) return { reply, fixed: false, reasons };

  // 3. Anexa bloco oficial corrigido
  const lines: string[] = ["", "—", "✅ *Dados oficiais (confira):*"];
  if (pixKey) lines.push(`• PIX: *${pixKey}*${input.pixKeyType ? ` (${input.pixKeyType})` : ""}`);
  if (input.totalOverdue > 0) {
    lines.push(`• Em atraso: *R$ ${input.totalOverdue.toFixed(2)}* (${input.overdue.length} parcela${input.overdue.length === 1 ? "" : "s"})`);
    for (const i of input.overdue.slice(0, 6)) {
      const shortC = i.contract_id ? ` #${String(i.contract_id).slice(0,6)}` : "";
      const v = Number(i.amount) + Number(i.late_fee || 0);
      lines.push(`   – Parcela #${i.installment_number ?? "?"}${shortC}: R$ ${v.toFixed(2)}`);
    }
  }
  if (input.totalDueToday > 0) {
    lines.push(`• Vence hoje: *R$ ${input.totalDueToday.toFixed(2)}* (${input.dueToday.length} parcela${input.dueToday.length === 1 ? "" : "s"})`);
  }
  const totalNow = input.totalOverdue + input.totalDueToday;
  if (totalNow > 0) lines.push(`• Total para quitar agora: *R$ ${totalNow.toFixed(2)}*`);

  reply = reply.trimEnd() + "\n" + lines.join("\n");
  return { reply, fixed: true, reasons };
}

// ─── Inteligência comportamental ────────────────────────────────────────────
// Extrai um "raio-x" do cliente a partir do histórico de parcelas pagas +
// pendentes/atrasadas. Alimenta o prompt com sinais concretos (não achismo):
// pontualidade, atrasos médios, melhor dia da semana p/ cobrar, streak, etc.

export interface BehaviorInstallmentLike {
  amount: number | string;
  due_date?: string | null;
  paid_at?: string | null;
  paid_amount?: number | string | null;
  status?: string | null;
  installment_number?: number | null;
}

export interface ClientBehavior {
  onTimeStreak: number;          // pagamentos seguidos em dia (mais recentes)
  latePayments30d: number;       // pagamentos com atraso nos últimos 30 dias
  avgDaysLate: number;           // média de atraso (positivo = atraso)
  onTimePct: number;             // % dos últimos 20 pagamentos em dia
  bestPayDow: string | null;     // dia da semana com mais pagamentos
  bestPayHour: number | null;    // hora do dia mais comum de pagamento
  totalPaidVolume: number;       // R$ acumulados historicamente
  brokenPromisesLast30d: number; // promessas vencidas sem pagamento no período
  daysSinceLastPayment: number | null;
  perfil: "cumpridor" | "atrasa_pouco" | "atrasa_muito" | "novo" | "inadimplente";
  score0to100: number;           // sinal composto (0=risco alto, 100=perfeito)
}

const DOW_PT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function toDateSafe(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isFinite(d.getTime()) ? d : null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function computeClientBehavior(opts: {
  paidHistory: BehaviorInstallmentLike[];   // últimas parcelas pagas (mais recentes primeiro OU sem ordem)
  pending: BehaviorInstallmentLike[];       // pendentes/atrasadas atuais
  promises?: Array<{ promise_date?: string | null; created_at?: string | null }>;
  todayStr: string;                          // YYYY-MM-DD
}): ClientBehavior {
  const today = new Date(opts.todayStr + "T12:00:00");
  const paid = (opts.paidHistory || [])
    .map(p => ({
      due: toDateSafe(p.due_date || null),
      paidAt: toDateSafe(p.paid_at || null),
      amount: num(p.paid_amount ?? p.amount),
    }))
    .filter(p => p.paidAt)
    .sort((a, b) => (b.paidAt!.getTime()) - (a.paidAt!.getTime()));

  // Atraso por pagamento (dias)
  const daysLateList: number[] = [];
  const onTimeList: boolean[] = [];
  let latePayments30d = 0;
  for (const p of paid.slice(0, 20)) {
    if (!p.due) continue;
    const late = daysBetween(p.due, p.paidAt!);
    daysLateList.push(late);
    onTimeList.push(late <= 0);
    if (late > 0 && daysBetween(p.paidAt!, today) <= 30) latePayments30d++;
  }
  const avgDaysLate = daysLateList.length
    ? +(daysLateList.reduce((s, n) => s + Math.max(0, n), 0) / daysLateList.length).toFixed(1)
    : 0;
  const onTimePct = onTimeList.length
    ? Math.round((onTimeList.filter(Boolean).length / onTimeList.length) * 100)
    : 0;

  // Streak em dia (mais recentes)
  let onTimeStreak = 0;
  for (const inOrder of onTimeList) { if (inOrder) onTimeStreak++; else break; }

  // Dia da semana / hora mais comum de pagamento
  const dowCount = new Array(7).fill(0);
  const hourCount = new Array(24).fill(0);
  for (const p of paid.slice(0, 30)) {
    if (!p.paidAt) continue;
    dowCount[p.paidAt.getDay()]++;
    hourCount[p.paidAt.getHours()]++;
  }
  const bestPayDow = paid.length
    ? DOW_PT[dowCount.indexOf(Math.max(...dowCount))]
    : null;
  const bestPayHour = paid.length
    ? hourCount.indexOf(Math.max(...hourCount))
    : null;

  const totalPaidVolume = +(paid.reduce((s, p) => s + p.amount, 0)).toFixed(2);
  const daysSinceLastPayment = paid[0]?.paidAt ? daysBetween(paid[0].paidAt, today) : null;

  // Promessas quebradas (data prometida já passou sem pagamento no dia)
  let brokenPromisesLast30d = 0;
  for (const pr of opts.promises || []) {
    const pd = toDateSafe(pr.promise_date || null);
    if (!pd) continue;
    if (pd > today) continue; // ainda no futuro
    const days = daysBetween(pd, today);
    if (days > 30) continue;
    // Considera quebrada se não houve pagamento na janela ±1 dia
    const kept = paid.some(p => p.paidAt && Math.abs(daysBetween(pd, p.paidAt)) <= 1);
    if (!kept) brokenPromisesLast30d++;
  }

  // Perfil compostos
  const pendingCount = (opts.pending || []).length;
  let perfil: ClientBehavior["perfil"];
  if (paid.length === 0) perfil = "novo";
  else if (pendingCount > 0 && (latePayments30d >= 2 || brokenPromisesLast30d >= 2)) perfil = "inadimplente";
  else if (onTimePct >= 85) perfil = "cumpridor";
  else if (avgDaysLate <= 5) perfil = "atrasa_pouco";
  else perfil = "atrasa_muito";

  const score0to100 = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        onTimePct * 0.6 +
        Math.min(20, onTimeStreak * 2) +
        Math.max(0, 20 - avgDaysLate * 2) -
        brokenPromisesLast30d * 15,
      ),
    ),
  );

  return {
    onTimeStreak,
    latePayments30d,
    avgDaysLate,
    onTimePct,
    bestPayDow,
    bestPayHour,
    totalPaidVolume,
    brokenPromisesLast30d,
    daysSinceLastPayment,
    perfil,
    score0to100,
  };
}

/**
 * Detecta laço de resposta: se o bot está repetindo respostas semelhantes,
 * é sinal de que o modelo não está avançando a conversa — hora de escalar.
 * Retorna similarity 0..1 e um flag `loop` (>= 0.75 de similaridade entre
 * as últimas N respostas).
 */
export function detectResponseLoop(recentBotReplies: string[], threshold = 0.75): {
  loop: boolean;
  similarity: number;
} {
  const clean = (s: string) => (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúàãõâêîôûç ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const replies = recentBotReplies.map(clean).filter(Boolean).slice(-4);
  if (replies.length < 3) return { loop: false, similarity: 0 };

  const jaccard = (a: string, b: string) => {
    const A = new Set(a.split(" "));
    const B = new Set(b.split(" "));
    const inter = [...A].filter(x => B.has(x)).length;
    const uni = new Set([...A, ...B]).size;
    return uni ? inter / uni : 0;
  };
  const pairs: number[] = [];
  for (let i = 1; i < replies.length; i++) pairs.push(jaccard(replies[i - 1], replies[i]));
  const sim = pairs.length ? pairs.reduce((s, n) => s + n, 0) / pairs.length : 0;
  return { loop: sim >= threshold, similarity: +sim.toFixed(2) };
}

/**
 * Analisa a mensagem do cliente em busca de sinais de tom (heurístico rápido,
 * usado ANTES da IA para decidir escalonamento imediato e ajustar temperatura).
 */
export function detectClientTone(text: string): {
  hostile: boolean;
  frustrated: boolean;
  urgent: boolean;
  paying_intent: boolean;
  hardship: boolean;
} {
  const t = (text || "").toLowerCase();
  const hostile = /(vai (se |te |)f[uo]d|caralh|porra|merda|otari|desgra|golpe|golpist|processar|advogad|procon|reclame aqui|xingar|palhaç|idiota|imbecil|ladr[aã]o)/i.test(t);
  const frustrated = /(cansei|chateado|desisto|nunca mais|absurd|ridiculo|rid[íi]culo|não aguento|nao aguento|ta demais|tá demais|revoltad|indignad)/i.test(t);
  const urgent = /(urgente|agora mesmo|hoje mesmo|imediat|preciso muito|socorro|por favor rapid)/i.test(t);
  const paying_intent = /(vou pagar|vou fazer o pix|acabei de pagar|paguei agora|acabo de|manda o pix|me passa o pix|chave pix|quitar|quitação|regulariz)/i.test(t);
  const hardship = /(desempregad|sem trabalho|desempreg|sem dinheiro|dif[íi]cil|mal to comendo|n[ãa]o tenho como|pai doente|m[ãa]e doente|filho doente|doente|internad|acident|falec|morreu|luto|separei|divorci|corte de luz|despej)/i.test(t);
  return { hostile, frustrated, urgent, paying_intent, hardship };
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDRAIL DE PRECISÃO — pré-envio (assertReplySafe)
// Última linha de defesa antes de mandar QUALQUER mensagem para o cliente.
// Bloqueia (block=true) quando detecta violação dura:
//   • Vazamento: reply cita nome/CPF de OUTRO cliente do mesmo credor.
//   • Negociação: reply fala em desconto/abatimento/parcelar dívida/perdoar juros.
//   • Datas inventadas (soft): cita "dia XX/XX" que não bate com nenhuma parcela.
//   • Identidade não confirmada: reply cita valores ANTES de confirmar identidade.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReplyGuardrailInput {
  reply: string;
  currentClient: { id: string; name?: string | null; cpf_cnpj?: string | null } | null;
  otherClientsSample?: Array<{ id: string; name?: string | null; cpf_cnpj?: string | null }>;
  allowedDueDates?: string[];
  allowedAmounts?: number[]; // valores permitidos em reais (parcelas, totais, somas)
  amountToleranceCents?: number; // default 5 centavos
  identityConfirmed?: boolean;
  hasMoney?: boolean;
}

export interface ReplyGuardrailResult {
  block: boolean;
  reasons: string[];
  softHits: string[];
}

const NEGOTIATION_RE = /\b(desconto|abatimento|abater|parcelar (a )?d[ií]vida|perdoar? (os )?juros|reduzir (o )?valor|acordo especial)/i;
const DATE_BR_RE = /\b([0-3]?\d)[\/\-]([01]?\d)(?:[\/\-](\d{2,4}))?\b/g;
// Captura "R$ 1.234,56" | "R$ 350,00" | "R$ 350" | "R$1234.56"
const MONEY_RE_GUARD = /R\$\s*([\d\.]+(?:,\d{1,2})?|\d+(?:\.\d{1,2}))/gi;

function firstNameOf(full: string): string {
  return String(full || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
}

function parseBRLToCents(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/,/.test(s)) {
    const norm = s.replace(/\./g, "").replace(",", ".");
    const n = Number(norm);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  if (/^\d+\.\d{1,2}$/.test(s)) {
    return Math.round(Number(s) * 100);
  }
  const n = Number(s.replace(/\./g, ""));
  return Number.isFinite(n) ? n * 100 : null;
}

export function assertReplySafe(input: ReplyGuardrailInput): ReplyGuardrailResult {
  const reasons: string[] = [];
  const softHits: string[] = [];
  const reply = String(input.reply || "");
  if (!reply.trim()) return { block: false, reasons, softHits };
  const low = reply.toLowerCase();

  const meFirst = firstNameOf(input.currentClient?.name || "");
  const meCpf = String(input.currentClient?.cpf_cnpj || "").replace(/\D/g, "");
  for (const other of input.otherClientsSample || []) {
    if (!other?.id || other.id === input.currentClient?.id) continue;
    const oFirst = firstNameOf(other.name || "");
    if (oFirst && oFirst !== meFirst && oFirst.length >= 4) {
      const re = new RegExp(`\\b${oFirst.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(low)) reasons.push(`leak_name:${oFirst}`);
    }
    const oCpf = String(other.cpf_cnpj || "").replace(/\D/g, "");
    if (oCpf.length >= 11 && oCpf !== meCpf && reply.replace(/\D/g, "").includes(oCpf)) {
      reasons.push(`leak_cpf:${oCpf.slice(-4)}`);
    }
  }

  if (NEGOTIATION_RE.test(low)) reasons.push("negotiation_offered");

  if (input.allowedDueDates && input.allowedDueDates.length) {
    const allowedSet = new Set<string>();
    for (const iso of input.allowedDueDates) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
      if (m) allowedSet.add(`${Number(m[3])}/${Number(m[2])}`);
    }
    if (allowedSet.size) {
      const cited: string[] = [];
      for (const m of reply.matchAll(DATE_BR_RE)) {
        cited.push(`${Number(m[1])}/${Number(m[2])}`);
      }
      const bad = cited.filter((k) => !allowedSet.has(k));
      if (bad.length) softHits.push(`unknown_date:${bad.slice(0, 3).join(",")}`);
    }
  }

  if (input.identityConfirmed === false && input.hasMoney) {
    reasons.push("value_before_identity");
  }

  // Valores permitidos — qualquer R$ citado precisa estar no conjunto (tolerância padrão 5¢).
  if (input.allowedAmounts && input.allowedAmounts.length) {
    const tol = Math.max(0, Number(input.amountToleranceCents ?? 5));
    const allowedCents = input.allowedAmounts
      .map((v) => Math.round(Number(v) * 100))
      .filter((v) => Number.isFinite(v) && v > 0);
    const invented: string[] = [];
    for (const m of reply.matchAll(MONEY_RE_GUARD)) {
      const cents = parseBRLToCents(m[1]);
      if (cents == null || cents <= 0) continue;
      const ok = allowedCents.some((a) => Math.abs(a - cents) <= tol);
      if (!ok) invented.push(m[0]);
    }
    if (invented.length) reasons.push(`invented_amount:${invented.slice(0, 3).join("|")}`);
  }

  return { block: reasons.length > 0, reasons, softHits };
}


