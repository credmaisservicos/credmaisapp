import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkSharedSecret } from "../_shared/guard.ts";
import { guard as rateLimitGuard } from "../_shared/rate_limit.ts";
import { parseMemory, mergeMemory, serializeMemory, pushIntent, summarizeIntents, lastApproach, type IntentEntry } from "../_shared/memory.ts";
import {
  extractJsonObject,
  sanitizeAiResult,
  validateReceipt,
  sha256Hex,
  validatePixReply,
  computeClientBehavior,
  detectResponseLoop,
  detectClientTone,
  assertReplySafe,
  receiptOutcomeReply,
  splitWhatsAppText,
} from "../_shared/bot_utils.ts";

import { findFaqMatch, FAQ_COUNT } from "../_shared/faq_knowledge.ts";
import { identifyClient, loadClientInstallments, auditDecision, todayInSP, samePhoneBR } from "../_shared/agent_core.ts";
import { runAgentWithTools } from "../_shared/agent_tools.ts";
import { normalizeSnapshot, transition, saveSnapshot, type AgentState } from "../_shared/agent_fsm.ts";
import { isEmAtraso, isEmAberto } from "../_shared/installmentStatus.ts";
import { botBalance, botLateFee, botRenewalQuote } from "../_shared/bot_finance.ts";
import { botRows, botPortalLink, checkedBotQuery } from "../_shared/bot_data.ts";
import {parsePaymentDate as parseNaturalPaymentDate, extractPaymentAmount as extractPromisedAmount} from '../_shared/payment_input.ts';
import { queueBotMessage, deliverBotJob } from "../_shared/bot_delivery.ts";
import { automationAccountActive, withinBotHours } from "../_shared/bot_policy.ts";
import { saveBotAttachment } from "../_shared/bot_media.ts";
import {callGemini, geminiConfigured} from '../_shared/gemini.ts';
import {testRecipientScope} from '../_shared/bot_test_scope.ts';
import {pendingClientReceipt} from '../_shared/bot_collection.ts';
import {requestsHumanNegotiation, HUMAN_NEGOTIATION_REPLY} from '../_shared/human_negotiation.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Rate limit por JID — evita loops/spam
const jidRateBucket = new Map<string, number[]>();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 8;

// Lock por JID — evita duas execuções paralelas respondendo ao mesmo contato
const jidLock = new Map<string, number>();
const LOCK_TTL_MS = 30 * 1000;

// Saudações variadas (lead)
const LEAD_GREETINGS = [
  (e: string) => `Olá! 👋 Aqui é da *${e}*.\n\nNão consegui localizar seu cadastro pelo seu número. Pode me passar seu *nome completo* e *CPF*? Assim consigo te atender direitinho. 😊`,
  (e: string) => `Oi, tudo bem? 🙂\n\nAqui é o atendimento da *${e}*. Pra te ajudar melhor, pode me informar seu *nome* e *CPF*?`,
  (e: string) => `Olá! Seja bem-vindo(a) à *${e}*. 🤝\n\nPra puxar seu cadastro, preciso do seu *nome completo* e *CPF*, por favor.`,
  (e: string) => `Oi! 👋 Aqui é da *${e}*.\n\nNão te encontrei na nossa base. Me ajuda com seu *nome completo* e *CPF* pra eu seguir? 😉`,
];
const pickGreeting = (e: string) => LEAD_GREETINGS[Math.floor(Math.random() * LEAD_GREETINGS.length)](e);

function norm(s: string) { return (s || "").toLowerCase().replace(/\s+/g, " ").trim(); }

function isRateLimited(jid: string): boolean {
  const now = Date.now();
  const arr = (jidRateBucket.get(jid) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) { jidRateBucket.set(jid, arr); return true; }
  arr.push(now);
  jidRateBucket.set(jid, arr);
  return false;
}

const STOP_WORDS = ["parar bot", "pare bot", "pare de me mandar", "para de mandar", "cancelar bot", "desativar bot", "silenciar bot", "stop bot", "chega de bot", "para com isso bot", "desliga o bot"];
const HUMAN_WORDS = ["atendente", "humano", "pessoa de verdade", "falar com alguem", "falar com alguém", "falar c alguem", "operador", "gerente", "responsavel", "responsável", "quero falar com voce mesmo", "quero falar com vc mesmo", "com uma pessoa", "com alguém real", "quero falar com o dono", "quero falar com o patrão"];
const PIX_WORDS = ["qual o pix", "qual a chave pix", "me passa o pix", "manda o pix", "envia o pix", "me manda a chave pix", "manda a chave", "me manda a chave", "qual sua chave", "qual a chave", "chave pra pagar", "pix pra pagar", "pix p pagar"];

function matchesAny(text: string, words: string[]): boolean {
  const t = (text || "").toLowerCase();
  return words.some(w => t.includes(w));
}

function money(v: number) {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

const SERVICE_MENU = `Escolha uma opção respondendo com o número:

*1* — Solicitar empréstimo
*2* — Consultar parcelas
*3* — Solicitar renegociação (atendente)
*4* — Novo empréstimo (cliente ativo)
*5* — Falar com atendente`;

const SESSION_TIMEOUT_MESSAGE = "Atendimento encerrado por falta de resposta. Quando precisar continuar, envie uma nova mensagem para abrir o menu novamente.";

const LOAN_TYPE_MENU = `Qual é o seu perfil para a solicitação?

*1* — Pessoa física / autônomo
*2* — Trabalhador CLT
*3* — Pessoa jurídica (CNPJ)
*4* — Motorista ou entregador de aplicativo
*5* — Dono de comércio ou vendedor por aplicativo`;

function normalizeMenuText(value: string): string {
  return (value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function loanTypeFromText(value: string): string | null {
  const text = normalizeMenuText(value);
  if (/^(1|pessoa fisica|autonom[oa])$/.test(text)) return "pf";
  if (/^(2|clt|carteira assinada)$/.test(text)) return "clt";
  if (/^(3|pj|cnpj|pessoa juridica)$/.test(text)) return "cnpj";
  if (/^(4|motorista|entregador|uber|99|ifood|app de transporte)$/.test(text)) return "motorista_app";
  if (/^(5|comercio|lojista|vendedor|dono de comercio|app de vendas)$/.test(text)) return "comercio_app";
  return null;
}

function loanDocumentsMessage(company: string, type: string): string {
  const common = [
    "Selfie nítida segurando o RG ou a CNH ao lado do rosto",
    "Documento de identificação (RG ou CNH), frente e verso",
    "Comprovante de endereço recente",
    "Extratos bancários completos dos últimos 3 meses, em PDF",
    "Profissão ou atividade de trabalho",
    "Renda mensal, comprovada nos extratos bancários",
    "Se tiver indicação: nome e telefone de quem indicou",
  ];
  const specific: Record<string, string[]> = {
    pf: [],
    clt: ["Carteira de Trabalho Digital ou fotos das páginas de identificação e do contrato atual", "Últimos 3 contracheques, se disponíveis"],
    cnpj: ["Comprovante de inscrição e situação cadastral do CNPJ (cartão CNPJ)", "Documentos do responsável legal pela empresa"],
    motorista_app: ["Documento do veículo (CRLV)", "Informar se o veículo é próprio, financiado ou alugado", "Se for alugado: contrato ou comprovante da locadora", "Print da tela de perfil do aplicativo de motorista/entregador", "Print ou relatório da tela de faturamento/ganhos do aplicativo"],
    comercio_app: ["Comprovante do negócio ou cadastro da loja", "Print da tela de perfil do usuário/estabelecimento no aplicativo de vendas", "Print ou relatório da tela de faturamento/vendas do aplicativo"],
  };
  const labels: Record<string, string> = {
    pf: "Pessoa física / autônomo", clt: "Trabalhador CLT", cnpj: "Pessoa jurídica (CNPJ)",
    motorista_app: "Motorista ou entregador de aplicativo", comercio_app: "Comércio ou vendas por aplicativo",
  };
  const docs = [...common, ...(specific[type] || [])];
  return `*Solicitação de empréstimo — ${labels[type] || "análise de crédito"}*\n\nPara a análise da *${company}*, envie:\n\n${docs.map((doc, i) => `${i + 1}. ${doc}`).join("\n")}\n\nEnvie arquivos legíveis e sem cortes. O envio dos documentos não garante aprovação: a proposta passa por análise cadastral e de crédito. Nunca envie senha, código de acesso ou token bancário.`;
}

type DocumentReview = {
  document_type: string;
  label: string;
  readable: boolean;
  complete: boolean;
  quality: "good" | "acceptable" | "poor";
  authenticity_risk: "low" | "medium" | "high";
  decision: "accepted" | "resend" | "manual_review";
  reasons: string[];
};

const DOCUMENT_LABELS: Record<string, string> = {
  selfie_id: "selfie segurando RG ou CNH",
  identity_front: "documento de identificação — frente",
  identity_back: "documento de identificação — verso",
  address_proof: "comprovante de endereço",
  bank_statement: "extrato bancário",
  cnpj_card: "cartão CNPJ",
  work_card: "carteira de trabalho",
  payslip: "contracheque",
  vehicle_document: "documento do veículo",
  rental_contract: "documento da locadora",
  app_profile: "perfil no aplicativo",
  app_income: "faturamento no aplicativo",
  business_proof: "comprovante do comércio",
  unknown: "arquivo não identificado",
};

function requiredDocumentTypes(profile: string): string[] {
  const common = ["selfie_id", "identity_front", "identity_back", "address_proof", "bank_statement"];
  if (profile === "clt") return [...common, "work_card"];
  if (profile === "cnpj") return [...common, "cnpj_card"];
  if (profile === "motorista_app") return [...common, "vehicle_document", "app_profile", "app_income"];
  if (profile === "comercio_app") return [...common, "business_proof", "app_profile", "app_income"];
  return common;
}

async function reviewUploadedDocument(mediaData: string, mimeType: string, loanProfile: string, userId: string): Promise<DocumentReview> {
  const fallback: DocumentReview = {
    document_type: "unknown", label: DOCUMENT_LABELS.unknown, readable: false, complete: false,
    quality: "poor", authenticity_risk: "medium", decision: "manual_review",
    reasons: ["Não foi possível concluir a verificação automática"],
  };
  if (!mediaData || mediaData.length < 2_000) return { ...fallback, decision: "resend", reasons: ["Arquivo vazio, incompleto ou com resolução muito baixa"] };
  if (mediaData.length > 28_000_000) return { ...fallback, decision: "resend", reasons: ["Arquivo muito grande; envie uma imagem nítida ou PDF de até 15 MB"] };

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!lovableKey && !anthropicKey && !geminiConfigured(userId)) return fallback;
  const allowedTypes = requiredDocumentTypes(loanProfile).join(", ");
  const prompt = `Analise este arquivo de cadastro de crédito. Tipos esperados para este perfil: ${allowedTypes}.
Classifique SEM afirmar autenticidade jurídica. Verifique: tipo do documento; legibilidade; cortes; frente/verso; nome/datas/campos essenciais visíveis; sinais VISUAIS de edição, montagem, sobreposição, fonte inconsistente ou conteúdo incompatível.
Para extrato bancário, confira se parece PDF/relatório bancário e se cobre aproximadamente 3 meses; não invente períodos invisíveis.
Para selfie, confira se há uma pessoa segurando RG/CNH e se rosto e documento aparecem, mas não faça reconhecimento biométrico.
decision=resend quando ilegível, cortado, documento errado ou incompleto. decision=manual_review quando houver indício de manipulação/inconsistência. decision=accepted somente quando legível e compatível.
Responda SOMENTE JSON: {"document_type":"selfie_id|identity_front|identity_back|address_proof|bank_statement|cnpj_card|work_card|payslip|vehicle_document|rental_contract|app_profile|app_income|business_proof|unknown","label":"descrição curta","readable":true,"complete":true,"quality":"good|acceptable|poor","authenticity_risk":"low|medium|high","decision":"accepted|resend|manual_review","reasons":["motivo objetivo"]}`;
  const cleanBase64 = mediaData.replace(/^data:[^;]+;base64,/, "");
  const parseReview = (raw: string): DocumentReview => {
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) throw new Error("vision_invalid_json");
    const parsed = JSON.parse(match[0]);
    const type = DOCUMENT_LABELS[parsed.document_type] ? parsed.document_type : "unknown";
    return {
      document_type: type,
      label: String(parsed.label || DOCUMENT_LABELS[type]).slice(0, 120),
      readable: parsed.readable === true,
      complete: parsed.complete === true,
      quality: ["good", "acceptable", "poor"].includes(parsed.quality) ? parsed.quality : "poor",
      authenticity_risk: ["low", "medium", "high"].includes(parsed.authenticity_risk) ? parsed.authenticity_risk : "medium",
      decision: ["accepted", "resend", "manual_review"].includes(parsed.decision) ? parsed.decision : "manual_review",
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((x: any) => String(x).slice(0, 180)).slice(0, 4) : [],
    };
  };

  if (geminiConfigured(userId)) {
    try {
      const result = await callGemini({userId, system:'Faça apenas a triagem visual solicitada. Responda em JSON.',
        messages:[{role:'user', content:[{type:'text',text:prompt},
          {type:mimeType === 'application/pdf' ? 'document' : 'image',source:{type:'base64',media_type:mimeType,data:cleanBase64}}]}],
        maxTokens:1000,temperature:0,timeoutMs:12_000});
      return parseReview(result.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
    } catch (error) { console.warn('[document-review] Gemini indisponível', error); }
  }

  // PDFs (principalmente extratos) são enviados como bloco document para um
  // modelo com leitura nativa. Se o provedor estiver indisponível, usa o gateway.
  if (anthropicKey && mimeType === "application/pdf") {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 700, temperature: 0, messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } },
          { type: "text", text: prompt },
        ] }] }),
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) {
        const body = await response.json();
        return parseReview(body?.content?.find((block: any) => block.type === "text")?.text || "");
      }
    } catch (error) { console.warn("[document-review] leitura PDF primária falhou", error); }
  }

  if (!lovableKey) return fallback;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0,
        max_tokens: 700,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType || "image/jpeg"};base64,${cleanBase64}` } },
        ] }],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`vision_${response.status}`);
    const body = await response.json();
    return parseReview(body?.choices?.[0]?.message?.content || "");
  } catch (error) {
    console.warn("[document-review] falha na visão", error);
    return fallback;
  }
}

function buildLocalBotResult(params: {
  client: any;
  incomingText: string;
  overdue: any[];
  dueToday: any[];
  totalOverdue: number;
  totalDueToday: number;
  profile: any;
  tone: any;
  messageType?: string;
  hasMedia?: boolean;
  history?: Array<{ role: string; content: string }>;
}) {
  const { client, incomingText, overdue, dueToday, totalOverdue, totalDueToday, profile, tone, messageType, hasMedia, history } = params;
  const txt = (incomingText || "").toLowerCase();
  const firstName = (client?.name || "").split(" ").filter(Boolean)[0] || "tudo bem";
  const hasDebt = overdue.length > 0 || dueToday.length > 0;
  const total = totalOverdue + totalDueToday;
  const oldest = overdue[0] || dueToday[0];
  const pix = profile?.pix_key ? `\nPIX: *${profile.pix_key}*` : "";
  const lastBot = [...(history || [])].reverse().find(item => item.role === "assistant")?.content || "";

  if (/^(sim|pode|isso|essa|esse|manda|envia|ok)$/i.test(txt.trim()) && /pix|chave/i.test(lastBot) && profile?.pix_key) {
    return {
      reply: `${firstName}, segue a chave PIX: *${profile.pix_key}*. Depois do pagamento, envie o comprovante por aqui para conferência.`,
      is_receipt: false, is_rollover: false, is_promise: false, promise_date: null,
      receipt_value: 0, needs_human: false, intent: "pagamento", sentiment: "neutro",
      urgencia: "media", dificuldade_financeira: false, desconto_pct: 0, summary: "Resposta curta entendida pelo contexto do PIX",
    };
  }

  const promisedDate = /pag|acert|deposit|transfer/i.test(txt) ? parseNaturalPaymentDate(txt) : null;
  if (promisedDate) {
    const displayDate = promisedDate.split("-").reverse().join("/");
    return {
      reply: `Certo, ${firstName}. Registrei sua previsão de pagamento para ${displayDate}. Quando pagar, envie o comprovante por aqui.`,
      is_receipt: false, is_rollover: false, is_promise: true, promise_date: promisedDate,
      receipt_value: 0, needs_human: false, intent: "promessa", sentiment: "neutro",
      urgencia: "media", dificuldade_financeira: false, desconto_pct: 0, summary: "Promessa de pagamento para amanhã",
    };
  }

  const receipt = /comprovante|paguei|pix feito|transferi|enviei/i.test(incomingText || "")
    || (hasDebt && hasMedia && (messageType === "image" || messageType === "document"));
  if (receipt) {
    return {
      reply: hasMedia
        ? `Recebi o arquivo, ${firstName}. A cobrança fica pausada enquanto o comprovante é conferido. Assim que a análise terminar, você recebe a confirmação por aqui.`
        : `Certo, ${firstName}. Envie o comprovante em imagem ou PDF por aqui. Quando ele chegar, a cobrança será pausada para conferência.`,
      is_receipt: !!hasMedia,
      is_rollover: false,
      is_promise: false,
      promise_date: null,
      receipt_value: 0,
      needs_human: !!hasMedia,
      intent: "comprovante",
      sentiment: "neutro",
      urgencia: "media",
      dificuldade_financeira: false,
      desconto_pct: 0,
      summary: hasMedia ? "Comprovante recebido; cobrança pausada para conferência" : "Cliente informou pagamento; aguardando comprovante",
    };
  }

  const greeting = /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|opa|tudo bem)[!.?\s]*$/i.test(txt.trim());
  if (greeting) {
    return {
      reply: `Olá, ${firstName}. Como posso ajudar? Posso consultar suas parcelas, enviar os dados para pagamento ou chamar uma pessoa da equipe.`,
      is_receipt: false, is_rollover: false, is_promise: false, promise_date: null,
      receipt_value: 0, needs_human: false, intent: "saudacao", sentiment: "neutro",
      urgencia: "baixa", dificuldade_financeira: false, desconto_pct: 0,
      summary: "Saudação respondida sem iniciar cobrança",
    };
  }

  const wantsDeal = /renegoci|fazer acordo|quero desconto|tem desconto|parcelar (?:a d[ií]vida|o valor|essa conta)|dividir (?:a d[ií]vida|o valor)|mudar (?:a data|o vencimento)|n[aã]o consigo pagar|consigo pagar s[oó]|deixar por|fazer por/i.test(txt);
  if (wantsDeal) {
    const base = hasDebt
      ? `Oi ${firstName}, consigo te ajudar sim. Consta ${oldest ? `a parcela #${oldest.installment_number}` : "pendência"} e o total em aberto está em *${money(total)}*.`
      : `Oi ${firstName}, consigo te ajudar sim. Não localizei parcela vencida agora, mas vou registrar seu pedido.`;
    return {
      reply: `${base}\nEntendi o que você precisa. Vou passar seu caso para uma pessoa do nosso time avaliar a melhor condição com você.`,
      is_receipt: false,
      is_rollover: false,
      is_promise: /dia|amanh|hoje|semana|pago|pagar/i.test(txt),
      promise_date: null,
      receipt_value: 0,
      needs_human: true,
      intent: "negociacao",
      sentiment: tone?.frustrated ? "frustrado" : "neutro",
      urgencia: "alta",
      dificuldade_financeira: tone?.hardship === true,
      desconto_pct: 0,
      summary: "Cliente pediu negociação; encaminhado para atendimento humano",
    };
  }

  const asksInstallment = /quanto (?:falta|resta)|saldo|(?:qual|quanto|consult|ver|manda|enviar|pr[oó]xima|minha).*(?:parcela|vencimento|valor|pix)|(?:parcela|vencimento|pix).*(?:qual|quanto|quando|manda|enviar)/i.test(txt);
  if (asksInstallment) {
    if (!hasDebt) return {
      reply: `${firstName}, não encontrei parcela vencida ou vencendo hoje. Sua situação está em dia. Se quiser, posso informar o próximo vencimento.`,
      is_receipt: false, is_rollover: false, is_promise: false, promise_date: null,
      receipt_value: 0, needs_human: false, intent: "consulta_parcelas", sentiment: "neutro",
      urgencia: "baixa", dificuldade_financeira: false, desconto_pct: 0, summary: "Cliente sem pendência atual",
    };
    const due = String(oldest?.due_date || "").slice(0, 10).split("-").reverse().join("/");
    return {
      reply: `${firstName}, a parcela #${oldest?.installment_number || 1} vence em ${due || "data não informada"}. O valor atualizado é *${money(total)}*.${pix}`,
      is_receipt: false, is_rollover: false, is_promise: false, promise_date: null,
      receipt_value: 0, needs_human: false, intent: "consulta_parcelas", sentiment: "neutro",
      urgencia: overdue.length ? "alta" : "media", dificuldade_financeira: false, desconto_pct: 0, summary: "Consulta de parcela respondida",
    };
  }

  return {
    reply: `${firstName}, entendi. Pode me explicar um pouco melhor o que você precisa? Se preferir, escreva “parcelas”, “pagamento” ou “atendente”.`,
    is_receipt: false,
    is_rollover: false,
    is_promise: false,
    promise_date: null,
    receipt_value: 0,
    needs_human: false,
    intent: "duvida",
    sentiment: "neutro",
    urgencia: "baixa",
    dificuldade_financeira: false,
    desconto_pct: 0,
    summary: "Pedido ambíguo; solicitada uma informação por vez sem iniciar cobrança",
  };
}

