import {requestsHumanNegotiation, HUMAN_NEGOTIATION_REPLY} from './human_negotiation.ts';
// SDR (Sales Development Representative) — Agente completo de qualificação
// de leads via WhatsApp. Combina uma máquina de estados determinística
// (para não perder contexto entre mensagens) com uma camada de IA opcional
// para dar naturalidade e entender pedidos fora do script.
//
// Fluxo:
//   new         -> saudação + pergunta o nome
//   qualifying  -> coleta valor -> finalidade -> renda -> CPF -> email
//   simulated   -> estágio legado encaminhado para humano
//   handoff     -> avisa humano; needs_human = true
//   lost        -> lead pediu para parar / desqualificou
//
// A tabela `leads` guarda o estado por (user_id, phone).

import { callAnthropic, hasAIProvider } from "./anthropic.ts";

export interface Lead {
  id?: string;
  user_id: string;
  phone: string;
  name?: string | null;
  cpf?: string | null;
  email?: string | null;
  amount_requested?: number | null;
  income_monthly?: number | null;
  purpose?: string | null;
  term_months?: number | null;
  stage: LeadStage;
  score: number;
  tags: string[];
  notes: Record<string, any>;
  ai_summary?: string | null;
  last_message_at?: string | null;
  next_followup_at?: string | null;
}

export type LeadStage =
  | "new"
  | "qualifying"
  | "simulated"
  | "awaiting_docs"
  | "handoff"
  | "won"
  | "lost";

/* ─────────────── Documentos exigidos pós-aceite ─────────────── */
export const REQUIRED_DOCS: Array<{ key: string; label: string }> = [
  { key: "rg_frente", label: "RG (frente)" },
  { key: "rg_verso", label: "RG (verso)" },
  { key: "selfie", label: "Selfie segurando o RG" },
  { key: "comprovante_renda", label: "Comprovante de renda" },
  { key: "comprovante_residencia", label: "Comprovante de residência" },
];

export function nextPendingDoc(lead: Lead): { key: string; label: string } | null {
  const notes: any = lead.notes || {};
  const received: string[] = Array.isArray(notes?.docs?.received) ? notes.docs.received : [];
  return REQUIRED_DOCS.find(d => !received.includes(d.key)) || null;
}

export function portalUrl(): string {
  const base = (Deno.env.get("SITE_URL") || "").replace(/\/$/, "");
  return base ? `${base}/portal-cliente` : "";
}


/* ─────────────── Parsers determinísticos ─────────────── */

export function parseCPF(text: string): string | null {
  const digits = (text.match(/\d/g) || []).join("");
  const m = digits.match(/(\d{11})/);
  if (!m) return null;
  // valida dígito verificador
  const cpf = m[1];
  if (/^(\d)\1{10}$/.test(cpf)) return null;
  const calc = (base: string, factor: number) => {
    let s = 0;
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (factor - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]) ? cpf : null;
}

export function parseEmail(text: string): string | null {
  const m = (text || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Extrai valor em reais. Aceita "5000", "5 mil", "5.000,00", "R$ 3k", "10k".
 */
export function parseMoney(text: string): number | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/r\$\s*/g, "");
  // "5 mil", "10 mil reais"
  const mil = t.match(/(\d+[.,]?\d*)\s*mil/);
  if (mil) return Math.round(parseFloat(mil[1].replace(",", ".")) * 1000);
  // "5k", "10k"
  const k = t.match(/(\d+[.,]?\d*)\s*k\b/);
  if (k) return Math.round(parseFloat(k[1].replace(",", ".")) * 1000);
  // valores como 5.000,00 / 5000 / 5000,50
  const br = t.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/);
  if (br) {
    const raw = br[1].replace(/\./g, "").replace(",", ".");
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 50) return Math.round(n * 100) / 100;
  }
  // dígitos puros
  const num = t.match(/\b(\d{3,7})\b/);
  if (num) return Number(num[1]);
  return null;
}

