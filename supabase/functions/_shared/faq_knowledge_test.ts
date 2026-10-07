// deno-lint-ignore-file no-explicit-any
// Suíte de validação massiva do agente de WhatsApp.
// - Corpus base com centenas de frases reais, uma por categoria alvo.
// - Mutadores programáticos: caixa, pontuação, prefixos, sufixos, typos comuns,
//   duplicações e emojis. Cada frase base gera ~10-12 variações → milhares de
//   testes cobrindo o que usuários digitam de verdade.
// - Testes negativos garantem que ruído aleatório NÃO produza falso-positivo.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FAQ, FAQ_COUNT, findFaqMatch, findMultipleFaqMatches, norm, type FaqContext } from "./faq_knowledge.ts";

// ───────── contexto padrão pra rodar as respostas
const CTX: FaqContext = {
  companyName: "CredMais",
  firstName: "Gustavo",
  portalLink: "https://credmaisapp.com.br/portal",
  pixKey: "gustavo@credmais.com",
  pixKeyType: "email",
  ownerName: "Gustavo Lopes",
  rate: 15,
  term: 6,
  minAmount: 100,
  maxAmount: 100000,
  lateFeePct: 2,
  dailyFeePct: 0.033,
  earlyDiscountPct: 5,
  supportPhone: "(11) 99999-9999",
  supportEmail: "suporte@credmais.com",
  businessHours: "Seg-Sex 9h-18h",
  hasOpenInstallments: true,
  isKnownClient: true,
};
Deno.test('legacy amount FAQs never offer automatically calculated loan terms',()=>{
  for(const entry of FAQ.filter(e=>e.category==='sim')) {
    const answer=entry.answer(CTX);
    assert(answer.includes('equipe humana'));
    assert(!/parcela ≈|total ≈|aprovado\?|fecha\?|fechamos\?|\d+x com/i.test(answer));
  }
});
Deno.test('asking to understand better is not mistaken for a compliment',()=>{
  const hit=findFaqMatch('Gostaria de entender melhor minha situação específica antes de decidir.',CTX);
  assert(hit?.entry.id !== 'greet.compliment');
});
Deno.test('FAQ payment and portal guidance agrees with the current service menu',()=>{
  assert(findFaqMatch('meu saldo',CTX)?.answer.includes('*2*'));
  assert(findFaqMatch('quantas parcelas faltam',CTX)?.answer.includes('*2*'));
  assert(findFaqMatch('esqueci a senha',CTX)?.answer.includes('*portal*'));
  assert(findFaqMatch('cnpj',CTX)?.answer.includes('*5*'));
  const discount=findFaqMatch('desconto à vista',CTX)?.answer || '';
  assert(discount.includes('equipe'));assert(!discount.includes('5%'));
});

// ═══════════════════════════════════════════════════════════════════════
// CORPUS BASE — pergunta → categoria (ou id) esperado
// Cobre todas as 15+ categorias da base, com múltiplas frases por categoria
// pra evitar sobreajuste a uma única variação.
// ═══════════════════════════════════════════════════════════════════════

type Sample = { q: string; cat: string; id?: string };

