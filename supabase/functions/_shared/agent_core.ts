// Núcleo do agente de atendimento — v2
// Responsabilidades:
//  1) Identificação ESTRITA do cliente por telefone (com desambiguação por CPF).
//  2) Seleção correta de parcelas realmente em atraso (com saldo > 0).
//  3) Log auditável de cada decisão em `bot_actions_log`.

import { botRows } from "./bot_data.ts";
import { activeDebt, botBalance, botLateFee } from "./bot_finance.ts";

export type IdentifyResult =
  | { status: "unique"; client: any; matchType: "conversation" | "phone_strict" | "cpf" }
  | { status: "ambiguous"; candidates: any[] }
  | { status: "none" };

const DIGITS = /\D+/g;

/** Normaliza um telefone brasileiro para 13 dígitos: 55 + DDD(2) + 9 + 8 dígitos. */
export function normalizePhoneBR(raw: string): {
  digits: string;   // apenas dígitos, sem trato
  e164: string;     // 13 dígitos (55DDXXXXXXXXX) quando possível
  ddd: string | null;
  local8: string | null; // últimos 8 dígitos (sem o 9 opcional)
} {
  const d = String(raw || "").replace(DIGITS, "");
  if (!d) return { digits: "", e164: "", ddd: null, local8: null };

  // Remove código do país 55 se presente
  let rest = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;

  // DDD = primeiros 2 dígitos
  const ddd = rest.length >= 10 ? rest.slice(0, 2) : null;
  let local = ddd ? rest.slice(2) : rest;

  // local pode ter 8 (fixo antigo) ou 9 (celular com 9 na frente)
  let local8: string | null = null;
  let normLocal = local;
  if (local.length === 9 && local.startsWith("9")) {
    local8 = local.slice(1); // últimos 8 sem o 9
    normLocal = "9" + local8;
  } else if (local.length === 8) {
    local8 = local;
    // Para celular, o padrão E.164 exige o 9 na frente. Mantemos com 9.
    normLocal = "9" + local8;
  } else if (local.length > 9) {
    // Ex: número já veio com 9 e um dígito extra — pega os últimos 9
    normLocal = local.slice(-9);
    local8 = normLocal.startsWith("9") ? normLocal.slice(1) : normLocal.slice(-8);
  } else {
    local8 = local.slice(-8);
  }

  const e164 = ddd ? `55${ddd}${normLocal}` : "";
  return { digits: d, e164, ddd, local8 };
}

/** Retorna true se dois telefones referem-se ao MESMO número (BR-aware). */
export function samePhoneBR(a: string, b: string): boolean {
  const A = normalizePhoneBR(a);
  const B = normalizePhoneBR(b);
  if (!A.digits || !B.digits) return false;
  // E.164 idêntico é match forte
  if (A.e164 && B.e164 && A.e164 === B.e164) return true;
  // Fallback: mesmo DDD + mesmos 8 dígitos finais
  if (A.ddd && B.ddd && A.ddd === B.ddd && A.local8 && A.local8 === B.local8) return true;
  return false;
}

/** Extrai CPF (11 dígitos) de um texto livre, se presente. */
export function extractCPF(text: string): string | null {
  const digits = String(text || "").replace(DIGITS, "");
  // Procura sequências de 11 dígitos
  const match = digits.match(/\d{11}/);
  return match ? match[0] : null;
}

/**
 * Identifica o cliente com regras estritas.
 *  - Se a conversa já tem client_id → confia (foi resolvida antes).
 *  - Caso contrário, aplica samePhoneBR contra todos os clientes do dono.
 *  - Se houver 1 candidato único → resolve.
 *  - Se houver mais de 1 → status "ambiguous" (bot deve pedir CPF).
 *  - Se o texto atual contém CPF válido de um dos candidatos → resolve.
 */
export async function identifyClient(
  supabase: any,
  params: {
    userId: string;
    senderPhone: string;
    incomingText?: string;
    preboundClient?: any | null; // client_id já vinculado na conversa
  },
): Promise<IdentifyResult> {
  if (params.preboundClient?.user_id === params.userId &&
    (samePhoneBR(params.senderPhone, params.preboundClient.whatsapp || "") || samePhoneBR(params.senderPhone, params.preboundClient.phone || ""))) {
    return { status: "unique", client: params.preboundClient, matchType: "conversation" };
  }

  const { data: clients, error } = await supabase.rpc("system_find_clients_by_phone", {
    _user_id: params.userId, _phone: params.senderPhone,
  });
  if (error || !Array.isArray(clients)) throw new Error("client_lookup_unavailable");

  const candidates = (clients || []).filter((c: any) => {
    return samePhoneBR(params.senderPhone, c.whatsapp || "") ||
           samePhoneBR(params.senderPhone, c.phone || "");
  });

  if (candidates.length === 0) return { status: "none" };
  if (candidates.length === 1) {
    return { status: "unique", client: candidates[0], matchType: "phone_strict" };
  }

  // Ambíguo: tenta resolver por CPF no texto
  const cpf = extractCPF(params.incomingText || "");
  if (cpf) {
    const byCpf = candidates.find((c: any) =>
      String(c.cpf_cnpj || "").replace(DIGITS, "") === cpf
    );
    if (byCpf) return { status: "unique", client: byCpf, matchType: "cpf" };
  }

  return { status: "ambiguous", candidates };
}

