import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AGENT_TOOLS, calculateAgentOverdueCharge, executeTool } from "./agent_tools.ts";

const today = "2026-07-25";

function mkSupabase(overrides: Record<string, any> = {}) {
  return { from:(table:string)=>{
    let rows:any[]=table==="clients"?[{id:"cli-1",user_id:"owner",name:"João",status:"active",cpf_cnpj:"12345678901",...(overrides.client||{})}]:
      (overrides.installments?.data || (overrides.single?.data?[overrides.single.data]:[])).map((r:any)=>({user_id:"owner",client_id:"cli-1",...r}));
    let error=overrides.installments?.error || overrides.single?.error || null;
    const q:any={select:()=>q,eq:(k:string,v:unknown)=>{rows=rows.filter(r=>r[k]===v);return q;},
      not:()=>q,neq:()=>q,lt:()=>q,order:()=>q,
      range:(a:number,b:number)=>{rows=rows.slice(a,b+1);return q;},
      insert:()=>{rows=[{token:"00000000-0000-4000-8000-000000000001"}];return q;},
      maybeSingle:async()=>({data:rows[0]||null,error}),single:async()=>({data:rows[0]||null,error}),
      then:(ok:any)=>Promise.resolve({data:rows,error}).then(ok)};
    return q;
  }} as any;
}

Deno.test("catálogo de tools está válido", () => {
  assertEquals(AGENT_TOOLS.length, 5);
  for (const t of AGENT_TOOLS) {
    assertEquals(typeof t.name, "string");
    assertEquals(typeof t.description, "string");
    assertEquals(typeof (t.input_schema as any).type, "string");
  }
});

