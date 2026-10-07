// Base de conhecimento massiva para o bot (SDR + Atendimento).
// Cada entrada tem "patterns" (dezenas de variações regex/keywords) e uma
// resposta com placeholders substituídos em runtime via `formatAnswer`.
// Total: 300+ intents × ~10 variações = milhares de perguntas reconhecidas.

export interface FaqContext {
  companyName: string;
  firstName?: string;
  portalLink?: string;
  pixKey?: string;
  pixKeyType?: string;
  ownerName?: string;
  rate?: number;              // % ao mês
  term?: number;              // parcelas padrão
  minAmount?: number;
  maxAmount?: number;
  lateFeePct?: number;
  dailyFeePct?: number;
  earlyDiscountPct?: number;
  supportPhone?: string;
  supportEmail?: string;
  businessHours?: string;
  hasOpenInstallments?: boolean;
  isKnownClient?: boolean;
}

export interface FaqEntry {
  id: string;
  category: string;
  patterns: RegExp[];        // qualquer match → escolhe essa entry
  keywords?: string[][];     // AND-groups: cada sub-array precisa de 1 termo (score bonus)
  answer: (ctx: FaqContext) => string;
  followup?: string;         // gancho opcional pra continuar conversa
}

const money = (n?: number) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

// ─────────── util: normaliza texto (sem acento, minúsculo, colapsa espaços)
export function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s#$%.,-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// helper pra gerar patterns rapidamente
const rx = (...arr: string[]): RegExp[] => arr.map(s => new RegExp(s, "i"));

