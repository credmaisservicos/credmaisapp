// Utilitários de merge da memória do bot WhatsApp.
// Garante:
//  - Sem corrupção (entradas inválidas são descartadas, não quebram o objeto).
//  - Dedup case-insensitive (strings) ou por JSON canônico (objetos).
//  - Prioriza informações MAIS RECENTES (novas entradas substituem versões antigas
//    e ficam no topo da lista).
//  - Limite por seção (default 20) preservando as mais recentes.
//  - Serialização final respeitando MAX_BYTES (default 6000) sem produzir JSON inválido.

export const SECTION_LIMIT = 20;
export const MAX_BYTES = 6000;

export const MEMORY_SECTIONS = [
  "fatos",
  "preferencias",
  "motivos_atraso",
  "contatos_alternativos",
  "promessas",
  // Intenções recentes do cliente — cada item é um objeto:
  // { tipo, data, detalhe?, abordagem?, canal?, resultado? }
  // Usado para personalizar o PRÓXIMO envio (evitar repetir abordagem).
  "intencoes",
] as const;

export type MemorySection = typeof MEMORY_SECTIONS[number];

// Estado gravado pelo fluxo determinístico. Atualizações da IA não o alteram.
function flowState(raw: any): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  const strings = ['service_menu_stage','last_menu_choice','loan_profile','request_kind','pending_payment_kind','pending_payment_installment_id','pending_payment_set_at','installment_choice_set_at','payment_promise_cancelled_at','resumed_at'];
  const numbers = ['last_menu_at','human_reason_asked_at','pending_payment_amount','clarification_count'];
  for (const key of strings) if (typeof raw?.[key] === 'string' && raw[key].length <= 150) state[key] = raw[key];
  for (const key of numbers) if (typeof raw?.[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0) state[key] = raw[key];
  if (typeof raw?.service_menu_started === 'boolean') state.service_menu_started = raw.service_menu_started;
  if(Array.isArray(raw?.installment_choice_ids))state.installment_choice_ids=[...new Set(raw.installment_choice_ids.filter((id:unknown)=>typeof id==='string'&&id.length>0&&id.length<=150))].slice(0,10);
  for (const key of ['loan_documents_received','loan_documents_missing','loan_document_validations']) {
    if (Array.isArray(raw?.[key])) state[key] = dedupArr([],raw[key],SECTION_LIMIT);
  }
  return state;
}

export interface BotMemory {
  fatos: any[];
  preferencias: any[];
  motivos_atraso: any[];
  contatos_alternativos: any[];
  promessas: any[];
  ultima_interacao?: string;
  notas_legadas?: string;
  [k: string]: any;
}