Deno.test("buscar_cliente_por_cpf rejeita CPF inválido", async () => {
  const r = await executeTool(
    "buscar_cliente_por_cpf",
    { cpf: "123" },
    { supabase: mkSupabase(), siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, false);
});

Deno.test("buscar_cliente_por_cpf retorna cliente confirmado", async () => {
  const sup = mkSupabase({
    rpc: {
      search_clients_by_document: {
        data: [{ id: "cli-1", name: "João", status: "active" }],
        error: null,
      },
    },
  });
  const r = await executeTool(
    "buscar_cliente_por_cpf",
    { cpf: "12345678901" },
    { supabase: sup, siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals((r.data as any).client_id, "cli-1");
    assertEquals((r.data as any).name, "João");
  }
});

Deno.test("listar_parcelas_em_aberto usa os mesmos juros compostos da cobrança", async () => {
  const sup = mkSupabase({
    installments: {
      data: [
        {
          id: "p1",
          installment_number: 1,
          amount: 1000,
          paid_amount: 0,
          late_fee: 10.05,
          due_date: "2026-07-15", // 10 dias de atraso
          status: "pending",
          contracts: {
            status: "active",
            daily_interest_percent: 0.1,
            max_interest_cap_percent: null,
          },
        },
      ],
      error: null,
    },
  });
  const r = await executeTool(
    "listar_parcelas_em_aberto",
    { client_id: "cli-1" },
    { supabase: sup, siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    const p = (r.data as any).parcelas[0];
    assertEquals(p.dias_atraso, 10);
    assertEquals(p.multa, 0);
    assertEquals(p.juros_diarios, 10.05);
    assertEquals(p.taxa_diaria_percentual, 0.1);
    assertEquals(p.total_com_encargos, 1010.05);
  }
});

Deno.test("listar_parcelas_em_aberto aplica fallback e teto de juros", async () => {
  const sup = mkSupabase({
    installments: {
      data: [{
        id: "p2", installment_number: 2, amount: 100, paid_amount: 20,
        due_date: "2026-05-26", status: "overdue", late_fee: 50,
        contracts: { status: "overdue", daily_interest_percent: 0, max_interest_cap_percent: 50 },
      }],
      error: null,
    },
  });
  const r = await executeTool(
    "listar_parcelas_em_aberto",
    { client_id: "cli-1" },
    { supabase: sup, siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    const p = (r.data as any).parcelas[0];
    assertEquals(p.saldo_devedor, 80);
    assertEquals(p.juros_diarios, 50);
    assertEquals(p.taxa_diaria_percentual, 0);
    assertEquals(p.total_com_encargos, 130);
  }
});

Deno.test("cálculo compartilhado mantém PIX e listagem com o mesmo total", () => {
  const charge = calculateAgentOverdueCharge({
    amount: 100, paidAmount: 20, lateFee: 2.01, dueDate: "2026-07-23", today,
    dailyPercent: 1, capPercent: null,
  });
  assertEquals(charge.saldo, 80);
  assertEquals(charge.interest, 2.01);
  assertEquals(charge.total, 82.01);
});

Deno.test("gerar_link_pix inclui os mesmos encargos da parcela", async () => {
  const sup = mkSupabase({
    single: {
      data: {
        id: "p3", installment_number: 3, amount: 100, paid_amount: 20, late_fee: 2.01,
        due_date: "2026-07-23", status: "overdue", user_id: "owner",
        contracts: { status: "active", daily_interest_percent: 1, max_interest_cap_percent: null },
      },
      error: null,
    },
  });
  const r = await executeTool(
    "gerar_link_pix", { installment_id: "p3" },
    { supabase: sup, siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals((r.data as any).saldo_base, 80);
    assertEquals((r.data as any).juros_atraso, 2.01);
    assertEquals((r.data as any).valor, 82.01);
  }
});

Deno.test("listar_parcelas_em_aberto ignora contrato removido ou encerrado", async () => {
  for (const contracts of [null, { status: "completed", daily_interest_percent: 1 }]) {
    const sup = mkSupabase({ installments: { data: [{
      id: "fantasma", installment_number: 1, amount: 1000, paid_amount: 0,
      due_date: "2026-07-01", status: "overdue", contracts,
    }], error: null } });
    const r = await executeTool("listar_parcelas_em_aberto", { client_id: "cli-1" }, { supabase: sup, siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" });
    assertEquals(r.ok, true);
    if (r.ok) assertEquals((r.data as any).parcelas.length, 0);
  }
});

Deno.test("escalar_para_humano sempre retorna handoff", async () => {
  const r = await executeTool(
    "escalar_para_humano",
    { motivo: "pediu_desconto", resumo: "Cliente pediu 30% off" },
    { supabase: mkSupabase(), siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals((r.data as any).handoff, true);
});

Deno.test("tool desconhecida retorna erro", async () => {
  const r = await executeTool(
    "nao_existe",
    {},
    { supabase: mkSupabase(), siteUrl: "https://x", today, ownerId:"owner",verifiedClientId:"cli-1" },
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertStringIncludes(r.error, "tool_desconhecida");
});

Deno.test("tools reject replacing the verified client and foreign installment",async()=>{
  const ctx={supabase:mkSupabase({single:{data:{id:"foreign",user_id:"other",client_id:"other-client"}}}),siteUrl:"https://x",today,ownerId:"owner",verifiedClientId:"cli-1"};
  for(const name of ["listar_parcelas_em_aberto","enviar_portal_link"]){const r=await executeTool(name,{client_id:"other-client"},ctx);assertEquals(r.ok,false);}
  assertEquals((await executeTool("gerar_link_pix",{installment_id:"foreign"},ctx)).ok,false);
});
Deno.test("tools require server identity even when supplied IDs are plausible",async()=>{
  assertEquals((await executeTool("enviar_portal_link",{client_id:"cli-1"},{supabase:mkSupabase(),siteUrl:"https://x",today,ownerId:"",verifiedClientId:""})).ok,false);
});
Deno.test("fee-only remaining balance stays listed and payable",async()=>{
  const row={id:"fee-only",amount:100,paid_amount:110,late_fee:20,due_date:today,status:"pending",contracts:{status:"active"}};
  const ctx={supabase:mkSupabase({installments:{data:[row]},single:{data:row}}),siteUrl:"https://x",today,ownerId:"owner",verifiedClientId:"cli-1"};
  const list=await executeTool("listar_parcelas_em_aberto",{client_id:"cli-1"},ctx);
  assertEquals(list.ok,true);if(list.ok)assertEquals((list.data as any).parcelas[0].total_com_encargos,10);
  const pix=await executeTool("gerar_link_pix",{installment_id:row.id},ctx);
  assertEquals(pix.ok,true);if(pix.ok)assertEquals((pix.data as any).valor,10);
});
Deno.test("portal tool creates a short session and validates origin",async()=>{
  const ctx={supabase:mkSupabase(),siteUrl:"https://x",today,ownerId:"owner",verifiedClientId:"cli-1"};
  const r=await executeTool("enviar_portal_link",{client_id:"cli-1"},ctx);
  assertEquals(r.ok,true);if(r.ok)assertStringIncludes((r.data as any).url,"/portal?t=");
  assertEquals((await executeTool("enviar_portal_link",{client_id:"cli-1"},{...ctx,siteUrl:"javascript:alert(1)"})).ok,false);
});