// ═══════════════════════════════════════════════════════════════════════
// BASE DE CONHECIMENTO
// ═══════════════════════════════════════════════════════════════════════
export const FAQ: FaqEntry[] = [
  // ═════ SAUDAÇÕES E SMALL TALK ═════
  { id: "greet.hi", category: "greet",
    patterns: rx("^(oi|ola|olá|opa|eae|e ai|eai|hey|hi|hello|bom dia|boa tarde|boa noite|tudo bem|tudo bom|blz|beleza)\\b"),
    answer: (c) => `Olá${c.firstName ? ", " + c.firstName : ""}! 👋 Aqui é da *${c.companyName}*. Como posso te ajudar hoje?`,
    followup: "menu" },
  { id: "greet.thanks", category: "greet",
    patterns: rx("^(obrigad|valeu|vlw|agradec|thanks|thank you|tmj|tamo junto|grato|grata)"),
    answer: (c) => `Imagina, ${c.firstName || "amigo(a)"}! 🙌 Precisando é só chamar.` },
  { id: "greet.bye", category: "greet",
    patterns: rx("^(tchau|ate mais|até mais|falou|flw|abraço|abraco|bye|adeus|ate logo|até logo)"),
    answer: () => `Até mais! 👋 Qualquer coisa, é só mandar mensagem.` },
  { id: "greet.how_are_you", category: "greet",
    patterns: rx("(tudo bem|como voce esta|como vc ta|td bem|td bom|como estas)"),
    answer: (c) => `Tudo ótimo por aqui! 😄 E com você, ${c.firstName || "amigo(a)"}?` },
  { id: "greet.ok", category: "greet",
    patterns: rx("^(ok|okay|blz|beleza|show|top|dahora|joia|joinha|👍|👌|ta bom|tá bom|entendi|entendido|combinado|fechado|perfeito|otimo|ótimo)$"),
    answer: () => `Show! 👌` },
  { id: "greet.name_bot", category: "greet",
    patterns: rx("(qual (seu|teu) nome|voce e um bot|voce e humano|é um robo|é robô|é uma pessoa|com quem falo|quem esta ai)"),
    answer: (c) => `Sou o assistente virtual da *${c.companyName}* 🤖 — trabalho junto com o time pra te atender rapidinho. Se preferir humano é só pedir!` },
  { id: "greet.compliment", category: "greet",
    patterns: rx("(muito bom|excelente|otimo atendimento|ótimo atendimento|voces sao demais|amei|adorei|nota 10|melhor atendimento|melhor empresa|top demais)"),
    answer: (c) => `Que alegria ouvir isso! 💚 Muito obrigado pelo carinho. A ${c.companyName} tá aqui pra isso.` },

  // ═════ EMPRÉSTIMO — INFORMAÇÕES BÁSICAS ═════
  { id: "loan.what", category: "loan",
    patterns: rx("(o que (e|é) (um )?empr[eé]stimo|como funciona empr[eé]stimo|explica empr[eé]stimo|nunca peguei empr[eé]stimo)"),
    answer: (c) => `A *${c.companyName}* analisa a solicitação de empréstimo. Um atendente humano apresenta e confirma valores, juros e prazos antes da contratação.` },
  { id: "loan.how_it_works", category: "loan",
    patterns: rx("(como funciona|como faz|como pego|como consigo|como pega|como pedir|como solicitar|passo a passo|processo)"),
    answer: (c) => `É rapidinho: 1️⃣ Me diz o *valor* e a *finalidade*; 2️⃣ A equipe avalia sua solicitação; 3️⃣ Se aprovar, um consultor da *${c.companyName}* fecha por aqui; 4️⃣ O dinheiro cai no seu PIX. 🚀` },
  { id: "loan.rate", category: "loan",
    patterns: rx("(taxa|juros|% ao m[eê]s|porcentagem|quanto cobra|cobra quanto|percentual)"),
    answer: (c) => `Nossa taxa padrão é de *${c.rate ?? 15}% ao mês* (juros simples). Pode variar um pouco conforme valor, prazo e análise. 📊` },
  { id: "loan.term", category: "loan",
    patterns: rx("(prazo|parcela|quantas vezes|em quantos meses|dividir em|em quantas|meses pra pagar)"),
    answer: () => `O prazo da solicitação é definido pela equipe humana após a análise. No contrato existente, consulte os vencimentos no portal.` },
  { id: "loan.min_max", category: "loan",
    patterns: rx("(valor m[ií]nimo|valor m[aá]ximo|minimo|máximo|maximo|quanto pega|quanto d[aá] pra pegar|qual o teto|qual o limite)"),
    answer: (c) => `Emprestamos de *${money(c.minAmount ?? 100)}* a *${money(c.maxAmount ?? 100000)}* por contrato.` },
  { id: "loan.simulation", category: "loan",
    patterns: rx("(simula|simular|fazer simula|quero uma simula|calcula|calcular|quanto fica|quanto vai ficar|quanto fica a parcela)"),
    answer: (c) => `Claro! Me diz o *valor* que quer pegar e em *quantas parcelas* — a equipe humana fará a análise e informará as condições. 🧮` },
  { id: "loan.pre_approved", category: "loan",
    patterns: rx("(pre aprovado|pré aprovado|tenho limite|meu limite|quanto tenho aprovado|quanto ja tenho)"),
    answer: (c) => `Não trabalhamos com pré-aprovação automática — a análise é rápida e caso-a-caso. Me passa o valor que precisa que já verifico! 🚀` },
  { id: "loan.approval_time", category: "loan",
    patterns: rx("(quanto tempo (pra )?aprovar|demora quanto|em quanto tempo cai|libera em quanto tempo|quando cai o dinheiro|quando recebo)"),
    answer: (c) => `Análise em *minutos* e liberação no PIX no mesmo dia (dias úteis). Documentação em ordem = mais rápido! ⚡` },
  { id: "loan.first_loan", category: "loan",
    patterns: rx("(primeiro empr[eé]stimo|primeira vez|nunca peguei|sou novo cliente|nunca fiz)"),
    answer: (c) => `Bem-vindo(a) à *${c.companyName}*! Posso registrar sua solicitação. A equipe humana analisa o pedido e informa as condições.` },
  { id: "loan.reason", category: "loan",
    patterns: rx("(pra que serve|finalidade|proposito|posso usar pra|para que posso)"),
    answer: () => `Você usa como quiser: quitar dívidas, capital de giro, emergência, reforma, festa, viagem, estudo… não pedimos comprovação de destino. 💡` },

  // ═════ REQUISITOS / DOCUMENTOS ═════
  { id: "docs.what", category: "docs",
    patterns: rx("(que documento|quais documento|precisa (de )?documento|documentacao|documentação|o que preciso|o que precisa|requisitos)"),
    answer: () => `Só o básico: *CPF*, *RG*, *comprovante de residência* e *comprovante de renda* (se tiver). Sem burocracia! ✅` },
  { id: "docs.cpf_only", category: "docs",
    patterns: rx("(so com cpf|apenas cpf|sem documento|sem rg|sem comprovante)"),
    answer: () => `Pra iniciar sim! A equipe avalia sua solicitação só com CPF. Os demais docs só entram na hora de fechar o contrato. 📄` },
  { id: "docs.income_proof", category: "docs",
    patterns: rx("(comprovante de renda|contracheque|holerite|declaracao ir|declaração ir|extrato bancario|extrato bancário|preciso comprovar)"),
    answer: () => `Comprovante de renda ajuda a liberar valores maiores e taxas melhores, mas *não é obrigatório* em todos os casos. 📈` },
  { id: "docs.address_proof", category: "docs",
    patterns: rx("(comprovante de residencia|comprovante de endereço|conta de luz|conta de agua|conta de água)"),
    answer: () => `Qualquer conta em seu nome dos *últimos 90 dias* (luz, água, telefone, boleto). Se estiver em nome de terceiros, envie declaração simples. 🏠` },
  { id: "docs.id_types", category: "docs",
    patterns: rx("(pode ser cnh|serve cnh|carteira de motorista|rg antigo|rg vencido|passaporte|carteira de trabalho)"),
    answer: () => `RG, CNH, CTPS ou passaporte — qualquer documento com foto vale. Só precisa estar legível. 📷` },
  { id: "docs.mei", category: "docs",
    patterns: rx("(sou mei|autonomo|autônomo|freelancer|informal|nao tenho carteira|não tenho carteira)"),
    answer: () => `Sem problema! Aceitamos autônomos, MEIs e informais. Um extrato bancário dos últimos 3 meses ou nota fiscal já ajuda. 💼` },
  { id: "docs.retired", category: "docs",
    patterns: rx("(aposentado|pensionista|inss|beneficio|benefício|bpc|bolsa familia|bolsa família)"),
    answer: () => `Aposentados e pensionistas do INSS são muito bem-vindos. Basta o extrato do benefício como comprovante. 👵👴` },

  // ═════ PIX E PAGAMENTO ═════
  { id: "pix.key", category: "pix",
    patterns: rx("(chave pix|qual (o|a) pix|manda o pix|me passa o pix|passar o pix|pix pra pagar|onde pago)"),
    answer: (c) => c.pixKey
      ? `💠 *PIX (${(c.pixKeyType || "chave").toUpperCase()}):*\n\`${c.pixKey}\`\n👤 *Favorecido:* ${c.ownerName || c.companyName}\n\nApós pagar, envie o comprovante que registro na hora! 📎`
      : `Ainda não temos chave PIX configurada — já vou chamar um atendente pra te passar os dados. 👤` },
  { id: "pix.copy_paste", category: "pix",
    patterns: rx("(pix copia e cola|codigo pix|código pix|qr code|qrcode|copia e cola)"),
    answer: () => `Digite *2* para consultar suas parcelas e os dados de pagamento disponíveis.` },
  { id: "pix.confirm_payment", category: "pix",
    patterns: rx("(ja paguei|já paguei|acabei de pagar|paguei agora|paguei hoje|efetuei o pagamento|fiz o pagamento)"),
    answer: (c) => `Ótimo! 🎉 Me envia o *comprovante* aqui (imagem ou PDF) que eu já dou baixa na sua parcela. Se preferir, também posso pedir pro time confirmar manualmente.` },
  { id: "pix.receipt", category: "pix",
    patterns: rx("(comprovante|recibo|nota|papel do pagamento|onde envio comprovante)"),
    answer: () => `Basta mandar o comprovante *aqui mesmo nesta conversa* — aceito imagem, print ou PDF. 📎` },
  { id: "pix.wrong_key", category: "pix",
    patterns: rx("(paguei errado|pix errado|chave errada|caiu na conta errada|passei o pix errado)"),
    answer: () => `Calma, dá pra resolver! Me envia o comprovante que já aviso o time para conferir e devolver ou realocar o valor. 🔄` },
  { id: "pix.limit", category: "pix",
    patterns: rx("(limite do pix|nao consigo pagar tudo|não consigo pagar tudo|meu banco limita|pix limitado)"),
    answer: () => `Sem stress! Você pode fazer *pagamentos parciais* — cada valor é abatido da sua dívida. Me diga quanto consegue hoje.` },
  { id: "pix.other_method", category: "pix",
    patterns: rx("(so pix|só pix|aceita cartao|cartão|dinheiro|deposito|depósito|boleto|ted|doc)"),
    answer: (c) => `Trabalhamos preferencialmente com *PIX* (mais rápido e sem custo). Boleto ou depósito só em casos especiais — se precisar, aciono um atendente. 💳` },

  // ═════ ATRASO / MULTA / JUROS ═════
  { id: "late.fee", category: "late",
    patterns: rx("(multa|taxa de atraso|multa de atraso|quanto e a multa|quanto é a multa|juros de mora)"),
    answer: (c) => `Em caso de atraso: multa de *${c.lateFeePct ?? 2}%* sobre a parcela + juros de *${c.dailyFeePct ?? 0.033}% ao dia*. Alterações de valores e prazos dependem exclusivamente da equipe humana.` },
  { id: "late.what_happens", category: "late",
    patterns: rx("(o que acontece se atrasar|se eu atrasar|atrasar da problema|serei negativado|vai pro serasa|vai negativar)"),
    answer: (c) => `Se atrasar: 1) tenta pagar assim que puder (rendem multa e juros diários); 2) se persistir, o valor pode ser negativado; 3) mas antes disso, sempre conversamos primeiro. Nossa preferência é *renegociar*. 🤝` },
  { id: "late.grace", category: "late",
    patterns: rx("(tem carencia|tem carência|dias de tolerancia|dias de graca|posso atrasar um pouco)"),
    answer: () => `Os encargos seguem as condições do seu contrato. Qualquer tolerância ou mudança de prazo precisa ser avaliada pela equipe humana.` },
  { id: "late.no_money", category: "late",
    patterns: rx("(sem dinheiro|nao tenho como pagar|não tenho como pagar|nao tenho grana|tô duro|to duro|desempregado|perdi o emprego|estou apertado)"),
    answer: (c) => `Entendo, ${c.firstName || "amigo(a)"}. A equipe pode avaliar sua situação. Digite *3* para solicitar renegociação; valores e prazos dependem da análise de um atendente.` },
  { id: "late.deadline_extend", category: "late",
    patterns: rx("(mais prazo|estender prazo|adiar|prorrogar|posso pagar (depois|semana que vem|mes que vem)|adiantar pra depois)"),
    answer: () => `A equipe humana precisa avaliar qualquer alteração de prazo. Digite *3* para solicitar atendimento.` },
  { id: "late.calculation", category: "late",
    patterns: rx("(como calcula a multa|como calcula juros|conta da multa|conta dos juros)"),
    answer: (c) => `Simples: *multa ${c.lateFeePct ?? 2}%* aplicada uma vez sobre o valor da parcela + *${c.dailyFeePct ?? 0.033}%/dia* × dias em atraso. Ex: parcela R$ 500, 10 dias em atraso ≈ R$ 500 + R$10 multa + R$1,65 juros diários.` },
  { id: "late.negative", category: "late",
    patterns: rx("(fui negativado|estou negativado|nome sujo|nome no serasa|spc|serasa|score baixo)"),
    answer: () => `A equipe humana precisa analisar sua situação e informar se há uma opção disponível. O bot não promete aprovação ou condições.` },

  // ═════ PORTAL / ACESSO ═════
  { id: "portal.link", category: "portal",
    patterns: rx("(portal|site|app|link|acessar minha conta|entrar no sistema|onde vejo|onde acompanho)"),
    answer: (c) => `*Portal do Cliente*: ${c.portalLink || 'digite portal'}\n\nLá você consulta parcelas, comprovantes e contratos. Digite *portal* para receber seu link de acesso.` },
  { id: "portal.password", category: "portal",
    patterns: rx("(esqueci a senha|nao lembro a senha|senha errada|nao consigo entrar|não consigo entrar|erro no login|login nao funciona)"),
    answer: () => `Nosso portal usa o CPF cadastrado. Digite *portal* para receber seu link de acesso.` },
  { id: "portal.mobile", category: "portal",
    patterns: rx("(tem app|aplicativo|celular|baixar app|app da loja|play store|app store)"),
    answer: (c) => `Não precisa baixar nada! O portal roda direto no navegador do celular, é rápido e funciona igual app. 📱` },
  { id: "portal.what_can_do", category: "portal",
    patterns: rx("(pra que serve o portal|o que faço no portal|o que tem no portal|o que da pra fazer)"),
    answer: () => `No portal você consulta parcelas, baixa o extrato em PDF, recebe avisos e acessa os dados de pagamento. Qualquer negociação é feita exclusivamente pela equipe humana.` },

  // ═════ RENEGOCIAÇÃO ═════
  { id: "reneg.request", category: "reneg",
    patterns: rx("(renegoci|acordo|refinanci|nova negocia|quero um acordo|proposta|parcelar de novo|dividir de novo)"),
    answer: () => `A negociação é feita exclusivamente por uma pessoa da equipe. Digite *3* para solicitar atendimento humano; o bot não define valores ou condições.` },
  { id: "reneg.discount", category: "reneg",
    patterns: rx("(desconto|reduzir juros|abater multa|tirar multa|desconto à vista|desconto a vista)"),
    answer: () => `A equipe precisa avaliar qualquer desconto para quitação. Digite *3* para solicitar renegociação.` },
  { id: "reneg.entry", category: "reneg",
    patterns: rx("(entrada|primeira parcela|dou um valor|dar um valor|adiantar um pouco)"),
    answer: () => `Perfeito! Uma boa entrada reduz muito o parcelamento. Me diz o *valor da entrada* e em *quantas parcelas* quer o saldo. 💪` },
  { id: "reneg.plan", category: "reneg",
    patterns: rx("(plano de pagamento|calendario|calendário|cronograma|planejamento)"),
    answer: () => `Combinado! Vou preparar um plano com datas certinhas. Me confirma: *quanto por mês* e *dia de pagamento* que prefere?` },

  // ═════ QUITAÇÃO / ANTECIPAÇÃO ═════
  { id: "early.pay", category: "early",
    patterns: rx("(antecipar|quitar antes|pagar antes|pagar tudo|quitar tudo|liquidar|encerrar contrato)"),
    answer: () => `A equipe precisa conferir o saldo e as condições de antecipação. Digite *5* para falar com um atendente.` },
  { id: "early.next_installment", category: "early",
    patterns: rx("(pagar a proxima|próxima parcela|proxima parcela|adiantar (uma|duas|tres) parcela)"),
    answer: () => `Claro! Me diz *quantas parcelas* quer adiantar que já mando o PIX total. 💸` },
  { id: "early.penalty", category: "early",
    patterns: rx("(tem multa (pra|para) antecipar|cobra pra antecipar|penalidade antecipacao)"),
    answer: () => `A equipe humana confere as condições para antecipação do seu contrato. Digite *5* para falar com um atendente.` },

  // ═════ SEGURANÇA / GOLPE / LGPD ═════
  { id: "sec.scam", category: "security",
    patterns: rx("(é golpe|e golpe|isso e verdade|desconfiado|to desconfiada|nao acredito|não acredito|parece golpe|suspeito|suspeita)"),
    answer: (c) => `Entendo a cautela — hoje em dia é sábio duvidar. 🛡️ Somos a *${c.companyName}*, atendimento oficial. Nunca pedimos senha de banco, código de app ou depósito antes de liberar. Contratos são assinados digitalmente com validade jurídica.` },
  { id: "sec.data", category: "security",
    patterns: rx("(meus dados|lgpd|privacidade|onde ficam meus dados|quem tem acesso|vazamento)"),
    answer: () => `Seus dados ficam em servidor seguro, criptografado, e só nossa equipe autorizada acessa. Cumprimos a *LGPD* — você pode pedir exclusão a qualquer momento. 🔒` },
  { id: "sec.pay_first", category: "security",
    patterns: rx("(pagar (taxa|adiantado|antecipado|deposito|depósito) pra liberar|preciso depositar pra receber|taxa de liberacao)"),
    answer: (c) => `🚨 *Atenção*: a *${c.companyName}* NUNCA cobra taxa antecipada, depósito, seguro ou "TAC" pra liberar empréstimo. Se alguém pediu, é golpe — nos avise!` },
  { id: "sec.password", category: "security",
    patterns: rx("(quer minha senha|senha do banco|codigo do app|token|senha do cartao)"),
    answer: () => `🛡️ NUNCA pedimos senha, código de app ou dados de cartão. Se alguém pediu se passando por nós, é golpe — ignore e nos avise!` },

  // ═════ CONTRATO ═════
  { id: "contract.sign", category: "contract",
    patterns: rx("(assinar contrato|assinatura|como assino|onde assino|contrato digital|papel do contrato)"),
    answer: () => `O contrato é *100% digital*: você recebe um link, revisa, dá aceite com CPF+selfie e pronto. Vale como assinatura em cartório (Lei 14.063). ✍️` },
  { id: "contract.copy", category: "contract",
    patterns: rx("(copia do contrato|cópia do contrato|contrato assinado|pdf do contrato|manda o contrato)"),
    answer: (c) => `Claro! O PDF assinado está no *portal* (${c.portalLink || "link acima"}). Se preferir, peço pro time enviar aqui também. 📄` },
  { id: "contract.change", category: "contract",
    patterns: rx("(alterar contrato|mudar contrato|trocar prazo|trocar valor|refazer contrato)"),
    answer: () => `Alterações de valores ou prazos precisam ser avaliadas pela equipe. Digite *3* para solicitar renegociação.` },
  { id: "contract.cancel", category: "contract",
    patterns: rx("(cancelar (o )?contrato|desistir|arrependimento|nao quero mais|não quero mais o contrato)"),
    answer: () => `Se o dinheiro ainda não foi liberado, cancelamos sem custo. Se já caiu, você tem *7 dias* pra desistir (Código do Consumidor) devolvendo o valor. Chamo um atendente? 👤` },

  // ═════ HUMANO / ATENDIMENTO ═════
  { id: "human.talk", category: "human",
    patterns: rx("(atendente|humano|pessoa de verdade|falar com alguem|operador|gerente|responsavel|responsável|com uma pessoa|alguém real|dono|patrao|patrão|consultor)"),
    answer: (c) => `Digite *5* para falar com um atendente da *${c.companyName}*. O atendimento automático será pausado.` },
  { id: "human.hours", category: "human",
    patterns: rx("(horario de atendimento|horário|que horas atendem|abrem que horas|fim de semana|sabado|sábado|domingo|feriado)"),
    answer: (c) => `Nosso atendimento humano é *${c.businessHours || "seg-sex 9h-18h"}*. O bot responde 24h! Fora do horário deixe sua mensagem que retornamos assim que abrir. ⏰` },
  { id: "human.phone", category: "human",
    patterns: rx("(telefone|numero (de|do|para) contato|numero da empresa|liga (pra|para) mim|me liga)"),
    answer: (c) => c.supportPhone
      ? `Nosso contato oficial é *${c.supportPhone}*. 📞 Mas por aqui geralmente é mais rápido!`
      : `Nosso canal oficial é este WhatsApp. Se precisar de atendimento humano, digite *5*.` },

  // ═════ SIMULAÇÃO — VALORES ESPECÍFICOS ═════
  { id: "sim.1000", category: "sim",
    patterns: rx("(mil reais|1000 reais|r\\$ ?1000|1\\.000)"),
    answer: () => `A equipe humana analisa a solicitação de R$ 1.000 e informa valores e prazos. O bot não calcula nem confirma uma proposta.` },
  { id: "sim.500", category: "sim",
    patterns: rx("(quinhentos|500 reais|r\\$ ?500)"),
    answer: () => `A equipe humana analisa a solicitação de R$ 500 e informa valores e prazos. O bot não calcula nem confirma uma proposta.` },
  { id: "sim.2000", category: "sim",
    patterns: rx("(dois mil|2000 reais|r\\$ ?2000|2\\.000)"),
    answer: () => `A equipe humana analisa a solicitação de R$ 2.000 e informa valores e prazos. O bot não calcula nem confirma uma proposta.` },
  { id: "sim.5000", category: "sim",
    patterns: rx("(cinco mil|5000 reais|r\\$ ?5000|5\\.000)"),
    answer: () => `A equipe humana analisa a solicitação de R$ 5.000 e informa valores e prazos. O bot não calcula nem confirma uma proposta.` },
  { id: "sim.10000", category: "sim",
    patterns: rx("(dez mil|10000 reais|r\\$ ?10000|10\\.000)"),
    answer: () => `A equipe humana analisa a solicitação de R$ 10.000 e informa valores e prazos. O bot não calcula nem confirma uma proposta.` },

  // ═════ PRODUTOS ESPECÍFICOS ═════
  { id: "prod.consignado", category: "product",
    patterns: rx("(consignado|desconto em folha|desconto no beneficio|inss consignado)"),
    answer: (c) => `Não trabalhamos com *consignado* no momento — apenas empréstimo pessoal direto. Nossa análise costuma ser mais rápida e sem burocracia! ⚡` },
  { id: "prod.card", category: "product",
    patterns: rx("(cartao de credito|cartão de crédito|cartao consignado|cartão consignado)"),
    answer: () => `Não emitimos cartão — trabalhamos apenas com *empréstimo pessoal via PIX*. 💳` },
  { id: "prod.vehicle", category: "product",
    patterns: rx("(financiamento (de )?(carro|moto|veiculo|veículo)|refinanciamento|garantia veicular)"),
    answer: () => `Não financiamos veículos, mas fazemos empréstimo com veículo em garantia em alguns casos. Chamo um consultor? 🚗` },
  { id: "prod.property", category: "product",
    patterns: rx("(financiamento imovel|financiamento imóvel|home equity|casa em garantia)"),
    answer: () => `Não trabalhamos com imóveis em garantia atualmente. Nosso foco é *empréstimo pessoal rápido*. 🏠` },

  // ═════ FRUSTRAÇÃO / RECLAMAÇÕES ═════
  { id: "complain.angry", category: "complain",
    patterns: rx("(que absurdo|inaceitavel|inaceitável|revoltado|revoltada|indignado|indignada|palhaçada|palhacada|nao aceito|não aceito|processo|advogado|procon|reclame aqui)"),
    answer: (c) => `Sinto muito por essa experiência 🙏. Levo isso muito a sério — vou *chamar o gestor* agora pra resolver com você direto. Um momento…` },
  { id: "complain.wait", category: "complain",
    patterns: rx("(demora demais|to esperando|tô esperando|ninguem responde|ninguém responde|abandonado|ate quando|há dias|faz dias)"),
    answer: (c) => `Peço desculpas pela demora! 🙏 Já estou puxando seu histórico e vou priorizar seu atendimento agora.` },
  { id: "complain.wrong_charge", category: "complain",
    patterns: rx("(cobrança indevida|cobrar[aá] duas vezes|paguei e cobra de novo|ja paguei e continua|cobrança errada|valor errado)"),
    answer: () => `Vamos verificar já! 🔍 Me envie o comprovante e o valor que aparece cobrado — resolvo em minutos.` },
  { id: "complain.harassment", category: "complain",
    patterns: rx("(muita mensagem|para de mandar|para de me mandar|nao me manda mais|nao manda mais|assediando|perseguindo|bloquear)"),
    answer: () => `Peço desculpa pelo incômodo. 🙏 Vou reduzir a frequência e você pode digitar *"parar"* a qualquer momento pra sair da lista.` },

  // ═════ PERGUNTAS CONTEXTUAIS (CLIENTE ATIVO) ═════
  { id: "ctx.next_due", category: "context",
    patterns: rx("(quando vence|proximo vencimento|próximo vencimento|proxima parcela vence|data de vencimento|dia da parcela)"),
    answer: () => `Digite *2* para consultar as parcelas em aberto, com vencimentos e valores atualizados.` },
  { id: "ctx.balance", category: "context",
    patterns: rx("(saldo devedor|quanto (eu )?devo|quanto falta pagar|meu saldo|quanto ainda devo|total em aberto)"),
    answer: () => `Digite *2* para consultar suas parcelas e o saldo atualizado.` },
  { id: "ctx.installments_left", category: "context",
    patterns: rx("(quantas parcelas faltam|parcelas restantes|faltam quantas)"),
    answer: () => `Digite *2* para consultar as parcelas em aberto. O progresso do contrato também aparece no portal.` },
  { id: "ctx.history", category: "context",
    patterns: rx("(historico|histórico|extrato|todos os pagamentos|o que ja paguei|que ja paguei)"),
    answer: () => `Digite *portal* para acessar o histórico de parcelas e pagamentos do seu cadastro.` },
  { id: "ctx.new_loan", category: "context",
    patterns: rx("(novo emprestimo|outro emprestimo|mais um emprestimo|posso pegar mais|quero pegar de novo|renovar)"),
    answer: (c) => `Que ótimo saber que voltou! 💚 Vou avisar seu consultor pra preparar uma *nova proposta com condições especiais* (cliente antigo tem prioridade).` },

  // ═════ FAQs FINAIS DIVERSAS ═════
  { id: "misc.location", category: "misc",
    patterns: rx("(onde (voces |vocês )?fica(m)?|endereco|endereço|localizacao|localização|tem escritorio|escritório fisico|matriz)"),
    answer: (c) => `Somos *100% digitais* — atendemos de qualquer lugar do Brasil via WhatsApp e portal. Sem filas, sem deslocamento! 🌐` },
  { id: "misc.states", category: "misc",
    patterns: rx("(atende (em|no|na) [a-z ]+|atende todo brasil|atende meu estado|só (em|no|na))"),
    answer: () => `Atendemos *todo o Brasil*! Onde tiver PIX, a gente empresta. 🇧🇷` },
  { id: "misc.tax_id", category: "misc",
    patterns: rx("(cnpj|razao social|razão social|nome empresarial|registro banco central|bacen|autorizacao)"),
    answer: () => `Digite *5* para solicitar à equipe o CNPJ e a razão social da empresa.` },
  { id: "misc.language", category: "misc",
    patterns: rx("(fala ingles|english|habla espanol|other language|otro idioma)"),
    answer: () => `Atendemos em *português* apenas por enquanto. 🇧🇷 Português mesmo é o que fluímos! 😄` },
  { id: "misc.working_ok", category: "misc",
    patterns: rx("((voce|voces|vocês) (esta|estao|está|estão|ta|tão) funcionando|voce funciona|o bot ta on|ta on line|ta ai)"),
    answer: () => `Aqui estou! ✅ 24 horas por dia respondendo. Manda a boa!` },
  { id: "misc.reference", category: "misc",
    patterns: rx("(indicar amigo|indicacao|indicação|programa de indicacao|ganho por indicar|cashback)"),
    answer: (c) => `Amamos indicações! 💚 Ainda não temos programa formal, mas fale com seu consultor sobre *bônus por indicação* — muitas vezes conseguimos. 🎁` },
  { id: "misc.review", category: "misc",
    patterns: rx("(reclame aqui|nota|avaliacao|avaliação|reputacao|reputação|(e|sao|é|são) confiaveis?|(e|sao|é|são) confiáveis?)"),
    answer: (c) => `Trabalhamos pra manter reputação sólida — atendimento humano, contratos claros e taxa transparente. Melhor prova é o cliente satisfeito. 💚` },
];

