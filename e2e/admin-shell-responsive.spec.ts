import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const user = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "admin-audit@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const profile = {
  ...user,
  name: "Administrador de teste",
  subscription_type: "lifetime",
  plan_tier: "essencial",
  is_admin: true,
  is_blocked: false,
  onboarding_completed_at: "2026-01-01T00:00:00Z",
};

const routes = [
  "/admin", "/admin?secao=support", "/admin?secao=automations", "/admin?secao=logs",
  "/admin?secao=settings", "/admin/bot-audit", "/auditoria", "/historico",
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
        refresh_token: "admin-audit-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: exp,
        user,
      };
    } else if (path === "/auth/v1/user") body = user;
    else if (path === "/rest/v1/profiles") {
      const isCurrentProfile = url.searchParams.get("id")?.includes(user.id);
      body = isCurrentProfile ? profile : [
        profile,
        {
          ...user,
          id: "33333333-3333-4333-8333-333333333333",
          email: "cliente-audit@example.test",
          name: "Cliente de teste",
          is_admin: false,
          is_blocked: false,
          is_chat_blocked: false,
          subscription_type: "monthly",
          plan_tier: "completo",
          subscription_expires_at: "2099-12-31T00:00:00Z",
          created_at: "2026-08-01T00:00:00Z",
        },
      ];
    }
    else if (path === "/rest/v1/subscriptions") body = [{
      id: "sub-audit-1", email: "cliente-audit@example.test", status: "active",
      plan_name: "Completo", plan_tier: "completo", provider: "stripe",
      amount_paid: 299, current_period_end: "2026-10-15T00:00:00Z", created_at: "2026-09-01T00:00:00Z",
    }];
    else if (path === "/rest/v1/transactions") body = [{
      id: "tx-audit-1", type: "income", amount: 299, principal_amount: 250,
      interest_amount: 49, date: "2026-09-14", description: "Assinatura do plano Completo",
    }];
    else if (path === "/rest/v1/system_automations") body = [{
      id: "automation-audit-1", name: "Cobrança automática", status: "active",
      total_executions: 42, success_rate: 97,
    }];
    else if (path === "/rest/v1/automation_logs") body = [{
      id: "automation-log-audit-1", level: "warning", message: "Uma cobrança aguardando revisão",
      created_at: "2026-09-15T10:30:00Z",
    }];
    else if (path === "/rest/v1/audit_logs") body = [{
      id: "audit-event-audit-1", action: "client_updated", entity_type: "client",
      entity_id: "33333333-3333-4333-8333-333333333333", details: { source: "admin" },
      created_at: "2026-09-15T09:15:00Z", user_id: user.id,
    }, {
      id: "audit-bot-audit-1", action: "reply_blocked_by_guardrail", entity_type: "whatsapp_bot",
      entity_id: "33333333-3333-4333-8333-333333333333", details: { reasons: ["valor divergente", "identidade não confirmada"] },
      created_at: "2026-09-15T09:10:00Z", user_id: user.id,
    }];
    else if (path === "/rest/v1/bot_actions_log") body = [{
      id: "bot-action-audit-1", user_id: user.id, client_id: "33333333-3333-4333-8333-333333333333",
      conversation_id: "conversation-audit-1", tool_name: "escalate_human", tool_input: { reason: "guardrail" },
      tool_output: { needs_human: true }, success: true, error_message: null, created_at: "2026-09-15T09:11:00Z",
    }];
    else if (path === "/rest/v1/whatsapp_conversations") body = [{
      id: "conversation-audit-1", phone: "5511999999999", agent_state: "INTENT_HUMANO",
      agent_state_updated_at: "2026-09-15T09:12:00Z", clients: { name: "Cliente de teste" },
    }];
    else if (path === "/rest/v1/support_tickets") body = [{
      id: "ticket-audit-1", user_id: "33333333-3333-4333-8333-333333333333",
      subject: "Dúvida sobre cobrança", category: "billing", priority: "high", status: "open",
      last_message_at: "2026-09-15T08:00:00Z", unread_by_user: false, unread_by_admin: true,
      created_at: "2026-09-15T07:55:00Z",
    }];
    else if (path === "/rest/v1/support_ticket_messages") body = [{
      id: "ticket-message-audit-1", ticket_id: "ticket-audit-1", sender_id: "33333333-3333-4333-8333-333333333333",
      sender_role: "user", sender_name: "Cliente de teste", message: "Preciso entender esta cobrança.",
      is_internal: false, created_at: "2026-09-15T08:00:00Z",
    }];
    else if (path === "/rest/v1/rpc/is_admin") body = true;
    else if (path === "/rest/v1/platform_settings") body = { maintenance_mode: false, allow_new_registrations: true };
    await route.fulfill({ status: 200, json: body, headers: { "content-range": "0-0/0" } });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page).toHaveURL(/\/(?:dashboard|admin)$/);
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
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent : "";
      const wrappingLabel = element.closest("label")?.textContent;
      return !(element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") || label || wrappingLabel || element.getAttribute("name") || element.getAttribute("placeholder"))?.trim();
    })
    .map((element) => ({ tag: element.tagName.toLowerCase(), html: element.outerHTML.slice(0, 180) })));
}

test.describe("smoke responsivo administrativo com backend isolado", () => {
  for (const viewport of viewports) {
    test(`${viewport.name}: módulos administrativos permanecem utilizáveis`, async ({ page }) => {
      test.setTimeout(120_000);
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
        await expect(page.getByText(/acesso restrito|algo deu errado|erro inesperado/i), `${route} mostrou bloqueio ou falha`).toHaveCount(0);
        expect(await unnamedVisibleControls(page), `${route} possui controles visíveis sem nome acessível`).toEqual([]);
        expect(await unnamedVisibleFields(page), `${route} possui campos visíveis sem label/nome`).toEqual([]);
        const overflow = await page.evaluate(() => Math.max(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
          document.body.scrollWidth - document.body.clientWidth,
        ));
        expect(overflow, `${route} criou rolagem horizontal`).toBeLessThanOrEqual(1);
      }

      expect(pageErrors, "Erros JavaScript durante a matriz administrativa").toEqual([]);
    });
  }

  test("admin pode alternar entre o menu da plataforma e o menu de operação", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await mockBackend(page);
    await login(page);
    await expect(page.getByRole("tab", { name: "Plataforma", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Operação", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("link", { name: "Clientes", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usuários & Assinaturas", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Plataforma", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: "Usuários & Assinaturas", exact: true })).toBeVisible();
  });
});