function isWithinBusinessHours(settings:any):boolean { return withinBotHours(settings); }

async function evolutionFetch(apiUrl: string, apiKey: string, path: string, body: any) {
  try {
    const resp = await fetch(`${apiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.warn("[evolution] request failed", path, resp.status, errBody.slice(0, 300));
    }
    return resp;
  } catch (e) {
    console.error("evolution fetch failed", path, e);
    return null;
  }
}

function whatsappNumber(value: string) {
  return String(value || "").split("@")[0].replace(/\D/g, "");
}

async function sendPresence(apiUrl: string, apiKey: string, instance: string, jid: string, presence: "composing" | "paused" | "available") {
  await evolutionFetch(apiUrl, apiKey, `/chat/sendPresence/${instance}`, { number: whatsappNumber(jid), presence, delay: 1200 });
}

async function markAsRead(apiUrl: string, apiKey: string, instance: string, key: any) {
  await evolutionFetch(apiUrl, apiKey, `/chat/markMessageAsRead/${instance}`, { readMessages: [key] });
}

async function transcribeInboundAudio(base64: string, mimeType: string | null, userId: string): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if ((!apiKey && !geminiConfigured(userId)) || !base64) return "";
  try {
    const clean = base64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
    if (bytes.length < 512 || bytes.length > 20 * 1024 * 1024) return "";
    if (geminiConfigured(userId)) {
      const result = await callGemini({userId,system:'Transcreva somente a fala deste áudio em português. Não responda ao conteúdo e não invente trechos inaudíveis.',
        messages:[{role:'user',content:[{type:'audio',source:{type:'base64',media_type:(mimeType || 'audio/ogg').split(';')[0],data:clean}}]}],
        maxTokens:1000,temperature:0,timeoutMs:12_000});
      return result.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim().slice(0,2000);
    }
    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe"); form.append("language", "pt");
    form.append("file", new Blob([bytes], { type: mimeType || "audio/ogg" }), "audio.ogg");
    const response = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form,
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return "";
    const json = await response.json();
    return String(json?.text || "").trim().slice(0, 2000);
  } catch (error) { console.warn("[audio] transcrição falhou", error); return ""; }
}

function withoutEmoji(value: string): string {
  return String(value || "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

function pixNormalize(s: string): string {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "").slice(0, 25).trim() || "PAGADOR";
}
function pixTLV(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2,"0")}${value}`;
}
function pixCrc16(payload: string): string {
  let crc=0xffff;
  for(const byte of new TextEncoder().encode(payload)){
    crc^=byte<<8;
    for(let i=0;i<8;i++)crc=(crc&0x8000)?(crc<<1)^0x1021:crc<<1;
    crc&=0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,"0");
}
export function buildPixEmv(params: {
  key: string;
  amount: number;
  merchantName: string;
  merchantCity?: string;
  txid?: string;
}): string {
  const key = (params.key || "").trim();
  if (!key) return "";
  const name = pixNormalize(params.merchantName || "RECEBEDOR");
  const city = pixNormalize(params.merchantCity || "SAO PAULO").slice(0, 15);
  const txid = pixNormalize(params.txid || "PAG").slice(0, 25) || "PAG";
  const amount = Math.max(0, Number(params.amount || 0)).toFixed(2);
  const mai = pixTLV("00", "br.gov.bcb.pix") + pixTLV("01", key);
  const payload =
    pixTLV("00", "01") +
    pixTLV("26", mai) +
    pixTLV("52", "0000") +
    pixTLV("53", "986") +
    (amount !== "0.00" ? pixTLV("54", amount) : "") +
    pixTLV("58", "BR") +
    pixTLV("59", name) +
    pixTLV("60", city) +
    pixTLV("62", pixTLV("05", txid));
  const toCrc = payload + "6304";
  return toCrc + pixCrc16(toCrc);
}

async function upsertConversation(supabase: any, params: {
  userId: string; phone: string; jid: string; instance: string;
  clientId?: string | null; contactName?: string | null;
  preview: string; from: "client" | "bot" | "human"; incrementUnread: boolean;
}): Promise<string | null> {
  const { userId, phone, jid, instance, clientId, contactName, preview, from, incrementUnread } = params;
  const { data: existing,error: existingError } = await supabase
    .from("whatsapp_conversations").select("id, unread_count")
    .eq("user_id", userId).eq("phone", phone).maybeSingle();
  
  if(existingError)throw Error("conversation_lookup_unavailable");
  if (existing) {
    const {error}=await supabase.from("whatsapp_conversations").update({
      jid, instance,
      client_id: clientId ?? undefined,
      contact_name: contactName ?? undefined,
      last_message_at: new Date().toISOString(),
      last_message_preview: preview.slice(0, 200),
      last_message_from: from,
      unread_count: incrementUnread ? (existing.unread_count || 0) + 1 : existing.unread_count,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id).eq("user_id",userId);
    if(error)throw Error("conversation_update_unavailable");
    return existing.id;
  }
  
  const { data: created,error: createError } = await supabase.from("whatsapp_conversations").insert({
    user_id: userId, phone, jid, instance,
    client_id: clientId ?? null, contact_name: contactName ?? null,
    last_message_preview: preview.slice(0, 200), last_message_from: from,
    unread_count: incrementUnread ? 1 : 0,
  }).select("id").single();
  if(createError||!created)throw Error("conversation_create_unavailable");
  return created.id;
}

async function logMessage(supabase: any, params: {
  conversationId: string; userId: string;
  direction: "in" | "out"; sender: "client" | "bot" | "human";
  messageType: string; content: string;
  waMessageId?: string | null; mediaUrl?: string | null; metadata?: any;
}) {
  const {error}=await supabase.from("whatsapp_messages").insert({
    conversation_id: params.conversationId,
    user_id: params.userId,
    direction: params.direction,
    sender: params.sender,
    message_type: params.messageType,
    content: params.content,
    wa_message_id: params.waMessageId ?? null,
    media_url: params.mediaUrl ?? null,
    metadata: params.metadata ?? {},
  });
  if(error && error.code!=="23505")throw Error("message_persist_unavailable");
}

async function logBotAction(supabase: any, params: {
  userId: string; clientId?: string | null; conversationId?: string | null;
  toolName: string; toolInput?: any; toolOutput?: any;
  success?: boolean; errorMessage?: string | null;
}) {
  try {
    await supabase.from("bot_actions_log").insert({
      user_id: params.userId,
      client_id: params.clientId ?? null,
      conversation_id: params.conversationId ?? null,
      tool_name: params.toolName,
      tool_input: params.toolInput ?? {},
      tool_output: params.toolOutput ?? {},
      success: params.success ?? true,
      error_message: params.errorMessage ?? null,
    });
  } catch (e) {
    console.warn("[bot_actions_log] insert failed:", e);
  }
}

async function escalateToHuman(supabase: any, convoId: string, reason: string) {
  const {error}=await supabase.from("whatsapp_conversations").update({
    bot_paused: true,
    bot_status: "handoff",
    needs_human: true,
    human_takeover_at: new Date().toISOString(),
    human_takeover_reason: reason,
  }).eq("id", convoId);
  if(error)throw Error("human_takeover_unavailable");
}

serve(async (req) => {
  let finishEvent: ((success:boolean) => Promise<void>) | null = null;
  let finishResponse: (() => Promise<void>) | null = null;
  const deadline = Date.now() + 45_000;
  const process = async () => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Rate limit por IP (60 msgs/min, capacidade 30). Evolution costuma chamar de
  // 1-2 IPs — se estourar é abuso, não uso legítimo.
  const rl = await rateLimitGuard(req, "wa", 30, 1, corsHeaders);
  if (rl) return rl;


  // SEGURANÇA (C2): o Evolution não assina o payload, então exigimos um segredo
  // compartilhado. Configure o webhook do Evolution com `?secret=<valor>` na URL
  // (ou header x-webhook-secret) e defina EVOLUTION_WEBHOOK_SECRET nos secrets.
  //
  // Fecha por padrão: sem segredo configurado ou informado, o webhook é negado.
  //
  // HISTÓRICO: este guard chegou a ficar anulado por um `if (false && ...)` posto
  // como medida temporária para destravar a recepção. Com o env já configurado,
  // isso deixava o webhook aberto na internet: dava para forjar mensagem de
  // qualquer telefone, extrair a dívida e a chave PIX do cliente pelo bot e, com
  // `bot_auto_confirm_payment` ligado, dar baixa em parcela com comprovante falso.
  // Não reintroduza o curto-circuito — se a recepção parar, o certo é acertar a
  // URL do webhook no painel do Evolution.
  if (!checkSharedSecret(req, "EVOLUTION_WEBHOOK_SECRET", "x-webhook-secret")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    const payload = await req.json();
    if (payload.event !== "messages.upsert" && payload.event !== "MESSAGES_UPSERT") {
      return new Response(JSON.stringify({ status: "ignored_event" }), { headers: corsHeaders });
    }

    const data = payload.data;
    const key = data?.key ?? data?.message?.key;
    const msgContent = data?.message?.message ?? data?.message;
    if (!key || key.fromMe) return new Response(JSON.stringify({ status: "ignored_self" }), { headers: corsHeaders });

    const msgId = key.id;
    if (!msgId) return new Response(JSON.stringify({ error: "message_id_required" }), { status:400,headers:corsHeaders });

    const senderJid = key.remoteJid;
    if (!senderJid || senderJid.includes("@g.us") || senderJid.includes("@broadcast")) {
      return new Response(JSON.stringify({ status: "ignored_jid" }), { headers: corsHeaders });
    }
    const senderPhone = senderJid.split("@")[0].replace(/\D/g, "");
    const instanceName = payload.instance;

    let messageType = "text";
    let incomingText = msgContent?.conversation || msgContent?.extendedTextMessage?.text || "";
    let mediaData: string | null = null;
    let mimeType: string | null = null;

    if (msgContent?.imageMessage) {
      messageType = "image";
      mimeType = msgContent.imageMessage.mimetype;
      incomingText = msgContent.imageMessage.caption || "";
    } else if (msgContent?.audioMessage) {
      messageType = "audio";
      mimeType = msgContent.audioMessage.mimetype;
    } else if (msgContent?.documentMessage) {
      messageType = "document";
      mimeType = msgContent.documentMessage.mimetype;
      incomingText = msgContent.documentMessage.caption || msgContent.documentMessage.fileName || "";
    }

    // Resolve primeiro as instâncias adicionais. O fluxo antigo só procurava
    // settings.whatsapp_instance e, portanto, ignorava os outros números do usuário.
    const { data: instanceRows,error:instanceError } = await supabase
      .from("whatsapp_instances")
      .select("user_id, api_url, api_key")
      .eq("instance", instanceName)
      .eq("is_active", true)
      .limit(2);

    if(instanceError)throw Error('instance_lookup_unavailable');
    if ((instanceRows || []).length > 1) {
      console.error("[whatsapp-webhook] nome de instância duplicado", instanceName);
      return new Response(JSON.stringify({ error: "ambiguous_instance" }), { status: 409, headers: corsHeaders });
    }

    const additionalInstance = instanceRows?.[0] || null;
    const settingsQuery = supabase.from("settings").select("*");
    const { data: settings,error:settingsError } = additionalInstance
      ? await settingsQuery.eq("user_id", additionalInstance.user_id).maybeSingle()
      : await settingsQuery.eq("whatsapp_instance", instanceName).maybeSingle();
    if(settingsError)throw Error('settings_unavailable');
    if (!settings) return new Response(JSON.stringify({ status: "unknown_instance" }), { headers: corsHeaders });

    const apiUrl = (additionalInstance?.api_url || settings.whatsapp_api_url || "").replace(/\/$/, "");
    const apiKey = additionalInstance?.api_key || settings.whatsapp_api_key;
    if (apiUrl && apiKey) markAsRead(apiUrl, apiKey, instanceName, key).catch(() => {});

    const userId = settings.user_id;
    const scope = `${userId}:${instanceName}:${senderJid}`;
    const leaseToken = crypto.randomUUID();
    const {data: entitlementProfile,error: entitlementError} = await supabase.from("profiles").select("is_admin,is_blocked,plan_tier,subscription_type,subscription_expires_at,trial_ends_at").eq("id",userId).single();
    if(entitlementError) return new Response(JSON.stringify({error:"account_unavailable"}),{status:503,headers:corsHeaders});
    const automationAllowed=automationAccountActive(entitlementProfile);

    // A Evolution pode reenviar o mesmo evento por timeout/retry e duas Edge
    // Functions diferentes não compartilham memória. A reivindicação no banco é
    // atômica e garante uma única resposta em toda a infraestrutura.
    if (msgId) {
      const retryPayload=JSON.parse(JSON.stringify(payload,(name,value)=>name==="base64"?undefined:value));
      const {error:saveError}=await supabase.rpc("save_whatsapp_event",{_user_id:userId,_instance:instanceName,_message_id:msgId,_payload:retryPayload});
      if(saveError)return new Response(JSON.stringify({error:"event_storage_unavailable"}),{status:503,headers:corsHeaders});
      const { data: claimed, error: claimError } = await supabase.rpc("begin_whatsapp_event", {
        _user_id: userId, _instance: instanceName, _message_id: msgId, _lease_token: leaseToken,
      });
      if (claimError) {
        console.error("[idempotency] falha ao reivindicar evento", claimError.message);
        return new Response(JSON.stringify({ error: "idempotency_unavailable" }), { status: 503, headers: corsHeaders });
      }
      if (!claimed) {
        const {data: event,error: eventError} = await supabase.from("whatsapp_event_claims").select("status").eq("user_id",userId).eq("instance",instanceName).eq("message_id",msgId).maybeSingle();
        return new Response(JSON.stringify({status:"duplicate_or_processing"}),{status:!eventError && event?.status==="completed"?200:503,headers:corsHeaders});
      }
      finishEvent = async(success:boolean) => {
        const {error} = await supabase.rpc("finish_whatsapp_event",{_user_id:userId,_instance:instanceName,_message_id:msgId,_lease_token:leaseToken,_success:success});
        if(error) throw Error("event_ack_unavailable");
      };
    }

    // CLIENT LOOKUP (agent_core v2 — estrito + desambiguação por CPF)
    let client: any = null;
    const CLIENT_FIELDS = "id, user_id, name, phone, whatsapp, cpf_cnpj, status, credit_score, bot_memory, birth_date, email, address";
    const { data: convoExisting,error:existingError } = await supabase.from("whatsapp_conversations").select("id, client_id, bot_paused, blocked, needs_human, last_message_preview, last_message_from").eq("user_id", userId).eq("phone", senderPhone).maybeSingle();
    if(existingError)throw Error('conversation_lookup_unavailable');
    let preboundClient: any = null;
    if (convoExisting?.client_id) {
      const { data: c,error:clientError } = await supabase.from("clients").select(CLIENT_FIELDS).eq("id", convoExisting.client_id).eq("user_id",userId).maybeSingle();
      if(clientError)throw Error('client_lookup_unavailable');
      if (c) {
        // Confirma que o telefone AINDA bate com esse cliente — evita vínculo "podre"
        if (samePhoneBR(senderPhone, c.whatsapp || "") || samePhoneBR(senderPhone, c.phone || "")) {
          preboundClient = c;
        } else {
          console.warn("[client_lookup] conversation.client_id não bate mais com o telefone; ignorando vínculo antigo");
        }
      }
    }
    const ident = await identifyClient(supabase, { userId, senderPhone, incomingText, preboundClient });
    let ambiguousCandidates: any[] = [];
    if (ident.status === "unique") {
      client = ident.client;
      // Se veio de match por telefone/CPF e a conversa não estava vinculada, vincula agora
      if (!preboundClient && convoExisting?.id) {
        await supabase.from("whatsapp_conversations").update({ client_id: client.id }).eq("id", convoExisting.id).then(() => {}, () => {});
      }
    } else if (ident.status === "ambiguous") {
      ambiguousCandidates = ident.candidates;
      client = null;
    } else {
      client = null;
    }
    await auditDecision(supabase, {
      userId,
      conversationId: convoExisting?.id ?? null,
      clientId: client?.id ?? null,
      intent: `identify_${ident.status}`,
      outcome: "ok",
      details: {
        sender_phone: senderPhone,
        match_type: ident.status === "unique" ? (ident as any).matchType : null,
        candidate_count: ident.status === "ambiguous" ? ambiguousCandidates.length : (ident.status === "unique" ? 1 : 0),
      },
    });

    const { data: profile } = await supabase.from("profiles").select("name, pix_key, pix_key_type").eq("id", userId).single();

    const pushName = data?.pushName || data?.message?.pushName || null;
    const convoId = await upsertConversation(supabase, {
      userId, phone: senderPhone, jid: senderJid, instance: instanceName,
      clientId: client?.id ?? null, contactName: client?.name || pushName,
      preview: incomingText || `[${messageType}]`, from: "client", incrementUnread: true,
    });
    if (convoId) {
      await logMessage(supabase, {
        conversationId: convoId, userId, direction: "in", sender: "client",
        messageType, content: incomingText || "", waMessageId: msgId, metadata: { jid: senderJid, mime: mimeType },
      });
      // Qualquer resposta do cliente invalida o encerramento pendente da sessão.
      await supabase.from("whatsapp_scheduled_messages")
        .update({ status: "cancelled", error: "client_replied" })
        .eq("conversation_id", convoId)
        .eq("text", SESSION_TIMEOUT_MESSAGE)
        .in("status", ["pending", "awaiting_approval"]);
    }

    // Each event remains retryable until processing completes. Later fragments
    // must never be acknowledged as grouped after the first worker has read.
    const {data: ownsResponse,error: responseError} = await supabase.rpc("begin_whatsapp_response",{_user_id:userId,_jid:scope,_lease_token:leaseToken});
    if(responseError || !ownsResponse) return new Response(JSON.stringify({error:"conversation_busy"}),{status:503,headers:corsHeaders});
    finishResponse = async() => { const {error} = await supabase.rpc("finish_whatsapp_response",{_user_id:userId,_jid:scope,_lease_token:leaseToken});if(error)throw Error("response_ack_unavailable"); };

    const sessionWasClosed = convoExisting?.last_message_preview === SESSION_TIMEOUT_MESSAGE;

    if (convoExisting?.blocked) return new Response(JSON.stringify({ status: "blocked" }), { headers: corsHeaders });

    let replyIndex = 0;
    const botSay = async (text:string) => {
      const cleanText = withoutEmoji(text);
      if(!cleanText || !convoId) return;
      const {data: state,error: stateError} = await supabase.from("whatsapp_conversations").select("bot_paused,needs_human,blocked").eq("id",convoId).eq("user_id",userId).single();
      if(stateError) throw Error("conversation_state_unavailable");
      if(state.blocked) return;
      const handoff = state.bot_paused || state.needs_human;
      const chunks = splitWhatsAppText(cleanText);
      for(const chunk of chunks) {
        const job = await queueBotMessage(supabase,{user_id:userId,conversation_id:convoId,client_id:client?.id || null,
          text:chunk,purpose:handoff?"handoff_notice":"bot_reply",status:settings.bot_auto_send===true||testRecipientScope(userId,senderJid)===true?"pending":"awaiting_approval",
          scheduled_for:new Date().toISOString(),source_key:`reply:${instanceName}:${msgId}:${handoff?"handoff:":""}${replyIndex++}`});
        if(job.status!=="pending" || Date.now()>=deadline-13_000)continue;
        const {data: claimed,error} = await supabase.rpc("claim_whatsapp_job",{_id:job.id,_user_id:userId});
        if(error)throw Error("reply_claim_unavailable");
        if(claimed?.[0]) await deliverBotJob(supabase,claimed[0]);
      }
    };

    let inboundAttachmentPath: string | null = null;
    if(messageType!=="text"&&apiUrl&&apiKey){
      const resp=await evolutionFetch(apiUrl,apiKey,`/chat/getBase64FromMediaMessage/${instanceName}`,{message:{key,message:msgContent},convertToMp4:false});
      if(resp?.ok)mediaData=(await resp.json()).base64;
      if(!mediaData)throw Error("attachment_download_unavailable");
      inboundAttachmentPath=await saveBotAttachment(supabase,userId,msgId,mediaData,mimeType||"application/octet-stream");
      const {error}=await supabase.from("whatsapp_messages").update({metadata:{jid:senderJid,mime:mimeType,storage_path:inboundAttachmentPath}}).eq("user_id",userId).eq("wa_message_id",msgId);
      if(error)throw Error("attachment_log_unavailable");
    }

    if (convoExisting?.bot_paused || convoExisting?.needs_human) return new Response(JSON.stringify({status:"paused"}),{headers:corsHeaders});
    if (testRecipientScope(userId,senderJid) === false) return new Response(JSON.stringify({status:'test_recipient_ignored'}),{headers:corsHeaders});
    if(!settings.bot_enabled || !automationAllowed) return new Response(JSON.stringify({status:"automation_unavailable"}),{headers:corsHeaders});

    if (messageType === "audio" && settings.bot_process_audio !== true) {
      await botSay("O atendimento por áudio está desativado. Envie sua mensagem por escrito.");
      return new Response(JSON.stringify({status:"audio_disabled"}),{headers:corsHeaders});
    }
    if ((messageType === "image" || messageType === "document") && settings.bot_process_receipts !== true) {
      if(convoId)await escalateToHuman(supabase,convoId,"Anexo recebido; reconhecimento automático desativado");
      await botSay("Recebi seu arquivo e encaminhei para conferência da equipe.");
      return new Response(JSON.stringify({status:"receipt_recognition_disabled"}),{headers:corsHeaders});
    }
    if (client && messageType === "audio" && mediaData) {
      const transcript = await transcribeInboundAudio(mediaData, mimeType, userId);
      if (transcript) {
        incomingText = transcript;
        await supabase.from("whatsapp_messages").update({
          content: transcript,
          metadata: { jid: senderJid, mime: mimeType, storage_path:inboundAttachmentPath, transcript, transcribed: true },
        }).eq("user_id", userId).eq("wa_message_id", msgId);
      } else {
        if(convoId)await escalateToHuman(supabase,convoId,"Áudio recebido para atendimento pela equipe");
        await botSay("Recebi seu áudio e encaminhei para a equipe. Se preferir continuar por escrito, envie sua mensagem aqui.");
        return new Response(JSON.stringify({ status: "audio_transcription_failed" }), { headers: corsHeaders });
      }
    }


    if (requestsHumanNegotiation(incomingText)) {
      if (convoId) await escalateToHuman(supabase,convoId,'Pedido de negociação: atendimento exclusivamente humano');
      await checkedBotQuery(supabase.from('notifications').insert({
        user_id:userId, type:'warning',
        message:`Pedido de negociação: ${client?.name || senderPhone}. A equipe deve assumir a conversa no Atendimento.`,
      }));
      await botSay(HUMAN_NEGOTIATION_REPLY);
      return new Response(JSON.stringify({status:'human_handoff',reason:'negotiation'}),{headers:corsHeaders});
    }

    if (sessionWasClosed && messageType==="text") {
      if (convoId) await supabase.from("whatsapp_conversations").update({
        bot_status: "active",
      }).eq("id", convoId);
      if (client) {
        const remembered = parseMemory(client.bot_memory);
        const resumeStage = String(remembered.service_menu_stage || "main");
        await supabase.from("clients").update({
          bot_memory: serializeMemory({ ...remembered, service_menu_started: true, resumed_at: new Date().toISOString(), last_menu_at: Date.now() }),
        }).eq("id", client.id);
        const company = settings.company_name || profile?.name || "CredMais Digital Pay";
        const resumeMessage = resumeStage === "documents"
          ? "Seu atendimento foi reaberto do ponto em que paramos. Pode continuar enviando os documentos pendentes, um arquivo por vez."
          : resumeStage === "loan_type"
          ? `Seu atendimento foi reaberto do ponto em que paramos. Escolha o tipo de empréstimo:\n\n${LOAN_TYPE_MENU}`
          : `Seu atendimento foi reaberto e o histórico continua salvo.\n\n*Menu — ${company}*\n${SERVICE_MENU}`;
        await botSay(resumeMessage);
        return new Response(JSON.stringify({ status: "session_resumed", stage: resumeStage }), { headers: corsHeaders });
      } else {
        const { data: leadToResume } = await supabase.from("leads").select("id, notes").eq("user_id", userId).eq("phone", senderPhone).maybeSingle();
        if (leadToResume) await supabase.from("leads").update({
          notes: { ...(leadToResume.notes || {}), service_menu_stage: "main", resumed_at: new Date().toISOString() },
        }).eq("id", leadToResume.id);
      }
      const company = settings.company_name || profile?.name || "CredMais Digital Pay";
      await botSay(`Seu atendimento foi reaberto. O histórico anterior continua salvo.\n\n*Menu — ${company}*\n${SERVICE_MENU}`);
      return new Response(JSON.stringify({ status: "session_reopened" }), { headers: corsHeaders });
    }

    if (convoExisting?.bot_paused) return new Response(JSON.stringify({ status: "paused" }), { headers: corsHeaders });
    if (apiUrl && apiKey) sendPresence(apiUrl, apiKey, instanceName, senderJid, "composing").catch(() => {});

    // AMBÍGUO: mesmo número em vários cadastros → pedir CPF antes de qualquer dado.
    if (!client && ambiguousCandidates.length > 1) {
      const empresa = settings.company_name || profile?.name || "nossa equipe";
      await botSay(
        `Olá! 👋 Aqui é da *${empresa}*.\n\nEncontrei *${ambiguousCandidates.length} cadastros* com este número. ` +
        `Pra eu te atender com segurança, me envia seu *CPF* (só os 11 números).`,
      );
      await auditDecision(supabase, {
        userId, conversationId: convoId, clientId: null,
        intent: "asked_cpf_disambiguation", outcome: "blocked",
        details: { candidate_ids: ambiguousCandidates.map((c: any) => c.id) },
      });
      return new Response(JSON.stringify({ status: "ambiguous_ask_cpf" }), { headers: corsHeaders });
    }

    if(!client && messageType!=="text" && (messageType==="audio" || settings.bot_use_ai!==true || !(anthropicApiKey||Deno.env.get("LOVABLE_API_KEY")||geminiConfigured(userId)))){
      if(messageType==="audio"&&settings.bot_process_audio!==true){await botSay("O atendimento por áudio está desativado. Envie sua mensagem por escrito.");}
      else{if(convoId)await escalateToHuman(supabase,convoId,"Arquivo recebido de novo contato para conferência");await botSay("Recebi seu arquivo e encaminhei para atendimento da equipe.");}
      return new Response(JSON.stringify({status:"lead_attachment_received"}),{headers:corsHeaders});
    }
    if (!client) {
      // ─── SDR: Agente completo de qualificação de lead ────────────
      try {
        const companyName = settings.company_name || profile?.name || "CredMais Digital Pay";

        // Carrega (ou cria) o lead persistente
        const { data: existingLead } = await supabase
          .from("leads")
          .select("*")
          .eq("user_id", userId)
          .eq("phone", senderPhone)
          .maybeSingle();

        let lead: any = existingLead;
        if (!lead) {
          const { data: created } = await supabase
            .from("leads")
            .insert({
              user_id: userId,
              phone: senderPhone,
              stage: "new",
              source: "whatsapp",
              last_message_at: new Date().toISOString(),
              notes: { pushName: pushName || null },
            })
            .select("*")
            .single();
          lead = created;
        }

        // Menu comercial determinístico. O bot informa e coleta documentos,
        // mas nunca decide condições nem conduz renegociação.
        const leadNotes = (lead?.notes || {}) as Record<string, any>;
        const leadMenuStage = leadNotes.service_menu_stage || null;
        const leadText = normalizeMenuText(incomingText);
        const leadMainChoice = /^([1-5])(?:[.)\s]*)$/.exec(leadText)?.[1]
          || (/pedir.*emprest|quero.*emprest/.test(leadText) ? "1" : null)
          || (/consult.*parcela/.test(leadText) ? "2" : null)
          || (/renegoci|acordo/.test(leadText) ? "3" : null)
          || (/novo.*emprest/.test(leadText) ? "4" : null)
          || (/atendente|humano|pessoa do time/.test(leadText) ? "5" : null);

        if (!leadMenuStage || /^(oi|ola|bom dia|boa tarde|boa noite|menu|opcoes|ajuda)$/.test(leadText)) {
          await supabase.from("leads").update({
            notes: { ...leadNotes, service_menu_stage: "main", service_menu_started_at: new Date().toISOString() },
            last_message_at: new Date().toISOString(),
          }).eq("id", lead.id);
          await botSay(`Olá! Você está falando com o atendimento virtual da *${companyName}*.\n\n${SERVICE_MENU}`);
          return new Response(JSON.stringify({ status: "lead_menu" }), { headers: corsHeaders });
        }

        if (leadMenuStage === "loan_type") {
          const type = loanTypeFromText(incomingText);
          if (!type) {
            await botSay(`Não consegui identificar a modalidade. Responda somente com uma das opções abaixo:\n\n${LOAN_TYPE_MENU}`);
            return new Response(JSON.stringify({ status: "lead_loan_type_invalid" }), { headers: corsHeaders });
          }
          await supabase.from("leads").update({
            stage: "awaiting_docs",
            notes: { ...leadNotes, service_menu_stage: "documents", loan_profile: type },
            last_message_at: new Date().toISOString(),
          }).eq("id", lead.id);
          await botSay(`${loanDocumentsMessage(companyName, type)}\n\nPode enviar os documentos por aqui, um arquivo por vez.`);
          return new Response(JSON.stringify({ status: "lead_documents", type }), { headers: corsHeaders });
        }

        if (leadMenuStage === "main" && leadMainChoice) {
          if (leadMainChoice === "1") {
            await supabase.from("leads").update({ notes: { ...leadNotes, service_menu_stage: "loan_type", request_kind: "new_customer" } }).eq("id", lead.id);
            await botSay(LOAN_TYPE_MENU);
          } else if (leadMainChoice === "2" || leadMainChoice === "4") {
            await botSay("Não localizei sua ficha por este número. Para consultar parcelas ou pedir um novo empréstimo como cliente, envie seu CPF com 11 números. Usarei o CPF somente para localizar seu cadastro.");
          } else {
            const reason = leadMainChoice === "3" ? "Lead solicitou renegociação" : "Lead solicitou atendente";
            await supabase.from("leads").update({ stage: "handoff", notes: { ...leadNotes, service_menu_stage: "human", handoff_reason: reason } }).eq("id", lead.id);
            if (convoId) await supabase.from("whatsapp_conversations").update({ needs_human: true, bot_paused: true, human_takeover_reason: reason }).eq("id", convoId);
            await supabase.from("notifications").insert({ user_id: userId, message: `${reason}: ${senderPhone}`, type: "warning" });
            await botSay(`Certo. Encaminhei seu atendimento para uma pessoa da equipe da *${companyName}*. O bot não negocia valores ou condições.`);
          }
          return new Response(JSON.stringify({ status: "lead_menu_choice", choice: leadMainChoice }), { headers: corsHeaders });
        }

        // Histórico recente da conversa para contexto
        let history: Array<{ role: "user" | "bot"; text: string }> = [];
        if (convoId) {
          const { data: msgs } = await supabase
            .from("whatsapp_messages")
            .select("direction, content")
            .eq("conversation_id", convoId)
            .order("created_at", { ascending: false })
            .limit(10);
          history = (msgs || [])
            .reverse()
            .map((m: any) => ({ role: m.direction === "in" ? "user" as const : "bot" as const, text: m.content || "" }))
            .filter(h => h.text);
        }

        const sdrMod = await import("../_shared/sdr.ts");
        const ctx = {
          lead,
          incomingText,
          pushName,
          settings,
          profile,
          companyName,
          history,
        };

        // 🧠 Camada de compreensão livre (LLM) — entende perguntas, correções
        // e inversão de cálculo antes da máquina de estados.
        let understood: Awaited<ReturnType<typeof sdrMod.understand>> = null;
        try { understood = await sdrMod.understand(ctx); } catch { /* ignora */ }

        // Aplica correções ao lead ANTES de decidir (permite regravar campos).
        if (understood?.kind === "correction" && understood.corrections) {
          Object.assign(lead, understood.corrections);
          ctx.lead = lead;
        }

        // Se está aguardando documentos, tenta baixar mídia e processar
        let awaitingDocsOpts: { mediaReceived: boolean; docKey?: string } = { mediaReceived: false };
        if (lead.stage === "awaiting_docs" && messageType !== "text" && apiUrl && apiKey) {
          try {
            const resp = await evolutionFetch(apiUrl, apiKey, `/chat/getBase64FromMediaMessage/${instanceName}`, { message: { key, message: msgContent }, convertToMp4: false });
            if (resp?.ok) {
              const b64 = (await resp.json()).base64 as string | undefined;
              if (b64) {
                mediaData = b64;
                const loanProfile = String((lead.notes as any)?.loan_profile || "pf");
                const review = await reviewUploadedDocument(b64, mimeType || "application/octet-stream", loanProfile, userId);
                const ext = mimeType === "application/pdf" ? "pdf" : (mimeType?.split("/")[1] || "jpg");
                const path = `${userId}/leads/${lead.id}/${review.document_type}-${Date.now()}.${ext}`;
                const cleanB64 = b64.replace(/^data:[^;]+;base64,/, "");
                const bytes = Uint8Array.from(atob(cleanB64), c => c.charCodeAt(0));
                const upload = await supabase.storage.from("uploads").upload(path, bytes, {
                  contentType: mimeType || "application/octet-stream", upsert: false,
                });

                const currentNotes = (lead.notes || {}) as Record<string, any>;
                const docs = (currentNotes.docs || {}) as Record<string, any>;
                const received: string[] = Array.isArray(docs.received) ? [...docs.received] : [];
                if (review.decision === "accepted" && !received.includes(review.document_type)) received.push(review.document_type);
                const validations = Array.isArray(docs.validations) ? [...docs.validations] : [];
                validations.push({ ...review, path: upload.error ? null : path, reviewed_at: new Date().toISOString() });
                const required = requiredDocumentTypes(loanProfile);
                const missing = required.filter(type => !received.includes(type));
                const completed = missing.length === 0;
                await supabase.from("leads").update({
                  stage: completed ? "handoff" : "awaiting_docs",
                  notes: { ...currentNotes, service_menu_stage: completed ? "human" : "documents", docs: { ...docs, received, validations, missing, completed_at: completed ? new Date().toISOString() : null } },
                  last_message_at: new Date().toISOString(),
                }).eq("id", lead.id);

                if (review.decision === "resend") {
                  await botSay(`Não consegui validar este arquivo. ${review.reasons.join("; ") || "A imagem está incompleta ou ilegível."}\n\nEnvie novamente com boa iluminação, sem cortes, reflexos ou desfoque.`);
                } else if (review.decision === "manual_review") {
                  await supabase.from("notifications").insert({ user_id: userId, message: `Documento de ${lead.name || senderPhone} precisa de revisão manual: ${review.reasons.join("; ")}`, type: "warning" });
                  await botSay(`Recebi o arquivo, mas ele precisa de revisão humana antes de ser aceito. Motivo: ${review.reasons.join("; ") || "não foi possível confirmar os elementos visuais"}. A equipe foi avisada.`);
                } else if (completed) {
                  if (convoId) await supabase.from("whatsapp_conversations").update({ needs_human: true, bot_paused: true, human_takeover_reason: "Documentação validada e completa" }).eq("id", convoId);
                  await supabase.from("notifications").insert({ user_id: userId, message: `Documentação completa de ${lead.name || senderPhone}; revisar para decisão final.`, type: "info" });
                  await botSay(`Documento identificado como *${review.label}* e aceito na triagem. Todos os documentos solicitados foram recebidos. A equipe fará a conferência final.`);
                } else {
                  const missingLabels = missing.map(type => DOCUMENT_LABELS[type] || type).join(", ");
                  await botSay(`Documento identificado como *${review.label}* e aceito na triagem.\n\nAinda falta enviar: ${missingLabels}.`);
                }
                return new Response(JSON.stringify({ status: "document_reviewed", review, missing }), { headers: corsHeaders });
              }
            }
          } catch (e) { console.warn("[docs] falha ao salvar mídia do lead:", e); }
        }

        const decision =
          understood?.kind === 'reverse_calc'
            ? {reply:HUMAN_NEGOTIATION_REPLY,updates:{stage:'handoff' as const},stage:'handoff' as const,needsHuman:true,handoffReason:'Condições de empréstimo: análise exclusivamente humana',intent:'handoff'}
          : lead.stage === "awaiting_docs"
            ? sdrMod.handleAwaitingDocsReply(ctx, awaitingDocsOpts)
            : lead.stage === "simulated"
            ? sdrMod.handleSimulatedReply(ctx)
            : sdrMod.decide(ctx);


        // FAQ knowledge — camada de conhecimento antes de fallbacks do SDR
        const faqCtxLead = {
          companyName: settings.company_name || profile?.name || "nossa equipe",
          firstName: (lead.name || pushName || "").toString().split(" ")[0] || "",
          portalLink: `${(Deno.env.get("SITE_URL") || "https://credmaisapp.com.br").replace(/\/$/, "")}/portal`,
          pixKey: profile?.pix_key || undefined,
          pixKeyType: profile?.pix_key_type || undefined,
          ownerName: profile?.name || undefined,
          rate: Number(settings.default_interest_rate ?? 15),
          term: Number(settings.default_term_months ?? 6),
          minAmount: Number(settings.min_loan_amount ?? 100),
          maxAmount: Number(settings.max_loan_amount ?? 100000),
          lateFeePct: Number(settings.late_fee_percent ?? 2),
          dailyFeePct: Number(settings.daily_interest_percent ?? 0.033),
          earlyDiscountPct: Number(settings.early_payment_discount_percent ?? 0),
          supportPhone: settings.portal_contact_phone || undefined,
          supportEmail: settings.portal_contact_email || undefined,
          businessHours: settings.business_hours || undefined,
          hasOpenInstallments: false,
          isKnownClient: false,
        };
        const faqLeadHit = findFaqMatch(incomingText, faqCtxLead);

        // Se o lead PERGUNTOU algo, responde a pergunta ANTES da próxima etapa.
        // Prioridade: FAQ (mais rico, com dados dinâmicos) > faqAnswer legado.
        if (understood?.kind === "question") {
          const ans = (faqLeadHit && faqLeadHit.score >= 10)
            ? faqLeadHit.answer
            : sdrMod.faqAnswer(understood.topic, ctx);
          decision.reply = `${ans}\n\n${decision.reply}`;
        }

        // Small talk ("ok", "valeu", "obrigado", "beleza") — acusa recebimento
        // e traz de volta a pergunta pendente sem soar robótico.
        if (understood?.kind === "small_talk") {
          const ack = /obrigad|valeu|vlw|agrade/i.test(incomingText) ? "Imagina! 🙌" :
                      /^ok|beleza|blz|show|top|ta bom|tá bom/i.test(incomingText.trim()) ? "Perfeito! 👌" :
                      "Show! 👍";
          decision.reply = `${ack} ${decision.reply}`;
        }

        // Se o modelo não entendeu (unclear) mas a FAQ pegou, injeta a resposta da FAQ
        if (understood?.kind === "unclear" && faqLeadHit && faqLeadHit.score >= 10) {
          decision.reply = `${faqLeadHit.answer}\n\n${decision.reply}`;
        } else if (understood?.kind === "unclear" && (lead.notes as any)?.last_intent) {
          decision.reply = `Desculpa, não peguei bem 🙈 ${decision.reply}`;
        }




        // Persiste alterações do lead (mantém memória de contexto)
        const mergedNotes = {
          ...(lead.notes || {}),
          ...((decision.updates as any).notes || {}),
          last_intent: decision.intent,
          last_bot_reply: decision.reply?.slice(0, 300) || "",
          last_turn_at: new Date().toISOString(),
        };
        const patch: any = {
          ...decision.updates,
          stage: decision.stage,
          last_message_at: new Date().toISOString(),
          score: sdrMod.scoreLead({ ...lead, ...decision.updates }, settings),
          notes: mergedNotes,
        };
        // Follow-up automático (24h) se ficou parado no meio da qualificação
        if (decision.stage === "qualifying") {
          patch.next_followup_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }
        if (!patch.tags) delete patch.tags;

        await supabase.from("leads").update(patch).eq("id", lead.id);

        // Polimento com IA (mantém o conteúdo determinístico)
        let finalReply = decision.reply;
        try {
          finalReply = await sdrMod.polishWithAI(decision.reply, ctx, history);
        } catch { /* mantém fallback */ }

        // Persist the takeover before sending the acknowledgement.
        if (decision.needsHuman && convoId) {
          await escalateToHuman(supabase,convoId,decision.handoffReason || 'SDR handoff');
          // `notifications` não tem coluna `title`. Com ela no payload, o aviso
          // nunca era gravado: o dono não ficava sabendo que um lead pediu
          // atendimento humano. O título virou a primeira linha da mensagem.
          await checkedBotQuery(supabase.from("notifications").insert({
            user_id: userId,
            message: `Lead pronto para atendimento: ${lead.name || "Lead"} (${senderPhone}) — ${decision.handoffReason || "aguardando consultor"}`,
            type: "info",
          }));
        }

        await botSay(finalReply);

        // Notifica dono quando é a primeira interação relevante
        if (lead.stage === "new" && decision.stage !== "new") {
          await supabase.from("notifications").insert({
            user_id: userId,
            
            message: ["Novo lead no WhatsApp", `${senderPhone} iniciou uma conversa de empréstimo`].filter(Boolean).join(" — "),
            type: "info",
          });
        }
      } catch (sdrErr) {
        // AI helpers already have deterministic fallbacks. Failed persistence
        // or handoff must stay retryable rather than acknowledge completion.
        throw sdrErr;
      }
      return new Response(JSON.stringify({ status: "lead" }), { headers: corsHeaders });

    }

    // ─── MENU INTERATIVO (cliente conhecido) ───────────────────────────
    // Menu contextual + linguagem natural + PIX Copia&Cola + deep-link
    // portal + escolha de parcela + pagamento parcial + confirmação de
    // handoff + follow-up + cooldown por opção + idempotência.
    {
      const txtRaw = (incomingText || "").trim();
      const txtLow = txtRaw.toLowerCase();

      const siteUrl = (Deno.env.get("SITE_URL") || "https://credmaisapp.com.br").replace(/\/$/, "");
      const empresa = settings.company_name || profile?.name || "CredMais Digital Pay";
      const firstName = (client.name || "").split(" ")[0] || "";

      // Estado leve do cliente (memória bot)
      const mem = parseMemory(client.bot_memory);
      // A text request for an existing debt or a human can interrupt a loan
      // application. Numeric replies still select the requested loan profile.
      const serviceInterrupt = /\b(?:parcelas?|prestacoes?|debito|divida|renegociacao|acordo|portal)\b/.test(normalizeMenuText(txtRaw))
        || matchesAny(txtRaw, HUMAN_WORDS);
      if (messageType === 'text' && serviceInterrupt && ['loan_type','documents'].includes(String(mem.service_menu_stage))) {
        mem.service_menu_stage = 'main';
        await checkedBotQuery(supabase.from('clients').update({bot_memory:serializeMemory(mem)}).eq('id',client.id).eq('user_id',userId));
      }
      const lastMenuAt: number = Number(mem.last_menu_at || 0);
      const lastChoice: string | null = mem.last_menu_choice || null;
      const now = Date.now();
      const nowBrDay = new Date(now - 3 * 60 * 60 * 1000).toISOString().split("T")[0];

      // Helper: parcelas em aberto do cliente (agent_core: só com saldo > 0)
      const loadOpenInstallments = async () => {
        const bucket = await loadClientInstallments(supabase, client.id, nowBrDay, userId);
        // Devolve pending/overdue ordenadas por vencimento (compatível com o resto do fluxo)
        return [...bucket.overdue, ...bucket.dueToday, ...bucket.future];
      };
      const loadContractStats = async () => {
        const all=await botRows(()=>supabase.from("contract_installments").select("amount,paid_amount,status").eq("user_id",userId).eq("client_id",client.id).order("id"));
        const total = (all || []).length;
        const paid = (all || []).filter((i: any) => i.status === "paid").length;
        const totalDue = (all || []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
        const totalPaid = (all || []).reduce((s: number, i: any) => s + Number(i.paid_amount || 0), 0);
        return { total, paid, totalDue, totalPaid, pct: total > 0 ? Math.round((paid / total) * 100) : 0 };
      };

      // Deep-link do portal com sessão pré-autenticada
      const buildPortalDeepLink = () => botPortalLink(supabase,userId,client.id,siteUrl);

      // Follow-up automático (agenda mensagem em 24h se cliente não retornar)
      const scheduleFollowUp = async (text: string, hours = 24) => {
        if (!convoId) return;
        try {
          await supabase.from("whatsapp_scheduled_messages").insert({
            conversation_id: convoId,
            user_id: userId,
            text,
            scheduled_for: new Date(now + hours * 3600_000).toISOString(),
            status: "pending",
            purpose: "service_followup",
            client_id: client?.id || null,
          });
        } catch (e) { console.warn("[followup] falhou:", e); }
      };

      // Estatística rápida pra decidir menu contextual
      const openInstQuick = await loadOpenInstallments();
      const hasOpen = openInstQuick.length > 0;
      const hasPix = !!profile?.pix_key;
      const humanRequested = !!(convoExisting as any)?.needs_human;

      if (/status.*comprovante|comprovante.*(?:status|aprov|analis|rejeit)|foi aprovado/i.test(txtLow)) {
        const { data: review } = await checkedBotQuery<{data:{status:string}|null;error?:unknown}>((supabase as any).from("whatsapp_receipt_reviews")
          .select("status,created_at,reviewed_at,metadata").eq("user_id", userId).eq("client_id", client.id)
          .order("created_at", { ascending: false }).limit(1).maybeSingle());
        const pendingReceipt=await pendingClientReceipt(supabase,userId,client.id);
        const reviewStatus=pendingReceipt?'pending':review?.status || 'not_found';
        const statusText = pendingReceipt ? "Seu comprovante foi recebido e continua em análise. A cobrança permanece pausada até a conferência."
          : !review ? "Não encontrei comprovante enviado para análise."
          : review.status === "approved" ? "Seu comprovante foi aprovado e a baixa foi registrada."
          : review.status === "rejected" ? "O comprovante não foi aprovado. A equipe poderá orientar o motivo e solicitar um novo arquivo."
          : "Seu comprovante foi recebido e continua em análise. A cobrança permanece pausada até a conferência.";
        await botSay(statusText);
        return new Response(JSON.stringify({ status: "receipt_status", review_status: reviewStatus }), { headers: corsHeaders });
      }

      if (/cancelar|desmarcar|esquecer/.test(txtLow) && /promessa|previs[aã]o|combinado|pagamento/.test(txtLow)) {
        await checkedBotQuery(supabase.from('payment_promises').update({status:'cancelled'})
          .eq('user_id',userId).eq('client_id',client.id).eq('status','open'));
        const keptPromises = (Array.isArray(mem.promessas) ? mem.promessas : []).filter((promise: any) => !promise?.data || promise.data < nowBrDay);
        await checkedBotQuery(supabase.from("clients").update({ bot_memory: serializeMemory({ ...mem, promessas: keptPromises, payment_promise_cancelled_at: new Date().toISOString() }) }).eq("id", client.id).eq('user_id',userId));
        await checkedBotQuery(supabase.from("audit_logs").insert({ user_id: userId, entity_type: "whatsapp_bot", action: "payment_promise_cancelled", entity_id: client.id, details: { message: txtRaw.slice(0, 200) } }));
        await botSay(`Certo, ${firstName}. Cancelei a previsão de pagamento anterior. Se quiser informar uma nova data, pode escrever, por exemplo: “pago sexta-feira”.`);
        return new Response(JSON.stringify({ status: "promise_cancelled" }), { headers: corsHeaders });
      }

      const newPromiseDate = /pag|acert|deposit|transfer|mudar|alterar/.test(txtLow) ? parseNaturalPaymentDate(txtRaw) : null;
      const changingPromise = /mudar|alterar|corrigir|nova data|na verdade/.test(txtLow);
      const committingPayment = /\b(?:pago|pagarei|vou pagar|consigo pagar|posso pagar|vou depositar|vou transferir)\b/.test(txtLow);
      if (newPromiseDate && (changingPromise || committingPayment) && hasOpen && !/(?:s[oó]|somente|apenas)\s+(?:os\s+)?juros/.test(txtLow)) {
        const display = newPromiseDate.split("-").reverse().join("/");
        const promisedAmount = extractPromisedAmount(txtRaw);
        const previous = (Array.isArray(mem.promessas) ? mem.promessas : []).filter((promise: any) => !promise?.data || promise.data < nowBrDay);
        await checkedBotQuery(supabase.from("audit_logs").insert({ user_id: userId, entity_type: "whatsapp_bot", action: changingPromise ? "payment_promise_changed" : "promise_to_pay", entity_id: client.id, details: { promise_date: newPromiseDate, promise_amount: promisedAmount, message: txtRaw.slice(0, 200) } }));
        await checkedBotQuery(supabase.from("clients").update({ bot_memory: serializeMemory({ ...mem, promessas: [{ data: newPromiseDate, valor: promisedAmount, contexto: changingPromise ? "Data corrigida pelo cliente" : "Previsão informada pelo cliente" }, ...previous] }) }).eq("id", client.id).eq('user_id',userId));
        await botSay(`${changingPromise ? 'Atualizei' : 'Registrei'} sua previsão de pagamento${promisedAmount ? ` de ${money(promisedAmount)}` : ''} para ${display}. Quando pagar, envie o comprovante para conferência.`);
        return new Response(JSON.stringify({ status: changingPromise ? "promise_changed" : "promise_registered", promise_date: newPromiseDate }), { headers: corsHeaders });
      }

      // Menu principal fixo da CredMais Digital Pay.
      type MenuItem = { id: string; label: string; short: string };
      const menuItems: MenuItem[] = [
        { id: "1", label: "Solicitar empréstimo", short: "Solicitar empréstimo" },
        { id: "2", label: "Consultar parcelas", short: "Ver parcelas" },
        { id: "3", label: "Solicitar renegociação", short: "Atendente" },
        { id: "4", label: "Novo empréstimo (cliente ativo)", short: "Novo empréstimo" },
        { id: "5", label: "Falar com atendente", short: "Atendente" },
      ];

      const menuBody = `${SERVICE_MENU}\n\n_Você também pode escrever a opção. Digite *menu* para voltar._`;

      const showMenu = async (prefix?: string) => {
        const header = prefix ? `${prefix}\n\n` : "";
        await botSay(`${header}📋 *Menu — ${empresa}*\n${menuBody}`);
        await checkedBotQuery(supabase.from("clients").update({
          bot_memory: serializeMemory({ ...mem, last_menu_at: now }),
        }).eq("id", client.id).eq("user_id", userId));
      };

      if (mem.service_menu_stage === "documents" && messageType !== "text" && apiUrl && apiKey) {
        const mediaResponse = await evolutionFetch(apiUrl, apiKey, `/chat/getBase64FromMediaMessage/${instanceName}`, { message: { key, message: msgContent }, convertToMp4: false });
        const b64 = mediaResponse?.ok ? (await mediaResponse.json()).base64 as string | undefined : undefined;
        if (!b64) {
          await botSay("Não consegui abrir esse arquivo. Envie novamente como imagem nítida ou PDF.");
          return new Response(JSON.stringify({ status: "document_download_failed" }), { headers: corsHeaders });
        }
        const loanProfile = String(mem.loan_profile || "pf");
        const review = await reviewUploadedDocument(b64, mimeType || "application/octet-stream", loanProfile, userId);
        const ext = mimeType === "application/pdf" ? "pdf" : (mimeType?.split("/")[1] || "jpg");
        const path = `${userId}/clients/${client.id}/documents/${review.document_type}-${Date.now()}.${ext}`;
        const cleanB64 = b64.replace(/^data:[^;]+;base64,/, "");
        const bytes = Uint8Array.from(atob(cleanB64), c => c.charCodeAt(0));
        const upload = await supabase.storage.from("uploads").upload(path, bytes, { contentType: mimeType || "application/octet-stream", upsert: false });
        const received: string[] = Array.isArray(mem.loan_documents_received) ? [...mem.loan_documents_received] : [];
        if (review.decision === "accepted" && !received.includes(review.document_type)) received.push(review.document_type);
        const validations = Array.isArray(mem.loan_document_validations) ? [...mem.loan_document_validations] : [];
        validations.push({ ...review, path: upload.error ? null : path, reviewed_at: new Date().toISOString() });
        const missing = requiredDocumentTypes(loanProfile).filter(type => !received.includes(type));
        const completed = missing.length === 0;
        await checkedBotQuery(supabase.from("clients").update({ bot_memory: serializeMemory({
          ...mem,
          service_menu_stage: completed ? "human" : "documents",
          loan_documents_received: received,
          loan_document_validations: validations,
          loan_documents_missing: missing,
        }) }).eq("id", client.id).eq("user_id", userId));

        if (review.decision === "resend") {
          await botSay(`Não consegui validar este arquivo. ${review.reasons.join("; ") || "A imagem está incompleta ou ilegível."}\n\nEnvie novamente com boa iluminação, sem cortes, reflexos ou desfoque.`);
        } else if (review.decision === "manual_review") {
          await supabase.from("notifications").insert({ user_id: userId, message: `Documento de ${client.name} precisa de revisão manual: ${review.reasons.join("; ")}`, type: "warning" });
          await botSay(`Recebi o arquivo, mas ele precisa de revisão humana antes de ser aceito. Motivo: ${review.reasons.join("; ") || "não foi possível confirmar os elementos visuais"}. A equipe foi avisada.`);
        } else if (completed) {
          if (convoId) await supabase.from("whatsapp_conversations").update({ needs_human: true, bot_paused: true, human_takeover_reason: "Documentação validada e completa" }).eq("id", convoId);
          await supabase.from("notifications").insert({ user_id: userId, message: `Documentação completa de ${client.name}; revisar para decisão final.`, type: "info" });
          await botSay(`Documento identificado como *${review.label}* e aceito na triagem. Todos os documentos solicitados foram recebidos. A equipe fará a conferência final.`);
        } else {
          await botSay(`Documento identificado como *${review.label}* e aceito na triagem.\n\nAinda falta enviar: ${missing.map(type => DOCUMENT_LABELS[type] || type).join(", ")}.`);
        }
        return new Response(JSON.stringify({ status: "document_reviewed", review, missing }), { headers: corsHeaders });
      }

      // A primeira resposta sempre apresenta o menu. Se o cliente já escolheu
      // pedir um empréstimo, a próxima mensagem é interpretada como modalidade.
      if (!mem.service_menu_started && messageType === "text" && !/comprovante|paguei|transferi/i.test(incomingText)) {
        await showMenu(`Olá ${firstName}! Você está falando com o atendimento virtual da *${empresa}*.`);
        await checkedBotQuery(supabase.from("clients").update({
          bot_memory: serializeMemory({ ...mem, service_menu_started: true, service_menu_stage: "main", last_menu_at: now }),
        }).eq("id", client.id).eq("user_id", userId));
        return new Response(JSON.stringify({ status: "menu_first_interaction" }), { headers: corsHeaders });
      }

      if (mem.service_menu_stage === "loan_type") {
        if (/^(menu|opcoes|opções|voltar|inicio|início)$/.test(txtLow)) {
          await showMenu();
          await checkedBotQuery(supabase.from("clients").update({
            bot_memory: serializeMemory({ ...mem, service_menu_stage: "main", last_menu_at: now }),
          }).eq("id", client.id).eq("user_id", userId));
          return new Response(JSON.stringify({ status: "menu_shown" }), { headers: corsHeaders });
        }
        const type = loanTypeFromText(txtRaw);
        if (!type) {
          await botSay(`Não consegui identificar a modalidade. Responda com um número:\n\n${LOAN_TYPE_MENU}`);
          return new Response(JSON.stringify({ status: "loan_type_invalid" }), { headers: corsHeaders });
        }
        await botSay(`${loanDocumentsMessage(empresa, type)}\n\nPode enviar os documentos por aqui, um arquivo por vez.`);
        await checkedBotQuery(supabase.from("clients").update({
          bot_memory: serializeMemory({ ...mem, service_menu_stage: "documents", loan_profile: type, last_menu_at: now }),
        }).eq("id", client.id).eq("user_id", userId));
        return new Response(JSON.stringify({ status: "loan_documents", type }), { headers: corsHeaders });
      }

      // ─── Roteamento por linguagem natural ────────────────────────────
      const naturalRoute = (): { choice: string; parcelHint?: number; amountHint?: number } | null => {
        const t = txtLow;
        // Números direto
        const numMatch = /^([1-5])[\.\)\s]*$/.exec(txtRaw);
        if (numMatch) return { choice: numMatch[1] };
        // Botão pressionado (buttonId → menu_X)
        const btn = /menu_([1-5])/.exec(txtRaw);
        if (btn) return { choice: btn[1] };
        if (/\bportal\b/i.test(t)) return {choice:'portal'};
        const explicitParcel = /(?:parcela|prestacao|prestação|#)\s*(\d{1,3})/i.exec(t);
        if (explicitParcel) return { choice: "2", parcelHint: Number(explicitParcel[1]) };
        const ordinalWords: Array<[RegExp, number]> = [
          [/\b(?:primeira|primeiro|1[ªº])\b/i, 1], [/\b(?:segunda|segundo|2[ªº])\b/i, 2],
          [/\b(?:terceira|terceiro|3[ªº])\b/i, 3], [/\b(?:quarta|quarto|4[ªº])\b/i, 4],
          [/\b(?:quinta|quinto|5[ªº])\b/i, 5],
        ];
        const ordinal = ordinalWords.find(([pattern]) => pattern.test(t));
        if (ordinal && /parcela|prestacao|prestação|vencimento|pagar|pix/i.test(t)) return { choice: "2", parcelHint: ordinal[1] };
        // Palavras naturais equivalentes às cinco opções.
        if (/(consultar|ver|quais|minhas|listar|abertas?).*parc|parcela.*aberta|extrato|meu.?debito|débito|debito|em atraso|atrasadas?/i.test(t)) {
          return { choice: "2" };
        }
        if (/(renegoci|acordo|parcel(ar)? de novo|refinanc|nova negocia)/i.test(t)) {
          return { choice: "3" };
        }
        if (/(novo|outro|mais um).*(emprest|credito)|emprest.*cliente/i.test(t)) {
          return { choice: "4" };
        }
        if (matchesAny(t, HUMAN_WORDS) || /(atendente|humano|pessoa|consultor|gerente|responsavel|falar com voc[eê])/i.test(t)) {
          return { choice: "5" };
        }
        if (/(pedir|quero|preciso|solicitar|fazer).*(emprest|credito)/i.test(t)) {
          return { choice: "1" };
        }
        return null;
      };

      const isMenuTrigger = /^(menu|opc[oõ]es|opcoes|ajuda|op[cç][aã]o|comandos)$/i.test(txtLow);
      const route = naturalRoute();

      // Idempotência: se cliente repetir a mesma opção em <30s, silencia
      const cooldown = 30_000;
      if (route && route.choice === lastChoice && (now - lastMenuAt) < cooldown) {
        console.log("[menu] cooldown — resposta suprimida", { choice: route.choice });
        return new Response(JSON.stringify({ status: "menu_cooldown" }), { headers: corsHeaders });
      }

      if (route) {
        const choice = route.choice;

        if (choice === "1" || choice === "4") {
          await checkedBotQuery(supabase.from("clients").update({
            bot_memory: serializeMemory({
              ...mem,
              service_menu_started: true,
              service_menu_stage: "loan_type",
              request_kind: choice === "4" ? "existing_customer" : "loan_request",
              last_menu_choice: choice,
              last_menu_at: now,
            }),
          }).eq("id", client.id).eq("user_id", userId));
          await botSay(`${choice === "4" ? "Vamos iniciar uma nova solicitação usando sua ficha atual." : "Certo, vamos iniciar sua solicitação."}\n\n${LOAN_TYPE_MENU}`);
          return new Response(JSON.stringify({ status: "loan_type_menu", choice }), { headers: corsHeaders });
        }

        if (choice === "3" || choice === "5") {
          const reason = choice === "3" ? "Cliente solicitou renegociação" : "Cliente solicitou atendimento humano";
          const recentContext = [
            `Motivo: ${reason}`,
            txtRaw && !/^[1-5]$/.test(txtRaw) ? `Mensagem: ${txtRaw.slice(0, 220)}` : "",
            openInstQuick.length ? `${openInstQuick.length} parcela(s) em aberto` : "Sem parcelas em aberto",
          ].filter(Boolean).join(" · ");
          if (convoId) {
            await supabase.from("whatsapp_conversations").update({
              needs_human: true,
              bot_paused: true,
              bot_status: "handoff",
              human_takeover_reason: recentContext,
              updated_at: new Date().toISOString(),
            }).eq("id", convoId);
          }
          await supabase.from("notifications").insert({
            user_id: userId,
            message: `${reason}: ${client.name || senderPhone} (${senderPhone})`,
            type: "warning",
          });
          await botSay(choice === "3"
            ? `Entendi. A renegociação é feita somente por uma pessoa da equipe da *${empresa}*. O bot não altera valores, prazos ou condições. Já encaminhei seu pedido.`
            : `Certo. Pausei o atendimento automático e avisei uma pessoa da equipe da *${empresa}*. Ela continuará por aqui.`);
          return new Response(JSON.stringify({ status: "human_handoff", choice }), { headers: corsHeaders });
        }

        if (choice === "2") {
          const overdue = openInstQuick.filter((i: any) => {
            const due = typeof i.due_date === "string" ? i.due_date.split("T")[0] : i.due_date;
            return due < nowBrDay;
          });
          const amountDue = (i: any) => Math.max(0, Number(i.amount || 0) + Number(i.late_fee || 0) - Number(i.paid_amount || 0));
          const formatDue = (i: any) => {
            const due = typeof i.due_date === "string" ? i.due_date.split("T")[0] : i.due_date;
            const [year, month, day] = String(due).split("-");
            return `${day}/${month}/${year}`;
          };

          const requested = route.parcelHint
            ? openInstQuick.find((i: any) => Number(i.installment_number) === route.parcelHint)
            : null;
          if (route.parcelHint && !requested) {
            await botSay(`Não encontrei a parcela #${route.parcelHint} em aberto. Posso listar as parcelas disponíveis se você quiser.`);
          } else if (requested) {
            const requestedAmount = amountDue(requested);
            const requestedDue = formatDue(requested);
            await botSay(`A parcela #${requested.installment_number} está em aberto, vence em ${requestedDue} e possui saldo atualizado de *${money(requestedAmount)}*.`);
            if (hasPix && requestedAmount > 0) {
              const emv = buildPixEmv({ key: profile.pix_key!, amount: requestedAmount, merchantName: profile.name || empresa, merchantCity: "SAO PAULO", txid: `PARC${requested.installment_number}` });
              await botSay(`*Chave PIX:* ${profile.pix_key}\n*PIX Copia e Cola:*\n\`${emv}\``);

            }
          } else if (overdue.length > 0) {
            const lines = overdue.slice(0, 10).map((i: any) =>
              `*Parcela #${i.installment_number}* — vencimento ${formatDue(i)} — ${money(amountDue(i))}`
            ).join("\n");
            const totalOverdue = overdue.reduce((sum: number, i: any) => sum + amountDue(i), 0);
            await botSay(`Você possui ${overdue.length} parcela${overdue.length > 1 ? "s" : ""} em atraso:\n\n${lines}\n\n*Total atualizado em atraso: ${money(totalOverdue)}*`);

            if (hasPix && totalOverdue > 0) {
              const emv = buildPixEmv({ key: profile.pix_key!, amount: totalOverdue, merchantName: profile.name || empresa, merchantCity: "SAO PAULO", txid: "ATRASADAS" });
              await botSay(`*Chave PIX:* ${profile.pix_key}\n*Favorecido:* ${profile.name || empresa}\n\n*PIX Copia e Cola:*\n\`${emv}\``);

            }
          } else {
            const next = openInstQuick
              .filter((i: any) => amountDue(i) > 0)
              .sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)))[0];

            if (!next) {
              await botSay(`Você está em dia, ${firstName}. Não há parcelas pendentes no momento.`);
            } else {
              const nextAmount = amountDue(next);
              await botSay(`Você está em dia, ${firstName}.\n\nSua próxima parcela é a *#${next.installment_number}*, no valor de *${money(nextAmount)}*, com vencimento em *${formatDue(next)}*.`);
              if (hasPix && nextAmount > 0) {
                const emv = buildPixEmv({ key: profile.pix_key!, amount: nextAmount, merchantName: profile.name || empresa, merchantCity: "SAO PAULO", txid: `PARC${next.installment_number || 1}` });
                await botSay(`*Chave PIX:* ${profile.pix_key}\n*Favorecido:* ${profile.name || empresa}\n\n*PIX Copia e Cola:*\n\`${emv}\``);

              } else {
                await botSay("A chave PIX do responsável pela conta ainda não foi cadastrada. Encaminhei a situação para atendimento humano.");
                if (convoId) await supabase.from("whatsapp_conversations").update({ needs_human: true, bot_paused: true, bot_status: "handoff", human_takeover_reason: "Consulta de parcela sem PIX cadastrado" }).eq("id", convoId);
              }
            }
          }
        }

        else if (choice === "portal") {
          const link = await buildPortalDeepLink();
          const isDeep = link.includes("?t=");
          await botSay(
            `🔐 *Portal do Cliente — ${empresa}*\n\n` +
            `${isDeep ? "🔑 *Acesso automático* (link exclusivo, válido por 30 minutos):" : "Acesse aqui:"}\n${link}\n\n` +
            `Lá você pode:\n` +
            `• Ver todas as parcelas e comprovantes 📄\n` +
            `• Baixar recibos em PDF 📥\n` +
            `• Consultar os contatos da equipe\n` +
            `• Acompanhar em tempo real ⚡\n\n` +
            `Digite *menu* pra voltar.`
          );
        }

        // Persiste última escolha
        await checkedBotQuery(supabase.from("clients").update({
          bot_memory: serializeMemory({ ...mem, last_menu_at: now, last_menu_choice: choice }),
        }).eq("id", client.id).eq("user_id", userId));

        // Log estruturado
        await supabase.from("audit_logs").insert({
          user_id: userId, entity_type: "whatsapp_bot", action: "menu_choice",
          entity_id: client.id, details: {
            phone: senderPhone, choice,
            parcel_hint: route.parcelHint || null,
            amount_hint: route.amountHint || null,
            has_open: hasOpen,
            has_pix: hasPix,
            natural_language: !/^[1-5]$/.test(txtRaw),
          },
        });
        return new Response(JSON.stringify({ status: "menu_choice", choice }), { headers: corsHeaders });
      }

      if (isMenuTrigger) {
        await showMenu(`Oi ${firstName}! 👋`);
        await supabase.from("audit_logs").insert({
          user_id: userId, entity_type: "whatsapp_bot", action: "menu_shown",
          entity_id: client.id, details: { phone: senderPhone, trigger: "keyword", items: menuItems.length },
        });
        return new Response(JSON.stringify({ status: "menu_shown" }), { headers: corsHeaders });
      }

    }




    // ─── SAUDAÇÃO PERSONALIZADA (cliente conhecido, primeira mensagem) ──
    // Se nunca conversamos com esse número (sem convo prévia) OU não há
    // nenhuma resposta do bot nas últimas 12h, cumprimenta pelo nome e
    // pergunta o que precisa — sem entrar direto em modo cobrança.
    try {
      let shouldGreet = !convoExisting;
      if (!shouldGreet && convoId) {
        const { data: lastOut } = await supabase
          .from("whatsapp_messages")
          .select("created_at")
          .eq("conversation_id", convoId)
          .eq("direction", "out")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!lastOut) shouldGreet = true;
        else if (Date.now() - new Date(lastOut.created_at).getTime() > 12 * 60 * 60 * 1000) shouldGreet = true;
      }
      // Só saúda se a mensagem do cliente for curta/genérica (oi, olá, bom dia…)
      // — se ele já mandou pergunta específica, deixa a IA responder.
      const txt = (incomingText || "").toLowerCase().trim();
      const isGreetingIntent = txt.length <= 20 && /^(oi+|ol[áa]|bom\s*dia|boa\s*tarde|boa\s*noite|opa|e\s*a[ií]|hey|hi|hello|tudo\s*bem|tudo\s*bom)[\s!?.,👋🙂😊🤝]*$/i.test(txt);
      if (messageType==="text" && shouldGreet && (isGreetingIntent || !incomingText)) {
        const firstName = (client.name || "").split(" ")[0] || "tudo bem";
        const empresa = settings.company_name || profile?.name || "nossa equipe";

        // Puxa contexto MÍNIMO pra saudação ficar consciente:
        //  - parcelas em atraso / vence hoje
        //  - promessa de pagamento em aberto
        //  - última intenção registrada na memória
        const todayStr = todayInSP();
        const bucket = await loadClientInstallments(supabase, client.id, todayStr, userId);
        const overdueQ = bucket.overdue;
        const dueTodayQ = bucket.dueToday;
        const totOver = bucket.totalOverdue;
        const totToday = bucket.totalDueToday;

        const {data:openPromise} = await checkedBotQuery(supabase.from('payment_promises').select('promised_for,promised_amount')
          .eq('user_id',userId).eq('client_id',client.id).eq('status','open').gte('promised_for',todayStr).limit(1).maybeSingle());

        let greeting: string;
        if (openPromise) {
          greeting = `Oi ${firstName}! Aqui é da *${empresa}*. Sua previsão de pagamento está registrada para *${openPromise.promised_for.split('-').reverse().join('/')}*${openPromise.promised_amount ? ` (${money(Number(openPromise.promised_amount))})` : ""}. Como posso te ajudar?`;
        } else if (overdueQ.length > 0) {
          const oldest = overdueQ[0];
          greeting = `Oi ${firstName}! 👋 Aqui é da *${empresa}*. Sua parcela #${oldest.installment_number} está em atraso — total a regularizar: *${money(totOver)}*. Vou te enviar o PIX agora pra você quitar. 🙏`;
        } else if (dueTodayQ.length > 0) {
          greeting = `Oi ${firstName}! 👋 Aqui é da *${empresa}*. Sua parcela de *${money(totToday)}* vence *hoje*. Quer que eu te envie o PIX?`;
        } else {
          const generic = [
            `Oi ${firstName}! 👋 Aqui é da *${empresa}*. Como posso te ajudar hoje?`,
            `Olá ${firstName}, tudo bem? 🙂 Aqui é da *${empresa}*. Me conta, em que posso te ajudar?`,
            `E aí ${firstName}! 🤝 Aqui é da *${empresa}*. O que você precisa hoje?`,
          ];
          greeting = generic[Math.floor(Math.random() * generic.length)];
        }

        const menuFooter =
          `\n\n${SERVICE_MENU}\n\nDigite *portal* para acessar o portal do cliente.`;
        await botSay(greeting + menuFooter);
        await supabase.from("audit_logs").insert({
          user_id: userId, entity_type: "whatsapp_bot", action: "greeted_known_client",
          entity_id: client.id, details: { phone: senderPhone, overdue: overdueQ.length, due_today: dueTodayQ.length, has_promise: !!openPromise },
        });
        return new Response(JSON.stringify({ status: "greeted" }), { headers: corsHeaders });
      }
    } catch (e) {
      console.warn("[greet] falhou (seguindo fluxo normal):", (e as Error).message);
    }

    if (isRateLimited(scope)) return new Response(JSON.stringify({ status: "rate_limit" }), { status:503,headers: corsHeaders });

    // LOCK (try/finally garante liberação mesmo em erro)
    const lockHeld = jidLock.get(scope) || 0;
    if (lockHeld && Date.now() - lockHeld < LOCK_TTL_MS) return new Response(JSON.stringify({ status: "locked" }), { status:503,headers: corsHeaders });
    jidLock.set(scope, Date.now());
    try {


    // COMMANDS
    if (matchesAny(incomingText, STOP_WORDS)) {
      await supabase.from("audit_logs").insert({ user_id: userId, entity_type: "whatsapp_bot", action: "paused", entity_id: client.id, details: { reason: "client_stop" } });
      await logBotAction(supabase, { userId, clientId: client.id, conversationId: convoId, toolName: "pause_bot", toolInput: { reason: "client_stop_command" } });
      await supabase.from("whatsapp_conversations").update({ bot_paused: true, bot_status: "paused" }).eq("id", convoId);
      await botSay("🤖 Bot pausado. Um atendente humano falará com você em breve.");
      return new Response(JSON.stringify({ status: "stopped" }), { headers: corsHeaders });
    }
    if (matchesAny(incomingText, HUMAN_WORDS)) {
      await logBotAction(supabase, { userId, clientId: client.id, conversationId: convoId, toolName: "escalate_to_human", toolInput: { reason: "client_requested_human" } });
      await escalateToHuman(supabase, convoId!, "Cliente pediu atendente humano");
      await botSay("👤 Chamando um atendente humano...");
      await supabase.from("notifications").insert({ user_id: userId,  message: ["🚨 Atendimento humano solicitado", `${client.name} pediu para falar com um humano.`].filter(Boolean).join(" — "), type: "warning" });
      return new Response(JSON.stringify({ status: "human" }), { headers: corsHeaders });
    }
    if (matchesAny(incomingText, PIX_WORDS) && profile?.pix_key) {
      await botSay(`Chave PIX: *${profile.pix_key}* (${profile.pix_key_type || "PIX"}). Aguardo o comprovante! ✅`);
      return new Response(JSON.stringify({ status: "pix" }), { headers: corsHeaders });
    }

    if (messageType==="text" && !isWithinBusinessHours(settings)) {
      await botSay(`Olá! Recebi sua mensagem fora do horário (${settings.bot_business_start || "08:00"} às ${settings.bot_business_end || "18:00"}). Retorno em breve! 🙏`);
      return new Response(JSON.stringify({ status: "off_hours" }), { headers: corsHeaders });
    }

    // ENRICH DATA (contexto rico p/ a IA)
    const [
      { data: activeContracts },
      { data: installments },
      { data: interactionLogs },
      { data: allPaid },
      { data: recentPaid },
      { data: humanNotes },
      { data: openPromises },
      { data: messageTemplates },
    ] = await Promise.all([
      botRows(()=>supabase.from("contracts").select("id, capital, total_amount, total_interest, installment_amount, grace_periods, start_date, status, loan_mode, frequency, interest_rate, num_installments").eq("user_id",userId).eq("client_id", client.id).in("status", ["active", "overdue"]).order("id")).then(data=>({data})),
      botRows(()=>supabase.from("contract_installments").select("id, amount, paid_amount, due_date, status, late_fee, scheduled_interest, installment_number, contract_id, pre_settlement_snapshot, contracts(status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent)").eq("user_id",userId).eq("client_id", client.id).not("status","in",'("paid","cancelled")').order("due_date", { ascending: true }).order("id")).then(data=>({data:data.map(row=>({...row,stored_late_fee:row.late_fee,late_fee:botLateFee(row)}))})),
      supabase.from("audit_logs").select("action, created_at, details").eq("entity_id", client.id).eq("user_id",userId).eq("entity_type", "whatsapp_bot").order("created_at", { ascending: false }).limit(10),
      botRows(()=>supabase.from("contract_installments").select("id").eq("user_id",userId).eq("client_id", client.id).eq("user_id",userId).eq("status", "paid").order("id")).then(data=>({data})),
      supabase.from("contract_installments").select("amount, paid_amount, paid_at, installment_number, payment_method").eq("client_id", client.id).eq("user_id",userId).eq("status", "paid").order("paid_at", { ascending: false }).limit(5),
      // A tabela guarda `conversation_id` e `author_name` — não `client_id` nem
      // `created_by`. Com os nomes errados a consulta devolvia 400, e as anotações
      // que a equipe escreve sobre o cliente NUNCA chegavam ao contexto da IA:
      // o bot atendia sem saber de nada que foi combinado por fora.
      supabase.from("whatsapp_notes").select("content, author_name, created_at").eq("conversation_id", convoId).eq("user_id",userId).order("created_at", { ascending: false }).limit(8),
      supabase.from("payment_promises").select("created_at, promised_for, promised_amount, status").eq("client_id", client.id).eq("user_id",userId).order("created_at", { ascending: false }).limit(40),
      supabase.from("message_templates").select("name, content").eq("user_id", userId).limit(8),
    ].map(async query=>{
      const result=await query;
      if('error' in result && result.error)throw Error('bot_context_unavailable');
      return {data:result.data as any[]|null};
    }));

    const paidCount = allPaid?.length || 0;

    const now = new Date();
    const brDate = new Date(now.getTime() - 3 * 60 * 60 * 1000); // UTC-3
    const todayStr = brDate.toISOString().split('T')[0];

    const daysBetween = (a: string, b: string) => {
      const da = new Date(a + "T12:00:00"); const db = new Date(b + "T12:00:00");
      return Math.round((db.getTime() - da.getTime()) / 86400000);
    };

    // Só considera parcelas com SALDO real (amount - paid_amount > 0) — protege contra
    // status desatualizado (ex: parcela quitada mas ainda marcada como 'overdue').
    const activeContractIds = new Set((activeContracts || []).map((contract: any) => contract.id));
    const openWithBalance = (installments || []).filter(i => {
      const paid = Number(i.paid_amount) || 0;
      const balance = (Number(i.amount) || 0) + (Number(i.late_fee) || 0) - paid;
      return activeContractIds.has(i.contract_id) && balance > 0.005;
    });
    const overdue = openWithBalance.filter(i => {
      const dueDate = typeof i.due_date === 'string' ? i.due_date.split('T')[0] : i.due_date;
      return dueDate < todayStr;
    });
    const dueToday = openWithBalance.filter(i => {
      const dueDate = typeof i.due_date === 'string' ? i.due_date.split('T')[0] : i.due_date;
      return dueDate === todayStr;
    });
    const upcoming = openWithBalance.filter(i => {
      const dueDate = typeof i.due_date === 'string' ? i.due_date.split('T')[0] : i.due_date;
      return dueDate > todayStr;
    }).slice(0, 3);

    const totalOverdue = overdue.reduce((s, i) => s + (Number(i.amount) - (Number(i.paid_amount) || 0)) + (Number(i.late_fee) || 0), 0);
    const totalDueToday = dueToday.reduce((s, i) => s + botBalance(i), 0);

    // Mesma cotação da confirmação financeira; pagamento parcial exige atendente.
    const rolloverOptions = (activeContracts || []).map(c => {
      const inst = openWithBalance.find(i => i.contract_id === c.id);
      if (!inst) return null;
      const interestOnly = botRenewalQuote(inst, c);
      if (interestOnly === null) return null;
      return {
        contractId: c.id,
        interestOnly,
        totalAmount: botBalance(inst),
        frequency: c.frequency,
      };
    }).filter(Boolean);

    // ─── FAQ KNOWLEDGE BASE ─────────────────────────────────────────
    // Antes de ir pra IA (que custa tokens), checamos a base de
    // conhecimento local com centenas de intents. Match direto = resposta
    // instantânea, determinística e sem consumir crédito.
    try {
      if (messageType === "text" && incomingText && incomingText.length >= 2) {
        const siteUrlFaq = (Deno.env.get("SITE_URL") || "https://credmaisapp.com.br").replace(/\/$/, "");
        const firstNameFaq = (client.name || "").split(" ")[0] || "";
        const faqCtx = {
          companyName: settings.company_name || profile?.name || "nossa equipe",
          firstName: firstNameFaq,
          portalLink: `${siteUrlFaq}/portal-cliente?o=${userId}`,
          pixKey: profile?.pix_key || undefined,
          pixKeyType: profile?.pix_key_type || undefined,
          ownerName: profile?.name || undefined,
          rate: Number(settings.default_interest_rate ?? 15),
          term: Number(settings.default_term_months ?? 6),
          minAmount: Number(settings.min_loan_amount ?? 100),
          maxAmount: Number(settings.max_loan_amount ?? 100000),
          lateFeePct: Number(settings.late_fee_percent ?? 2),
          dailyFeePct: Number(settings.daily_interest_percent ?? 0.033),
          earlyDiscountPct: Number(settings.early_payment_discount_percent ?? 0),
          supportPhone: settings.portal_contact_phone || undefined,
          supportEmail: settings.portal_contact_email || undefined,
          businessHours: settings.business_hours || undefined,
          hasOpenInstallments: openWithBalance.length > 0,
          isKnownClient: true,
        };
        const faqHit = findFaqMatch(incomingText, faqCtx);
        // Só respondemos direto da base se:
        // - Score alto (≥ 10 = match direto de regex)
        // - Não há tom hostil detectado (deixa a IA modular a resposta)
        // - Cliente não pediu explicitamente humano (roteado antes no menu)
        if (faqHit && faqHit.score >= 10 && !detectClientTone(incomingText).hostile) {
          await botSay(faqHit.answer);
          await supabase.from("audit_logs").insert({
            user_id: userId, entity_type: "whatsapp_bot", action: "faq_hit",
            entity_id: client.id, details: {
              phone: senderPhone,
              faq_id: faqHit.entry.id,
              category: faqHit.entry.category,
              score: faqHit.score,
              knowledge_base_size: FAQ_COUNT,
              message_preview: incomingText.slice(0, 120),
            },
          });
          return new Response(JSON.stringify({ status: "faq_hit", id: faqHit.entry.id, score: faqHit.score }), { headers: corsHeaders });
        }
      }
    } catch (e) {
      console.warn("[faq] falhou (seguindo pra IA):", (e as Error).message);
    }

    // Histórico de conversa (mais largo)

    const conversationHistory: any[] = [];
    if (convoId) {
      const { data: msgHistory } = await supabase
        .from("whatsapp_messages")
        .select("direction, content, message_type, metadata, created_at")
        .eq("conversation_id", convoId)
        .order("created_at", { ascending: false })
        .limit(80);
      (msgHistory || []).reverse().forEach(h => {
        const txt = h.content || h.metadata?.transcript || `[${h.message_type}]`;
        conversationHistory.push({ role: h.direction === "in" ? "user" : "assistant", content: txt });
      });
    }

    // Memória de longo prazo — JSON estruturado (com fallback p/ texto legado)
    const memoryObj = parseMemory(client.bot_memory);
    const memoryPretty = JSON.stringify(memoryObj, null, 2);
    const intentSummary = summarizeIntents(memoryObj, 6);
    const priorApproach = lastApproach(memoryObj);

    // O registro operacional exclui promessas canceladas, cumpridas ou vencidas.
    const pendingPromises = (openPromises || []).filter(p => p.status === 'open').map(p => ({
      date: p.promised_for,
      created_at: p.created_at,
      amount: p.promised_amount,
    })).filter(p => p.date && p.date >= todayStr);

    // Notas humanas e templates como referência
    const humanNotesText = (humanNotes || []).map(n => `- [${n.author_name || 'humano'} em ${(n.created_at || '').slice(0,10)}] ${n.content}`).join("\n").slice(0, 1500);
    const recentPaidText = (recentPaid || []).map(p => `- Parcela #${p.installment_number}: R$ ${Number(p.paid_amount || p.amount).toFixed(2)} em ${(p.paid_at || '').slice(0,10)}${p.payment_method ? ` (${p.payment_method})` : ''}`).join("\n");
    const templatesText = (messageTemplates || []).map(t => `• ${t.name}: ${t.content.slice(0, 120)}`).join("\n").slice(0, 800);

    const contractShort = (id?: string) => id ? `#${String(id).slice(0,6)}` : '';

    const overdueDetail = overdue.map(i => {
      const d = typeof i.due_date === 'string' ? i.due_date.split('T')[0] : i.due_date;
      const days = daysBetween(d, todayStr);
      return `- [Contrato ${contractShort(i.contract_id)}] Parcela #${i.installment_number}: R$ ${Number(i.amount).toFixed(2)} (${days}d em atraso, desde ${d}${i.late_fee ? `, multa R$ ${Number(i.late_fee).toFixed(2)}` : ''})`;
    }).join('\n');

    const upcomingDetail = upcoming.map(i => {
      const d = typeof i.due_date === 'string' ? i.due_date.split('T')[0] : i.due_date;
      return `- [Contrato ${contractShort(i.contract_id)}] Parcela #${i.installment_number}: R$ ${Number(i.amount).toFixed(2)} (vence em ${d})`;
    }).join('\n');

    const addr: any = client.address || {};
    const addressLine = (typeof addr === "object" && (addr.street || addr.city))
      ? `${addr.street || ''}${addr.number ? ', ' + addr.number : ''}${addr.city ? ' - ' + addr.city : ''}${addr.state ? '/' + addr.state : ''}`.trim()
      : (typeof addr === "string" ? addr : "");

    const scoreNum = client.credit_score ?? 50;
    const perfilPagador = scoreNum > 80 ? 'EXCELENTE' : scoreNum >= 60 ? 'BOM' : scoreNum >= 40 ? 'MEDIANO' : 'RISCO ALTO';
    const maxDiasAtraso = overdue.reduce((max, i) => {
      const d = typeof i.due_date === 'string' ? i.due_date.split('T')[0] : i.due_date;
      return Math.max(max, daysBetween(d, todayStr));
    }, 0);
    const estagio = maxDiasAtraso === 0 ? 'em dia' : maxDiasAtraso <= 3 ? 'lembrete amigável' : maxDiasAtraso <= 10 ? 'cobrança padrão' : maxDiasAtraso <= 30 ? 'cobrança firme' : 'pré-jurídico';

    // ─── Inteligência comportamental ──────────────────────────────────
    // Puxa histórico amplo para cálculo de perfil (limite maior que recentPaid)
    const { data: fullPaid } = await supabase
      .from("contract_installments")
      .select("amount, paid_amount, paid_at, due_date, installment_number, status")
      .eq("client_id", client.id)
      .eq("user_id", userId)
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .limit(40);

    const behavior = computeClientBehavior({
      paidHistory: (fullPaid || []) as any,
      pending: (installments || []) as any,
      promises: (openPromises || []).filter(p => ['open','broken'].includes(p.status)).map((p: any) => ({
        promise_date: p.promised_for,
        created_at: p.created_at,
      })),
      todayStr,
    });

    // Tom da mensagem atual (heurística rápida, roda antes da IA)
    const tone = detectClientTone(incomingText);

    // Contexto temporal (dia da semana, período do dia, fim de semana)
    const dowNames = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const brNow = brDate;
    const hourBR = brNow.getUTCHours();
    const dowBR = dowNames[brNow.getUTCDay()];
    const isWeekend = brNow.getUTCDay() === 0 || brNow.getUTCDay() === 6;
    const periodoDia = hourBR < 6 ? "madrugada" : hourBR < 12 ? "manhã" : hourBR < 18 ? "tarde" : "noite";
    const cumprimento = hourBR < 12 ? "Bom dia" : hourBR < 18 ? "Boa tarde" : "Boa noite";

    // Últimas 4 respostas do bot para detectar looping repetitivo
    const recentBotReplies = conversationHistory
      .filter(m => m.role === "assistant")
      .slice(-4)
      .map(m => m.content);
    const loopSignal = detectResponseLoop(recentBotReplies);

    // Escalonamento IMEDIATO por sinais fortes (antes mesmo de chamar a IA)
    let preEscalate: string | null = null;
    if (tone.hostile) preEscalate = "cliente_hostil";
    else if (behavior.brokenPromisesLast30d >= 2) preEscalate = "2+_promessas_quebradas_30d";
    else if (loopSignal.loop) preEscalate = `bot_em_loop_sim=${loopSignal.similarity}`;


    const empresaNome = settings.company_name || profile?.name || 'CredMais Digital Pay';
    const agenteNome = settings.bot_agent_name || 'Assistente';
    const canalVendas = settings.sales_channel_url || settings.company_name || '(canal oficial de vendas)';
    const prazoNegociacao = settings.negotiation_sla || '1 dia útil';
    const prazoBaixa = settings.payment_settlement_days || '2 dias úteis';

    const systemPrompt = `Você é ${agenteNome}, atendente virtual oficial da ${empresaNome}, empresa de empréstimo pessoal. Você cuida do atendimento de cobrança: entende o que o cliente quis dizer, responde dúvidas sobre as parcelas, ajuda a regularizar e registra o resultado. Você é PRECISO, EMPÁTICO, RESPEITOSO e NUNCA inventa fatos.

INFORMAÇÕES INSTITUCIONAIS: nome da empresa/canal: ${empresaNome}. Serviço: atendimento digital para solicitação de empréstimos, consulta de parcelas e encaminhamento ao time responsável. Se pedirem CNPJ, endereço, taxas, aprovação ou outra informação que não esteja nos dados deste atendimento, não invente; encaminhe para uma pessoa da equipe.

═══ CONVERSA NATURAL ═══
Converse como um bom atendente brasileiro no WhatsApp: natural, caloroso e direto, sem parecer texto pronto. Entenda abreviações, erros de digitação, frases quebradas, áudios transcritos e mensagens curtas pelo contexto. Não corrija o português do cliente.
Responda à ÚLTIMA intenção levando em conta as mensagens anteriores. Se ele mandar "sim", "pode", "amanhã", "quanto?" ou "manda", descubra pelo histórico a que se refere; não reinicie o atendimento e não repita a apresentação.
Antes de responder, pense em silêncio: (1) o que ele realmente quer agora? (2) o que já foi respondido? (3) qual é a menor resposta que resolve? Nunca exponha esse raciocínio.
Use contrações naturais quando combinarem com o tom ("pra", "tá", "te envio"), sem exagerar em gírias. Varie o começo das respostas. Evite bordões repetidos como "Entendo, [nome]" e "Posso ajudar em algo mais?".
Não transforme toda resposta em cobrança. Primeiro responda exatamente ao que foi perguntado; depois, se fizer sentido, conduza um único próximo passo. Faça apenas UMA pergunta por mensagem.
Se algo estiver ambíguo, pergunte de forma simples em vez de supor. Se houver emoção ou dificuldade, reconheça isso em uma frase genuína antes de tratar da pendência.
Se perguntarem, diga com transparência que você é o atendente virtual da ${empresaNome} e que pode chamar uma pessoa do time. Nunca finja ser uma pessoa real.

═══ 🚧 LIMITES INEGOCIÁVEIS DO SEU PAPEL ═══
✗ Você NÃO NEGOCIA. Nunca ofereça desconto, parcelamento da dívida, prorrogação, abatimento, revisão de valor ou qualquer "jeitinho". Qualquer pedido de negociação → needs_human=true (motivo: negociação), mesmo que o cliente insista ou implore.
✗ Você NÃO VENDE e NÃO simula empréstimo novo. Pedido de novo empréstimo → redirecione ao ${canalVendas}.
✗ Você só atende dúvidas ligadas à cobrança: valor em aberto, vencimento, 2ª via de PIX/boleto, confirmação de pagamento.
✗ Você NUNCA discute a dívida com terceiros. Só fala com o titular após confirmar identidade.
✗ Você NUNCA pede senha, código, dados de cartão ou pagamento fora dos meios oficiais gerados pelo sistema.
✗ Você NUNCA dá conselho jurídico ou financeiro.

═══ 🗣 TOM DE VOZ ═══
Respeitoso, humano, empático e objetivo. Firme na informação, nunca na pressão. Tom configurado pelo operador: ${settings.bot_tone || 'amigavel'}. Use o primeiro nome com moderação — não repita em toda mensagem. Em geral responda em 1–3 frases curtas; use mais linhas somente quando precisar listar parcelas. Uma pergunta por vez. Linguagem simples (sem juridiquês). NÃO use emojis em nenhuma resposta. NUNCA use CAIXA ALTA, ironia, sarcasmo ou tom de ameaça.

═══ 👤 PERFIL DO CLIENTE ═══
Nome: ${client.name} | Primeiro nome: ${client.name.split(' ')[0]}
CPF: ${client.cpf_cnpj ? String(client.cpf_cnpj).replace(/^(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})$/, '***.$2.$3-**') : 'n/d'} | Nascimento: ${client.birth_date || 'n/d'}
Telefone: ${client.phone || senderPhone} | E-mail: ${client.email || 'n/d'}
Status: ${client.status || 'Ativo'} | Score: ${scoreNum}/100 → PERFIL ${perfilPagador}
Parcelas já pagas no histórico: ${paidCount}

═══ 📂 CONTRATOS ATIVOS (${activeContracts?.length || 0}) ═══
⚠️ CADA CONTRATO É INDEPENDENTE. NUNCA some parcelas entre contratos.
${(activeContracts || []).map(c => `- Contrato ${contractShort(c.id)}: Capital R$ ${Number(c.capital).toFixed(2)} | ${c.num_installments || '?'}x | ${c.frequency} | taxa ${c.interest_rate}% | início ${c.start_date}`).join('\n') || '(nenhum)'}

═══ 💰 SITUAÇÃO — HOJE ${brDate.toLocaleDateString('pt-BR')} ═══
📅 Vence HOJE: R$ ${totalDueToday.toFixed(2)} (${dueToday.length} parcela(s))
⚠️ EM ATRASO (valor atualizado, já com encargos): R$ ${totalOverdue.toFixed(2)} (${overdue.length} parcela(s)) — maior atraso: ${maxDiasAtraso}d

Detalhe ATRASADAS (fonte de verdade — copie os valores LITERAL):
${overdueDetail || '(sem atrasos)'}

Detalhe VENCE HOJE:
${dueToday.map(i => `- [Contrato ${contractShort(i.contract_id)}] Parcela #${i.installment_number}: R$ ${Number(i.amount).toFixed(2)}`).join('\n') || '(nenhuma)'}

═══ ✅ ÚLTIMOS PAGAMENTOS ═══
${recentPaidText || '(nenhum pagamento ainda)'}

═══ 📝 NOTAS INTERNAS ═══
${humanNotesText || '(nenhuma)'}

═══ 🤝 PROMESSAS PENDENTES ═══
${pendingPromises.length ? pendingPromises.map(p => `- Prometeu pagar até ${p.date}${p.amount ? `: ${money(p.amount)}` : ''}`).join('\n') : '(nenhuma)'}

═══ 🧠 MEMÓRIA DE LONGO PRAZO ═══
${memoryPretty}

═══ 🎯 INTENÇÕES RECENTES ═══
${intentSummary || '(nenhuma)'}
${priorApproach ? `Última abordagem: "${priorApproach}". VARIE — não repita o mesmo argumento.` : ''}

═══ ⚙️ MEIO DE PAGAMENTO OFICIAL ═══
Multa/juros já embutidos no valor "atualizado" acima. Chave PIX oficial: ${profile?.pix_key || '(sem chave cadastrada — não invente)'} ${profile?.pix_key_type ? `(${profile.pix_key_type})` : ''} | Recebedor: ${profile?.name || empresaNome}. A ${empresaNome} só recebe pelos boletos/PIX gerados neste atendimento oficial.

═══ 🧠 COMPORTAMENTO ═══
Perfil: ${behavior.perfil.toUpperCase()} (${behavior.score0to100}/100) | Em dia: ${behavior.onTimePct}% | Atraso médio: ${behavior.avgDaysLate}d | Promessas quebradas 30d: ${behavior.brokenPromisesLast30d}

═══ 🗓 CONTEXTO TEMPORAL ═══
Agora: ${dowBR}, ${brDate.toLocaleDateString('pt-BR')} ~${hourBR}h (${periodoDia}${isWeekend ? ', fim de semana' : ', dia útil'})
Janela permitida p/ contato ativo: 08h–20h, seg–sáb. Fora disso, apenas RESPONDA quando o cliente iniciar; não faça cobrança ativa.

═══ 🎙 TOM DETECTADO ═══
Hostil: ${tone.hostile ? 'SIM ⚠️' : 'não'} | Frustrado: ${tone.frustrated ? 'sim' : 'não'} | Intenção de pagar: ${tone.paying_intent ? 'SIM' : 'não'} | Dificuldade: ${tone.hardship ? 'SIM (acolha, não pressione)' : 'não'}
${preEscalate ? `⚠️ SINAL FORTE: ${preEscalate} → needs_human=true, resposta curta e educada.` : ''}
${loopSignal.loop ? `⚠️ Respostas repetitivas (sim=${loopSignal.similarity}). Mude de abordagem ou encaminhe a humano.` : ''}

═══ 🧭 FRAMEWORK DE RACIOCÍNIO ═══
1. OBSERVAR: intenção real do cliente; há comprovante anexado?
2. IDENTIDADE: se ainda não confirmada nesta conversa, peça 1 dado (nome completo + CPF parcial OU data de nascimento) ANTES de citar valores.
3. VALIDAR NÚMEROS: qualquer valor citado precisa bater LITERAL com as seções ATRASADAS / VENCE HOJE. Se não bater, needs_human=true.
4. DECIDIR CAMINHO (apenas UM dos 6 abaixo).
5. RESPONDER: máx 3–4 linhas, tom humano, sem emojis (exceto 1 leve na confirmação de pagamento).

═══ 🎭 OS ÚNICOS 6 CAMINHOS QUE VOCÊ EXECUTA ═══
▸ 1) Cliente aceita pagar agora → envie PIX/valor exato + informe: "Identificado o pagamento, a baixa sai em até ${prazoBaixa}."
▸ 2) Cliente indica DATA de pagamento → registre promessa (is_promise=true, promise_date), confirme por escrito: "Combinado: R$ X até DD/MM. Qualquer imprevisto, me avisa antes."
▸ 3) Cliente pede desconto/parcelamento/prazo/qualquer condição diferente → NÃO NEGOCIE. needs_human=true, motivo negociação. Diga: "Essa condição quem avalia é nosso time. Já encaminhei, retornam em até ${prazoNegociacao}."
▸ 4) Cliente diz "já paguei" → se houver comprovante (imagem/PDF): is_receipt=true, agradeça e informe prazo de baixa. Se NÃO houver: peça o comprovante educadamente ("Pode me enviar o comprovante? Assim que chegar registro e pauso a cobrança.").
▸ 5) Cliente contesta a dívida, fala em fraude, Procon, advogado, processo → needs_human=true PRIORIDADE ALTA e SUSPENDA a cobrança nessa mensagem.
▸ 6) Cliente sem condição e sem data → acolha ("Sinto muito por esse momento. Sem pressão.") e ofereça encaminhar ao time (needs_human=true) OU combinar novo contato em X dias.

