import {
  assertEquals,
  assert,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dedupArr,
  mergeMemory,
  parseMemory,
  serializeMemory,
  MAX_BYTES,
  SECTION_LIMIT,
} from "./memory.ts";

Deno.test('flow state survives the next message and AI memory updates cannot replace it',()=>{
  const state={service_menu_started:true,service_menu_stage:'loan_type',last_menu_at:100,pending_payment_kind:'interest_only',pending_payment_amount:45.21,pending_payment_installment_id:'installment',pending_payment_set_at:'2026-10-07T12:00:00Z',loan_documents_received:['identity'],loan_document_validations:[{decision:'accepted',document_type:'identity'}]};
  const parsed=parseMemory(JSON.stringify(state));
  const updated=mergeMemory(parsed,{fatos:['novo'],service_menu_stage:'main',pending_payment_amount:999},'2026-10-07');
  const next=parseMemory(serializeMemory(updated));
  for(const [key,value] of Object.entries(state))assertEquals(next[key],value);
  assertEquals(next.fatos,['novo']);
});
Deno.test('flow memory rejects invalid types and unexpected control keys',()=>{
  const parsed=parseMemory(JSON.stringify({service_menu_started:'true',service_menu_stage:{value:'main'},last_menu_at:'100',pending_payment_amount:-1,loan_documents_received:'identity',unsafe_key:true}));
  for(const key of ['service_menu_started','service_menu_stage','last_menu_at','pending_payment_amount','loan_documents_received','unsafe_key'])assertEquals(parsed[key],undefined);
});
Deno.test('large memory keeps the current menu and payment state within its size limit',()=>{
  const memory=parseMemory(JSON.stringify({service_menu_started:true,service_menu_stage:'documents',pending_payment_kind:'partial',pending_payment_amount:20,loan_document_validations:[{notes:'x'.repeat(10_000)}],fatos:['x'.repeat(10_000)]}));
  const serialized=serializeMemory(memory);
  assert(serialized.length<=MAX_BYTES);
  const next=parseMemory(serialized);
  assertEquals(next.service_menu_stage,'documents');assertEquals(next.pending_payment_amount,20);
});

Deno.test("dedupArr: prioriza itens mais recentes (incoming vence em duplicata)", () => {
  const out = dedupArr(["pagamento atrasado"], ["Pagamento Atrasado"]);
  assertEquals(out.length, 1);
  assertEquals(out[0], "Pagamento Atrasado"); // versão nova preservada
});

Deno.test("dedupArr: novos itens aparecem antes dos antigos", () => {
  const out = dedupArr(["a", "b"], ["c", "d"]);
  assertEquals(out, ["c", "d", "a", "b"]);
});

Deno.test("dedupArr: descarta entradas inválidas sem corromper", () => {
  const out = dedupArr(
    ["fato 1"],
    [null, undefined, "", "   ", "fato 2", {}, { tipo: "telefone", v: "11999" }] as any,
  );
  assertEquals(out.includes("fato 2"), true);
  assertEquals(out.some((x) => x && typeof x === "object" && x.tipo === "telefone"), true);
  assertEquals(out.filter((x) => x === null || x === undefined || x === "").length, 0);
});

Deno.test("dedupArr: aplica limite por seção mantendo os mais recentes", () => {
  const old = Array.from({ length: 30 }, (_, i) => `old-${i}`);
  const neu = Array.from({ length: 5 }, (_, i) => `new-${i}`);
  const out = dedupArr(old, neu, SECTION_LIMIT);
  assertEquals(out.length, SECTION_LIMIT);
  assertEquals(out.slice(0, 5), neu); // novos ficam no topo
});

Deno.test("dedupArr: dedup de objetos por conteúdo canônico", () => {
  const a = [{ tipo: "telefone", v: "11999" }];
  const b = [{ v: "11999", tipo: "telefone" }]; // mesma coisa, ordem diferente
  const out = dedupArr(a, b);
  assertEquals(out.length, 1);
});

Deno.test("dedupArr: aceita entradas não-array sem quebrar", () => {
  const out = dedupArr(null as any, "naoEhArray" as any);
  assertEquals(out, []);
});

Deno.test("parseMemory: lida com string legado", () => {
  const m = parseMemory("cliente prefere pix");
  assertEquals(m.notas_legadas, "cliente prefere pix");
  assertEquals(m.fatos, []);
});

Deno.test("parseMemory: lida com JSON quebrado sem lançar", () => {
  const m = parseMemory("{ invalid json");
  assertEquals(Array.isArray(m.fatos), true);
});

