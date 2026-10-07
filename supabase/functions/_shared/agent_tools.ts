// Tool calls tipadas para o agente Anthropic.
// Cada tool tem: nome, schema JSON-Schema, e um executor server-side que
// consulta o banco. A IA só pode obter dados via essas tools — nunca inventa.
//
// Formato compatível com Anthropic Tool Use:
//   https://docs.anthropic.com/en/docs/build-with-claude/tool-use
import { ANTHROPIC_MODEL } from "./anthropic.ts";
import {callGemini, geminiConfigured} from './gemini.ts';
import { botBalance, activeDebt, botLateFee } from "./bot_finance.ts";
import { botRows, botPortalLink } from "./bot_data.ts";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// -- Catálogo de tools disponíveis para o agente ------------------------------
export const AGENT_TOOLS: ToolDef[] = [
  {
    name: "buscar_cliente_por_cpf",
    description:
      "Localiza o cliente pelo CPF/CNPJ (só dígitos aceitos). Use SEMPRE antes de citar qualquer dado pessoal ou valor.",
    input_schema: {
      type: "object",
      properties: {
        cpf: { type: "string", description: "CPF ou CNPJ com apenas dígitos" },
      },
      required: ["cpf"],
    },
  },
  {
    name: "listar_parcelas_em_aberto",
    description:
      "Retorna as parcelas em aberto (não pagas) de um cliente confirmado. Inclui saldo devedor, multa e juros diários calculados no servidor.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string", format: "uuid" },
        somente_vencidas: {
          type: "boolean",
          description: "Se true, filtra apenas parcelas com due_date < hoje.",
          default: false,
        },
      },
      required: ["client_id"],
    },
  },
  {
    name: "gerar_link_pix",
    description:
      "Gera código PIX Copia-e-Cola (EMV) para uma parcela específica. Usa a chave PIX do credor cadastrado.",
    input_schema: {
      type: "object",
      properties: {
        installment_id: { type: "string", format: "uuid" },
      },
      required: ["installment_id"],
    },
  },
  {
    name: "escalar_para_humano",
    description:
      "Encerra o atendimento pelo bot e escala para operador humano. Use quando o cliente pedir desconto, parcelamento, negociação ou reclamar de valor.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: [
            "pediu_desconto",
            "pediu_parcelamento",
            "reclamou_valor",
            "quer_humano",
            "fora_de_escopo",
            "confuso",
          ],
        },
        resumo: { type: "string", description: "Uma frase para o operador." },
      },
      required: ["motivo"],
    },
  },
  {
    name: "enviar_portal_link",
    description:
      "Envia o deep-link do portal do cliente (auto-login) para o cliente. Use quando ele pedir consulta detalhada, comprovantes ou histórico.",
    input_schema: {
      type: "object",
      properties: { client_id: { type: "string", format: "uuid" } },
      required: ["client_id"],
    },
  },
];

// -- Contrato do executor -----------------------------------------------------
export interface ToolContext {
  supabase: any; // SupabaseClient — evitando dep. duplicada
  siteUrl: string;
  today: string; // YYYY-MM-DD
  ownerId: string;
  billingDay?: string;
  verifiedClientId: string;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export function calculateAgentOverdueCharge(input: {
  amount: number;
  paidAmount?: number;
  lateFee?: number;
  dueDate: string;
  today: string;
  dailyPercent?: number;
  capPercent?: number | null;
}) {
  const base = Math.max(0, Number(input.amount) || 0);
  const saldo = Math.max(0, base - (Number(input.paidAmount) || 0));
  const daysLate = Math.max(0, Math.floor(
    (new Date(input.today).getTime() - new Date(input.dueDate).getTime()) / 86400000,
  ));
  // O atendimento usa o encargo já materializado pelo job financeiro. Assim
  // não reaplica taxa, multa ou qualquer padrão global no valor comunicado.
  const configuredDailyPct = Number(input.dailyPercent || 0);
  const dailyPct = configuredDailyPct > 0 ? configuredDailyPct : 0;
  const total = botBalance({ amount: base, paid_amount: input.paidAmount, late_fee: input.lateFee });
  const interest = Math.max(0, total - saldo);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    base: round(base), saldo: round(saldo), daysLate, dailyPct,
    interest: round(interest), total,
  };
}