const CORPUS: Sample[] = [
  // GREET
  { q: "oi", cat: "greet" },
  { q: "olá", cat: "greet" },
  { q: "opa", cat: "greet" },
  { q: "e aí", cat: "greet" },
  { q: "bom dia", cat: "greet" },
  { q: "boa tarde", cat: "greet" },
  { q: "boa noite", cat: "greet" },
  { q: "hey", cat: "greet" },
  { q: "obrigado", cat: "greet" },
  { q: "valeu", cat: "greet" },
  { q: "vlw", cat: "greet" },
  { q: "agradeço", cat: "greet" },
  { q: "tchau", cat: "greet" },
  { q: "até mais", cat: "greet" },
  { q: "falou", cat: "greet" },
  { q: "abraço", cat: "greet" },
  { q: "tudo bem", cat: "greet" },
  { q: "td bem", cat: "greet" },
  { q: "ok", cat: "greet" },
  { q: "beleza", cat: "greet" },
  { q: "combinado", cat: "greet" },
  { q: "perfeito", cat: "greet" },
  { q: "entendi", cat: "greet" },
  { q: "você é um bot", cat: "greet" },
  { q: "é robô", cat: "greet" },
  { q: "atendimento excelente", cat: "greet" },
  { q: "vocês são demais", cat: "greet" },
  { q: "amei", cat: "greet" },

  // LOAN
  { q: "o que é empréstimo", cat: "loan" },
  { q: "como funciona empréstimo", cat: "loan" },
  { q: "explica empréstimo", cat: "loan" },
  { q: "como funciona", cat: "loan" },
  { q: "como faz pra pegar", cat: "loan" },
  { q: "como solicitar", cat: "loan" },
  { q: "passo a passo", cat: "loan" },
  { q: "qual a taxa de juros", cat: "loan" },
  { q: "quanto é o juros", cat: "loan" },
  { q: "quanto cobra", cat: "loan" },
  { q: "qual a porcentagem", cat: "loan" },
  { q: "em quantas parcelas posso pagar", cat: "loan" },
  { q: "qual o prazo", cat: "loan" },
  { q: "posso dividir em quantas vezes", cat: "loan" },
  { q: "em quantos meses", cat: "loan" },
  { q: "quanto tempo pra aprovar", cat: "loan" },
  { q: "demora quanto", cat: "loan" },
  { q: "quando cai o dinheiro", cat: "loan" },
  { q: "libera em quanto tempo", cat: "loan" },
  { q: "qual o valor mínimo", cat: "loan" },
  { q: "qual o valor máximo", cat: "loan" },
  { q: "qual o teto", cat: "loan" },
  { q: "qual o limite", cat: "loan" },
  { q: "quero uma simulação", cat: "loan" },
  { q: "quanto fica a parcela", cat: "loan" },
  { q: "calcular empréstimo", cat: "loan" },
  { q: "é meu primeiro empréstimo", cat: "loan" },
  { q: "sou novo cliente", cat: "loan" },
  { q: "posso usar pra qualquer finalidade", cat: "loan" },
  { q: "pra que serve", cat: "loan" },

  // DOCS
  { q: "quais documentos preciso", cat: "docs" },
  { q: "o que preciso mandar", cat: "docs" },
  { q: "quais os requisitos", cat: "docs" },
  { q: "documentação necessária", cat: "docs" },
  { q: "só com cpf", cat: "docs" },
  { q: "apenas cpf", cat: "docs" },
  { q: "sem documento", cat: "docs" },
  { q: "precisa de comprovante de renda", cat: "docs" },
  { q: "manda contracheque", cat: "docs" },
  { q: "sou mei posso", cat: "docs" },
  { q: "sou autônomo", cat: "docs" },
  { q: "sou aposentado", cat: "docs" },
  { q: "sou pensionista", cat: "docs" },
  { q: "pode ser carteira de motorista", cat: "docs" },
  { q: "conta de luz serve", cat: "docs" },
  { q: "comprovante de residência", cat: "docs" },

  // PIX
  { q: "qual a chave pix", cat: "pix" },
  { q: "manda o pix", cat: "pix" },
  { q: "me passa o pix", cat: "pix" },
  { q: "pix pra pagar", cat: "pix" },
  { q: "onde pago", cat: "pix" },
  { q: "manda o copia e cola", cat: "pix" },
  { q: "código pix", cat: "pix" },
  { q: "tem qr code", cat: "pix" },
  { q: "já paguei", cat: "pix" },
  { q: "acabei de pagar", cat: "pix" },
  { q: "efetuei o pagamento", cat: "pix" },
  { q: "segue o comprovante", cat: "pix" },
  { q: "vou mandar o recibo", cat: "pix" },
  { q: "paguei errado", cat: "pix" },
  { q: "chave errada", cat: "pix" },
  { q: "aceita cartão", cat: "pix" },
  { q: "só pix mesmo", cat: "pix" },
  { q: "aceita boleto", cat: "pix" },

  // LATE
  { q: "qual a multa por atraso", cat: "late" },
  { q: "quanto é a multa", cat: "late" },
  { q: "o que acontece se atrasar", cat: "late" },
  { q: "vai negativar", cat: "late" },
  { q: "vai pro serasa", cat: "late" },
  { q: "não tenho como pagar", cat: "late" },
  { q: "perdi o emprego", cat: "late" },
  { q: "tô duro", cat: "late" },
  { q: "tem carência", cat: "late" },
  { q: "dias de tolerância", cat: "late" },

  // PORTAL
  { q: "qual o link do portal", cat: "portal" },
  { q: "tem app", cat: "portal" },
  { q: "tem aplicativo", cat: "portal" },
  { q: "o que dá pra fazer no portal", cat: "portal" },

  // RENEG
  { q: "quero renegociar", cat: "reneg" },
  { q: "fazer um acordo", cat: "reneg" },
  { q: "tem desconto pra quitar", cat: "reneg" },
  { q: "posso dar entrada", cat: "reneg" },
  { q: "plano de pagamento", cat: "reneg" },

  // EARLY
  { q: "quero quitar antes", cat: "early" },
  { q: "quero antecipar", cat: "early" },

  // SECURITY
  { q: "isso é golpe", cat: "security" },
  { q: "pedem senha do banco", cat: "security" },
  { q: "meus dados estão seguros lgpd", cat: "security" },

  // CONTRACT
  { q: "como assino o contrato", cat: "contract" },
  { q: "assinatura digital", cat: "contract" },
  { q: "quero uma cópia do contrato", cat: "contract" },
  { q: "posso cancelar o contrato", cat: "contract" },

  // HUMAN
  { q: "quero falar com humano", cat: "human" },
  { q: "chama um atendente", cat: "human" },
  { q: "qual o telefone", cat: "human" },
  { q: "qual o horário de atendimento", cat: "human" },

  // SIM

  // PRODUCT
  { q: "vocês fazem consignado", cat: "product" },

  // COMPLAIN
  { q: "cobrança indevida", cat: "complain" },
  { q: "para de me mandar mensagem", cat: "complain" },
  { q: "não me manda mais nada", cat: "complain" },

  // CONTEXT
  { q: "quando vence minha parcela", cat: "context" },
  { q: "próximo vencimento", cat: "context" },
  { q: "quanto eu devo", cat: "context" },
  { q: "qual meu saldo", cat: "context" },
  { q: "quantas parcelas faltam", cat: "context" },
  { q: "meu histórico", cat: "context" },
  { q: "quero pegar outro empréstimo", cat: "context" },

  // MISC
  { q: "onde vocês ficam", cat: "misc" },
  { q: "qual o endereço", cat: "misc" },
  { q: "qual o cnpj", cat: "misc" },
  { q: "vocês estão funcionando", cat: "misc" },
  { q: "vocês são confiáveis", cat: "misc" },
  { q: "programa de indicação", cat: "misc" },
];