═══ 🕊 ESCUTA E EMPATIA ═══
Se contar dificuldade, acolha ANTES de qualquer coisa: "Entendo, [nome], imprevistos acontecem. Obrigado por me contar." Nunca julgue. Nunca "você deveria ter...". Não poder negociar não significa ser frio.

═══ 📚 HISTÓRICO ═══
- 1º atraso de cliente sempre pontual → tom mais leve: "Vi que você sempre pagou em dia, imagino que algo tenha acontecido."
- Promessa anterior não cumprida → retome sem recriminar.
- Cliente já escalado ao time → NÃO cobre de novo; apenas informe status.

═══ 🚨 REGRAS INVIOLÁVEIS ═══
✗ NUNCA invente valor, contrato, parcela, taxa ou política. Se não está listado acima, não existe.
✗ NUNCA some parcelas de contratos diferentes.
✗ NUNCA ofereça desconto, parcelamento ou prazo — sempre escalar_humano.
✗ NUNCA marque is_receipt=true por texto ("já paguei") sem imagem/PDF anexado.
✗ NUNCA cumprimente 2x na mesma conversa.
✗ NUNCA repita a mesma cobrança em 2 mensagens seguidas.
✗ NUNCA mencione negativação/SPC como pressão — no máximo 1 vez, factual e neutra, em toda a conversa.
✗ NUNCA fale da dívida com quem não seja o titular identificado.