// Palavras que NÃO podem virar "nome" mesmo se casarem o formato alfabético.
const NAME_STOP = new Set([
  "oi","ola","olá","opa","hey","hi","hello","alo","alô",
  "bom","boa","dia","tarde","noite","madrugada",
  "tudo","bem","bom","boa","como","vai","voce","você","vc",
  "sim","nao","não","ok","beleza","blz","valeu","obrigado","obrigada","obg","vlw",
  "quero","preciso","gostaria","queria","gostava",
  "emprestimo","empréstimo","dinheiro","credito","crédito","grana","valor",
  "info","informacao","informação","informacoes","informações","duvida","dúvida",
  "atendente","humano","pessoa","consultor","gerente","dono","responsavel","responsável",
  "por","favor","obrigado","obrigada","boa","tarde","urgente","agora",
]);

function looksLikeGreeting(text: string): boolean {
  const toks = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
  if (!toks.length) return false;
  const stopHits = toks.filter(t => NAME_STOP.has(t)).length;
  // Se metade ou mais dos tokens são stop-words de saudação/intent, NÃO é nome.
  return stopHits >= Math.ceil(toks.length / 2);
}

export function parseName(text: string, pushName?: string): string | null {
  const t = (text || "").trim();
  // Padrão explícito "meu nome é ..."
  const m1 = t.match(/(?:meu nome (?:é|eh)|me chamo|sou (?:o|a)?|aqui (?:é|eh) (?:o|a)?)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,60})/i);
  if (m1) {
    const cand = m1[1].trim();
    if (!looksLikeGreeting(cand)) return capitalizeName(cand);
  }
  // Só aceita mensagem inteira como nome quando NÃO parece saudação/intent
  // e tem 2+ palavras alfabéticas puras.
  if (
    t.length <= 60 &&
    /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,60}$/.test(t) &&
    t.split(/\s+/).length >= 2 &&
    !looksLikeGreeting(t)
  ) {
    return capitalizeName(t);
  }
  if (pushName && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]{2,60}$/.test(pushName) && !looksLikeGreeting(pushName)) {
    return capitalizeName(pushName);
  }
  return null;
}

