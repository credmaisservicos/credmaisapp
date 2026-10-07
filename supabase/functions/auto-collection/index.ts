import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";
import { sendEmail } from "../_shared/brevo.ts";
import { callAnthropic, hasAIProvider } from "../_shared/anthropic.ts";
import { parseMemory, summarizeIntents, lastApproach, pushIntent, serializeMemory } from "../_shared/memory.ts";
import { renderTemplate, renderMessage } from "../_shared/messageTemplate.ts";
import { assertReplySafe } from "../_shared/bot_utils.ts";
import { alertPlatformAdmins } from "../_shared/operations.ts";
import { checkSharedSecret } from "../_shared/guard.ts";
import { botRows, checkedBotQuery } from "../_shared/bot_data.ts";
import { botBalance, activeDebt } from "../_shared/bot_finance.ts";
import { queueBotMessage } from "../_shared/bot_delivery.ts";
import { withinBotHours,automationAccountActive } from "../_shared/bot_policy.ts";
import { collectionPlan, collectionCooldownHours, collectionSuppression, collectionAiBudget } from "../_shared/bot_collection.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface EscalationRule {
  days: number;   // >0 = dias em atraso; <=0 = dias antes do vencimento (D-3 = -3)
  channel: string; // whatsapp | email | both
  template: string;
}

