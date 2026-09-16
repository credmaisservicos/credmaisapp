// Substitui placeholders {{chave}} no template do contrato com dados reais.
// Suporta tabela de parcelas via bloco {{#parcelas}}...{{/parcelas}} (cada linha repete por parcela).

export interface ContractPlaceholderData {
  clientName: string;
  cpfCnpj: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  capital: number;
  interestRate: number;
  totalAmount: number;
  totalInterest: number;
  installmentAmount: number;
  numInstallments: number;
  frequency: string;
  startDate: string;
  lateFeePercent: number;
  dailyInterestPercent: number;
  dailyPenaltyType?: "percentage" | "fixed";
  companyName: string;
  companyCnpj: string;
  installments?: { installment_number: number; amount: number; due_date: string }[];

  // O formulário de empréstimo já coletava tudo isto e gravava no contrato, mas
  // nada chegava ao documento: quem pedia avalista gerava um contrato sem o
  // nome do avalista em lugar nenhum — um aval que não vale nada. Idem para
  // garantia, forma de pagamento, carência e desconto de antecipação.
  paymentMethod?: string;
  guaranteeType?: string | null;
  guaranteeDescription?: string | null;
  guarantorName?: string | null;
  guarantorCpf?: string | null;
  guarantorPhone?: string | null;
  gracePeriods?: number;
  graceDays?: number;
  earlyPaymentDiscountPercent?: number;
  maxInterestCapPercent?: number | null;
  companyAddress?: string;
  companyPhone?: string;
}