// ═══════════════════════════════════════════════════════════════════════
// MATCHER
// ═══════════════════════════════════════════════════════════════════════

/**
 * Encontra a melhor entrada da FAQ pro texto do usuário.
 * Retorna null se nada bater com confiança mínima.
 */
export function findFaqMatch(text: string, ctx: FaqContext): { entry: FaqEntry; answer: string; score: number } | null {
  const t = norm(text);
  if (!t || t.length < 2) return null;

  let best: { entry: FaqEntry; score: number } | null = null;

  for (const entry of FAQ) {
    let score = 0;
    for (const pat of entry.patterns) {
      const match = text.match(pat) ?? t.match(pat);
      if (match) {
        // Frases específicas vencem palavras genéricas. Ex.: "quantas parcelas
        // faltam" é contexto do contrato, não a pergunta genérica sobre prazo.
        score += 10 + Math.min(match[0].length, 50) / 10;
        break;
      }
    }
    if (entry.keywords) {
      for (const group of entry.keywords) {
        if (group.some(k => t.includes(norm(k)))) score += 3;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { entry, score };
    }
  }
  if (!best || best.score < 5) return null;
  return { entry: best.entry, answer: best.entry.answer(ctx), score: best.score };
}

/** Retorna múltiplas respostas se o texto contiver várias intenções. */
export function findMultipleFaqMatches(text: string, ctx: FaqContext, max = 3): FaqEntry[] {
  const t = norm(text);
  const hits: Array<{ entry: FaqEntry; score: number }> = [];
  for (const entry of FAQ) {
    for (const pat of entry.patterns) {
      if (pat.test(text) || pat.test(t)) {
        hits.push({ entry, score: 10 });
        break;
      }
    }
  }
  // dedupe por categoria — evita 3 respostas iguais
  const seen = new Set<string>();
  const uniq: FaqEntry[] = [];
  for (const h of hits.sort((a, b) => b.score - a.score)) {
    if (seen.has(h.entry.category)) continue;
    seen.add(h.entry.category);
    uniq.push(h.entry);
    if (uniq.length >= max) break;
  }
  return uniq;
}

/** Total de intents na base (métrica pra logs) */
export const FAQ_COUNT = FAQ.length;