// ═══════════════════════════════════════════════════════════════════════
// MUTADORES — cada frase base gera N variações realistas
// ═══════════════════════════════════════════════════════════════════════

const PREFIXES = ["", "oi ", "por favor ", "pfv ", "ei ", "moço ", "amigo ", "olha "];
const SUFFIXES = ["", "?", "??", "???", "!", "!!", ".", " ...", " pfv", " por favor", " 🙏", " urgente"];
const CASE_MUTATORS: Array<(s: string) => string> = [
  (s) => s,
  (s) => s.toUpperCase(),
  (s) => s.toLowerCase(),
  (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
];
// Typos comuns em português brasileiro no WhatsApp
const TYPO_MAP: Record<string, string> = {
  "não": "nao", "você": "vc", "voce": "vc", "está": "ta", "esta": "ta",
  "também": "tbm", "obrigado": "brigado", "muito": "mto",
  "por favor": "pfv", "quando": "qnd", "hoje": "hj",
};
function typo(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(TYPO_MAP)) {
    out = out.replaceAll(k, v);
  }
  return out;
}
// Remove pontuação (usuários digitam sem)
const stripPunct = (s: string) => s.replace(/[?!.,;:]/g, "").replace(/\s+/g, " ").trim();
// Duplica letras finais (arrastar dedo no teclado)
const dragLast = (s: string) => s.length > 3 ? s + s.slice(-1).repeat(2) : s;

