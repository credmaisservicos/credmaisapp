import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "audit@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const profile = {
  ...user,
  name: "Conta de teste",
  subscription_type: "lifetime",
  is_blocked: false,
  plan_tier: "essencial",
  onboarding_completed_at: "2026-01-01T00:00:00Z",
};

const routes = [
  "/dashboard", "/hoje", "/analises", "/clientes", "/clientes/novo", "/clientes/buscar",
  "/clientes/11111111-1111-4111-8111-111111111111",
  "/contratos/22222222-2222-4222-8222-222222222222",
  "/cobrancas", "/carteira", "/comercial", "/comercial/estoque", "/comercial/vendas", "/comercial/locacoes",
  "/garantias", "/investidores", "/investidores/11111111-1111-4111-8111-111111111111", "/lucros", "/gastos", "/ferramentas",
  "/ferramentas/metas", "/ferramentas/simulador", "/ferramentas/tarefas", "/ferramentas/anotacoes",
  "/ferramentas/planilha", "/puxada-dados", "/sobre", "/perfil", "/relatorios", "/historico-financeiro",
  "/configuracoes", "/cobradores", "/qrcode", "/comunicacao", "/comunicacao?tab=agente", "/comunicacao/inbox", "/suporte",
  "/notificacoes", "/chat", "/tv",
];

const viewports = [
  { name: "ultracompacto", width: 240, height: 480 },
  { name: "celular compacto", width: 280, height: 640 },
  { name: "mobile estreito", width: 320, height: 720 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "tablet largo", width: 1024, height: 768 },
  { name: "desktop", width: 1366, height: 900 },
  { name: "desktop amplo", width: 1920, height: 1080 },
];

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