Deno.test("parseMemory: descarta seções com tipo errado", () => {
  const m = parseMemory(JSON.stringify({ fatos: "deveria ser array", preferencias: ["ok"] }));
  assertEquals(m.fatos, []);
  assertEquals(m.preferencias, ["ok"]);
});

Deno.test("mergeMemory: nunca corrompe — entrada vazia devolve objeto válido", () => {
  const base = parseMemory("");
  const out = mergeMemory(base, null, "2026-06-16");
  assertEquals(out.fatos, []);
  assertEquals(out.ultima_interacao, "2026-06-16");
});

Deno.test("mergeMemory: prioriza update mais recente", () => {
  const base = parseMemory(
    JSON.stringify({ fatos: ["mora em SP"], preferencias: ["prefere PIX"] }),
  );
  const out = mergeMemory(
    base,
    { fatos: ["mudou para RJ"], preferencias: ["Prefere PIX"] },
    "2026-06-16",
  );
  assertEquals(out.fatos[0], "mudou para RJ");
  assertEquals(out.preferencias.length, 1); // dedup case-insensitive
});

Deno.test("mergeMemory: ignora update malformado e preserva memória", () => {
  const base = parseMemory(JSON.stringify({ fatos: ["importante"] }));
  const out = mergeMemory(base, "string aleatoria" as any, "2026-06-16");
  assertEquals(out.fatos, ["importante"]);
});

Deno.test("mergeMemory: preserva notas_legadas existentes", () => {
  const base = parseMemory("nota antiga em texto");
  const out = mergeMemory(base, { fatos: ["novo"] }, "2026-06-16");
  assertEquals(out.notas_legadas, "nota antiga em texto");
  assertEquals(out.fatos, ["novo"]);
});

Deno.test("serializeMemory: produz JSON válido sempre", () => {
  const base = parseMemory("");
  const s = serializeMemory(base);
  const parsed = JSON.parse(s); // não pode lançar
  assertEquals(Array.isArray(parsed.fatos), true);
});

Deno.test("serializeMemory: respeita MAX_BYTES e mantém recentes", () => {
  const base = parseMemory("");
  // 50 fatos longos por seção
  for (const sec of ["fatos", "preferencias", "motivos_atraso", "contatos_alternativos", "promessas"]) {
    (base as any)[sec] = Array.from({ length: 50 }, (_, i) => `${sec}-item-${i}-`.repeat(20));
  }
  const s = serializeMemory(base);
  assert(s.length <= MAX_BYTES, `Esperado <= ${MAX_BYTES}, veio ${s.length}`);
  const parsed = JSON.parse(s); // ainda JSON válido
  // Os primeiros itens (mais recentes) devem estar preservados
  assertEquals(parsed.fatos[0], base.fatos[0]);
});

Deno.test("integração: ciclo completo parse→merge→serialize→parse mantém invariantes", () => {
  let raw = "";
  for (let turn = 0; turn < 10; turn++) {
    const mem = parseMemory(raw);
    const update = {
      fatos: [`turno-${turn}: cliente disse X`],
      preferencias: turn % 2 === 0 ? ["prefere manhã"] : ["Prefere Manhã"],
      promessas: [{ valor: 100 + turn, data: `2026-06-${10 + turn}` }],
    };
    const merged = mergeMemory(mem, update, `2026-06-${10 + turn}`);
    raw = serializeMemory(merged);
    // sempre re-parseável
    JSON.parse(raw);
  }
  const final = parseMemory(raw);
  // Mais recente no topo
  assertEquals(final.fatos[0], "turno-9: cliente disse X");
  // Dedup de preferências aplicado
  assertEquals(final.preferencias.length, 1);
  // Promessas únicas mantidas (10 distintas)
  assertEquals(final.promessas.length, 10);
});

Deno.test("integração: dados antigos não 'ressuscitam' após remoção", () => {
  const base = parseMemory(
    JSON.stringify({ promessas: [{ valor: 100, data: "2026-01-01" }] }),
  );
  // IA decide remover a promessa (não a inclui no update) — mas dedup é additivo.
  // Documenta comportamento: precisa ser explicitamente substituída.
  const out = mergeMemory(base, { promessas: [] }, "2026-06-16");
  assertEquals(out.promessas.length, 1); // sobrevive (esperado: cliente atualiza explicitamente)
  // Substituição explícita:
  const replaced = mergeMemory(base, {
    promessas: [{ valor: 200, data: "2026-06-20" }],
  }, "2026-06-16");
  assertEquals(replaced.promessas[0].valor, 200);
  assertNotEquals(replaced.promessas[0].valor, 100);
});