═══ ✅ EXEMPLOS ═══
Ex1 — "quanto to devendo?" (identidade já confirmada):
"Consultei aqui, ${client.name.split(' ')[0]}: parcela #N do contrato #abc em aberto, hoje em R$ X (valor atualizado). Te envio o PIX pra regularizar agora?"

Ex2 — "faz por 400 que eu pago hoje" (desconto):
"Entendo, ${client.name.split(' ')[0]}. Eu não consigo alterar valores por aqui, mas nosso time de negociação pode avaliar. Já encaminhei seu caso — retornam em até ${prazoNegociacao}." [needs_human=true]

Ex3 — "da pra dividir em 3x?":
"Esse tipo de condição é com o time de negociação, ${client.name.split(' ')[0]}. Acabei de encaminhar. Enquanto isso, precisa da 2ª via de algo?" [needs_human=true]

Ex4 — "paguei ontem" sem comprovante:
"Beleza! Pra confirmar aqui, pode me mandar o comprovante (print ou PDF)? Assim que chegar registro e pauso a cobrança."

Ex5 — "to desempregado, não sei quando pago":
"Sinto muito por esse momento, ${client.name.split(' ')[0]}. Sem pressão. Quer que eu encaminhe seu caso pro nosso time ver alguma condição, ou prefere que eu te chame de novo em uns dias?"