async function mockBackend(page: Page) {
  await page.routeWebSocket("**", socket => socket.close());
  await page.route("https://*.supabase.co/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];

    if (path === "/auth/v1/token") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      body = {
        access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.test`,
        refresh_token: "test-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: exp,
        user,
      };
    } else if (path === "/auth/v1/user") {
      body = user;
    } else if (path === "/rest/v1/profiles") {
      body = profile;
    } else if (path === "/rest/v1/rpc/is_admin") {
      body = false;
    } else if (path === "/rest/v1/rpc/list_public_profiles") {
      body = [{ id: user.id, name: "Conta de teste", avatar_url: null, is_admin: false, is_chat_blocked: false }, { id: "66666666-6666-4666-8666-666666666666", name: null, avatar_url: null, is_admin: false, is_chat_blocked: false }];
    } else if (path === "/rest/v1/platform_settings") {
      body = { maintenance_mode: false, allow_new_registrations: true };
    } else if (path === "/rest/v1/clients") {
      body = [{
        id: "11111111-1111-4111-8111-111111111111",
        user_id: user.id,
        name: "Cliente de auditoria",
        cpf_cnpj: "111.111.111-11",
        email: "cliente@example.test",
        phone: "11999999999",
        whatsapp: "11999999999",
        status: "active",
        client_type: "individual",
        address: null,
        documents: [],
        created_at: "2026-01-01T00:00:00Z",
      }];
    } else if (path === "/rest/v1/contracts") {
      const contract = {
        id: "22222222-2222-4222-8222-222222222222",
        user_id: user.id,
        client_id: "11111111-1111-4111-8111-111111111111",
        capital: 1000,
        interest_rate: 10,
        num_installments: 2,
        installment_amount: 550,
        total_amount: 1100,
        total_interest: 100,
        frequency: "monthly",
        loan_mode: "installments",
        status: "active",
        signature_status: "not_required",
        signature_token: null,
        signature_url: null,
        signed_at: null,
        start_date: "2026-09-01T12:00:00Z",
        late_fee_percent: 2,
        daily_interest_percent: 0.1,
        payment_method: "pix",
        auto_renew: false,
        grace_days: 0,
        grace_periods: 0,
        early_payment_discount_percent: 0,
        max_interest_cap_percent: null,
        guarantee_type: null,
        guarantee_description: null,
        guarantor_name: null,
        guarantor_cpf: null,
        guarantor_phone: null,
        investor_loan_id: null,
        attachments: [],
        notes: "Contrato sintético da auditoria",
        created_at: "2026-09-01T12:00:00Z",
      };
      body = url.searchParams.has("id") ? contract : [contract];
    } else if (path === "/rest/v1/contract_installments") {
      body = [{
        id: "33333333-3333-4333-8333-333333333333",
        user_id: user.id,
        client_id: "11111111-1111-4111-8111-111111111111",
        contract_id: "22222222-2222-4222-8222-222222222222",
        installment_number: 1,
        amount: 550,
        paid_amount: 0,
        due_date: "2026-10-01T12:00:00Z",
        status: "pending",
        collection_status: null,
        collection_count: 0,
        late_fee: 0,
        paid_at: null,
        paid_principal: 0,
        paid_interest: 0,
        paid_fees: 0,
        scheduled_principal: 500,
        scheduled_interest: 50,
        payment_method: null,
        receipt_review_status: "none",
        receipt_storage_path: null,
        receipt_url: null,
        last_collected_at: null,
        last_collected_channel: null,
        created_at: "2026-09-01T12:00:00Z",
      }];
    } else if (path === "/rest/v1/profits") {
      body = [{ id: "profit-audit-1", user_id: user.id, description: "Juros recebidos", amount: 50, date: "2026-09-10", installment_id: null, status: "available", created_at: "2026-09-10T12:00:00Z" }];
    } else if (path === "/rest/v1/expenses") {
      body = [{ id: "expense-audit-1", user_id: user.id, description: "Custo operacional", amount: 25, category: "Operacional", date: "2026-09-09", created_at: "2026-09-09T12:00:00Z" }];
    } else if (path === "/rest/v1/goals") {
      body = [{ id: "goal-audit-1", user_id: user.id, description: "Aumentar carteira", target_amount: 10000, current_amount: 2500, frequency: "Mensal", created_at: "2026-09-01T12:00:00Z" }];
    } else if (path === "/rest/v1/todos") {
      body = [{ id: "todo-audit-1", user_id: user.id, task: "Revisar contratos vencendo", is_complete: false, created_at: "2026-09-14T12:00:00Z" }];
    } else if (path === "/rest/v1/notes") {
      body = [{ id: "note-audit-1", user_id: user.id, title: "Ligar para o cliente", created_at: "2026-09-14T12:00:00Z", updated_at: "2026-09-14T12:00:00Z" }];
    } else if (path === "/rest/v1/investors") {
      const investor = { id: "44444444-4444-4444-8444-444444444444", user_id: user.id, name: "Investidor de auditoria", cpf_cnpj: "222.222.222-22", email: "investidor@example.test", phone: "11988888888", whatsapp: "11988888888", pix_key: "investidor@example.test", pix_key_type: "email", notes: "Registro de teste", access_token: "audit-investor-token", status: "active", created_at: "2026-01-15T12:00:00Z" };
      const incompleteInvestor = { id: "55555555-5555-4555-8555-555555555555", user_id: user.id, name: null, cpf_cnpj: null, email: null, phone: null, whatsapp: null, pix_key: null, pix_key_type: null, notes: null, access_token: null, status: "active", created_at: "2026-02-15T12:00:00Z" };
      body = url.searchParams.has("id") ? investor : [investor, incompleteInvestor];
    } else if (path === "/rest/v1/investor_loans") {
      body = [{ id: "loan-audit-1", user_id: user.id, investor_id: "44444444-4444-4444-8444-444444444444", principal: 5000, interest_rate: 2, total_due: 5100, paid_amount: 1000, start_date: "2026-08-01", due_date: "2026-10-01", frequency: "monthly", status: "active", payment_method: "pix", paid_at: null, notes: "Empréstimo de teste", created_at: "2026-08-01T12:00:00Z" }, { id: "loan-incomplete-audit-1", user_id: user.id, investor_id: "55555555-5555-4555-8555-555555555555", principal: null, interest_rate: null, total_due: null, paid_amount: null, start_date: null, due_date: null, frequency: null, status: "active", payment_method: null, paid_at: null, notes: null, created_at: "2026-08-02T12:00:00Z" }];
    } else if (path === "/rest/v1/investor_payments") {
      body = [{ id: "investor-payment-audit-1", user_id: user.id, investor_id: "44444444-4444-4444-8444-444444444444", amount: 1000, paid_at: "2026-09-05T12:00:00Z", method: "pix", notes: "Pagamento de teste" }];
    } else if (path === "/rest/v1/collectors") {
      body = [{ id: "collector-audit-1", user_id: user.id, name: "Cobrador de auditoria", phone: "11977777777", email: "cobrador@example.test", city: "São Paulo", state: "SP", is_active: true, created_at: "2026-01-20T12:00:00Z" }];
    } else if (path === "/rest/v1/collector_assignments") {
      body = [{ id: "assignment-audit-1", user_id: user.id, collector_id: "collector-audit-1", client_id: user.id, clients: { id: user.id, name: "Cliente de auditoria", phone: "11999999999", whatsapp: "11999999999", cpf_cnpj: "111.111.111-11", status: "active" } }];
    } else if (path === "/rest/v1/collector_tokens") {
      body = [{ id: "collector-token-audit-1", user_id: user.id, collector_id: "collector-audit-1", token: "audit-collector-token", is_active: true, created_at: "2026-01-20T12:00:00Z" }];
    } else if (path === "/rest/v1/business_assets") {
      body = [{ id: "asset-audit-1", user_id: user.id, kind: "phone", label: "Celular de auditoria", identifier: "123456789012345", cost: 1000, price: 1300, condition: "Novo", notes: "Bem de teste", status: "available", photos: [], details: {}, created_at: "2026-09-01T12:00:00Z" }];
    } else if (path === "/rest/v1/business_operations") {
      body = [{ id: "operation-audit-1", user_id: user.id, client_id: user.id, asset_id: "asset-audit-1", kind: "sale", status: "active", total: 1300, down_payment: 300, deposit: 0, deposit_returned: 0, start_date: "2026-09-01", end_date: null, billing: "monthly", rate: 0, notes: "Operação de teste", details: {}, created_at: "2026-09-01T12:00:00Z" }, { id: "operation-incomplete-audit-1", user_id: user.id, client_id: null, asset_id: "asset-audit-1", kind: "sale", status: "active", total: null, down_payment: null, deposit: null, deposit_returned: null, start_date: null, end_date: null, billing: null, rate: null, notes: null, details: null, created_at: "2026-09-02T12:00:00Z" }];
    } else if (path === "/rest/v1/business_receivables") {
      body = [{ id: "receivable-audit-1", user_id: user.id, operation_id: "operation-audit-1", number: 1, amount: 1000, paid_amount: 0, due_date: "2026-10-01", status: "pending" }];
    } else if (path === "/rest/v1/business_payments") {
      body = [{ id: "business-payment-audit-1", user_id: user.id, operation_id: "operation-audit-1", kind: "sale", amount: 300, method: "pix", created_at: "2026-09-01T12:00:00Z" }];
    } else if (path === "/rest/v1/loan_collateral") {
      body = [{ id: "collateral-audit-1", user_id: user.id, contract_id: "22222222-2222-4222-8222-222222222222", client_id: user.id, description: "Documento de garantia", category: "Documento", identifier: "GAR-001", estimated_value: "valor-legado-invalido", condition: "Bom", storage_location: "Cofre", photos: [], notes: "Garantia de teste", status: "held", received_at: "2026-09-01T12:00:00Z", returned_at: null }];
    } else if (path === "/rest/v1/transactions") {
      body = [{ id: "transaction-audit-1", user_id: user.id, type: "payment", amount: 550, principal_amount: 500, interest_amount: 50, date: "2026-09-10", description: "Pagamento de parcela", client_id: user.id, contract_id: "22222222-2222-4222-8222-222222222222" }];
    } else if (path === "/rest/v1/audit_logs") {
      body = [{ id: "audit-log-audit-1", user_id: user.id, action: "payment", entity_type: "contract_installment", entity_id: "33333333-3333-4333-8333-333333333333", details: { message: "Pagamento registrado" }, created_at: "2026-09-10T12:00:00Z" }];
    } else if (path === "/rest/v1/chat_channels") {
      body = [{ id: "channel-audit-1", name: "Geral", description: "Canal geral", is_default: true, is_announcement: false }];
    } else if (path === "/rest/v1/chat_channel_members") {
      body = [{ id: "member-audit-1", channel_id: "channel-audit-1", user_id: user.id, last_read_at: "2026-09-15T11:00:00Z" }];
    } else if (path === "/rest/v1/chat_dm_threads") {
      body = [];
    } else if (path === "/rest/v1/chat_messages") {
      body = [{ id: "chat-message-audit-1", channel_id: "channel-audit-1", dm_thread_id: null, user_id: user.id, user_name: "Conta de teste", user_avatar: null, content: "Mensagem de auditoria https://", type: "text", file_url: null, file_name: null, file_type: null, reply_to: null, is_pinned: false, is_deleted: false, deleted_by: null, edited_at: null, created_at: "2026-09-15T11:30:00Z" }];
    } else if (path === "/rest/v1/chat_message_reactions") {
      body = [];
    } else if (path === "/rest/v1/support_tickets") {
      body = [{ id: "ticket-audit-1", user_id: user.id, subject: "Dúvida de auditoria", category: "technical", priority: "normal", status: "answered", last_message_at: "2026-09-15T11:00:00Z", unread_by_user: false, unread_by_admin: false, created_at: "2026-09-14T12:00:00Z" }];
    } else if (path === "/rest/v1/support_ticket_messages") {
      body = [{ id: "ticket-message-audit-1", ticket_id: "ticket-audit-1", sender_id: user.id, sender_role: "user", sender_name: "Conta de teste", message: "Mensagem de suporte", created_at: "2026-09-15T11:00:00Z" }];
    } else if (path === "/rest/v1/notifications") {
      body = [{
        id: "notification-audit-1",
        message: "Parcela recebida para validação",
        from: "Sistema",
        type: "billing",
        link: "/cobrancas",
        is_read: false,
        created_at: "2026-09-15T12:00:00Z",
      }, {
        id: "notification-incomplete-1",
        message: null,
        from: null,
        type: null,
        link: null,
        is_read: true,
        created_at: "2026-09-14T12:00:00Z",
      }];
    } else if (path === "/rest/v1/whatsapp_conversations") {
      // API rows podem chegar parcialmente preenchidas durante a migração de
      // instâncias; a tela não deve quebrar ao filtrar telefone ou tags.
      body = [{
        id: "conversation-audit-1",
        user_id: user.id,
        client_id: null,
        phone: null,
        jid: "5511999999999@s.whatsapp.net",
        instance: null,
        contact_name: null,
        last_message_at: "2026-09-15T12:00:00Z",
        last_message_preview: null,
        last_message_from: null,
        unread_count: 0,
        bot_paused: false,
        needs_human: false,
        blocked: false,
        tags: [null],
        last_intent: null,
        bot_status: "active",
      }];
    }

    await route.fulfill({ status: 200, json: body, headers: { "content-range": "0-0/0" } });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function unnamedVisibleControls(page: Page) {
  return page.locator("button:visible, a:visible").evaluateAll((elements) => elements
    .filter((element) => {
      const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "";
      return !label.trim();
    })
    .map((element) => ({ tag: element.tagName.toLowerCase(), html: element.outerHTML.slice(0, 180) })));
}

async function unnamedVisibleFields(page: Page) {
  return page.locator("input:visible, select:visible, textarea:visible, img:visible").evaluateAll((elements) => elements
    .filter((element) => {
      if (element.tagName === "IMG") return !element.hasAttribute("alt");
      const id = element.getAttribute("id");
      const labelledBy = element.getAttribute("aria-labelledby");
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      const wrappingLabel = element.closest("label")?.textContent;
      return !(element.getAttribute("aria-label") || labelledBy || label || wrappingLabel || element.getAttribute("name") || element.getAttribute("placeholder"))?.trim();
    })
    .map((element) => ({ tag: element.tagName.toLowerCase(), html: element.outerHTML.slice(0, 180) })));
}

test.describe("smoke responsivo autenticado com backend isolado", () => {
  for (const viewport of viewports) {
    test(`${viewport.name}: rotas internas renderizam sem overflow horizontal`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await mockBackend(page);
      await login(page);

      for (const route of routes) {
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${route} devolveu HTTP invalido`).toBeLessThan(400);
        await expect(page.locator("#root"), `${route} nao renderizou`).not.toBeEmpty();
        await expect(page, `${route} saiu da area autenticada`).not.toHaveURL(/\/login(?:\?|$)/);
        await expect(page.getByText(/algo deu errado|erro inesperado/i), `${route} mostrou falha fatal`).toHaveCount(0);
        expect(await unnamedVisibleControls(page), `${route} possui controles visíveis sem nome acessível`).toEqual([]);
        expect(await unnamedVisibleFields(page), `${route} possui campos visíveis sem label/nome`).toEqual([]);
        if (route === "/garantias") {
          await expect(page.getByText(/\bNaN\b|\bundefined\b|\bInvalid Date\b/i), `${route} exibiu valor legado inválido`).toHaveCount(0);
        }

        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        expect(Math.max(overflow.document, overflow.body), `${route} criou rolagem horizontal`).toBeLessThanOrEqual(1);
      }

      expect(pageErrors, "Erros JavaScript durante a matriz autenticada").toEqual([]);
    });
  }
});