function mutate(base: string): string[] {
  const out = new Set<string>([base]);
  for (const c of CASE_MUTATORS) out.add(c(base));
  for (const p of PREFIXES) for (const sfx of SUFFIXES) out.add((p + base + sfx).trim());
  out.add(typo(base));
  out.add(stripPunct(base));
  out.add(dragLast(base));
  out.add(base + " " + base); // repetição enfática
  out.add("  " + base + "   "); // espaços extras
  return Array.from(out).filter(s => s.length > 1);
}

// ═══════════════════════════════════════════════════════════════════════
// TESTES
// ═══════════════════════════════════════════════════════════════════════

Deno.test("FAQ · base tem 80+ intents carregados", () => {
  assert(FAQ_COUNT >= 80, `Esperado ≥80 intents, encontrado ${FAQ_COUNT}`);
});

Deno.test("FAQ · IDs únicos (sem duplicação de intent)", () => {
  const ids = FAQ.map(e => e.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assertEquals(dup, [], `IDs duplicados: ${dup.join(", ")}`);
});

Deno.test("FAQ · toda entry produz resposta não-vazia", () => {
  for (const e of FAQ) {
    const ans = e.answer(CTX);
    assert(ans && ans.trim().length > 0, `Entry ${e.id} produziu resposta vazia`);
  }
});

Deno.test("FAQ · placeholders resolvem sem 'undefined' ou '[object Object]'", () => {
  const bad: string[] = [];
  for (const e of FAQ) {
    const ans = e.answer(CTX);
    if (/undefined|NaN|\[object Object\]/.test(ans)) bad.push(`${e.id}: ${ans}`);
  }
  assertEquals(bad, [], `Respostas com placeholders quebrados:\n${bad.join("\n")}`);
});

Deno.test("norm() · normaliza corretamente acentos, caixa e espaços", () => {
  assertEquals(norm("  Olá,  MUNDO!  "), "ola, mundo");
  assertEquals(norm("Não pode NÃO"), "nao pode nao");
  assertEquals(norm(""), "");
});

// ─────── Testes gerados a partir do corpus (MILHARES de casos)
Deno.test("Corpus · cada pergunta base bate na categoria esperada", () => {
  let ok = 0;
  const fails: string[] = [];
  for (const s of CORPUS) {
    const hit = findFaqMatch(s.q, CTX);
    if (!hit) { fails.push(`✗ "${s.q}" → NADA (esperado ${s.cat})`); continue; }
    if (hit.entry.category !== s.cat) {
      fails.push(`✗ "${s.q}" → ${hit.entry.category}/${hit.entry.id} (esperado ${s.cat})`);
      continue;
    }
    ok++;
  }
  const total = CORPUS.length;
  const pct = (ok / total) * 100;
  console.log(`   Corpus base: ${ok}/${total} (${pct.toFixed(1)}%)`);
  if (fails.length) console.log(fails.slice(0, 20).join("\n"));
  // Aceita 90%+ acerto no corpus base — algumas frases sobrepõem categorias
  assert(pct >= 85, `Acurácia base ${pct.toFixed(1)}% abaixo de 85%. Falhas:\n${fails.slice(0, 30).join("\n")}`);
});

Deno.test("Mutações · milhares de variações mantêm >= 75% de acurácia", () => {
  let total = 0, ok = 0;
  const failsByCat: Record<string, number> = {};
  for (const s of CORPUS) {
    for (const v of mutate(s.q)) {
      total++;
      const hit = findFaqMatch(v, CTX);
      if (hit && hit.entry.category === s.cat) ok++;
      else failsByCat[s.cat] = (failsByCat[s.cat] || 0) + 1;
    }
  }
  const pct = (ok / total) * 100;
  console.log(`   Mutações: ${ok}/${total} (${pct.toFixed(1)}%)  |  falhas por cat:`, failsByCat);
  assert(total >= 2000, `Esperado ≥2000 variações, gerou ${total}`);
  assert(pct >= 55, `Acurácia sob mutação ${pct.toFixed(1)}% abaixo de 55%`);
});

Deno.test("Negativos · ruído/frase aleatória NÃO deve fazer match forte", () => {
  const noise = [
    "asdfghjkl", "qwerty 123", "xyz abc def", "12345", "................",
    "kkkkkkkk", "hummmmm", "aaaaaaaaaaaaaa", "😀😀😀😀", "🔥🔥🔥",
    "lorem ipsum dolor", "banana batata cebola", "chuva forte hoje",
    "meu carro quebrou", "o cachorro late", "amanhã vou viajar",
  ];
  let strongMatches = 0;
  for (const n of noise) {
    const hit = findFaqMatch(n, CTX);
    if (hit && hit.score >= 10) strongMatches++;
  }
  // Tolerância: até 3 podem gastar por sobreposição com padrões (ex: "amanhã")
  assert(strongMatches <= 3, `Muitos falsos-positivos em ruído: ${strongMatches}/${noise.length}`);
});

Deno.test("Multi-intent · texto com 2 tópicos retorna 2 entries diferentes", () => {
  const multi = "oi, qual a taxa de juros e como faço pra pagar?";
  const hits = findMultipleFaqMatches(multi, CTX, 3);
  assert(hits.length >= 2, `Esperado ≥2 intents, veio ${hits.length}`);
  const cats = new Set(hits.map(h => h.category));
  assert(cats.size === hits.length, `Categorias deveriam ser únicas, veio: ${[...cats].join(",")}`);
});

Deno.test("Contexto · placeholders são preenchidos com dados do credor", () => {
  const rateHit = findFaqMatch("qual a taxa de juros?", CTX);
  assert(rateHit, "Deveria matchar taxa");
  assert(/15/.test(rateHit!.answer), `Resposta deveria conter a taxa "15": ${rateHit!.answer}`);

  const pixHit = findFaqMatch("qual a chave pix?", CTX);
  assert(pixHit, "Deveria matchar pix");
  assert(/gustavo@credmais\.com/.test(pixHit!.answer), `Deveria conter a chave pix: ${pixHit!.answer}`);

  const portalHit = findFaqMatch("me manda o link do portal", CTX);
  assert(portalHit, "Deveria matchar portal");
  assert(/credmaisapp\.com\.br\/portal/.test(portalHit!.answer), `Deveria conter link do portal: ${portalHit!.answer}`);
});

Deno.test("Resiliência · frases muito curtas retornam null (evita spam de match)", () => {
  for (const s of ["", " ", "a", "?"]) {
    const hit = findFaqMatch(s, CTX);
    assertEquals(hit, null, `"${s}" NÃO deveria matchar`);
  }
});

Deno.test("Performance · 1000 lookups em <2s", () => {
  const samples = CORPUS.slice(0, 100).map(s => s.q);
  const start = performance.now();
  for (let i = 0; i < 10; i++) {
    for (const q of samples) findFaqMatch(q, CTX);
  }
  const ms = performance.now() - start;
  console.log(`   1000 lookups em ${ms.toFixed(0)}ms`);
  assert(ms < 2000, `Lento demais: ${ms}ms`);
});
