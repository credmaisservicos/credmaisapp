import { test, expect } from "@playwright/test";

/**
 * Caminho do dinheiro — o que não pode acontecer.
 *
 * Estes testes não fazem login: rodam contra o app publicado e cobrem as
 * garantias que valem SEM sessão. É de propósito. Os furos que apareceram neste
 * sistema foram todos de porta aberta: função de admin sem checagem, webhook sem
 * segredo, portal com token eterno. Um teste que só roda logado não pega nada
 * disso.
 *
 * Fluxos que exigem sessão (pagar, estornar) precisam de uma conta de teste
 * dedicada — não usar conta real, porque cada execução mexeria em dinheiro de
 * cliente. Ver `docs/verificar-razao.sql` para a conferência do razão.
 */

const SUPABASE =
  process.env.E2E_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://credmaisapp-supabase.fcoipz.easypanel.host";
const ANON =
  process.env.E2E_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "";

test.describe("rotas de administração não podem estar abertas", () => {
  // A admin-create-lifetime já rodou exposta na internet: criava conta vitalícia
  // e, para e-mail existente, TROCAVA A SENHA do dono — tomada de conta direta.
  for (const fn of ["admin-create-lifetime", "admin-create-trial"]) {
    test(`${fn} recusa quem não é admin`, async ({ request }) => {
      const semCredencial = await request.post(`${SUPABASE}/functions/v1/${fn}`, {
        data: { email: "invasor@example.com", password: "SenhaQualquer123", name: "probe" },
        failOnStatusCode: false,
      });
      expect(semCredencial.status()).toBe(401);

      const comAnon = await request.post(`${SUPABASE}/functions/v1/${fn}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
        data: { email: "invasor@example.com", password: "SenhaQualquer123", name: "probe" },
        failOnStatusCode: false,
      });
      expect(comAnon.status()).toBe(401);
    });
  }

  test("a função de restaurar backup exige admin", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/functions/v1/backup-restore`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      data: { user_id: "00000000-0000-0000-0000-000000000000" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
  });

  test("a função de teste seed-test-user não existe mais", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/functions/v1/seed-test-user`, {
      data: {},
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });
});

test.describe("automações só rodam com o segredo do cron", () => {
  // Sem esse gate, qualquer um dispara cobrança em massa e recálculo de juros.
  for (const fn of [
    "auto-backup", "auto-birthday", "auto-cleanup", "auto-collection",
    "auto-credit-score", "auto-late-fees", "auto-notifications",
    "auto-subscription-check", "check-overdue", "investor-notify",
    "whatsapp-followup", "whatsapp-schedule-runner",
  ]) {
    test(`${fn} recusa segredo inválido`, async ({ request }) => {
      const res = await request.post(`${SUPABASE}/functions/v1/${fn}`, {
        headers: { "x-cron-secret": "segredo-invalido-de-teste" },
        data: {},
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(401);
    });
  }
});

test.describe("funções privadas recusam visitante", () => {
  for (const fn of [
    "agent-chat", "business-intelligence-ai", "credit-score-ai", "daily-briefing",
    "delete-user-account", "evolution-api", "export-user-data", "report-ai",
    "send-welcome-email", "settings-set-secret", "simulator-ai", "support-triage",
    "transcribe-audio", "whatsapp-ai-assist", "whatsapp-send", "auto-receipt",
  ]) {
    test(`${fn} exige autenticação real`, async ({ request }) => {
      const res = await request.post(`${SUPABASE}/functions/v1/${fn}`, {
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
        data: {}, failOnStatusCode: false,
      });
      // 400 ainda é aceitável em versões antigas que validam o corpo antes do JWT;
      // a garantia de segurança é nunca executar a operação (2xx) como visitante.
      expect([400, 401, 403]).toContain(res.status());
    });
  }
});

test.describe("dados de cliente não vazam sem sessão", () => {
  test("negociação do portal exige token válido e vinculado ao cliente", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/functions/v1/client-negotiation`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      data: {
        clientId: "11111111-1111-4111-8111-111111111111",
        session_token: "22222222-2222-4222-8222-222222222222",
        messages: [{ role: "user", content: "Quero negociar" }],
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(401);
  });

  for (const tabela of ["clients", "contracts", "contract_installments", "profiles", "settings"]) {
    test(`${tabela} não devolve linha para visitante`, async ({ request }) => {
      const res = await request.get(`${SUPABASE}/rest/v1/${tabela}?select=id&limit=5`, {
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
        failOnStatusCode: false,
      });
      // Ou a RLS barra (4xx), ou devolve vazio. O que não pode é vir dado.
      if (res.ok()) expect(await res.json()).toEqual([]);
      else expect(res.status()).toBeGreaterThanOrEqual(400);
    });
  }

  test("os erros de tela só são legíveis por admin", async ({ request }) => {
    const res = await request.get(`${SUPABASE}/rest/v1/client_errors?select=mensagem&limit=5`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      failOnStatusCode: false,
    });
    if (res.ok()) expect(await res.json()).toEqual([]);
  });
});

test.describe("configuração da plataforma", () => {
  test("é legível por visitante (a tela de login precisa) mas não gravável", async ({ request }) => {
    const leitura = await request.get(
      `${SUPABASE}/rest/v1/platform_settings?select=allow_new_registrations`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, failOnStatusCode: false },
    );
    expect(leitura.ok()).toBeTruthy();
    expect((await leitura.json()).length).toBe(1);

    const escrita = await request.patch(`${SUPABASE}/rest/v1/platform_settings?id=eq.true`, {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        Prefer: "return=representation",
      },
      data: { maintenance_mode: true },
      failOnStatusCode: false,
    });
    // A RLS não deixa a linha ser alcançada: nenhuma linha alterada.
    if (escrita.ok()) expect(await escrita.json()).toEqual([]);
    else expect(escrita.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("portal do cliente", () => {
  test("negociação exige sessão válida do portal", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/functions/v1/client-negotiation`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
      data: {
        clientId: "00000000-0000-0000-0000-000000000000",
        session_token: "sessao-invalida-de-teste",
        messages: [{ role: "user", content: "teste" }],
      },
      failOnStatusCode: false,
    });
    // 400 remains accepted while production is on the legacy CPF contract.
    // The hardened endpoint returns 401/404 and never exposes negotiation data.
    expect([400, 401, 404]).toContain(res.status());
  });

  test("token inválido não abre dossiê nenhum", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/portal_login_by_token`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: { _token: "00000000-0000-0000-0000-000000000000" },
      failOnStatusCode: false,
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBeNull();
  });

  test("a função antiga de login por CPF continua removida", async ({ request }) => {
    // `portal_client_login_cpf` foi apagada em 01/08. O acesso por CPF voltou,
    // mas passa pela `portal_client_login`, que aplica limite de tentativas e
    // recusa CPF ambíguo entre contas. A porta velha, sem essas proteções,
    // precisa continuar fechada.
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/portal_client_login_cpf`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: { _cpf: "12345678901" },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("CPF que não existe não vaza nada", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/portal_client_login`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: { _cpf: "00000000000" },
      failOnStatusCode: false,
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBeNull();
  });
});

test.describe("checkout público não executa chamadas inesperadas", () => {
  test("funções de criação aceitam somente POST", async ({ request }) => {
    for (const fn of ["mercadopago-create-preference", "mercadopago-process-payment"]) {
      const res = await request.get(`${SUPABASE}/functions/v1/${fn}`, { failOnStatusCode: false });
      expect(res.status()).toBe(405);
    }
  });

  test("consulta de status rejeita identificador malformado antes do provedor", async ({ request }) => {
    const res = await request.get(`${SUPABASE}/functions/v1/mercadopago-check-status?id=nao-e-pagamento`, {
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("portal do cobrador", () => {
  test("token inválido não revela cobrador, clientes ou parcelas", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/collector_login_by_token`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: { _token: "TOKEN-INEXISTENTE-E2E" },
      failOnStatusCode: false,
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBeNull();
  });

  test("token inválido não consegue registrar pagamento", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/collector_register_payment`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: {
        _token: "TOKEN-INEXISTENTE-E2E",
        _installment_id: "00000000-0000-0000-0000-000000000000",
        _paid_total: 1,
        _method: "pix",
        _receipt_url: null,
      },
      failOnStatusCode: false,
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("portal do investidor", () => {
  test("token inválido não revela perfil, empréstimos ou pagamentos", async ({ request }) => {
    const res = await request.post(`${SUPABASE}/rest/v1/rpc/investor_portal_login`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      data: { _token: "00000000-0000-0000-0000-000000000000" },
      failOnStatusCode: false,
    });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toBeNull();
  });
});