test("menu mobile abre, filtra e fecha por teclado sem perder a navegação", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);

  const more = page.getByRole("button", { name: "Mais", exact: true });
  await expect(more).toBeVisible();
  await more.click();
  const dialog = page.getByRole("dialog", { name: "Menu completo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Análises", exact: true })).toHaveAttribute("href", "/analises");

  await dialog.getByRole("textbox", { name: "Buscar no menu" }).fill("metas");
  await expect(dialog.getByRole("link", { name: "Metas", exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Clientes", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("Sidebar desktop expõe links semânticos para as telas do menu", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockBackend(page);
  await login(page);
  await expect(page.getByRole("link", { name: "Clientes", exact: true })).toHaveAttribute("href", "/clientes");
  await expect(page.getByRole("link", { name: "Cobranças", exact: true })).toHaveAttribute("href", "/cobrancas");
});

test("busca global encerra loading quando a consulta falha", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mockBackend(page);
  await login(page);
  await page.route("**/rest/v1/clients**", route => route.abort("failed").catch(() => undefined));

  await page.locator('[data-tour="topbar-search"]').click();
  const search = page.locator('input[placeholder*="Buscar"]:visible').last();
  await expect(search).toBeVisible();
  await search.fill("cliente inexistente");
  await expect(page.getByText(/Nenhum resultado para/)).toBeVisible({ timeout: 2_000 });
  await expect(search).toBeVisible();
});