const fmtMoney = (v: unknown) => {
  const number = Number(v ?? 0);
  return "R$ " + (Number.isFinite(number) ? number : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d: string) => {
  if (!d) return "";
  try {
    // Bare YYYY-MM-DD → parse as local noon to avoid UTC shift
    const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dt = iso ? new Date(+iso[1], +iso[2] - 1, +iso[3], 12, 0, 0, 0) : new Date(d);
    return dt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return d;
  }
};

export const CONTRACT_PLACEHOLDERS = [
  { key: "cliente_nome", desc: "Nome do cliente" },
  { key: "cliente_cpf", desc: "CPF/CNPJ do cliente" },
  { key: "cliente_telefone", desc: "Telefone" },
  { key: "cliente_whatsapp", desc: "WhatsApp" },
  { key: "cliente_email", desc: "E-mail" },
  { key: "cliente_endereco", desc: "Endereço" },
  { key: "empresa_nome", desc: "Nome da empresa (credor)" },
  { key: "empresa_cnpj", desc: "CNPJ da empresa" },
  { key: "capital", desc: "Valor emprestado" },
  { key: "total", desc: "Total a pagar" },
  { key: "total_juros", desc: "Total de juros" },
  { key: "valor_parcela", desc: "Valor de cada parcela" },
  { key: "num_parcelas", desc: "Quantidade de parcelas" },
  { key: "taxa", desc: "Taxa de juros (%)" },
  { key: "frequencia", desc: "Frequência (Mensal, Quinzenal, etc)" },
  { key: "data_inicio", desc: "Data do 1º vencimento" },
  { key: "multa", desc: "Multa por atraso (%)" },
  { key: "juros_diario", desc: "Juros diário (%)" },
  { key: "data_hoje", desc: "Data de hoje" },
  { key: "data_ultimo_vencimento", desc: "Vencimento da última parcela" },
  { key: "tabela_parcelas", desc: "Tabela completa de parcelas" },
  { key: "forma_pagamento", desc: "Forma de pagamento (PIX, dinheiro…)" },
  { key: "carencia", desc: "Carência antes da 1ª parcela" },
  { key: "desconto_antecipacao", desc: "Desconto por pagamento antecipado (%)" },
  { key: "teto_juros", desc: "Teto dos juros de atraso (%)" },
  { key: "garantia_tipo", desc: "Tipo de garantia (avalista, veículo…)" },
  { key: "garantia_descricao", desc: "Descrição da garantia" },
  { key: "avalista_nome", desc: "Nome do avalista" },
  { key: "avalista_cpf", desc: "CPF do avalista" },
  { key: "avalista_telefone", desc: "Telefone do avalista" },
  { key: "empresa_endereco", desc: "Endereço da empresa (credor)" },
  { key: "empresa_telefone", desc: "Telefone da empresa (credor)" },
];

/**
 * Blocos que só aparecem quando o dado existe.
 *
 * Sem isto, um contrato com cláusula de avalista sairia com os campos em branco
 * para todo cliente que não tem avalista — que é a maioria. Uso:
 *
 *   {{#se_avalista}}O(A) Sr(a). {{avalista_nome}}, CPF {{avalista_cpf}},
 *   figura como AVALISTA...{{/se_avalista}}
 */
export const CONTRACT_CONDITIONS = [
  { key: "se_avalista", desc: "Só aparece quando há avalista" },
  { key: "se_garantia", desc: "Só aparece quando há garantia" },
  { key: "se_carencia", desc: "Só aparece quando há carência" },
  { key: "se_desconto", desc: "Só aparece quando há desconto por antecipação" },
  { key: "se_teto_juros", desc: "Só aparece quando há teto de juros de atraso" },
];

const ROTULOS_PAGAMENTO: Record<string, string> = {
  pix: "PIX",
  cash: "Dinheiro",
  boleto: "Boleto",
  transfer: "Transferência bancária",
};

const ROTULOS_GARANTIA: Record<string, string> = {
  aval: "Avalista",
  vehicle: "Veículo",
  property: "Imóvel",
  other: "Outra",
};

/** Nomes de variáveis que o texto usa e o sistema não conhece. */
export function variaveisDesconhecidas(template: string): string[] {
  const conhecidas = new Set([
    ...CONTRACT_PLACEHOLDERS.map((p) => p.key),
    ...CONTRACT_CONDITIONS.map((c) => c.key),
    "parcelas",
    "numero",
    "vencimento",
    "valor",
  ]);
  const achadas = new Set<string>();
  for (const m of String(template || "").matchAll(/\{\{\s*[#/]?\s*([a-z_]+)\s*\}\}/gi)) {
    const chave = m[1].toLowerCase();
    if (!conhecidas.has(chave)) achadas.add(chave);
  }
  return [...achadas];
}

export function renderContractTemplate(template: string, data: ContractPlaceholderData): string {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const map: Record<string, string> = {
    cliente_nome: data.clientName || "",
    cliente_cpf: data.cpfCnpj || "",
    cliente_telefone: data.phone || "",
    cliente_whatsapp: data.whatsapp || "",
    cliente_email: data.email || "",
    cliente_endereco: data.address || "",
    empresa_nome: data.companyName || "",
    empresa_cnpj: data.companyCnpj || "",
    capital: fmtMoney(data.capital),
    total: fmtMoney(data.totalAmount),
    total_juros: fmtMoney(data.totalInterest),
    valor_parcela: fmtMoney(data.installmentAmount),
    num_parcelas: String(data.numInstallments),
    taxa: `${data.interestRate}%`,
    frequencia: data.frequency,
    data_inicio: fmtDate(data.startDate),
    multa: data.dailyPenaltyType === "fixed" ? `R$ ${fmtMoney(data.lateFeePercent)} por dia` : `${data.lateFeePercent}% por dia`,
    juros_diario: `${data.dailyInterestPercent}%`,
    data_hoje: today,
    data_ultimo_vencimento: fmtDate(
      (data.installments || []).length
        ? data.installments![data.installments!.length - 1].due_date
        : "",
    ),
    forma_pagamento: ROTULOS_PAGAMENTO[String(data.paymentMethod || "").toLowerCase()] || "",
    carencia: data.graceDays
      ? `${data.graceDays} dia(s)`
      : data.gracePeriods
        ? `${data.gracePeriods} período(s)`
        : "",
    desconto_antecipacao: data.earlyPaymentDiscountPercent
      ? `${data.earlyPaymentDiscountPercent}%`
      : "",
    teto_juros: data.maxInterestCapPercent ? `${data.maxInterestCapPercent}%` : "",
    garantia_tipo: ROTULOS_GARANTIA[String(data.guaranteeType || "").toLowerCase()] || "",
    garantia_descricao: data.guaranteeDescription || "",
    avalista_nome: data.guarantorName || "",
    avalista_cpf: data.guarantorCpf || "",
    avalista_telefone: data.guarantorPhone || "",
    empresa_endereco: data.companyAddress || "",
    empresa_telefone: data.companyPhone || "",
  };

  // Tabela de parcelas (texto simples)
  const tabela = (data.installments || [])
    .map(
      (p) =>
        `Parcela ${String(p.installment_number).padStart(2, "0")} — Vencimento ${fmtDate(
          p.due_date,
        )} — ${fmtMoney(Number(p.amount))}`,
    )
    .join("\n");
  map.tabela_parcelas = tabela;

  // Blocos condicionais: o trecho some inteiro quando o dado não existe, em vez
  // de imprimir uma cláusula de avalista com o nome em branco.
  const condicoes: Record<string, boolean> = {
    se_avalista: Boolean(data.guarantorName?.trim()),
    se_garantia: Boolean(
      data.guaranteeType && data.guaranteeType !== "none" &&
      (data.guaranteeDescription?.trim() || data.guarantorName?.trim()),
    ),
    se_carencia: Boolean(data.graceDays || data.gracePeriods),
    se_desconto: Boolean(data.earlyPaymentDiscountPercent),
    se_teto_juros: Boolean(data.maxInterestCapPercent),
  };
  let template2 = template;
  for (const [chave, ativo] of Object.entries(condicoes)) {
    const bloco = new RegExp(`\\{\\{#${chave}\\}\\}([\\s\\S]*?)\\{\\{/${chave}\\}\\}`, "g");
    template2 = template2.replace(bloco, (_m, dentro) => (ativo ? dentro : ""));
  }

  // Bloco repetível {{#parcelas}}...{{/parcelas}}
  let result = template2.replace(/\{\{#parcelas\}\}([\s\S]*?)\{\{\/parcelas\}\}/g, (_m, block) => {
    return (data.installments || [])
      .map((p) =>
        block
          .replace(/\{\{numero\}\}/g, String(p.installment_number).padStart(2, "0"))
          .replace(/\{\{vencimento\}\}/g, fmtDate(p.due_date))
          .replace(/\{\{valor\}\}/g, fmtMoney(Number(p.amount))),
      )
      .join("");
  });

  // Substituições simples
  result = result.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) =>
    map[key.toLowerCase()] !== undefined ? map[key.toLowerCase()] : `{{${key}}}`,
  );

  return result;
}

export const DEFAULT_CONTRACT_TEMPLATE = `CONTRATO DE EMPRÉSTIMO PESSOAL

CREDOR: {{empresa_nome}} — CPF/CNPJ {{empresa_cnpj}}
Endereço: {{empresa_endereco}} — Telefone: {{empresa_telefone}}
DEVEDOR(A): {{cliente_nome}} — CPF/CNPJ {{cliente_cpf}}
Endereço: {{cliente_endereco}}
Telefone: {{cliente_telefone}} — E-mail: {{cliente_email}}

As partes acima identificadas celebram este instrumento particular de empréstimo e confissão de dívida, mediante as condições seguintes.

1. OBJETO E ENTREGA DO CAPITAL
1.1 O CREDOR entrega ao(à) DEVEDOR(A) o valor de {{capital}}, que declara receber e se obriga a restituir conforme este instrumento.

2. CONDIÇÕES FINANCEIRAS
2.1 Capital entregue: {{capital}}.
2.2 Taxa contratada: {{taxa}} por período {{frequencia}}.
2.3 Custo financeiro total: {{total_juros}}.
2.4 Valor total a pagar: {{total}}.
2.5 Pagamento em {{num_parcelas}} parcela(s) de {{valor_parcela}}, com primeiro vencimento em {{data_inicio}} e último em {{data_ultimo_vencimento}}.

3. CRONOGRAMA DE PAGAMENTOS
{{tabela_parcelas}}

4. FORMA DE PAGAMENTO
4.1 Os pagamentos serão realizados por {{forma_pagamento}} nas datas do cronograma e deverão ser comprovados por recibo, comprovante bancário ou registro no portal.
{{#se_carencia}}4.2 Fica concedida carência de {{carencia}} antes do primeiro vencimento.
{{/se_carencia}}
5. ENCARGOS POR ATRASO
5.1 No atraso, incidirão juros de {{juros_diario}} ao dia sobre o valor vencido e multa de {{multa}}.
{{#se_teto_juros}}5.2 Os juros de atraso ficam limitados a {{teto_juros}} do valor original da parcela.
{{/se_teto_juros}}
{{#se_desconto}}
6. PAGAMENTO ANTECIPADO
6.1 A quitação antecipada dá direito à redução proporcional dos encargos futuros e ao desconto adicional contratado de {{desconto_antecipacao}}.
{{/se_desconto}}
{{#se_avalista}}
7. AVAL
7.1 {{avalista_nome}}, CPF {{avalista_cpf}}, telefone {{avalista_telefone}}, declara ciência das condições e assina como AVALISTA, nos limites da legislação aplicável.
{{/se_avalista}}
{{#se_garantia}}
8. GARANTIA
8.1 Tipo: {{garantia_tipo}}. Descrição: {{garantia_descricao}}.
8.2 A garantia somente poderá ser exigida nos limites da obrigação contratada e da legislação aplicável.
{{/se_garantia}}
9. DISPOSIÇÕES GERAIS
9.1 O(A) DEVEDOR(A) manterá seus dados de contato atualizados.
9.2 Eventual tolerância não implica renúncia, alteração contratual ou novação.
9.3 As partes admitem comunicações, comprovantes e assinatura por meios eletrônicos.
9.4 Fica eleito o foro legalmente competente, respeitadas as normas obrigatórias de proteção ao consumidor e de competência territorial.

_______________, {{data_hoje}}


_____________________________            _____________________________
{{empresa_nome}} (Credor)                 {{cliente_nome}} (Devedor/a)
{{#se_avalista}}

_____________________________
{{avalista_nome}} (Avalista)
{{/se_avalista}}

_____________________________            _____________________________
Testemunha 1 — Nome e CPF                 Testemunha 2 — Nome e CPF`;

type ContractPreset = { id: string; name: string; description: string; content: string };

const presetContract = (title: string, opening: string, special: string) => `${title}

CREDOR: {{empresa_nome}}, CPF/CNPJ {{empresa_cnpj}}, com endereço em {{empresa_endereco}}.
DEVEDOR(A): {{cliente_nome}}, CPF/CNPJ {{cliente_cpf}}, residente em {{cliente_endereco}}.

${opening}

1. VALOR E CONDIÇÕES
1.1. O capital entregue é de {{capital}}.
1.2. A taxa contratada é de {{taxa}} na frequência {{frequencia}}.
1.3. O total previsto é de {{total}}, sendo {{total_juros}} de encargos remuneratórios.
1.4. O pagamento ocorrerá em {{num_parcelas}} parcela(s) de {{valor_parcela}}, por {{forma_pagamento}}.

2. VENCIMENTOS
2.1. Primeiro vencimento: {{data_inicio}}. Último vencimento: {{data_ultimo_vencimento}}.
{{tabela_parcelas}}

3. ATRASO
3.1. No atraso incidirão juros de {{juros_diario}} ao dia e multa contratada de {{multa}}, observados os limites legais aplicáveis.
{{#se_teto_juros}}3.2. Os juros de atraso ficam limitados a {{teto_juros}} do valor original da parcela.{{/se_teto_juros}}

${special}

5. DISPOSIÇÕES GERAIS
5.1. Pagamentos deverão ser comprovados por recibo, comprovante bancário ou registro no portal.
5.2. As partes aceitam comunicações e assinatura por meios eletrônicos.
5.3. Eventual tolerância não representa novação ou renúncia de direito.
5.4. Fica eleito o foro legalmente competente, respeitadas as normas obrigatórias aplicáveis.

Local e data: ____________________, {{data_hoje}}

_____________________________        _____________________________
{{empresa_nome}} — CREDOR             {{cliente_nome}} — DEVEDOR(A)
{{#se_avalista}}
_____________________________
{{avalista_nome}} — AVALISTA, CPF {{avalista_cpf}}
{{/se_avalista}}

_____________________________        _____________________________
Testemunha 1 — Nome e CPF             Testemunha 2 — Nome e CPF`;

export const CONTRACT_TEMPLATE_PRESETS: ContractPreset[] = [
  {
    id: "pessoal-parcelado", name: "Empréstimo pessoal parcelado", description: "Modelo geral com cronograma completo.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO PESSOAL PARCELADO", "As partes celebram empréstimo particular com restituição parcelada, conforme o cronograma deste instrumento.", "4. QUITAÇÃO ANTECIPADA\n4.1. O devedor poderá antecipar pagamentos, com recálculo dos encargos futuros quando aplicável.\n{{#se_desconto}}4.2. Foi ajustado desconto adicional de {{desconto_antecipacao}} para antecipação.{{/se_desconto}}"),
  },
  {
    id: "pagamento-unico", name: "Pagamento único", description: "Capital e juros em um vencimento.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO COM PAGAMENTO ÚNICO", "O devedor restituirá o capital e os encargos em pagamento único na data indicada neste contrato.", "4. PAGAMENTO FINAL\n4.1. A obrigação será liquidada integralmente no vencimento, sem pagamentos periódicos intermediários."),
  },
  {
    id: "somente-juros", name: "Somente juros", description: "Juros periódicos e capital ao final.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO COM PAGAMENTO PERIÓDICO DE JUROS", "Durante a vigência, o devedor pagará os juros periódicos; o capital permanecerá devido até o vencimento final.", "4. CAPITAL\n4.1. O pagamento dos juros não amortiza o capital, salvo indicação expressa em recibo.\n4.2. O capital deverá ser quitado no último vencimento ou em renovação formal aceita pelas partes."),
  },
  {
    id: "confissao-divida", name: "Confissão de dívida", description: "Formalização de saldo já existente.",
    content: presetContract("INSTRUMENTO PARTICULAR DE CONFISSÃO E PARCELAMENTO DE DÍVIDA", "O devedor reconhece como líquido o saldo de {{capital}}, cuja composição e forma de pagamento declara conhecer.", "4. RECONHECIMENTO\n4.1. Este instrumento consolida o saldo indicado sem impedir a conferência de pagamentos comprovadamente realizados.\n4.2. A quitação será concedida após a liquidação integral."),
  },
  {
    id: "com-avalista", name: "Com avalista", description: "Inclui qualificação e assinatura do avalista.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO COM AVALISTA", "O empréstimo é celebrado com garantia pessoal do avalista identificado neste instrumento.", "4. AVAL\n{{#se_avalista}}4.1. {{avalista_nome}}, CPF {{avalista_cpf}}, telefone {{avalista_telefone}}, declara ciência das condições e assume a garantia nos limites legais.{{/se_avalista}}"),
  },
  {
    id: "com-garantia", name: "Com garantia", description: "Para veículo, imóvel ou outro bem.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO COM GARANTIA", "As obrigações contam com a garantia descrita abaixo, sem transferência automática de propriedade.", "4. GARANTIA\n{{#se_garantia}}4.1. Tipo: {{garantia_tipo}}. Descrição: {{garantia_descricao}}.\n4.2. A garantia somente poderá ser exigida nos limites da obrigação e da legislação.{{/se_garantia}}"),
  },
  {
    id: "capital-giro-pj", name: "Capital de giro — PJ", description: "Empréstimo destinado a atividade empresarial.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO PARA CAPITAL DE GIRO", "O capital é disponibilizado ao devedor para apoio à sua atividade empresarial, permanecendo a obrigação de pagamento independente da destinação econômica.", "4. FINALIDADE\n4.1. A indicação de capital de giro não cria sociedade, participação nos resultados ou vínculo entre as partes."),
  },
  {
    id: "semanal", name: "Cobrança semanal", description: "Texto direto para pagamentos semanais.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO — PAGAMENTOS SEMANAIS", "O pagamento será realizado semanalmente nas datas discriminadas no cronograma.", "4. PERIODICIDADE\n4.1. Cada pagamento corresponde à parcela indicada, e pagamentos parciais serão abatidos do saldo mediante recibo."),
  },
  {
    id: "quinzenal", name: "Cobrança quinzenal", description: "Preparado para ciclos de quinze dias.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO — PAGAMENTOS QUINZENAIS", "O pagamento será realizado em ciclos quinzenais, conforme datas expressas no cronograma.", "4. PERIODICIDADE\n4.1. Alterações de vencimento somente terão validade quando registradas por escrito ou no portal."),
  },
  {
    id: "price", name: "Parcelas fixas — Price", description: "Amortização com prestações fixas.",
    content: presetContract("CONTRATO DE EMPRÉSTIMO COM PARCELAS FIXAS", "O saldo será amortizado por prestações fixas calculadas pelo sistema Price, conforme taxa e cronograma informados.", "4. AMORTIZAÇÃO\n4.1. Cada prestação compreende juros e amortização do capital.\n4.2. A antecipação deverá considerar o saldo devedor atualizado na data do pagamento."),
  },
];