/**
 * Executa a tool escolhida pela IA. Sempre retorna JSON-serializável.
 * Não expõe dados de outros clientes: cada tool escopa por client_id.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    if (!ctx.ownerId || !ctx.verifiedClientId) return { ok: false, error: "identity_required" };
    if (input.client_id && input.client_id !== ctx.verifiedClientId) return { ok: false, error: "client_not_authorized" };
    switch (name) {
      case "buscar_cliente_por_cpf": {
        const cpf = String(input.cpf || "").replace(/\D/g, "");
        if (cpf.length !== 11 && cpf.length !== 14) {
          return { ok: false, error: "CPF/CNPJ inválido (esperado 11 ou 14 dígitos)" };
        }
        const { data: c, error } = await ctx.supabase.from("clients")
          .select("id,name,status,cpf_cnpj").eq("id", ctx.verifiedClientId)
          .eq("user_id", ctx.ownerId).maybeSingle();
        if (error) return { ok: false, error: error.message };
        if (!c || String(c.cpf_cnpj || "").replace(/\D/g, "") !== cpf) {
          return { ok: false, error: "cliente_nao_encontrado" };
        }
        return {
          ok: true,
          data: {
            client_id: c.id,
            name: c.name,
            status: c.status,
            has_more: false,
          },
        };
      }

      case "listar_parcelas_em_aberto": {
        const clientId = String(input.client_id || "");
        const somenteVencidas = Boolean(input.somente_vencidas);
        if (!clientId) return { ok: false, error: "client_id obrigatório" };
        const build = () => { let q = ctx.supabase
          .from("contract_installments")
          // A multa e o juro diário ficam no CONTRATO, não na parcela. Pedindo os
          // dois como colunas da parcela, o PostgREST devolvia 400 e a ferramenta
          // inteira falhava: a IA nunca conseguia listar as parcelas em aberto de
          // ninguém. Aqui eles vêm pelo contrato.
          .select(
            "id, installment_number, amount, paid_amount, late_fee, due_date, status, pre_settlement_snapshot, contracts:contract_id ( status, daily_interest_percent, daily_penalty_type, daily_penalty_value, max_interest_cap_percent )",
          )
          .eq("client_id", clientId)
          .eq("user_id", ctx.ownerId)
          .not("status", "in", '("paid","cancelled")')
          .order("due_date", { ascending: true }).order("id");
        if (somenteVencidas) q = q.lt("due_date", ctx.today);
        return q; };
        const data = await botRows(build);
        const rows = data.filter(activeDebt).map((r: any) => {
          const ct = r.contracts || {};
          const charge = calculateAgentOverdueCharge({
            amount: r.amount, paidAmount: r.paid_amount, lateFee: botLateFee(r,ctx.billingDay ?? ctx.today), dueDate: r.due_date,
            today: ctx.today, dailyPercent: ct.daily_interest_percent,
            capPercent: ct.max_interest_cap_percent,
          });
          return {
            installment_id: r.id,
            numero: r.installment_number,
            due_date: r.due_date,
            saldo_devedor: charge.saldo,
            dias_atraso: charge.daysLate,
            multa: 0,
            juros_diarios: charge.interest,
            taxa_diaria_percentual: charge.dailyPct,
            total_com_encargos: charge.total,
          };
        });
        return { ok: true, data: { parcelas: rows.slice(0, 30), total: rows.length,
          has_more: rows.length > 30, saldo_total: rows.reduce((sum: number, r: any) => sum + r.total_com_encargos, 0) } };
      }

      case "gerar_link_pix": {
        const instId = String(input.installment_id || "");
        if (!instId) return { ok: false, error: "installment_id obrigatório" };
        const { data: inst, error } = await ctx.supabase
          .from("contract_installments")
          .select("id, client_id, amount, paid_amount, late_fee, installment_number, user_id, status, due_date, pre_settlement_snapshot, contracts:contract_id ( status, daily_interest_percent, daily_penalty_type, daily_penalty_value, max_interest_cap_percent )")
          .eq("id", instId)
          .eq("user_id", ctx.ownerId).eq("client_id", ctx.verifiedClientId)
          .maybeSingle();
        if (error || !inst) return { ok: false, error: "parcela_nao_encontrada" };
        if (["paid", "cancelled"].includes(inst.status)) return { ok: false, error: "parcela_sem_saldo" };
        const ct = (inst as any).contracts || {};
        if (!["active", "overdue"].includes(String(ct.status || "").toLowerCase())) {
          return { ok: false, error: "contrato_inativo_ou_inexistente" };
        }
        if (botBalance(inst) < 0.01) {
          return { ok: false, error: "parcela_sem_saldo" };
        }
        const charge = calculateAgentOverdueCharge({
          amount: Number(inst.amount), paidAmount: Number(inst.paid_amount), lateFee: botLateFee(inst,ctx.billingDay ?? ctx.today),
          dueDate: String((inst as any).due_date || ctx.today), today: ctx.today,
          dailyPercent: ct.daily_interest_percent, capPercent: ct.max_interest_cap_percent,
        });
        // Não geramos EMV aqui — retornamos os dados para o webhook chamar o
        // gerador existente. Isso mantém a tool leve e determinística.
        return {
          ok: true,
          data: {
            installment_id: inst.id,
            valor: charge.total,
            saldo_base: charge.saldo,
            juros_atraso: charge.interest,
            dias_atraso: charge.daysLate,
            numero: inst.installment_number,
            owner_id: inst.user_id,
          },
        };
      }

      case "escalar_para_humano": {
        return {
          ok: true,
          data: {
            handoff: true,
            motivo: String(input.motivo || "quer_humano"),
            resumo: String(input.resumo || ""),
          },
        };
      }

      case "enviar_portal_link": {
        const clientId = String(input.client_id || "");
        if (!clientId) return { ok: false, error: "client_id obrigatório" };
        const url = await botPortalLink(ctx.supabase, ctx.ownerId, clientId, ctx.siteUrl);
        return { ok: true, data: { url } };
      }

      default:
        return { ok: false, error: `tool_desconhecida:${name}` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// -- Loop de chamada Anthropic com tools --------------------------------------
export interface RunAgentParams {
  system: string;
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  ctx: ToolContext;
  maxSteps?: number;
  deadline?: number;
}

export interface RunAgentResult {
  reply: string;
  tools_used: Array<{ name: string; input: unknown; output: ToolResult }>;
  handoff: boolean;
  handoff_motivo?: string;
}

/**
 * Executa o loop com tool use até a IA emitir texto final (`end_turn`) ou
 * atingir `maxSteps`. Retorna resposta + trilha de tools usadas para auditoria.
 */