test("modal de cadastro do estoque mantém campos nomeados e fechamento acessível", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);
  await page.goto("/comercial/estoque");
  await page.getByRole("button", { name: "Cadastrar bem", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Tipo de bem")).toBeVisible();
  await expect(dialog.getByLabel("Nome / modelo")).toBeVisible();
  await expect(dialog.getByLabel(/IMEI|Placa/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Fechar", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("abas de Configurações mantêm campos acessíveis em mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);
  await page.goto("/configuracoes");

  for (const tab of [
    "Empresa & Dados", "Chave PIX", "Padrões de Empréstimo", "Marca, Cores & Tema",
    "Portal do Cliente", "Modelo de Contrato", "Bot de Cobranças", "Templates de Mensagem",
    "Mensagem Padrão", "WhatsApp (Evolution)", "Webhooks / N8N",
  ]) {
    const trigger = page.getByRole("button", { name: tab, exact: true });
    await expect(trigger, `Aba ${tab} não está disponível`).toBeVisible();
    await trigger.click();
    await expect(page.locator("#root")).not.toBeEmpty();
    expect(await unnamedVisibleControls(page), `Aba ${tab} possui controle sem nome`).toEqual([]);
    expect(await unnamedVisibleFields(page), `Aba ${tab} possui campo sem nome`).toEqual([]);
    const overflow = await page.evaluate(() => Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    ));
    expect(overflow, `Aba ${tab} criou rolagem horizontal`).toBeLessThanOrEqual(1);
  }
});