function generatePixCopyPaste(pixKey: string, amount: number, merchantName = "SISTEMA JUROS") {
  const gui = "000201";
  const pixGui = "0014br.gov.bcb.pix";
  const pixKeyTag = `01${pixKey.length.toString().padStart(2, "0")}${pixKey}`;
  const merchantAccountInfo = `26${(pixGui.length + pixKeyTag.length).toString().padStart(2, "0")}${pixGui}${pixKeyTag}`;
  const merchantCategory = "52040000";
  const currency = "5303986";
  const amountStr = amount.toFixed(2);
  const transactionAmount = `54${amountStr.length.toString().padStart(2, "0")}${amountStr}`;
  const countryCode = "5802BR";
  const name = merchantName.substring(0, 25).toUpperCase();
  const merchantNameTag = `59${name.length.toString().padStart(2, "0")}${name}`;
  const merchantCity = "6009SAO PAULO";
  const additionalData = "62070503***";
  const payload = `${gui}${merchantAccountInfo}${merchantCategory}${currency}${transactionAmount}${countryCode}${merchantNameTag}${merchantCity}${additionalData}6304`;
  let crc = 0xFFFF;
  for (const b of new TextEncoder().encode(payload)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return payload + (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
}

function withoutEmoji(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // SEGURANÇA (M4): cron protegido por segredo obrigatório.
  if (!checkSharedSecret(req, "CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const generateWithinBudget = collectionAiBudget();

    const now = new Date();
    const spParts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo",
        year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",hour:"2-digit",minute:"2-digit",hourCycle:"h23",
      }).formatToParts(now).map((part) => [part.type, part.value]),
    );
    const todayStr = `${spParts.year}-${spParts.month}-${spParts.day}`;
    const dayOfWeek = String(spParts.weekday || "").slice(0, 3).toLowerCase();
    const startOfTodayUtc = `${todayStr}T03:00:00Z`;

    // A régua diária também fecha promessas que venceram sem baixa. Falhar aqui
    // não interrompe as cobranças existentes, mas deixa diagnóstico no log.
    const { error: expirePromisesError } = await supabase.rpc("expire_payment_promises", {
      _reference_date: todayStr,
    });
    if(expirePromisesError)throw Error("promise_state_unavailable");

    const allSettings=await botRows(()=>supabase.from("settings").select("*").eq("bot_enabled",true).order("user_id"));
    if (!allSettings?.length) {
      return new Response(JSON.stringify({ message: "Nenhum bot ativo", sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Plano Essencial (R$199) não inclui automações/IA — pula esses usuários.
    const automationProfiles=await botRows(()=>supabase.from("profiles").select("id,is_admin,plan_tier,is_blocked,subscription_type,subscription_expires_at,trial_ends_at").order("id"));
    const profilesById = new Map((automationProfiles ?? []).map((p: any) => [p.id, p]));

    let totalSent = 0, totalEmail = 0, totalSkipped = 0,totalQueued=0;
    const results: any[] = [];

    for (const settings of allSettings) {
      const userId = settings.user_id;
      const aiConfigured = hasAIProvider(userId);
      const entitlementProfile: any = profilesById.get(userId);
      const entitlementEnd = entitlementProfile?.subscription_type === "trial"
        ? entitlementProfile?.trial_ends_at || entitlementProfile?.subscription_expires_at
        : entitlementProfile?.subscription_expires_at;
      const expired = entitlementProfile?.subscription_type !== "lifetime" &&
        (!entitlementEnd || new Date(entitlementEnd).getTime() <= now.getTime());
      if (!automationAccountActive(entitlementProfile,now)) {
        const reason = !entitlementProfile ? "Perfil não encontrado"
          : entitlementProfile.is_blocked ? "Conta bloqueada"
          : entitlementProfile.plan_tier === "essencial" ? "Plano Essencial: automações desativadas"
          : "Assinatura expirada";
        results.push({ user_id: userId, sent: 0, skipped: 1, errors: [reason] });
        continue;
      }
      const errors: string[] = [];
      let sent = 0, emailSent = 0, skipped = 0,queued=0;

      const workDays = (settings.bot_work_days as string[]) || ["mon", "tue", "wed", "thu", "fri"];
      if (!workDays.includes(dayOfWeek)) {
        results.push({ user_id: userId, sent: 0, skipped: 1, errors: ["Dia não útil"] });
        continue;
      }

      const currentMinute=Number(spParts.hour)*60+Number(spParts.minute);
      const targetMinute=Number(settings.bot_send_hour ?? 10)*60+Number(settings.bot_send_minute ?? 0);
      // Five-minute cron windows honor each account's selected minute.
      if((currentMinute-targetMinute+1440)%1440>=5 || !withinBotHours(settings,now))continue;
      const apiUrl = (settings.whatsapp_api_url || "").replace(/\/$/, "");
      const apiKey = settings.whatsapp_api_key || "";
      const instanceName = settings.whatsapp_instance || "";
      let waConfigured = !!(apiUrl && apiKey && instanceName);

      // A sessão do WhatsApp cai sozinha (celular sem bateria, aparelho
      // desconectado, sessão expirada) e NADA no sistema avisava: o robô seguia
      // tentando enviar, cada envio falhava, e o erro morria numa resposta HTTP
      // que ninguém lê. Foi o que aconteceu de 25/07 em diante — 11 dias de
      // silêncio sem um único registro.
      //
      // Agora a conexão é conferida ANTES de montar as mensagens, e o dono é
      // avisado uma vez por dia para reconectar.
      if (waConfigured) {
        let conectado = false;
        try {
          const est = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
            headers: { apikey: apiKey },signal:AbortSignal.timeout(5_000),
          });
          if (est.ok) {
            const j = await est.json();
            conectado = (j?.instance?.state || j?.state) === "open";
          }
        } catch (_) { conectado = false; }

        if (!conectado) {
          waConfigured = false;
          const jaAvisou = await supabase
            .from("audit_logs").select("id", { count: "exact", head: true })
            .eq("user_id", userId).eq("entity_type", "auto_collection")
            .eq("action", "whatsapp_desconectado")
            .gte("created_at", startOfTodayUtc);
          if (!jaAvisou.count) {
            await supabase.from("notifications").insert({
              user_id: userId,
              message: "WhatsApp desconectado — as cobranças automáticas não estão saindo. Reconecte em Configurações → WhatsApp escaneando o QR.",
              type: "warning",
              link: "/configuracoes/whatsapp",
            }).then(() => {}, () => {});
            await supabase.from("audit_logs").insert({
              user_id: userId, entity_type: "auto_collection",
              action: "whatsapp_desconectado", entity_id: null,
              details: { instancia: instanceName },
            }).then(() => {}, () => {});
          }
          errors.push("WhatsApp desconectado — cobranças por WhatsApp suspensas nesta rodada");
        }
      }

      const { count: legacySent,error:sentError } = await supabase
        .from("audit_logs").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("entity_type", "auto_collection")
        .eq("action", "message_sent").gte("created_at", startOfTodayUtc);

      if(sentError)throw Error("delivery_limit_unavailable");
      const {count:queuedToday,error:queuedError}=await supabase.from("whatsapp_scheduled_messages").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("purpose","collection").gte("created_at",startOfTodayUtc).not("status","in",'("cancelled","failed")');
      if(queuedError)throw Error("delivery_limit_unavailable");
      const sentToday=(legacySent||0)+(queuedToday||0);
      const maxPerDay = settings.bot_max_messages_per_day ?? 50;
      if ((sentToday || 0) >= maxPerDay) {
        results.push({ user_id: userId, sent: 0, skipped: 1, errors: ["Limite diário atingido"] });
        continue;
      }
      const remaining = maxPerDay - (sentToday || 0);

      const escalationRules = (settings.bot_escalation_rules as EscalationRule[]) || [];
      if (!escalationRules.length) {
        results.push({ user_id: userId, sent: 0, skipped: 0, errors: ["Sem regras"] });
        continue;
      }

      // Régua escalonada: separamos regras de pré-vencimento (days<=0) e atraso (days>0)
      const preDueRules  = escalationRules.filter(r => Number(r.days) <= 0).sort((a,b) => a.days - b.days); // -3 antes de -1

      // Janela de leitura das parcelas — pega o maior D-N configurado (default 7)
      const maxLookAhead = preDueRules.length
        ? Math.max(7, ...preDueRules.map(r => Math.abs(Number(r.days))))
        : 0;
      const lookAheadDate = new Date(now.getTime() + maxLookAhead * 86400000).toISOString();

      // ATENÇÃO — este filtro paralisava a cobrança automática.
      //
      // Era `.eq("status", "pending")`. Só que o `auto-late-fees` roda às 03:00 e
      // marca toda parcela vencida como "overdue". A partir daí ela sumia daqui
      // para sempre: o bot só enxergava a parcela na janela entre o vencimento e
      // a virada da madrugada seguinte.
      //
      // Na prática, as réguas de 1, 3, 7, 15 e 30 dias de atraso NUNCA disparavam
      // — o bot conversava só com quem tinha acabado de vencer. Em 2026-08-05
      // eram 265 parcelas e R$ 74.459 invisíveis para a cobrança automática, a
      // mais antiga vencida desde 01/06.
      //
      // A regra correta é a mesma do painel: em aberto = não paga e não cancelada.
      const rawInstallments=await botRows(()=>supabase.from("contract_installments")
        .select("id,amount,paid_amount,status,due_date,client_id,contract_id,installment_number,late_fee,pre_settlement_snapshot,contracts(status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent)")
        .eq("user_id",userId).not("status","in",'("paid","cancelled")').lte("due_date",lookAheadDate).order("id"));
      const installments=rawInstallments.filter(activeDebt);

      if (!installments?.length) {
        results.push({ user_id: userId, sent: 0, skipped: 0, errors: [] });
        continue;
      }


      const clients=await botRows(()=>supabase.from("clients").select("id,name,phone,whatsapp,email,credit_score,bot_memory").eq("user_id",userId).order("id"));
      const clientMap = new Map((clients || []).map(c => [c.id, c]));

      // Uma promessa futura é um compromisso válido: não se deve disparar uma
      // nova cobrança genérica antes da data combinada.
      const futurePromises = await botRows(()=>supabase
        .from("payment_promises")
        .select("client_id, promised_for, promised_amount")
        .eq("user_id", userId)
        .eq("status", "open")
        .gte("promised_for", todayStr).order("id"));
      const promiseByClient = new Map((futurePromises || []).map((promise: any) => [promise.client_id, promise]));

      // Opt-out/bloqueio no Inbox vale também para a régua automática.
      const blockedConversations = await botRows(()=>supabase
        .from("whatsapp_conversations").select("jid").eq("user_id", userId).or("blocked.eq.true,bot_paused.eq.true,needs_human.eq.true").order("id"));
      const blockedPhones = new Set((blockedConversations || []).map((c: any) => String(c.jid || "").replace(/\D/g, "")));

      const {data:profile}=await checkedBotQuery(supabase.from("profiles").select("name,billing_message,pix_key,pix_key_type").eq("id",userId).single());

      const templates=await botRows(()=>supabase.from("message_templates").select("*").eq("user_id",userId).eq("is_active",true).order("id"));

      const companyName = settings.company_name || profile?.name || "Sistema Juros";

      // Agrupa por cliente
      const byClient = new Map<string, typeof installments>();
      for (const inst of installments) {
        const list = byClient.get(inst.client_id) || [];
        list.push(inst);
        byClient.set(inst.client_id, list);
      }
      const contactedRecipients = new Set<string>();

      for (const [clientId, clientInstallments] of byClient) {
        if (sent + emailSent + queued >= remaining) break;
        const client = clientMap.get(clientId);
        if (!client) continue;
        if (promiseByClient.has(clientId)) {
          skipped++;
          continue;
        }

        const phone = client.whatsapp || client.phone;
        const email = client.email;
        const normalizedPhone = String(phone || "").replace(/\D/g, "");
        const phoneWithCountry = normalizedPhone.startsWith("55") ? normalizedPhone : `55${normalizedPhone}`;
        const whatsappBlocked = !!normalizedPhone && (blockedPhones.has(normalizedPhone) || blockedPhones.has(phoneWithCountry));
        if(whatsappBlocked){skipped++;continue;}
        const recipientKey = phoneWithCountry.length > 4 ? `wa:${phoneWithCountry}` : email ? `email:${String(email).trim().toLowerCase()}` : "";
        if (recipientKey && contactedRecipients.has(recipientKey)) { skipped++; continue; }

        const plan = collectionPlan(clientInstallments, escalationRules, todayStr);
        if (!plan) continue;
        const {installments:insts,rule:matchingRule,days:selectedDays,isPreDue} = plan;

        // O intervalo escolhido pelo operador vale para todos os níveis de atraso.
        const cooldownHours = collectionCooldownHours(settings.bot_retry_interval_hours);
        const cutoff = new Date(now.getTime() - cooldownHours * 3600000).toISOString();

        const { data: alreadySent } = await checkedBotQuery(supabase
          .from("audit_logs").select("id, created_at, details")
          .eq("user_id", userId).eq("entity_type", "auto_collection")
          .eq("action","message_sent").eq("entity_id", clientId).order("created_at", { ascending: false }).limit(5));
        const withinCooldown = alreadySent?.find(r => new Date(r.created_at as string).getTime() >= new Date(cutoff).getTime());
        if (withinCooldown) { skipped++; continue; }
        const {data:recentQueued} = await checkedBotQuery(supabase.from('whatsapp_scheduled_messages')
          .select('id,text,status,created_at,sent_at').eq('user_id',userId).eq('client_id',clientId).eq('purpose','collection')
          .or(`status.in.(pending,processing,awaiting_approval,uncertain),and(status.eq.sent,sent_at.gte.${cutoff})`)
          .order('created_at',{ascending:false}).limit(5));
        if (recentQueued?.length) { skipped++; continue; }
        // Últimas mensagens enviadas — para banir repetição no prompt
        const recentSentTexts: string[] = (alreadySent || [])
          .map(r => (r.details as any)?.message_preview)
          .filter((s: any) => typeof s === "string" && s.length > 0)
          .slice(0, 3);

        const { data: history } = await checkedBotQuery(supabase
          .from("contract_installments").select("status, paid_at, due_date")
          .eq("user_id", userId).eq("client_id", clientId)
          .order("due_date", { ascending: false }).limit(20));

        // "Parar ao detectar pagamento": o campo existia em Configurações e nunca
        // era lido. Se o cliente pagou alguma parcela desde a última cobrança, ele
        // está respondendo — insistir é o caminho mais curto para irritar quem já
        // está pagando. Só vale quando o operador liga a opção.
        if (settings.bot_stop_on_payment !== false) {
          const {data:lastWhatsApp} = await checkedBotQuery(supabase.from('whatsapp_scheduled_messages')
            .select('sent_at').eq('user_id',userId).eq('client_id',clientId).eq('purpose','collection')
            .eq('status','sent').order('sent_at',{ascending:false}).limit(1).maybeSingle());
          const ultimaCobranca = [alreadySent?.[0]?.created_at,lastWhatsApp?.sent_at].filter(Boolean).sort().at(-1) as string | undefined;
          if (ultimaCobranca) {
            const {data:payments} = await checkedBotQuery(supabase.from('transactions').select('id')
              .eq('user_id',userId).eq('client_id',clientId).eq('type','payment')
              .gt('created_at',ultimaCobranca).limit(1));
            if (payments?.length) { skipped++; continue; }
          }
        }

        const paidCount = history?.filter(h => h.status === "paid").length || 0;
        const lateCount = history?.filter(h =>
          h.status === "paid" && h.paid_at && new Date(h.paid_at) > new Date(h.due_date)
        ).length || 0;
        const totalHist = history?.length || 0;
        const reliability = totalHist ? Math.round((paidCount / totalHist) * 100) : 0;

        // Juros diário composto (4% a.d. padrão) calculado ao vivo — nunca depende
        // apenas do late_fee gravado, que pode estar desatualizado.
        const totalAmount=plan.amount;
        const totalLateFees=plan.fees;
        // A taxa aparecia como "4% ao dia" escrito à mão na mensagem e no
        // prompt da IA, enquanto o cálculo já usava a taxa do contrato. Hoje os
        // 74 contratos em atraso são todos 4%, então o número está certo — mas
        // no dia em que uma taxa mudar, o cliente receberia por escrito um
        // percentual que não é o dele. Aqui o texto passa a sair do dado.
        const taxaTexto = "conforme as condições do contrato";
        let message = "";
        const daysOverdue = Math.max(0, selectedDays);
        const daysUntilDue = Math.max(0, -selectedDays);

        // ─── Memória de intenções do cliente ─────────────────────────────
        // Personaliza o próximo envio: se prometeu pagar, cobre a promessa;
        // se pediu desconto, ofereça um acordo; se abriu o portal, chame
        // para pagar por lá; nunca repita a mesma abordagem duas vezes.
        const clientMemory = parseMemory((client as any).bot_memory);
        const intentSummary = summarizeIntents(clientMemory, 5);
        const priorApproach = lastApproach(clientMemory);
        const intentsList = Array.isArray(clientMemory.intencoes) ? clientMemory.intencoes : [];
        const has = (t: string) => intentsList.some((i: any) => i && i.tipo === t);
        const promiseIntent = intentsList.find((i: any) => i && i.tipo === "prometeu_pagar");
        const personalizations: string[] = [];
        if (has("prometeu_pagar") && promiseIntent) personalizations.push("Cliente mencionou intenção de pagar. Não use a data do registro como prazo combinado; não invente data nem novas condições.");
        if (has("pediu_desconto")) personalizations.push("Cliente pediu desconto. NÃO negocie nem ofereça condições; informe que a equipe humana avaliará.");
        if (has("dificuldade")) personalizations.push("Cliente sinalizou dificuldade financeira. Seja empático, mas NÃO ofereça parcelamento, desconto ou prorrogação.");
        if (has("abriu_portal")) personalizations.push("Cliente ABRIU O PORTAL recentemente — reforce o CTA de pagar pelo portal, não repita o link.");
        if (has("hostil")) personalizations.push("Cliente ficou HOSTIL — desarme, seja curto, ofereça falar com humano.");
        if (has("pediu_prazo")) personalizations.push("Cliente PEDIU PRAZO antes — encaminhe para a equipe, sem propor nova data ou mudar condições.");

        // Escolhe uma nova abordagem — DIFERENTE da última usada
        const stageApproach = isPreDue ? "lembrete_amigavel"
          : selectedDays >= 30 ? "cobranca_firme"
          : selectedDays >= 15 ? "cobranca_respeitosa"
          : selectedDays >= 7 ? "cobranca_padrao"
          : "cobranca_padrao";
        // Escolhe uma nova abordagem — DIFERENTE das últimas usadas
        const approachPool: Record<string, string[]> = {
          lembrete_amigavel: ["lembrete_amigavel", "pergunta_confirmacao", "aviso_curto", "cta_portal"],
          cobranca_firme: ["cobranca_firme", "resumo_pendencias", "aviso_curto", "atendimento_humano"],
          cobranca_respeitosa: ["cobranca_respeitosa", "resumo_pendencias", "aviso_curto", "atendimento_humano"],
          cobranca_padrao: ["cobranca_padrao", "atendimento_humano", "pergunta_previsao", "cta_portal"],
        };
        const recentApproaches = (intentsList || [])
          .map((i: any) => i && typeof i.abordagem === "string" ? i.abordagem : null)
          .filter(Boolean).slice(0, 3) as string[];
        const pool = approachPool[stageApproach] || [stageApproach];
        const candidates = pool.filter(a => !recentApproaches.includes(a));
        const nextApproach = (candidates.length ? candidates : pool)[
          Math.floor(Math.random() * (candidates.length ? candidates.length : pool.length))
        ];

        // ── Anti-repetição: helpers Jaccard ────────────────────────────
        const cleanTxt = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9áéíóúàãõâêîôûç ]+/gi, " ").replace(/\s+/g, " ").trim();
        const jaccard = (a: string, b: string) => {
          const A = new Set(cleanTxt(a).split(" ").filter(Boolean));
          const B = new Set(cleanTxt(b).split(" ").filter(Boolean));
          if (!A.size || !B.size) return 0;
          const inter = [...A].filter(x => B.has(x)).length;
          const uni = new Set([...A, ...B]).size;
          return uni ? inter / uni : 0;
        };
        const maxSimVs = (candidate: string) =>
          recentSentTexts.length ? Math.max(...recentSentTexts.map(t => jaccard(candidate, t))) : 0;

        if (settings.bot_use_ai && aiConfigured) {
          const tone = settings.bot_tone || "profissional";
          const severity = isPreDue ? "AMIGÁVEL — só um lembrete gentil"
            : selectedDays >= 30 ? "FIRME e direta"
            : selectedDays >= 15 ? "assertiva mas respeitosa"
            : selectedDays >= 7 ? "preocupada e clara"
            : "amigável e gentil";
          const buildPrompt = (extraDiversity: string) => `Gere mensagem WhatsApp personalizada:
CLIENTE: ${client.name}
${isPreDue ? `PARCELA VENCE EM ${daysUntilDue} DIA(S)` : `PARCELA EM ATRASO: ${daysOverdue} DIA(S)`}
VALOR TOTAL ATUALIZADO (com encargos de atraso): R$ ${totalAmount.toFixed(2)} (${insts.length} parcela(s))
${totalLateFees > 0 ? `ENCARGOS DE ATRASO JÁ INCLUÍDOS: R$ ${totalLateFees.toFixed(2)} (${taxaTexto}) — SEMPRE informe o valor total atualizado.` : ""}
SCORE: ${client.credit_score ?? 100}/100
HISTÓRICO: ${paidCount}/${totalHist} pagas (${reliability}% confiabilidade)
INTENÇÕES RECENTES:
${intentSummary || '(nenhuma)'}
ABORDAGEM DESTA MENSAGEM: "${nextApproach}" (últimas usadas: ${recentApproaches.join(", ") || "nenhuma"} — NÃO repita).
${recentSentTexts.length ? `MENSAGENS JÁ ENVIADAS RECENTEMENTE (PROIBIDO REPETIR frases, aberturas, estruturas ou palavras marcantes destas):\n${recentSentTexts.map((t, i) => `#${i + 1}: ${t.slice(0, 260)}`).join("\n")}\nEscreva algo VISIVELMENTE diferente: outra abertura, outra ordem, outro tom, outro CTA.` : ""}
${personalizations.length ? "AJUSTES OBRIGATÓRIOS:\n- " + personalizations.join("\n- ") : ""}
${isPreDue ? "Apenas LEMBRE, sem cobrar. Sugira o pagamento antecipado via PIX." : ""}
NUNCA negocie, ofereça desconto, parcelamento, prorrogação ou pagamento parcial. Essas decisões pertencem ao atendimento humano.
${extraDiversity}`;
          const systemPrompt = `Você é especialista em recuperação de crédito da empresa ${companyName}. Tom: ${tone}. Severidade atual: ${severity}. NUNCA diga que é uma IA. Use português brasileiro. Máximo 4 linhas curtas. Emojis discretos (1-2). Gere APENAS o texto da mensagem, sem aspas, sem comentários. REGRA CRÍTICA: cada mensagem precisa ser NOVA — nunca repita aberturas ("Olá X,", "Identificamos…"), nem estrutura, nem frases das mensagens anteriores desse cliente.`;
          try {
            message = await generateWithinBudget(timeoutMs => callAnthropic({
              userId,
              system: systemPrompt,
              messages: [{ role: "user", content: buildPrompt("") }],
              temperature: 0.85, maxTokens: 400,timeoutMs,
            }));
            message = (message || "").trim();
            // Se ficou muito parecido com envios anteriores → regenerar com mais diversidade
            if (message && maxSimVs(message) >= 0.5) {
              const retry = await generateWithinBudget(timeoutMs => callAnthropic({
                userId,
                system: systemPrompt,
                messages: [{ role: "user", content: buildPrompt("A mensagem gerada anteriormente ficou parecida com envios passados. REESCREVA do zero com abertura diferente, verbos diferentes, ordem diferente e outro CTA.") }],
                temperature: 1.0, maxTokens: 400,timeoutMs,
              }));
              const retryTxt = (retry || "").trim();
              if (retryTxt && maxSimVs(retryTxt) < maxSimVs(message)) message = retryTxt;
            }

            // Guarda-corpo antes de enviar. O webhook do WhatsApp já validava a
            // resposta da IA; o disparo automático não validava nada — e aqui o
            // texto vai direto para o devedor, assinado com o nome do credor.
            // Bloqueia principalmente vazamento de dado de OUTRO cliente e oferta
            // de acordo quando a negociação está desligada.
            if (message) {
              const guarda = assertReplySafe({
                reply: message,
                currentClient: client,
                otherClientsSample: (clients || []).filter((c: any) => c.id !== client.id).slice(0, 25),
                negotiationEnabled: false,
                allowedAmounts: [totalAmount,totalLateFees,totalAmount-totalLateFees,...insts.map(i=>botBalance(i))],
                amountToleranceCents: 0,
              } as any);
              if (guarda.block) {
                console.warn(`[auto-collection] mensagem da IA bloqueada (${guarda.reasons.join(", ")}) — usando o texto padrão`);
                // Campos de `audit_logs` num insert de `bot_actions_log`: o
                // registro era recusado e o bloqueio da IA não deixava rastro.
                await supabase.from("bot_actions_log").insert({
                  user_id: userId, client_id: client.id,
                  tool_name: "ai_reply_blocked", success: false,
                  tool_input: { origem: "auto_collection" },
                  tool_output: { reasons: guarda.reasons, preview: message.slice(0, 200) },
                }).then(() => {}, () => {});
                message = ""; // cai no template/mensagem padrão logo abaixo
              }
            }
          } catch (aiErr) { console.error("Anthropic fail:", aiErr); }
        }


        if (!message) {
          // Variáveis disponíveis para QUALQUER texto configurável desta mensagem.
          // Antes cada trecho substituía um subconjunto diferente: o template
          // trocava 5 variáveis mas só em {chaves} (e a tela ensina [colchetes],
          // então os 8 templates prontos chegavam literais ao cliente), a saudação
          // trocava 2, e a mensagem de encerramento não trocava nenhuma.
          const varsMensagem = {
            nome: client.name,
            empresa: companyName,
            valor: `R$ ${totalAmount.toFixed(2)}`,
            parcelas: String(insts.length),
            dias: String(isPreDue ? daysUntilDue : daysOverdue),
            numero: insts[0]?.installment_number != null ? String(insts[0].installment_number) : "",
            parcela: insts[0]?.installment_number != null ? String(insts[0].installment_number) : "",
            data: insts[0]?.due_date ? new Date(insts[0].due_date).toLocaleDateString("pt-BR") : "",
            juros: `R$ ${totalLateFees.toFixed(2)}`,
            pix: profile?.pix_key ?? "",
            // O identificador público do credor elimina ambiguidade entre
            // cadastros iguais sem emitir um token que abriria o dossiê.
            portal: `${(Deno.env.get("SITE_URL") ?? "https://www.credmaisapp.com.br").replace(/\/+$/, "")}/portal-cliente?o=${userId}`,
          };

          const templateName=String(matchingRule.template || '').trim().toLowerCase();
          const template = templateName ? templates?.find(t => t.name.trim().toLowerCase()===templateName) : undefined;
          if (template) {
            const r = renderTemplate(template.content, varsMensagem);
            message = r.texto;
            if (r.desconhecidas.length) {
              console.warn(`[auto-collection] template "${template.name}" usa variáveis inexistentes:`, r.desconhecidas);
            }
          } else {
            const baseGreet = settings.bot_greeting_message
              ? renderMessage(settings.bot_greeting_message, varsMensagem)
              : `Olá ${client.name}`;
            // Rotaciona aberturas para NÃO repetir a mesma mensagem toda vez
            const greetVariants = isPreDue
              ? [`${baseGreet}, tudo bem?`, `Oi ${client.name}!`, `${client.name}, passando rapidinho aqui.`, `E aí, ${client.name}?`]
              : [`${baseGreet},`, `${client.name}, tudo certo?`, `Oi ${client.name},`, `${client.name}, precisamos alinhar um ponto.`];
            const bodyPreVariants = [
              `⏰ Só um lembrete: sua parcela de R$ ${totalAmount.toFixed(2)} vence em ${daysUntilDue} dia(s).`,
              `📅 Passando pra avisar: vencimento em ${daysUntilDue} dia(s) — R$ ${totalAmount.toFixed(2)}.`,
              `💡 Falta ${daysUntilDue} dia(s) pra sua parcela de R$ ${totalAmount.toFixed(2)}.`,
              `🔔 Aviso rápido: R$ ${totalAmount.toFixed(2)} programado(s) daqui a ${daysUntilDue} dia(s).`,
            ];
            const bodyOverVariants = [
              `Identificamos ${insts.length} parcela(s) pendente(s) — R$ ${totalAmount.toFixed(2)}. Atraso de ${daysOverdue} dia(s).`,
              `Está com ${insts.length} parcela(s) em aberto totalizando R$ ${totalAmount.toFixed(2)} (${daysOverdue} dia(s) em atraso).`,
              `Pendência: R$ ${totalAmount.toFixed(2)} em ${insts.length} parcela(s), ${daysOverdue} dia(s) sem pagamento.`,
              `Verificamos aqui: R$ ${totalAmount.toFixed(2)} em atraso há ${daysOverdue} dia(s).`,
            ];
            // A mensagem de encerramento não passava por substituição nenhuma:
            // quem escrevesse "Att, {empresa}" mandava "Att, {empresa}" ao cliente.
            const closing = settings.bot_closing_message
              ? renderMessage(settings.bot_closing_message, varsMensagem)
              : "Qualquer dúvida, chama aqui.";
            const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
            if (isPreDue) {
              message = `${pick(greetVariants)}\n\n${pick(bodyPreVariants)}\nSe preferir, já deixe o pagamento agendado.`;
            } else {
              message = `${pick(greetVariants)}\n\n${pick(bodyOverVariants)}\n\n${closing}`;
            }
          }
          // Variação por intenção no template básico (evita eco literal)
          if (has("prometeu_pagar") && promiseIntent) {
            message += `\n\nVocê comentou que pretende pagar. Se precisar de ajuda, fale com nossa equipe.`;
          } else if (has("pediu_desconto") || has("dificuldade")) {
            message += `\n\nSua solicitação precisa ser avaliada pela equipe de atendimento. Não consigo alterar valores ou condições por aqui.`;
          } else if (has("abriu_portal")) {
            message += `\n\n(Vi que você abriu o portal recentemente — se precisar de ajuda pra concluir, me chama por aqui.)`;
          }
          // Detalhamento dos juros de atraso sempre visível
          if (totalLateFees > 0 && !/juros/i.test(message)) {
            const principal = totalAmount - totalLateFees;
            message += `\n\nDetalhe: parcela(s) R$ ${principal.toFixed(2)} + encargos de atraso R$ ${totalLateFees.toFixed(2)} (${taxaTexto} · ${daysOverdue} dia(s))\nTotal atualizado: R$ ${totalAmount.toFixed(2)}`;
          }
        }


        // Os valores configuráveis também precisam corresponder ao saldo selecionado.
        const amountGuard = assertReplySafe({reply:message,currentClient:client,
          allowedAmounts:[totalAmount,totalLateFees,totalAmount-totalLateFees,...insts.map(i=>botBalance(i))],amountToleranceCents:0});
        if (amountGuard.reasons.some(reason=>reason.startsWith('invented_amount:'))) {
          message = `Olá ${client.name}. ${isPreDue ? `Lembrete de vencimento em ${daysUntilDue} dia(s)` : `Pendência de ${insts.length} parcela(s), com atraso de ${daysOverdue} dia(s)`}. Qualquer dúvida, fale com nossa equipe.`;
        }
        message += `\n\nTotal ${isPreDue?'do lembrete':'a pagar'}: R$ ${totalAmount.toFixed(2)}${totalLateFees>0?` (inclui R$ ${totalLateFees.toFixed(2)} de encargos)` : ''}.`;

        if (settings.bot_send_pix && profile?.pix_key) {
          try {
            const pixCode = generatePixCopyPaste(profile.pix_key, totalAmount, companyName);
            message += `\n\n💳 *PIX para pagamento*\nChave: ${profile.pix_key}\n\n*Copia e Cola:*\n\`${pixCode}\``;
          } catch { message += `\n\n💰 PIX: ${profile.pix_key}`; }
        }

        // Não envia novamente o mesmo texto ao mesmo cliente. Esta verificação
        // ocorre depois de montar valores/PIX, portanto bloqueia duplicata real e
        // permite uma nova mensagem quando a dívida ou orientação mudou.
        const normalizedMessage = withoutEmoji(message).replace(/\s+/g, " ").trim().toLowerCase().slice(0, 350);
        const repeatedMessage = recentSentTexts.some((text) =>
          withoutEmoji(text).replace(/\s+/g, " ").trim().toLowerCase().slice(0, 350) === normalizedMessage
        );
        if (repeatedMessage) {
          skipped++;
          await supabase.from("audit_logs").insert({
            user_id: userId, entity_type: "auto_collection", action: "duplicate_blocked",
            entity_id: clientId, details: { channel: matchingRule.channel, days_overdue: daysOverdue },
          }).then(() => {}, () => {});
          continue;
        }

        let waOk = false;
        const suppression = await collectionSuppression(supabase,userId,clientId);
        if (suppression) { skipped++; continue; }
        if (waConfigured && phone && ["whatsapp","both"].includes(matchingRule.channel)) {
          const recipient=phoneWithCountry;
          const {data:existing,error:ce}=await supabase.from("whatsapp_conversations").select("id,blocked,bot_paused,needs_human,instance").eq("user_id",userId).eq("phone",recipient).maybeSingle();
          if(ce)throw Error("conversation_lookup_unavailable");
          if(existing?.blocked || existing?.bot_paused || existing?.needs_human){skipped++;continue;}
          let conversationId=existing?.id;
          if(!conversationId){
            const {data:created,error}=await supabase.from("whatsapp_conversations").insert({user_id:userId,phone:recipient,jid:`${recipient}@s.whatsapp.net`,instance:instanceName,client_id:clientId,contact_name:client.name}).select("id").single();
            if(error)throw Error("conversation_create_unavailable");conversationId=created.id;
          }
          const job=await queueBotMessage(supabase,{user_id:userId,conversation_id:conversationId,client_id:clientId,
            text:withoutEmoji(message),purpose:"collection",status:settings.bot_auto_send===true?"pending":"awaiting_approval",
            scheduled_for:new Date().toISOString(),source_key:`collection:${clientId}:${todayStr}:${Math.round(totalAmount*100)}`,
            expected_amount:totalAmount,installment_ids:insts.map(i=>i.id)});
          waOk=["pending","awaiting_approval","processing","sent"].includes(job.status);
          if(waOk){queued++;if(recipientKey)contactedRecipients.add(recipientKey);}
          await supabase.from("audit_logs").insert({user_id:userId,entity_type:"auto_collection",action:"message_queued",entity_id:clientId,
            details:{channel:"whatsapp",job_id:job.id,status:job.status,amount:totalAmount}});
        }

        let shouldEmail = settings.bot_auto_send===true && !!email && (
          matchingRule.channel === "email" || matchingRule.channel === "both" ||
          (!waOk && !waConfigured) || (!waOk && daysOverdue >= 15) || daysOverdue >= 30
        );

        // O e-mail também precisa da mesma leitura final do WhatsApp. Sem isto,
        // uma baixa/exclusão entre a montagem da fila e o envio ainda era cobrada.
        if (shouldEmail) {
          const latestEmailRows = await botRows(()=>supabase
            .from("contract_installments")
            .select("id,amount,paid_amount,late_fee,status,due_date,pre_settlement_snapshot,contracts(status,daily_interest_percent,daily_penalty_type,daily_penalty_value,max_interest_cap_percent)")
            .eq("user_id", userId).eq("client_id", clientId)
            .not("status", "in", '("paid","cancelled")').order('id'));
          const selectedIds=new Set(insts.map(i=>i.id));
          const latestTotal=latestEmailRows.filter(row=>selectedIds.has(row.id)&&activeDebt(row)).reduce((sum,row)=>sum+botBalance(row),0);
          shouldEmail=latestTotal>=0.01&&Math.abs(latestTotal-totalAmount)<0.01;
        }

        if (shouldEmail) {
          const { data: claimed } = await checkedBotQuery(supabase.rpc("claim_collection_dispatch", {
            _user_id: userId, _client_id: clientId, _channel: "email", _bucket: now.toISOString(),
          }));
          shouldEmail = !!claimed;
        }

        // Regra global do canal: nenhuma mensagem automática sai com emoji,
        // inclusive templates personalizados e respostas geradas por IA.
        message = withoutEmoji(message);

        if (shouldEmail) {
          const subject = isPreDue
            ? `⏰ Lembrete: parcela vence em ${daysUntilDue} dia(s) - ${companyName}`
            : daysOverdue >= 30
              ? `⚠️ Pendência ${daysOverdue} dias em atraso - ${companyName}`
              : `Lembrete de pagamento - ${companyName}`;
          const html = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb;border-radius:12px">
              <h2 style="color:#1e293b">Olá, ${client.name}</h2>
              <div style="background:white;padding:20px;border-radius:8px;border:1px solid #e5e7eb;white-space:pre-wrap;line-height:1.6;color:#334155">${message.replace(/</g, "&lt;")}</div>
              <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:24px">Mensagem automática de ${companyName}.</p>
            </div>`;
          try {
            const res = await sendEmail({ to: [{ email, name: client.name }], subject, htmlContent: html });
            if (!res.error) {
              emailSent++;
              if (recipientKey) contactedRecipients.add(recipientKey);
              await supabase.from("audit_logs").insert({
                user_id: userId, entity_type: "auto_collection", action: "message_sent",
                entity_id: clientId,
                details: {
                  client_name: client.name, email, channel: "email",
                  rule: matchingRule, days_overdue: daysOverdue, days_until_due: daysUntilDue,
                  pre_due: isPreDue, amount: totalAmount, reliability, ai_generated: !!settings.bot_use_ai,
                  approach: nextApproach,
                  message_preview: (message || "").slice(0, 400),
                },
              });
            } else { errors.push(`${client.name} (email): ${JSON.stringify(res.error).slice(0, 120)}`); }
          } catch (err) { errors.push(`${client.name} (email): ${err instanceof Error ? err.message : "Erro"}`); }
        }
      }

      totalSent += sent; totalEmail += emailSent; totalSkipped += skipped;totalQueued+=queued;
      results.push({ user_id: userId, sent, queued,email_sent: emailSent, skipped, errors });

      if ((queued + emailSent) > 0 && settings.bot_notify_owner) {
        await supabase.from("notifications").insert({
          user_id: userId,
          message: `Bot de cobranças: ${queued} WhatsApp ${settings.bot_auto_send===true?'na fila de envio':'aguardando aprovação'} e ${emailSent} e-mail(s) aceito(s) pelo provedor.`,
          type: "collection_auto", from: "Bot de Cobranças", link: "/auditoria",
        });
      }
      if (errors.length > 0) {
        await supabase.from("notifications").insert({
          user_id: userId,
          message: `Falha operacional: ${errors.length} cobrança(s) não foram enviadas. Consulte a auditoria.`,
          type: "warning", from: "Agente de cobranças", link: "/comunicacao?tab=performance",
        });
      }
    }

    const operationalErrors = results.flatMap((result: any) =>
      (result.errors || []).filter((message: string) =>
        !/Plano Essencial|Dia não útil|Sem regras|Limite diário|Assinatura expirada|Conta bloqueada/.test(message),
      ).map((message: string) => `${result.user_id}: ${message}`),
    );
    if (operationalErrors.length) {
      await alertPlatformAdmins(
        supabase,
        "auto-collection",
        `Cobrança automática terminou com ${operationalErrors.length} erro(s): ${operationalErrors.slice(0, 3).join(" | ")}`,
      );
    }

    return new Response(
      JSON.stringify({ message: "Sucesso", total_sent: totalSent,total_queued:totalQueued, total_email: totalEmail, total_skipped: totalSkipped, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("auto-collection error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