export async function runAgentWithTools(
  params: RunAgentParams,
): Promise<RunAgentResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const useGemini = geminiConfigured(params.ctx.ownerId);
  if (!apiKey && !useGemini) throw new Error("IA não configurada para esta conta");

  const maxSteps = params.maxSteps ?? 6;
  const toolsUsed: RunAgentResult["tools_used"] = [];
  let handoff = false;
  let handoffMotivo: string | undefined;

  const messages: any[] = [
    ...(params.history || []),
    { role: "user", content: params.userMessage },
  ];
  const deadline = Math.min(Date.now()+20_000,params.deadline ?? Infinity);

  for (let step = 0; step < maxSteps; step++) {
    if (Date.now() >= deadline) break;
    let data: any;
    if (useGemini) {
      data = await callGemini({userId:params.ctx.ownerId, system:params.system, messages, tools:AGENT_TOOLS,
        maxTokens:1024, temperature:0.3, timeoutMs:Math.max(1, Math.min(10_000, deadline - Date.now()))});
    } else {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        temperature: 0.3,
        system: params.system,
        tools: AGENT_TOOLS,
        messages,
      }),
      signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now()))),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Anthropic ${resp.status}: ${err}`);
    }
    data = await resp.json();
    }
    const stopReason = data.stop_reason as string;
    const content = data.content || [];
    messages.push({ role: "assistant", content });

    if (stopReason !== "tool_use") {
      const text = content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return { reply: text, tools_used: toolsUsed, handoff, handoff_motivo: handoffMotivo };
    }

    // Executar todas as tool_use dessa resposta
    const toolResults: any[] = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;
      const result = await executeTool(block.name, block.input || {}, params.ctx);
      toolsUsed.push({ name: block.name, input: block.input, output: result });
      if (block.name === "escalar_para_humano" && result.ok) {
        handoff = true;
        handoffMotivo = String((result.data as any).motivo || "");
        return { reply: "Encaminhei seu atendimento para a equipe responsável.", tools_used: toolsUsed, handoff, handoff_motivo: handoffMotivo };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "Deixa eu te encaminhar para um operador humano concluir esse atendimento.",
    tools_used: toolsUsed,
    handoff: true,
    handoff_motivo: "max_steps",
  };
}