test("diálogos de venda e locação permanecem utilizáveis em mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);

  for (const flow of [
    { route: "/comercial/vendas", trigger: "Registrar venda", dialog: "Registrar venda" },
    { route: "/comercial/locacoes", trigger: "Nova locação", dialog: "Nova locação" },
  ]) {
    await page.goto(flow.route);
    await page.getByRole("button", { name: flow.trigger, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: flow.dialog })).toBeVisible();
    expect(await unnamedVisibleControls(page), `${flow.route} possui controle sem nome`).toEqual([]);
    expect(await unnamedVisibleFields(page), `${flow.route} possui campo sem nome`).toEqual([]);
    const overflow = await page.evaluate(() => Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    ));
    expect(overflow, `${flow.route} criou rolagem horizontal no diálogo`).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
});

test("seleção e baixa de notificação funcionam com dados reais simulados", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);
  await page.goto("/notificacoes");

  await expect(page.getByText("Parcela recebida para validação")).toBeVisible();
  const selectAll = page.getByRole("checkbox", { name: "Selecionar todas as notificações" });
  await selectAll.check();
  await expect(page.getByRole("button", { name: /marcar lidas/i })).toBeVisible();
  await page.getByRole("button", { name: /marcar lidas/i }).click();
  await expect(page.getByRole("button", { name: /marcar lidas/i })).toHaveCount(0);
  await expect(page.locator("#notifications-select-page")).not.toBeChecked();
});

test("detalhe do cliente mantém formulários financeiros acessíveis em mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);
  await page.goto(`/clientes/${user.id}`);

  await page.getByRole("button", { name: "Editar dados do cliente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Editar Cliente" })).toBeVisible();
  expect(await unnamedVisibleFields(page), "edição do cliente possui campos sem nome").toEqual([]);
  const clientOverflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth,
  ));
  expect(clientOverflow, "edição do cliente criou rolagem horizontal").toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Editar contrato", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Editar Empréstimo/ })).toBeVisible();
  expect(await unnamedVisibleFields(page), "edição do contrato possui campos sem nome").toEqual([]);
  const contractOverflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    document.body.scrollWidth - document.body.clientWidth,
  ));
  expect(contractOverflow, "edição do contrato criou rolagem horizontal").toBeLessThanOrEqual(1);
});

test("detalhe do investidor abre baixa mesmo com empréstimo incompleto na lista", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockBackend(page);
  await login(page);
  await page.goto("/investidores/11111111-1111-4111-8111-111111111111");

  await page.getByRole("button", { name: "Dar baixa", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registrar pagamento" })).toBeVisible();
});
