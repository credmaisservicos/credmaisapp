import { test, expect } from "@playwright/test";

const publicRoutes = [
  "/", "/login", "/planos", "/inteligencia", "/sobre-credmais", "/missao",
  "/checkout?plan=essencial", "/reset-password", "/portal-cliente",
  "/checkout/sucesso", "/checkout/erro", "/checkout/pendente",
  "/portal", "/portal/token-invalido", "/investidor/token-invalido",
  "/privacidade", "/termos", "/cobrador-externo",
];

const protectedRoutes = [
  "/dashboard", "/hoje", "/analises", "/clientes", "/clientes/novo",
  "/clientes/buscar", "/clientes/11111111-1111-4111-8111-111111111111",
  "/contratos/22222222-2222-4222-8222-222222222222", "/cobrancas", "/carteira",
  "/comercial", "/comercial/estoque", "/comercial/vendas", "/comercial/locacoes", "/garantias",
  "/investidores", "/investidores/11111111-1111-4111-8111-111111111111", "/lucros",
  "/gastos", "/ferramentas", "/ferramentas/metas", "/ferramentas/simulador",
  "/ferramentas/tarefas", "/ferramentas/anotacoes", "/ferramentas/planilha",
  "/puxada-dados", "/sobre", "/perfil", "/admin", "/admin/bot-audit",
  "/relatorios", "/historico", "/historico-financeiro", "/configuracoes",
  "/cobradores", "/qrcode", "/comunicacao", "/comunicacao/inbox",
  "/auditoria", "/suporte", "/notificacoes", "/chat", "/tv",
  "/central", "/agente-ia", "/bot-performance", "/automacoes", "/configuracoes/whatsapp", "/inadimplencia",
];

for (const route of publicRoutes) {
  test(`rota pública saudável: ${route}`, async ({ page }) => {
    const fatalErrors: string[] = [];
    page.on("pageerror", error => fatalErrors.push(error.message));
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route} devolveu HTTP inválido`).toBeLessThan(400);
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.locator("#root")).not.toBeEmpty();
    expect(fatalErrors, `${route} gerou erro JavaScript fatal`).toEqual([]);
  });
}

for (const route of protectedRoutes) {
  test(`rota protegida exige sessão: ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForURL(/\/login(?:\?|$)/);
    expect(page.url()).toContain("next=");
    expect(decodeURIComponent(page.url())).toContain(route);
  });
}