function canonicalKey(x: any): string | null {
  if (x === null || x === undefined) return null;
  if (typeof x === "string") {
    const t = x.trim().toLowerCase();
    return t.length ? t : null;
  }
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (typeof x === "object") {
    try {
      const keys = Object.keys(x).sort();
      const norm: Record<string, any> = {};
      for (const k of keys) norm[k] = x[k];
      const s = JSON.stringify(norm);
      return s && s !== "{}" ? s.toLowerCase() : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Faz merge de duas listas priorizando as MAIS RECENTES (`incoming`).
 * - Itens inválidos (null/undefined/strings vazias) são descartados.
 * - Dedup case-insensitive; em caso de duplicata a versão NOVA vence.
 * - Resultado é cortado em `limit`, mantendo os mais recentes.
 */
export function dedupArr(
  existing: any[] = [],
  incoming: any[] = [],
  limit = SECTION_LIMIT,
): any[] {
  const safeExisting = Array.isArray(existing) ? existing : [];
  const safeIncoming = Array.isArray(incoming) ? incoming : [];
  // newest-first: incoming antes de existing
  const ordered = [...safeIncoming, ...safeExisting];
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of ordered) {
    const k = canonicalKey(item);
    if (k === null) continue; // inválido → descarta
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Faz o parse defensivo do bot_memory bruto vindo do banco. */
export function parseMemory(raw: unknown): BotMemory {
  const base: BotMemory = {
    fatos: [],
    preferencias: [],
    motivos_atraso: [],
    contatos_alternativos: [],
    promessas: [],
    intencoes: [],
  };
  if (!raw) return base;
  const s = String(raw);
  if (!s.trim().startsWith("{")) {
    return { ...base, notas_legadas: s.slice(0, 1500) };
  }
  try {
    const parsed = JSON.parse(s);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
    for (const sec of MEMORY_SECTIONS) {
      base[sec] = Array.isArray(parsed[sec]) ? parsed[sec] : [];
    }
    if (typeof parsed.ultima_interacao === "string") base.ultima_interacao = parsed.ultima_interacao;
    if (typeof parsed.notas_legadas === "string") base.notas_legadas = parsed.notas_legadas.slice(0, 1500);
    Object.assign(base, flowState(parsed));
    return base;
  } catch {
    return { ...base, notas_legadas: s.slice(0, 1500) };
  }
}

/**
 * Faz merge da memória existente com `update` retornado pela IA.
 * Sempre prioriza dados novos; nunca corrompe; sempre devolve um objeto válido.
 */
export function mergeMemory(
  existing: BotMemory,
  update: any,
  todayStr: string,
  limit = SECTION_LIMIT,
): BotMemory {
  const safeUpdate = update && typeof update === "object" && !Array.isArray(update) ? update : {};
  const merged: BotMemory = {
    ...flowState(existing),
    fatos: dedupArr(existing.fatos, safeUpdate.fatos, limit),
    preferencias: dedupArr(existing.preferencias, safeUpdate.preferencias, limit),
    motivos_atraso: dedupArr(existing.motivos_atraso, safeUpdate.motivos_atraso, limit),
    contatos_alternativos: dedupArr(existing.contatos_alternativos, safeUpdate.contatos_alternativos, limit),
    promessas: dedupArr(existing.promessas, safeUpdate.promessas, limit),
    // intenções: janela menor (12) — só interessa o passado recente
    intencoes: dedupArr(existing.intencoes, safeUpdate.intencoes, Math.min(limit, 12)),
    ultima_interacao:
      (typeof safeUpdate.ultima_interacao === "string" && safeUpdate.ultima_interacao) ||
      todayStr ||
      existing.ultima_interacao,
  };
  if (existing.notas_legadas) merged.notas_legadas = existing.notas_legadas;
  return merged;
}

/**
 * Serializa garantindo que JSON.parse(serializeMemory(m)) === objeto válido.
 * Se exceder MAX_BYTES, vai cortando das seções mais ruidosas (mantendo as recentes).
 */
export function serializeMemory(memory: BotMemory, maxBytes = MAX_BYTES): string {
  let attempt = { ...memory };
  let serialized = JSON.stringify(attempt);
  if (serialized.length <= maxBytes) return serialized;

  // Estratégia: encurta seções progressivamente (mantém topo = mais recentes).
  const order: MemorySection[] = [
    "contatos_alternativos",
    "motivos_atraso",
    "preferencias",
    "fatos",
    "promessas",
    "intencoes",
  ];
  for (let cap = SECTION_LIMIT - 1; cap >= 1; cap--) {
    for (const sec of order) {
      attempt = { ...attempt, [sec]: (attempt[sec] || []).slice(0, cap) };
      serialized = JSON.stringify(attempt);
      if (serialized.length <= maxBytes) return serialized;
    }
    if (Array.isArray(attempt.loan_document_validations)) {
      attempt = { ...attempt, loan_document_validations: attempt.loan_document_validations.slice(-cap) };
      serialized = JSON.stringify(attempt);
      if (serialized.length <= maxBytes) return serialized;
    }
  }
  // Último recurso: derruba notas_legadas.
  delete attempt.notas_legadas;
  serialized = JSON.stringify(attempt);
  if (serialized.length <= maxBytes) return serialized;
  // Garantia final: trunca de forma segura mantendo JSON válido.
  return JSON.stringify({
    ...Object.fromEntries(Object.entries(flowState(memory)).filter(([key]) => key !== 'loan_document_validations')),
    fatos: [],
    preferencias: [],
    motivos_atraso: [],
    contatos_alternativos: [],
    promessas: [],
    intencoes: [],
    ultima_interacao: memory.ultima_interacao,
  });
}

// ─── Intenções por cliente ────────────────────────────────────────────
// Tipos canônicos usados para personalizar o próximo envio:
//   "prometeu_pagar"       — cliente prometeu pagar em data X
//   "pediu_desconto"       — cliente pediu abatimento/negociação
//   "dificuldade"          — sinalizou hardship (desemprego, doença…)
//   "abriu_portal"         — acessou o portal do cliente
//   "pediu_prazo"          — pediu extensão de vencimento
//   "hostil"               — mensagem agressiva
//   "silencio"             — não respondeu ao último envio
//   "quitou_parcial"       — pagou parte
//   "renovacao"            — pediu para renovar o contrato
export type IntentType =
  | "prometeu_pagar" | "pediu_desconto" | "dificuldade" | "abriu_portal"
  | "pediu_prazo" | "hostil" | "silencio" | "quitou_parcial" | "renovacao";

export interface IntentEntry {
  tipo: IntentType;
  data: string;          // YYYY-MM-DD
  detalhe?: string;      // curta descrição opcional
  abordagem?: string;    // rótulo curto da abordagem enviada (ex: "lembrete_amigavel", "acordo_15off")
  canal?: "whatsapp" | "email" | "portal";
}

/** Adiciona uma intenção nova ao topo da lista (mais recente primeiro). */
export function pushIntent(mem: BotMemory, entry: IntentEntry, limit = 12): BotMemory {
  const list = Array.isArray(mem.intencoes) ? mem.intencoes : [];
  // Dedupe por tipo+data (evita spam de eventos idênticos no mesmo dia)
  const filtered = list.filter((x: any) => !(x && x.tipo === entry.tipo && x.data === entry.data));
  return { ...mem, intencoes: [entry, ...filtered].slice(0, limit) };
}

/** Resumo textual das intenções recentes — para injetar em prompts. */
export function summarizeIntents(mem: BotMemory, maxItems = 6): string {
  const list = (Array.isArray(mem.intencoes) ? mem.intencoes : []).slice(0, maxItems);
  if (!list.length) return "";
  return list
    .map((i: any) => {
      const parts = [i.tipo, i.data].filter(Boolean).join(" ");
      const extra = [i.abordagem && `abordagem=${i.abordagem}`, i.detalhe].filter(Boolean).join(", ");
      return `- ${parts}${extra ? ` (${extra})` : ""}`;
    })
    .join("\n");
}

/** Última abordagem usada — para o cron variar o próximo disparo. */
export function lastApproach(mem: BotMemory): string | null {
  const list = Array.isArray(mem.intencoes) ? mem.intencoes : [];
  for (const i of list) if (i && typeof i.abordagem === "string" && i.abordagem) return i.abordagem;
  return null;
}