/** Data de hoje no fuso America/Sao_Paulo em formato YYYY-MM-DD. */
export function todayInSP(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

export type InstallmentRow = {
  id: string;
  contract_id: string | null;
  installment_number: number;
  amount: number;
  paid_amount: number | null;
  late_fee: number | null;
  due_date: string;
  status: string;
};

export type OverdueBucket = {
  overdue: InstallmentRow[];      // vencidas de fato (due_date < hoje) e com saldo > 0
  dueToday: InstallmentRow[];     // vencem hoje e com saldo > 0
  future: InstallmentRow[];       // ainda vão vencer
  totalOverdue: number;           // soma amount+late_fee - paid_amount para "overdue"
  totalDueToday: number;
  hasPromise?: boolean;
};

/** Corta uma data ISO ou date-only em YYYY-MM-DD. */
function ymd(v: any): string {
  if (!v) return "";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/**
 * Retorna parcelas REAIS em atraso do cliente.
 * Regra oficial: (status != 'paid') AND (amount - COALESCE(paid_amount,0) > 0) AND due_date < hoje.
 * `dueToday` são as que vencem hoje (não em atraso ainda).
 */
export async function loadClientInstallments(
  supabase: any,
  clientId: string,
  today: string = todayInSP(),
  ownerId: string,
): Promise<OverdueBucket> {
  if (!ownerId) throw new Error("owner_required");
  const data = await botRows(() => supabase
    .from("contract_installments")
    .select("id, contract_id, installment_number, amount, paid_amount, late_fee, due_date, status, pre_settlement_snapshot, contracts:contract_id(status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent)")
    .eq("client_id", clientId)
    .eq("user_id", ownerId)
    .not("status", "in", '("paid","cancelled")')
    .order("due_date", { ascending: true }).order("id"));

  const rows: InstallmentRow[] = (data || [])
    .filter(activeDebt)
    .map((r: any): InstallmentRow => ({
      id: r.id,
      contract_id: r.contract_id,
      installment_number: Number(r.installment_number) || 0,
      amount: Number(r.amount) || 0,
      paid_amount: Number(r.paid_amount) || 0,
      late_fee: botLateFee(r),
      due_date: ymd(r.due_date),
      status: String(r.status || ""),
    }))
    // Saldo > 0 (proteção contra parcelas quitadas mas com status errado)
    .filter((r: InstallmentRow) => botBalance(r) >= 0.01);

  const overdue = rows.filter((r) => r.due_date < today);
  const dueToday = rows.filter((r) => r.due_date === today);
  const future = rows.filter((r) => r.due_date > today);

  const totalOverdue = overdue.reduce(
    (s, r) => s + botBalance(r),
    0,
  );
  const totalDueToday = dueToday.reduce(
    (s, r) => s + botBalance(r),
    0,
  );

  return { overdue, dueToday, future, totalOverdue, totalDueToday };
}

/** Grava uma decisão do agente para auditoria. Nunca lança. */
export async function auditDecision(
  supabase: any,
  params: {
    userId: string;
    conversationId?: string | null;
    clientId?: string | null;
    intent: string;                 // ex: "menu_choice_1", "ambiguous_client", "sent_overdue_summary"
    outcome: "ok" | "blocked" | "fallback" | "error";
    details?: Record<string, any>;
  },
): Promise<void> {
  try {
    // Esta tabela não tem `entity_type`, `action`, `entity_id` nem `details` —
    // esses são os campos de `audit_logs`. Com eles no payload, TODO registro do
    // agente era recusado: a tela de auditoria do bot ficava vazia mesmo com o
    // bot trabalhando, e não havia como investigar reclamação de cliente.
    await supabase.from("bot_actions_log").insert({
      user_id: params.userId,
      client_id: params.clientId ?? null,
      conversation_id: params.conversationId ?? null,
      tool_name: params.intent,
      success: params.outcome === "ok",
      error_message: params.outcome === "error" ? (params.details?.error || "error") : null,
      tool_input: { origem: "whatsapp_agent_v2", outcome: params.outcome },
      tool_output: { ...(params.details || {}) },
    });
  } catch (_e) {
    // silencioso — auditoria nunca deve derrubar o agente
  }
}