function capitalizeName(n: string) {
  return n
    .toLowerCase()
    .split(/\s+/)
    .map(w => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

const PURPOSE_KEYWORDS: Array<[RegExp, string]> = [
  [/quita(r|ção)|paga(r|mento)\s*(de\s*)?d[ií]vida|nome\s*(sujo|limpo)|serasa|spc/i, "Quitar dívidas"],
  [/reforma|obra|constru|casa|im[oó]vel/i, "Reforma / imóvel"],
  [/carro|moto|ve[ií]culo|autom[oó]vel/i, "Veículo"],
  [/neg[oó]cio|empresa|com[eé]rcio|capital de giro|estoque|mercadoria/i, "Capital de giro"],
  [/emerg[eê]ncia|urg[eê]ncia|hospital|sa[uú]de|rem[eé]dio/i, "Emergência / saúde"],
  [/estudo|faculdade|curso|escola/i, "Educação"],
  [/viagem|f[eé]rias/i, "Viagem"],
];

export function parsePurpose(text: string): string | null {
  for (const [rx, label] of PURPOSE_KEYWORDS) if (rx.test(text)) return label;
  const t = (text || "").trim();
  if (t.length >= 4 && t.length <= 120 && /[a-zà-ÿ]/i.test(t)) return t;
  return null;
}

/* ─────────────── Cálculo de score ─────────────── */

export function scoreLead(l: Partial<Lead>, settings: any): number {
  let s = 0;
  if (l.name) s += 15;
  if (l.cpf) s += 20;
  if (l.email) s += 5;
  if (l.amount_requested) s += 15;
  if (l.purpose) s += 10;
  if (l.income_monthly) {
    s += 15;
    // Renda coerente com o valor pedido (3x renda mensal é confortável)
    if (l.amount_requested && l.income_monthly >= l.amount_requested / 6) s += 10;
  }
  const min = Number(settings?.min_loan_amount || 100);
  const max = Number(settings?.max_loan_amount || 100000);
  if (l.amount_requested && l.amount_requested >= min && l.amount_requested <= max) s += 10;
  return Math.min(100, s);
}

const money = (v: number) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

/* ─────────────── Máquina de estados ─────────────── */

export interface SdrContext {
  lead: Partial<Lead>;
  incomingText: string;
  pushName?: string | null;
  settings: any;
  profile: any;
  companyName: string;
  history?: Array<{ role: "user" | "bot"; text: string }>;
}

export interface SdrDecision {
  reply: string;
  updates: Partial<Lead>;
  stage: LeadStage;
  needsHuman: boolean;
  handoffReason?: string;
  intent: string;
}

export function decide(ctx: SdrContext): SdrDecision {
  const text = (ctx.incomingText || "").trim();
  const low = text.toLowerCase();
  const lead = ctx.lead || {};
  const updates: Partial<Lead> = {};
  const lastIntent: string = (lead.notes as any)?.last_intent || "";
  const hasHistory = (ctx.history || []).length > 0;
  if(requestsHumanNegotiation(text))return {
    reply:HUMAN_NEGOTIATION_REPLY, updates:{stage:'handoff'}, stage:'handoff', needsHuman:true,
    handoffReason:'Pedido de negociação: atendimento exclusivamente humano', intent:'handoff',
  };

  // stop / desqualifica
  if (/(parar|para de|cancela|remove|não\s*quero|nao\s*quero)/i.test(low) && /(mensagem|contato|falar|voc[eê])/i.test(low)) {
    return {
      reply: "Sem problema! Não vou mais te enviar mensagens por aqui. Se mudar de ideia é só chamar. 👋",
      updates: { stage: "lost", tags: mergeTags(lead.tags, ["optout"]) },
      stage: "lost",
      needsHuman: false,
      intent: "optout",
    };
  }

  // pede humano
  if (/(atendente|humano|pessoa|falar com (algu[eé]m|o dono|gerente|respons[aá]vel))/i.test(low)) {
    return {
      reply: `Claro! Já estou chamando um consultor da *${ctx.companyName}* pra continuar com você por aqui. 🙋‍♂️`,
      updates: { stage: "handoff", tags: mergeTags(lead.tags, ["pediu_humano"]) },
      stage: "handoff",
      needsHuman: true,
      handoffReason: "Lead pediu atendimento humano",
      intent: "handoff",
    };
  }

  // Extrai o que veio na mensagem, sem depender do estado
  const nameFound = !lead.name ? parseName(text, ctx.pushName || undefined) : null;
  if (nameFound) updates.name = nameFound;

  const cpfFound = parseCPF(text);
  if (cpfFound && !lead.cpf) updates.cpf = cpfFound;

  const emailFound = parseEmail(text);
  if (emailFound && !lead.email) updates.email = emailFound;

  // Roteamento CONTEXTUAL por última pergunta feita.
  // Se o bot acabou de perguntar algo, direciona a resposta pro slot certo.
  const money1 = parseMoney(text);
  if (money1) {
    if (lastIntent === "ask_amount" && !lead.amount_requested) {
      updates.amount_requested = money1;
    } else if (lastIntent === "ask_income" && !lead.income_monthly) {
      updates.income_monthly = money1;
    } else if (!lead.amount_requested && /(quero|preciso|pegar|empr[eé]stimo|valor|r\$|mil|k)/i.test(low)) {
      updates.amount_requested = money1;
    } else if (!lead.income_monthly && /(ganho|renda|sal[aá]rio|recebo|fatur)/i.test(low)) {
      updates.income_monthly = money1;
    } else if (!lead.amount_requested) {
      updates.amount_requested = money1;
    } else if (!lead.income_monthly && money1 !== lead.amount_requested) {
      updates.income_monthly = money1;
    }
  }

  // Se a última pergunta foi sobre finalidade, aceita o texto como finalidade
  const purposeFound = !lead.purpose
    ? (lastIntent === "ask_purpose" && text.length >= 3 && text.length <= 120 && !money1 && !cpfFound && !emailFound
        ? (parsePurpose(text) || text.trim())
        : parsePurpose(text))
    : null;
  if (purposeFound && purposeFound !== lead.name) updates.purpose = purposeFound;

  // Afirmações curtas ("sim", "isso", "confirmo") — apenas confirmam, não avançam campo
  const isYes = /^(sim|isso|isso mesmo|confirmo|correto|ok|beleza|pode ser)\.?$/i.test(text);
  const isNo = /^(n[aã]o|nao|negativo)\.?$/i.test(text);

  const merged: Partial<Lead> = { ...lead, ...updates };

  // Decide próxima pergunta com base no que ainda falta
  const empresa = ctx.companyName;
  const firstName = (merged.name || "").split(/\s+/)[0] || "";
  const oi = firstName ? `${firstName}, ` : "";

  // NEW → primeiro contato (só saúda se ainda não houver histórico)
  if (!lead.name && !merged.name) {
    const opener = hasHistory
      ? `Pra eu te chamar pelo nome, me diz seu *nome completo*, por favor. 😊`
      : `Oi! Aqui é da *${empresa}*, atendimento de empréstimos. Para registrar sua solicitação, me diz seu *nome completo*, por favor.`;
    return {
      reply: opener,
      updates: { ...updates, stage: "qualifying" },
      stage: "qualifying",
      needsHuman: false,
      intent: "ask_name",
    };
  }

  if (!merged.amount_requested) {
    return {
      reply: `Prazer, ${firstName}! 🤝\nQuanto você está precisando pegar emprestado? Pode mandar o valor aproximado (ex.: *R$ 3.000*, *5 mil*).`,
      updates: { ...updates, stage: "qualifying" },
      stage: "qualifying",
      needsHuman: false,
      intent: "ask_amount",
    };
  }

  const min = Number(ctx.settings?.min_loan_amount || 100);
  const max = Number(ctx.settings?.max_loan_amount || 100000);
  if (merged.amount_requested < min || merged.amount_requested > max) {
    return {
      reply: `${oi}o valor solicitado (*${money(merged.amount_requested)}*) precisa de análise da equipe humana. Encaminhei sua solicitação para um atendente.`,
      updates: { ...updates, stage:'handoff', tags: mergeTags(merged.tags, ["fora_faixa"]) },
      stage: "handoff",
      needsHuman: true,
      handoffReason: 'Valor solicitado fora da faixa: análise exclusivamente humana',
      intent: "handoff",
    };
  }

  if (!merged.purpose) {
    return {
      reply: `Show! Anotei *${money(merged.amount_requested)}*.\nPra qual finalidade é o empréstimo? (ex.: quitar dívida, reforma, capital de giro, emergência)`,
      updates: { ...updates, stage: "qualifying" },
      stage: "qualifying",
      needsHuman: false,
      intent: "ask_purpose",
    };
  }

  if (!merged.income_monthly) {
    return {
      reply: `Anotado: *${merged.purpose}*. 👍\nQual é sua *renda mensal* aproximada? A equipe usará essa informação na análise.`,
      updates: { ...updates, stage: "qualifying" },
      stage: "qualifying",
      needsHuman: false,
      intent: "ask_income",
    };
  }

  if (!merged.cpf) {
    return {
      reply: `Perfeito. Para completar seu cadastro, me passa seu *CPF* (só números). 🔒 Uso apenas pra análise interna.`,
      updates: { ...updates, stage: "qualifying" },
      stage: "qualifying",
      needsHuman: false,
      intent: "ask_cpf",
    };
  }

  // The bot collects the request; only humans offer or change credit terms.
  return {
    reply: 'Recebi os dados da sua solicitação. Uma pessoa da equipe avaliará valores, prazos e condições e continuará o atendimento por aqui.',
    updates: {...updates, stage:'handoff', score:scoreLead(merged,ctx.settings), tags:mergeTags(merged.tags,['aguardando_analise_humana'])},
    stage:'handoff', needsHuman:true, handoffReason:'Solicitação pronta para análise e condições pela equipe humana', intent:'handoff',
  };
}

/**
 * Leads no antigo estágio de simulação seguem para atendimento humano.
 */
export function handleSimulatedReply(ctx: SdrContext): SdrDecision {
  return {
    reply:HUMAN_NEGOTIATION_REPLY, updates:{stage:'handoff'}, stage:'handoff', needsHuman:true,
    handoffReason:'Simulação antiga: condições devem ser tratadas por uma pessoa da equipe', intent:'handoff',
  };
}

/**
 * Fase de coleta de documentos após aceite.
 * @param ctx contexto padrão do SDR
 * @param opts.mediaReceived true se a mensagem trouxe imagem/PDF (o webhook já salvou)
 * @param opts.docKey chave do doc que acabou de ser aceito (quando mediaReceived=true)
 */
export function handleAwaitingDocsReply(
  ctx: SdrContext,
  opts: { mediaReceived: boolean; docKey?: string } = { mediaReceived: false },
): SdrDecision {
  const lead = ctx.lead;
  const firstName = (lead.name || "").split(/\s+/)[0] || "";
  const t = (ctx.incomingText || "").toLowerCase();
  const empresa = ctx.companyName;

  // Escape: pediu humano
  if (/(atendente|humano|pessoa|consultor|falar com algu[eé]m)/i.test(t)) {
    return {
      reply: `Sem problema, ${firstName}! Vou chamar um consultor da *${empresa}* pra continuar com você.`,
      updates: { stage: "handoff", tags: mergeTags(lead.tags, ["pediu_humano_docs"]) },
      stage: "handoff",
      needsHuman: true,
      handoffReason: "Lead pediu atendente durante coleta de docs",
      intent: "handoff",
    };
  }

  const notes: any = lead.notes || {};
  let received: string[] = Array.isArray(notes?.docs?.received) ? [...notes.docs.received] : [];

  if (opts.mediaReceived && opts.docKey && !received.includes(opts.docKey)) {
    received.push(opts.docKey);
  }

  const nextDoc = REQUIRED_DOCS.find(d => !received.includes(d.key));
  const updatedNotes = { ...notes, docs: { ...(notes.docs || {}), received } };

  // Todos os documentos entregues → handoff
  if (!nextDoc) {
    return {
      reply: `Perfeito, ${firstName}! ✅ Recebi todos os documentos. Um consultor da *${empresa}* já vai revisar e te chamar pra fechar o contrato. Obrigado! 🙌`,
      updates: {
        stage: "handoff",
        tags: mergeTags(lead.tags, ["docs_completos"]),
        score: 100,
        notes: { ...updatedNotes, docs: { ...updatedNotes.docs, completed_at: new Date().toISOString() } },
      },
      stage: "handoff",
      needsHuman: true,
      handoffReason: "Documentação completa — pronto para fechar",
      intent: "docs_complete",
    };
  }

  // Recebeu um doc e ainda faltam
  if (opts.mediaReceived) {
    const done = REQUIRED_DOCS.length - REQUIRED_DOCS.findIndex(d => d.key === nextDoc.key);
    const total = REQUIRED_DOCS.length;
    return {
      reply: `Recebido ✅ (${total - REQUIRED_DOCS.findIndex(d => d.key === nextDoc.key)}/${total})\n\nAgora me envia o *${nextDoc.label}*, por favor. 📎`,
      updates: { notes: updatedNotes },
      stage: "awaiting_docs",
      needsHuman: false,
      intent: "doc_received",
    };
  }

  // Nada anexado — apenas nudge com o próximo pendente
  return {
    reply: `${firstName ? firstName + ", " : ""}ainda estou aguardando o *${nextDoc.label}* aqui pelo WhatsApp (foto ou PDF). Se preferir falar com alguém, é só responder *atendente*. 🙂`,
    updates: {},
    stage: "awaiting_docs",
    needsHuman: false,
    intent: "await_doc",
  };
}


function mergeTags(existing: string[] | undefined, add: string[]): string[] {
  const set = new Set([...(existing || []), ...add]);
  return Array.from(set);
}

/**
 * Camada de IA opcional — reformula a resposta com mais naturalidade,
 * mantendo o mesmo conteúdo. Usa Anthropic se disponível; senão devolve
 * a resposta determinística intacta.
 */
export async function polishWithAI(
  base: string,
  ctx: SdrContext,
  history: Array<{ role: "user" | "bot"; text: string }>,
): Promise<string> {
  try {
    if (!hasAIProvider(ctx.lead?.user_id)) return base;
    const system =
      `Você é um SDR (pré-vendas) da empresa ${ctx.companyName}, especializada em empréstimos pessoais. ` +
      `Reescreva a resposta abaixo mantendo TODAS as informações, valores e perguntas, ` +
      `com tom humano, brasileiro, cordial e curto (máx 4 linhas + emojis moderados). ` +
      `Não negocie valores ou condições; qualquer alteração depende da equipe humana. Não invente valores, não prometa aprovação, não peça dados diferentes dos que já estão na resposta. ` +
      `Se houver histórico, personalize levemente sem repetir cumprimentos já feitos.`;
    const hist = (history || []).slice(-6).map(h => `${h.role === "bot" ? "Assistente" : "Cliente"}: ${h.text}`).join("\n");
    const user =
      `Histórico:\n${hist}\n\n` +
      `Resposta base (reescreva mantendo o conteúdo):\n"""${base}"""`;
    const out = await callAnthropic({
      userId:ctx.lead?.user_id,
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 400,
      temperature: 0.6,
    });
    const cleaned = (out || "").trim().replace(/^"+|"+$/g, "");
    return cleaned.length > 10 && !requestsHumanNegotiation(cleaned) ? cleaned : base;
  } catch (_) {
    return base;
  }
}

/* ─────────────── Compreensão livre (LLM) ─────────────── */

export type UnderstoodKind =
  | "answer_slot"       // resposta normal ao slot atual — segue máquina de estados
  | "question"          // lead perguntou algo (taxa, prazo, carência, etc.)
  | "correction"        // lead corrigiu um dado já coletado
  | "reverse_calc"      // "posso pagar X por mês, quanto consigo?"
  | "small_talk"        // agradecimento, saudação, "ok", "obrigado"
  | "objection"         // achou caro, desistiu, reclamou
  | "off_topic"         // pergunta fora do escopo
  | "unclear";

export interface Understood {
  kind: UnderstoodKind;
  /** tópico da pergunta quando kind=question */
  topic?: "rate" | "term" | "grace" | "early_pay" | "late_fee" | "min_max" | "requirements" | "how_it_works" | "safety" | "company" | "other";
  /** correções: campo -> novo valor (parseado) */
  corrections?: Partial<Pick<Lead, "name" | "cpf" | "email" | "amount_requested" | "income_monthly" | "purpose" | "term_months">>;
  /** para reverse_calc */
  monthly_payment?: number;
  /** texto livre da pergunta original (para responder) */
  raw_question?: string;
  /** confiança 0..1 */
  confidence?: number;
}

/**
 * Camada de compreensão via LLM. Devolve `null` quando não há API key ou o
 * modelo falhou — nesse caso o caller usa apenas a máquina de estados.
 */
export async function understand(ctx: SdrContext): Promise<Understood | null> {
  // Fallback determinístico primeiro — funciona SEM LLM.
  // Cobre os casos mais comuns pra o bot não ficar mudo se a IA estiver off.
  const localFirst = understandLocal(ctx);

  try {
    if (!hasAIProvider(ctx.lead?.user_id)) return localFirst;
    const lead = ctx.lead || {};
    const filled = {
      name: lead.name || null,
      cpf: lead.cpf ? "***" + String(lead.cpf).slice(-2) : null,
      email: lead.email || null,
      amount_requested: lead.amount_requested || null,
      income_monthly: lead.income_monthly || null,
      purpose: lead.purpose || null,
      term_months: lead.term_months || null,
    };
    const lastIntent = (lead.notes as any)?.last_intent || "";
    const hist = (ctx.history || []).slice(-6).map(h => `${h.role === "bot" ? "Assistente" : "Cliente"}: ${h.text}`).join("\n");

    const system =
      `Você classifica mensagens de um lead num bot de empréstimos pessoais brasileiro. ` +
      `Retorne SOMENTE JSON válido (sem markdown, sem comentário), no formato: ` +
      `{"kind":"answer_slot|question|correction|reverse_calc|small_talk|objection|off_topic|unclear",` +
      `"topic":"rate|term|grace|early_pay|late_fee|min_max|requirements|how_it_works|safety|company|other",` +
      `"corrections":{"name":str|null,"cpf":str|null,"email":str|null,"amount_requested":num|null,"income_monthly":num|null,"purpose":str|null,"term_months":num|null},` +
      `"monthly_payment":num|null,"raw_question":str|null,"confidence":0..1}. ` +
      `Regras: (1) "question" = lead PERGUNTOU algo (ex.: "qual a taxa?", "tem carência?", "posso antecipar?"). ` +
      `(2) "correction" = lead alterou um dado JÁ preenchido (ex.: "na verdade meu CPF é 111..."). ` +
      `(3) "reverse_calc" = lead disse quanto pode pagar por mês e quer saber o valor total. ` +
      `(4) "answer_slot" = respondeu à pergunta pendente. (5) só popule corrections com valores que já existem em campos_ja_preenchidos.`;

    const user =
      `Última pergunta do bot (intent): ${lastIntent}\n` +
      `Campos já preenchidos: ${JSON.stringify(filled)}\n` +
      `Histórico recente:\n${hist || "(vazio)"}\n\n` +
      `Mensagem do lead: """${ctx.incomingText}"""\n\n` +
      `Responda apenas com o JSON.`;

    const out = await callAnthropic({
      userId:ctx.lead?.user_id,
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 350,
      temperature: 0.1,
    });
    const m = (out || "").match(/\{[\s\S]*\}/);
    if (!m) return localFirst;
    const parsed = JSON.parse(m[0]);
    // sanitiza corrections
    const c = parsed.corrections || {};
    const clean: any = {};
    if (typeof c.name === "string" && c.name.trim().length >= 2) clean.name = c.name.trim();
    if (typeof c.cpf === "string") { const p = parseCPF(c.cpf); if (p) clean.cpf = p; }
    if (typeof c.email === "string") { const p = parseEmail(c.email); if (p) clean.email = p; }
    if (typeof c.amount_requested === "number" && c.amount_requested > 0) clean.amount_requested = c.amount_requested;
    if (typeof c.income_monthly === "number" && c.income_monthly > 0) clean.income_monthly = c.income_monthly;
    if (typeof c.purpose === "string" && c.purpose.trim().length >= 3) clean.purpose = c.purpose.trim();
    if (typeof c.term_months === "number") clean.term_months = Math.max(1, Math.min(60, Math.round(c.term_months)));
    return {
      kind: parsed.kind || "unclear",
      topic: parsed.topic,
      corrections: Object.keys(clean).length ? clean : undefined,
      monthly_payment: typeof parsed.monthly_payment === "number" ? parsed.monthly_payment : undefined,
      raw_question: typeof parsed.raw_question === "string" ? parsed.raw_question : undefined,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch (e) {
    console.error("[sdr.understand] falhou:", (e as Error).message);
    return localFirst;
  }
}

/**
 * Compreensão puramente determinística (sem LLM). Usada como fallback quando
 * o Anthropic está indisponível — evita que o bot fique mudo/robótico.
 */
export function understandLocal(ctx: SdrContext): Understood | null {
  const raw = (ctx.incomingText || "").trim();
  if (!raw) return null;
  const t = raw.toLowerCase();

  // Small talk / agradecimento
  if (/^(obrigad[oa]|valeu|vlw|agradeç|agradec|show|top|beleza|blz|ok|okay|tá bom|ta bom|entendi|certo|👍|🙏|❤️)[!.?\s]*$/i.test(raw)) {
    return { kind: "small_talk", confidence: 0.9 };
  }

  // Perguntas: heurística por interrogação/palavras-gatilho
  const isQuestion = raw.includes("?") ||
    /^(qual|quanto|como|quando|onde|posso|dá|da pra|precisa|precisam|tem|existe|é possivel|é possível|será|sera|quero saber|me diz|explica|pode|posso antecipar|se eu)/i.test(t);
  if (isQuestion) {
    let topic: Understood["topic"] = "other";
    if (/(juro|taxa|percentual|porcentagem|cet|encargo)/i.test(t)) topic = "rate";
    else if (/(prazo|parcela|quantas.*vezes|em quantas|em quantos meses|meses)/i.test(t)) topic = "term";
    else if (/(car[eê]ncia|come[çc]ar.*pagar depois|adiar.*primeira)/i.test(t)) topic = "grace";
    else if (/(antecipa|quitar antes|pagar adiantado|desconto.*antecipa)/i.test(t)) topic = "early_pay";
    else if (/(atras|multa|juros.*dia|se n[aã]o pagar)/i.test(t)) topic = "late_fee";
    else if (/(m[ií]nimo|m[aá]ximo|at[eé] quanto|quanto.*empresta|valor m[ií]nimo)/i.test(t)) topic = "min_max";
    else if (/(precisa|documento|exigencia|exigência|garantia|avalist|comprovante)/i.test(t)) topic = "requirements";
    else if (/(como funciona|como fecha|como assina|passo a passo|processo)/i.test(t)) topic = "how_it_works";
    else if (/(seguro|golpe|confi[aá]vel|verdade|s[eé]rio|golpist)/i.test(t)) topic = "safety";
    else if (/(quem s[aã]o|empresa|voc[eê]s s[aã]o|cnpj)/i.test(t)) topic = "company";
    return { kind: "question", topic, raw_question: raw.slice(0, 200), confidence: 0.75 };
  }

  // Objeção / desânimo
  if (/(muito caro|abusiv|absurd|desisti|deixa pra l[aá]|n[aã]o compensa|caro demais|juros alto|taxa alta)/i.test(t)) {
    return { kind: "objection", confidence: 0.8 };
  }

  // Reverse calc: "posso pagar 300 por mês", "consigo 500/mês"
  const rev = t.match(/(?:pago|posso|consigo|d[aá] pra pagar|caberia|encaixa)\s*(?:uns\s*|umas\s*|cerca de\s*|r\$\s*)?(\d[\d.,]*)\s*(?:por m[eê]s|\/m[eê]s|mensai|mensal|no m[eê]s)/i);
  if (rev) {
    const n = parseFloat(rev[1].replace(/\./g, "").replace(",", "."));
    if (!isNaN(n) && n >= 20) return { kind: "reverse_calc", monthly_payment: n, confidence: 0.8 };
  }

  // Correção explícita: "na verdade...", "corrigindo..."
  if (/(na verdade|corrigindo|correção|desculpa|errei|é\s+\d)/i.test(t)) {
    return { kind: "correction", confidence: 0.5 };
  }

  return null; // deixa a máquina de estados seguir
}


/** Gera resposta factual às perguntas do lead a partir das settings. */
export function faqAnswer(topic: Understood["topic"], ctx: SdrContext): string {
  const s = ctx.settings || {};
  const rate = Number(s.default_interest_rate || ctx.profile?.default_interest_rate || 15);
  const term = Number(s.default_term_months || 6);
  const min = Number(s.min_loan_amount || 100);
  const max = Number(s.max_loan_amount || 100000);
  const lateFee = Number(s.late_fee_percent ?? 2);
  const dailyFee = Number(s.daily_interest_percent ?? 0.033);
  const company = ctx.companyName;
  switch (topic) {
    case "rate":
      return `Nossa taxa padrão é de *${rate}% ao mês* (juros simples). A taxa final pode variar conforme o valor, prazo e sua análise. 📊`;
    case "term":
      return `Trabalhamos com prazos de *1 a 60 parcelas*. O padrão é *${term}x*; valores e prazos da sua solicitação são definidos pela equipe humana.`;
    case "grace":
      return `A equipe humana verifica se existe carência aplicável ao seu contrato ou solicitação.`;
    case "early_pay":
      return `Para antecipar pagamentos, solicite a conferência do saldo à equipe humana. O bot não define descontos ou condições.`;
    case "late_fee":
      return `Em caso de atraso: multa de *${lateFee}%* sobre a parcela + juros de *${dailyFee}% ao dia*. Alterações de prazo ou encargos dependem exclusivamente da equipe humana.`;
    case "min_max":
      return `Emprestamos de *R$ ${min.toLocaleString("pt-BR")}* até *R$ ${max.toLocaleString("pt-BR")}* por contrato.`;
    case "requirements":
      return `Precisamos só de: *CPF*, *nome completo*, *comprovante de renda* (opcional) e um *contato de referência*. Sem consulta ao SPC/Serasa na maioria dos casos. ✅`;
    case "how_it_works":
      return `Funciona assim: 1) você me passa valor, finalidade e renda; 2) a equipe analisa a solicitação; 3) um consultor apresenta e confirma as condições antes de contratar.`;
    case "safety":
      return `Somos a *${company}* e trabalhamos com contrato assinado digitalmente. Seus dados ficam protegidos e só uso o CPF pra análise interna. 🔒`;
    case "company":
      return `Aqui é a *${company}*, atendimento oficial. Posso registrar sua solicitação para análise da equipe humana.`;
    default:
      return `Pode me dar um pouco mais de detalhe? Posso registrar sua solicitação para análise da equipe humana.`;
  }
}