Ex6 — "queria mais 3 mil emprestado":
"Esse canal é só do atendimento de cobrança, ${client.name.split(' ')[0]}. Pra novo empréstimo é pelo ${canalVendas}. Posso te ajudar com a parcela em aberto?"

═══ 📤 FORMATO DE SAÍDA (JSON puro, SEM markdown, SEM cercas) ═══
{
  "thought": "1)OBSERVAR ... 2)IDENTIDADE ok/pendente 3)VALIDAÇÃO NUMÉRICA: R$ X bate com parcela #N contrato #abc ✓ 4)CAMINHO escolhido (1..6) 5)RASCUNHO",
  "reply": "sua resposta final ao cliente em PT-BR (máx 3–4 linhas, sem emoji em cobrança)",
  "is_receipt": boolean,
  "is_promise": boolean,
  "promise_date": "YYYY-MM-DD ou null",
  "receipt_value": number,
  "receipt_date": "YYYY-MM-DD lido do comprovante, senão null",
  "needs_human": boolean,
  "human_reason": "negociacao|contestacao|fraude|vulnerabilidade|procon_juridico|pediu_humano|3_tentativas|outro|null",
  "intent": "saudacao|pagamento|comprovante|promessa|reclamacao|duvida|negociacao|contestacao|novo_emprestimo|atualizacao_dados|outro",
  "sentiment": "positivo|neutro|frustrado|hostil",
  "urgencia": "baixa|media|alta",
  "dificuldade_financeira": boolean,
  "summary": "resumo 1 linha do resultado do contato",
  "memory_update": {
    "fatos": ["fatos consolidados, máx 12"],
    "preferencias": ["ex: prefere PIX de manhã"],
    "motivos_atraso": ["ex: desemprego desde MM/AAAA"],
    "contatos_alternativos": [],
    "promessas": [{"data":"YYYY-MM-DD","valor":0,"contexto":"o que prometeu"}],
    "ultima_interacao": "${todayStr}"
  }
}`;

    // Temperatura adaptativa: mais criativa em saudações, mais determinística
    // quando há dinheiro ou tensão em jogo (evita alucinação de valores).
    const adaptiveTemp = tone.hostile || tone.paying_intent || overdue.length > 0 ? 0.2 : 0.35;

    // Prompt caching (Anthropic): o system prompt é reaproveitado por 5min,
    // reduz custo/latência em conversas com múltiplas idas e vindas.
    const systemBlocks = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];

    const anthMessages = conversationHistory.map(m => ({ role: m.role, content: m.content }));
    if (messageType === "text") anthMessages.push({ role: "user", content: incomingText });
    else if (mediaData && mimeType) {
      const blocks: any[] = [{ type: "text", text: incomingText || `[Enviou ${messageType}]` }];
      if (messageType === "image") blocks.unshift({ type: "image", source: { type: "base64", media_type: mimeType, data: mediaData } });
      else if (mimeType === "application/pdf") blocks.unshift({ type: "document", source: { type: "base64", media_type: "application/pdf", data: mediaData } });
      anthMessages.push({ role: "user", content: blocks });
    }

    // Retry com backoff exponencial em 429/5xx/529 (Anthropic overloaded)
    let aiResp: Response | null = null;
    let aiErrBody = "";
    let parsed: any = null;
    if (geminiConfigured(userId) && settings.bot_use_ai === true && Date.now()<deadline-12_000) {
      try {
        const response = await callGemini({userId,system:systemPrompt,messages:anthMessages,
          maxTokens:2200,temperature:adaptiveTemp,timeoutMs:Math.max(1,Math.min(8_000,deadline-Date.now()-12_000))});
        aiResp = new Response(JSON.stringify(response),{headers:{'Content-Type':'application/json'}});
        await logBotAction(supabase,{userId,clientId:client.id,conversationId:convoId,
          toolName:'gemini_response',toolInput:{model:Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash-lite'},toolOutput:{generated:true}});
      } catch (error) { aiErrBody = error instanceof Error ? error.message : 'gemini_unavailable'; }
    } else if (anthropicApiKey && settings.bot_use_ai === true) {
      for (let attempt = 0; attempt < 2 && Date.now()<deadline-12_000; attempt++) {
        try {
          aiResp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31" },
            body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 2200, temperature: adaptiveTemp, top_p: 0.85, system: systemBlocks, messages: anthMessages }),
            signal:AbortSignal.timeout(Math.max(1,Math.min(8_000,deadline-Date.now()-12_000))),
          });
          if (aiResp.ok) break;
          aiErrBody = await aiResp.text();
          const retriable = aiResp.status === 429 || aiResp.status === 529 || aiResp.status >= 500;
          if (!retriable) {
            console.warn(`[ai] indisponível (${aiResp.status}), usando fallback local:`, aiErrBody.slice(0, 200));
            break;
          }
          console.warn(`[ai] tentativa ${attempt + 1} falhou (${aiResp.status}), retry em breve`);
          await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
        } catch (e) {
          aiErrBody = e instanceof Error ? e.message : String(e);
          console.warn(`[ai] tentativa ${attempt + 1} com erro:`, aiErrBody.slice(0, 200));
          if (attempt === 2) break;
          await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
        }
      }
    } else {
      aiErrBody = "IA não configurada ou indisponível para esta conta";
    }

    if (aiResp?.ok) {
      const aiData = await aiResp.json();
      const rawText = aiData?.content?.[0]?.text ?? "";
      parsed = extractJsonObject(rawText);
      if (!parsed) {
        console.warn("[ai] resposta sem JSON válido, devolvendo fallback:", rawText.slice(0, 200));
        const cleaned = rawText.replace(/```[a-z]*|```/gi, "").replace(/[{}\[\]"]/g, " ").trim();
        parsed = { reply: cleaned.slice(0, 400) || "Desculpe, tive um problema técnico. Pode repetir, por favor?" };
      }
    } else {
      parsed = buildLocalBotResult({ client, incomingText, overdue, dueToday, totalOverdue, totalDueToday, profile, tone, messageType, hasMedia: !!mediaData, history: conversationHistory });
      await logBotAction(supabase, {
        userId,
        clientId: client.id,
        conversationId: convoId,
        toolName: "local_ai_fallback",
        toolInput: { reason: aiErrBody.slice(0, 200), message: incomingText.slice(0, 200) },
        toolOutput: { reply: parsed.reply, intent: parsed.intent, needs_human: parsed.needs_human },
      });
    }
    const result: any = sanitizeAiResult(parsed);

    const pendingPaymentAge = Date.now() - new Date(memoryObj.pending_payment_set_at || '').getTime();
    const quotedInstallment = openWithBalance.find(i => i.id === memoryObj.pending_payment_installment_id);
    const pendingPaymentFresh = pendingPaymentAge >= 0 && pendingPaymentAge < 48 * 3600_000 && !!quotedInstallment;
    if (result.is_receipt && pendingPaymentFresh) {
      if (memoryObj.pending_payment_kind === "interest_only") result.is_rollover = true;
      if (Number(result.receipt_value || 0) <= 0 && Number(memoryObj.pending_payment_amount || 0) > 0) {
        result.receipt_value = Number(memoryObj.pending_payment_amount);
      }
    }

    // Preserva campos novos que o sanitizer estrito descarta (backward-compat).
    const sentiment = ["positivo", "neutro", "frustrado", "hostil"].includes(parsed.sentiment) ? parsed.sentiment : "neutro";
    const urgencia = ["baixa", "media", "alta"].includes(parsed.urgencia) ? parsed.urgencia : "baixa";
    const dificuldade = parsed.dificuldade_financeira === true || tone.hardship;
    const descontoPct = Math.max(0, Math.min(100, Number(parsed.desconto_pct) || 0));

    // Escalonamento forçado por sinais fortes detectados ANTES da IA
    if (preEscalate) {
      result.needs_human = true;
      await supabase.from("notifications").insert({
        user_id: userId,
        
        message: ["🚨 Bot escalou para humano", `Cliente ${client.name}: motivo = ${preEscalate}. Assuma a conversa quando puder.`].filter(Boolean).join(" — "),
        type: "warning",
      });
    }

    // No discount, revised terms or renewal may be proposed by the model.
    if (descontoPct > 0 || result.intent === 'negociacao' || requestsHumanNegotiation(result.reply)) {
      result.needs_human = true;
      result.reply = HUMAN_NEGOTIATION_REPLY;
      result.is_rollover = false;
      result.is_promise = false;
    }



    // ─── Validação de PIX e valores antes de enviar ──────────────────────
    if (result.reply) {
      const v = validatePixReply({
        reply: result.reply,
        pixKey: profile?.pix_key,
        pixKeyType: profile?.pix_key_type,
        installments: openWithBalance as any,
        overdue: overdue as any,
        dueToday: dueToday as any,
        totalOverdue,
        totalDueToday,
        rolloverOptions: rolloverOptions as any,
      });
      if (v.fixed) {
        result.reply = v.reply;
        await supabase.from("audit_logs").insert({
          user_id: userId,
          entity_type: "whatsapp_bot",
          action: "pix_reply_corrected",
          entity_id: client.id,
          details: { reasons: v.reasons },
        });
        // Se detectou valor inventado ou chave PIX errada, notifica o operador
        // (o cliente já recebe a versão corrigida, mas o operador precisa saber)
        const critical = v.reasons.some(r => r.startsWith("invented_values") || r.startsWith("pix_key_mismatch"));
        if (critical) {
          await supabase.from("notifications").insert({
            user_id: userId,
            
            message: ["⚠️ IA quase enviou dado incorreto", `Cliente ${client.name}: bot corrigido automaticamente (${v.reasons.slice(0,2).join("; ")}). Revise a conversa.`].filter(Boolean).join(" — "),
            type: "warning",
          });
        }
      }
    }

    // ─── Guardrail duro pré-envio (última linha de defesa) ────────────────
    if (result.reply) {
      try {
        const { data: otherSample } = await supabase
          .from("clients")
          .select("id, name, cpf_cnpj")
          .eq("user_id", userId)
          .neq("id", client.id)
          .limit(50);
        const allowedDates = [
          ...(overdue || []).map((i: any) => String(i.due_date || "").slice(0, 10)),
          ...(dueToday || []).map((i: any) => String(i.due_date || "").slice(0, 10)),
          ...((installments || []) as any[]).map((i) => String(i.due_date || "").slice(0, 10)),
        ].filter(Boolean);
        // Conjunto de valores permitidos: parcelas individuais (bruto/pago/saldo), totais e somas comuns.
        const amountsBase: number[] = [];
        const pushAmt = (n: any) => {
          const v = Number(n);
          if (Number.isFinite(v) && v > 0) amountsBase.push(v);
        };
        for (const i of ((installments || []) as any[])) {
          pushAmt(i.amount);
          pushAmt(i.paid_amount);
          pushAmt(Number(i.amount || 0) - Number(i.paid_amount || 0));
        }
        for (const i of ((overdue || []) as any[])) {
          pushAmt(i.amount);
          pushAmt(Number(i.amount || 0) - Number(i.paid_amount || 0));
          pushAmt((i as any).amount_with_fee);
          pushAmt((i as any).late_fee);
          pushAmt((i as any).daily_interest);
        }
        for (const i of ((dueToday || []) as any[])) {
          pushAmt(i.amount);
          pushAmt(Number(i.amount || 0) - Number(i.paid_amount || 0));
        }
        pushAmt(totalOverdue);
        pushAmt(totalDueToday);
        pushAmt(Number(totalOverdue || 0) + Number(totalDueToday || 0));
        for (const r of ((rolloverOptions || []) as any[])) {
          pushAmt(r.interestOnly);
          pushAmt(r.totalAmount);
        }
        const allowedAmounts = Array.from(new Set(amountsBase.map((v) => Math.round(v * 100) / 100)));
        const hasMoney = /R\$\s*\d/.test(result.reply);
        const g = assertReplySafe({
          reply: result.reply,
          currentClient: { id: client.id, name: client.name, cpf_cnpj: client.cpf_cnpj },
          otherClientsSample: (otherSample || []) as any,
          allowedDueDates: allowedDates,
          allowedAmounts,
          identityConfirmed: true, // já passamos por identifyClient com status "unique"
          hasMoney,
        });
        if (g.block) {
          // ── Recovery com tool calls tipadas ─────────────────────────
          // Antes de escalar cegamente, damos uma última chance à IA
          // com tools server-side (dados garantidos, sem alucinação).
          let recovered = false;
          try {
            const siteUrl = Deno.env.get("SITE_URL") || "";
            const toolRun = await runAgentWithTools({
              deadline:deadline-12_000,
              system: `Você é o atendente virtual de cobrança da empresa. Cliente confirmado: ${client.name} (id=${client.id}). Converse em PT-BR natural, como um bom atendente no WhatsApp: entenda erros e mensagens curtas pelo histórico, responda primeiro ao que foi perguntado, não repita apresentação nem bordões e faça uma pergunta por vez. Use SEMPRE as tools para obter valores/parcelas — nunca invente. Se o cliente pedir desconto/parcelamento/negociação, chame escalar_para_humano. Seja breve, respeitoso e sem emojis em cobrança.`,
              userMessage: incomingText || "",
              history: (conversationHistory || []).slice(-6).map(m => ({ role: m.role as "user" | "assistant", content: typeof m.content === "string" ? m.content : "" })),
              ctx: { supabase, siteUrl:siteUrl || "https://credmaisapp.com.br", today: todayStr,billingDay:new Date().toISOString().slice(0,10), ownerId:userId, verifiedClientId:client.id },
              maxSteps: 4,
            });
            await supabase.from("bot_actions_log").insert({
              user_id: userId,
              client_id: client.id,
              conversation_id: convoId,
              // Não existe `action_type` nesta tabela; o campo derrubava o insert
              // inteiro. O tipo da ação já vive em `tool_name`/`tool_input`.
              tool_name: "runAgentWithTools",
              tool_input: { motivo: "tool_recovery", trigger: "guardrail_block", reasons: g.reasons.slice(0, 5) },
              tool_output: { tools_used: toolRun.tools_used.map(t => ({ name: t.name, ok: (t.output as any).ok })), handoff: toolRun.handoff, motivo: toolRun.handoff_motivo, reply_len: toolRun.reply.length },
            });
            if (toolRun.reply && !toolRun.handoff && !requestsHumanNegotiation(toolRun.reply)) {
              // Reaplicar guardrail no reply recuperado
              const g2 = assertReplySafe({
                reply: toolRun.reply,
                currentClient: { id: client.id, name: client.name, cpf_cnpj: client.cpf_cnpj },
                otherClientsSample: (otherSample || []) as any,
                allowedDueDates: allowedDates,
                allowedAmounts,
                identityConfirmed: true,
                hasMoney: /R\$\s*\d/.test(toolRun.reply),
              });
              if (!g2.block) {
                result.reply = toolRun.reply;
                recovered = true;
              }
            }
          } catch (e) {
            console.warn("[tool-recovery] falhou:", (e as Error).message);
          }
          if (!recovered) {
            const safeLines = [
              `Oi, ${String(client.name || "").split(" ")[0] || "tudo bem"}. Vou repassar seu atendimento para um responsável do nosso time e ele te responde por aqui.`,
            ];
            result.reply = safeLines.join("\n");
            result.needs_human = true;
          }
          await supabase.from("audit_logs").insert({
            user_id: userId,
            entity_type: "whatsapp_bot",
            action: recovered ? "reply_recovered_by_tools" : "reply_blocked_by_guardrail",
            entity_id: client.id,
            details: { reasons: g.reasons, softHits: g.softHits, recovered },
          });
          if (!recovered) {
            await supabase.from("notifications").insert({
              user_id: userId,
              
              message: ["🛑 Bot bloqueado pelo guardrail", `Cliente ${client.name}: ${g.reasons.slice(0, 3).join(", ")}. Assuma a conversa.`].filter(Boolean).join(" — "),
              type: "warning",
            });
          }
        } else if (g.softHits.length) {
          await supabase.from("audit_logs").insert({
            user_id: userId,
            entity_type: "whatsapp_bot",
            action: "reply_soft_hits",
            entity_id: client.id,
            details: { softHits: g.softHits },
          });
        }
      } catch {
        if(convoId)await escalateToHuman(supabase,convoId,'Não foi possível validar a resposta automática');
        result.reply='Sua solicitação foi encaminhada para conferência da equipe.';
        result.is_receipt=false;
      }
    }

    if (result.is_promise) {
      const promiseDate = parseNaturalPaymentDate(String(result.promise_date || ''));
      if (promiseDate && openWithBalance.length) {
        await checkedBotQuery(supabase.from('audit_logs').insert({user_id:userId,entity_type:'whatsapp_bot',entity_id:client.id,action:'promise_to_pay',details:{promise_date:promiseDate,promise_amount:extractPromisedAmount(incomingText),message:incomingText.slice(0,200)}}));
        result.promise_date = promiseDate;
      } else {
        result.is_promise = false;
        result.promise_date = null;
        result.reply = 'Informe a data em que pretende pagar, por exemplo: “pago amanhã” ou “pago dia 15”. A previsão precisa ser para hoje ou uma data futura.';
      }
    }

    if (result.needs_human && !result.is_receipt && convoId) {
      await escalateToHuman(supabase,convoId,'Resposta automática exige atendimento humano');
      await checkedBotQuery(supabase.from('notifications').insert({user_id:userId,type:'warning',
        message:`Atendimento humano solicitado: ${client.name || senderPhone}. Assuma a conversa no Atendimento.`}));
    }

    // Comprovantes recebem resposta depois da triagem, sem confirmar baixa.
    if (result.reply && !result.is_receipt) await botSay(result.reply);


    // Merge inteligente da memória (validado + dedup + limite por seção, ver _shared/memory.ts)
    if (result.memory_update || true) {
      try {
        let merged = mergeMemory(memoryObj, result.memory_update, todayStr);

        // ─── Registra intenções derivadas desta interação ────────────────
        // Deriva sinais do que a IA classificou + heurísticas locais para
        // que o PRÓXIMO envio (webhook ou cron) evite repetir a abordagem.
        const intents: IntentEntry[] = [];
        const pushI = (e: IntentEntry) => intents.push(e);
        if (result.is_promise && result.promise_date) {
          pushI({ tipo: "prometeu_pagar", data: todayStr, detalhe: `até ${result.promise_date}`, canal: "whatsapp" });
        }
        if (descontoPct > 0 || result.intent === "negociacao" || /desconto|abatimento|acordo/i.test(incomingText || "")) {
          pushI({ tipo: "pediu_desconto", data: todayStr, detalhe: descontoPct ? `${descontoPct}%` : undefined, canal: "whatsapp" });
        }
        if (dificuldade) {
          pushI({ tipo: "dificuldade", data: todayStr, canal: "whatsapp" });
        }
        if (/prazo|adiar|proximo mes|próximo mês|semana que vem/i.test(incomingText || "")) {
          pushI({ tipo: "pediu_prazo", data: todayStr, canal: "whatsapp" });
        }
        if (sentiment === "hostil" || tone.hostile) {
          pushI({ tipo: "hostil", data: todayStr, canal: "whatsapp" });
        }
        if (result.intent === "renovacao" || result.is_rollover) {
          pushI({ tipo: "renovacao", data: todayStr, canal: "whatsapp" });
        }

        // Registra a "abordagem" usada pelo bot nesta resposta, para que o
        // próximo disparo saiba variar (rótulo curto derivado do estágio).
        const abordagem =
          result.needs_human ? "escalou_humano" :
          descontoPct > 0 ? `acordo_${Math.round(descontoPct)}off` :
          result.is_promise ? "aceitou_promessa" :
          estagio === "em dia" ? "conversa_neutra" :
          estagio === "lembrete amigável" ? "lembrete_amigavel" :
          estagio === "cobrança padrão" ? "cobranca_padrao" :
          estagio === "cobrança firme" ? "cobranca_firme" :
          "pre_juridico";
        pushI({ tipo: (result.intent === "pagamento" ? "prometeu_pagar" : "silencio") as any, data: todayStr, abordagem, canal: "whatsapp" });

        for (const it of intents) merged = pushIntent(merged, it);

        // Detecta acesso recente ao portal (últimas 24h) → intenção "abriu_portal"
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data: portalHits } = await supabase
          .from("portal_sessions")
          // A chave da tabela é `token`; não existe `id`. Pedindo `id` a consulta
          // devolvia 400 e o bot nunca percebia que o cliente tinha aberto o
          // portal — a intenção "abriu_portal" jamais era registrada.
          .select("token, created_at")
          .eq("client_id", client.id)
          .gte("created_at", since)
          .limit(1);
        if (portalHits?.length) {
          merged = pushIntent(merged, { tipo: "abriu_portal", data: todayStr, canal: "portal" });
        }

        const serialized = serializeMemory(merged);
        // Garantia final: só grava se for JSON parseável (nunca corrompe a coluna)
        JSON.parse(serialized);
        await supabase.from("clients").update({ bot_memory: serialized }).eq("id", client.id);
      } catch (e) {
        console.error("[memory] merge falhou, mantendo memória anterior:", e);
      }
    }

    await supabase.from("audit_logs").insert({ user_id: userId, entity_type: "whatsapp_bot", action: "replied", entity_id: client.id, details: { intent: result.intent, thought: result.thought, reply: result.reply } });

    // ─── Persistência do FSM (estado do agente entre turnos) ─────────────
    if (convoId) {
      try {
        const { data: convoRow } = await supabase
          .from("whatsapp_conversations")
          .select("agent_state, agent_state_data, agent_state_updated_at")
          .eq("id", convoId)
          .maybeSingle();
        const current = normalizeSnapshot(convoRow as any);
        // Deriva próximo estado a partir do resultado da IA
        let nextState: AgentState = "CONFIRMED";
        const patch: Record<string, unknown> = {
          client_id: client.id,
          overdue_total: Number(totalOverdue || 0),
          last_intent: result.intent || null,
        };
        if (result.needs_human) {
          nextState = "INTENT_HUMANO";
          patch.human_reason = (result as any).human_reason || preEscalate || "bot_decision";
        } else if (result.is_promise && result.promise_date) {
          nextState = "INTENT_PROMESSA";
          patch.promise_date = result.promise_date;
          patch.promise_amount = Number((result as any).promise_amount || 0);
        } else if (result.intent === "pagamento" && Number(totalOverdue || 0) > 0) {
          nextState = "INTENT_PAGAR";
        } else if (result.intent === "comprovante") {
          nextState = "INTENT_COMPROVANTE";
        } else if (result.intent === "contestacao") {
          nextState = "INTENT_CONTESTAR";
        }
        // Se o estado atual não permite transição direta, primeiro sobe para CONFIRMED
        let staged = current;
        if (current.state === "UNKNOWN" || current.state === "IDENTIFYING") {
          const toConfirmed = transition(current, "CONFIRMED", { client_id: client.id });
          if (!toConfirmed.error) staged = toConfirmed.next;
        }
        const tr = transition(staged, nextState, patch);
        if (!tr.error) {
          await saveSnapshot(supabase, convoId, tr.next);
        } else {
          // Registra transição inválida para observabilidade
          await supabase.from("audit_logs").insert({
            user_id: userId,
            entity_type: "whatsapp_bot",
            action: "fsm_transition_blocked",
            entity_id: client.id,
            details: { from: staged.state, to: nextState, reason: tr.error },
          });
        }
      } catch (e) {
        console.warn("[fsm] persist falhou:", (e as Error).message);
      }
    }

    // ─── Validação avançada de comprovante ─────────────────────────────────
    // Camadas: evidência mínima, sanidade do valor, competência da data, anti-reuso (hash), fraude textual.
    let mediaHash: string | null = null;
    const seenHashes = new Set<string>();
    if (mediaData) {
      try { mediaHash = await sha256Hex(mediaData); } catch (e) { console.warn("[hash] falhou:", e); }
      // Busca hashes já utilizados para este user (últimos 90 dias) → anti-reuso
      const { data: prevHashes } = await supabase
        .from("audit_logs")
        .select("details")
        .eq("user_id", userId)
        .eq("entity_type", "whatsapp_receipt")
        .gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString())
        .limit(500);
      for (const row of (prevHashes || [])) {
        const h = (row as any)?.details?.hash;
        if (typeof h === "string") seenHashes.add(h);
      }
    }

    const receiptCheck = result.is_receipt ? validateReceipt({
      messageType,
      hasMedia: !!mediaData,
      incomingText,
      receiptValue: result.receipt_value,
      receiptDate: (result as any).receipt_date || null,
      installments: openWithBalance as any,
      todayStr,
      mediaHash,
      seenHashes,
    }) : null;

    const verifiedReceipt = !!receiptCheck?.trusted;
    // A media heuristic is not evidence of bank settlement. All uploaded receipts
    // require the authenticated owner's confirmation through the review flow.
    const trustedReceipt = false;

    if (result.is_receipt) {
      result.reply = receiptOutcomeReply({
        isVerified: verifiedReceipt,
        isTrusted: trustedReceipt,
        isDuplicate: receiptCheck?.duplicate,
        hasOpenBalance: openWithBalance.length > 0,
        originalReply: result.reply,
      });
      if (!openWithBalance.length) {
        result.needs_human = true;
        result.summary = "Comprovante recebido sem parcela ativa em aberto";
      }
    }

    if (result.is_receipt && mediaData && convoId) {
      await escalateToHuman(supabase,convoId,"Comprovante recebido; cobrança pausada para conferência");
    }

    if (result.is_receipt && !verifiedReceipt) {
      console.log("[receipt] rejeitado:", receiptCheck?.reasons.join(",") || "n/d", "risk=", receiptCheck?.riskScore);
      const reasonsTxt = receiptCheck?.reasons.join(", ") || "sem evidência";
      await supabase.from("notifications").insert({
        user_id: userId,
        
        message: [receiptCheck?.duplicate ? "⚠️ Comprovante reutilizado" : "Possível pagamento — revisar", `Cliente ${client.name}: ${reasonsTxt} (risco ${receiptCheck?.riskScore || 0}/100). Confirme manualmente.`].filter(Boolean).join(" — "),
        type: receiptCheck?.duplicate ? "error" : "warning",
      });
      // Registra a tentativa (com hash, se houver) para auditoria/anti-replay
      await supabase.from("audit_logs").insert({
        user_id: userId, entity_type: "whatsapp_receipt", action: "rejected", entity_id: client.id,
        details: { hash: mediaHash, reasons: receiptCheck?.reasons, risk: receiptCheck?.riskScore, value: result.receipt_value },
      });
    }

    if (result.is_receipt && mediaData && !trustedReceipt) {
      const reviewInstallmentId = receiptCheck?.matchedInstallmentId || (pendingPaymentFresh ? quotedInstallment?.id : null) || openWithBalance[0]?.id || null;
      const { error: reviewInsertError } = await supabase.from("whatsapp_receipt_reviews").insert({
        user_id: userId,
        client_id: client.id,
        conversation_id: convoId,
        installment_id: reviewInstallmentId,
        amount: Number(result.receipt_value || 0),
        media_hash: mediaHash,
        match_type: receiptCheck?.matchType || null,
        status: "pending",
        metadata: {
          risk_score: receiptCheck?.riskScore || 0,
          reasons: receiptCheck?.reasons || [],
          message_type: messageType,
          storage_path: inboundAttachmentPath,
          payment_kind: pendingPaymentFresh && reviewInstallmentId === quotedInstallment?.id ? memoryObj.pending_payment_kind || "payment" : "payment",
        },
      });
      if (reviewInsertError && reviewInsertError.code !== "23505") {
        throw Error("receipt_review_unavailable");
      }
      await supabase.from("notifications").insert({
        user_id: userId,
        message: `Comprovante recebido de ${client.name}. A validação automática encontrou dados compatíveis, mas a baixa aguarda confirmação humana.`,
        type: "warning",
      });
      if (convoId) await supabase.from("whatsapp_conversations").update({
        needs_human: true,
        bot_paused: true,
        bot_status: "handoff",
        human_takeover_reason: "Confirmar comprovante antes da baixa",
        updated_at: new Date().toISOString(),
      }).eq("id", convoId);
      await logBotAction(supabase, {
        userId, clientId: client.id, conversationId: convoId,
        toolName: "receipt_waiting_human_confirmation",
        toolInput: { value: result.receipt_value, match: receiptCheck?.matchType, hash: mediaHash },
      });
    }

    if(result.is_receipt && result.reply) await botSay(result.reply);
      return new Response(JSON.stringify({ status: "success" }), { headers: corsHeaders });
    } finally {
      jidLock.delete(scope);
    }

  } catch (err) {
    console.error("Webhook processing failed");
    return new Response(JSON.stringify({ error: "webhook_processing_failed" }), { status: 500, headers: corsHeaders });
  }
  };
  const response = await process();
  try {
    if(finishResponse)await (finishResponse as () => Promise<void>)();
    if(finishEvent)await (finishEvent as (success:boolean) => Promise<void>)(response.status<500);
  } catch { return new Response(JSON.stringify({error:"event_ack_unavailable"}),{status:503,headers:corsHeaders}); }
  return response;
});
