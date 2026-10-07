import { expect, test, type Page } from "@playwright/test";

// A conta e todas as respostas de backend são simuladas no navegador.
// Não cria usuários, pagamentos nem registros no Supabase.
test.use({ serviceWorkers: "block" });
const user = { id: "11111111-1111-4111-8111-111111111111", email: "audit@example.test",
  aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const profile = { ...user, name: "Conta de teste", subscription_type: "lifetime", is_blocked: false,
  plan_tier: "essencial", onboarding_completed_at: "2026-01-01T00:00:00Z" };
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

// playwright.config.ts carrega VITE_SUPABASE_URL de .env.production. Mockar
// um domínio fixo (ex: "*.supabase.co") fica obsoleto assim que o projeto
// migra de host — como já aconteceu ao sair do Supabase Cloud para o
// self-hosted — e os testes passam a bater no backend real sem perceber.
const supabaseOrigin = new URL(process.env.VITE_SUPABASE_URL || "https://supabase-not-configured.invalid").origin;

async function mockBackend(page: Page, failFirstProfile: boolean|'temporary' = false) {
  let profileReads = 0;
  await page.routeWebSocket("**", socket => socket.close());
  await page.route(`${supabaseOrigin}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown = [];
    if (path === "/auth/v1/token") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      body = { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, exp, role: "authenticated" })}.test`,
        refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, expires_at: exp, user };
    } else if (path === "/auth/v1/user") body = user;
    else if (path === "/rest/v1/profiles") {
      const isAuthProfile = url.searchParams.get("select") === "*";
      if (isAuthProfile) profileReads++;
      if (failFirstProfile && isAuthProfile && profileReads === 1) {
        await route.fulfill({ status: failFirstProfile==='temporary'?503:400, json: { message: "Falha simulada ao consultar perfil" } });
        return;
      }
      body = profile;
    } else if (path === "/rest/v1/rpc/is_admin") body = false;
    else if (path === "/rest/v1/platform_settings") body = { maintenance_mode: false, allow_new_registrations: true };
    await route.fulfill({ status: 200, json: body, headers: { "content-range": "0-0/0" } });
  });
  return () => profileReads;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(user.email);
  await page.getByLabel(/senha/i).first().fill("SenhaDeTeste123!");
  await page.getByRole("button", { name: /entrar/i }).click();
}

test("login chega ao dashboard e consulta o perfil uma única vez", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const reads = await mockBackend(page);
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  expect(reads()).toBe(1);
  expect(errors).toEqual([]);
});

test("perfil com falha permite tentar novamente e abrir o dashboard", async ({ page }) => {
  const reads = await mockBackend(page, true);
  await login(page);
  await expect(page.getByText("Não foi possível verificar seu acesso")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("tab", { name: "Visão geral", exact: true })).toBeVisible();
  expect(reads()).toBe(2);
});
test('uma falha temporária do perfil se recupera automaticamente no login',async({page})=>{
 const reads=await mockBackend(page,'temporary');await login(page);
 await expect(page.getByRole('tab',{name:'Visão geral',exact:true})).toBeVisible();
 expect(reads()).toBe(2);await expect(page.getByText('Não foi possível verificar seu acesso')).toHaveCount(0);
});
for(const failure of ['quota','blocked']as const)test(`login chega ao painel com armazenamento ${failure}`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
 await page.addInitScript(failure=>{
   if(failure==='quota')Storage.prototype.setItem=function(){throw new DOMException('Storage full','QuotaExceededError');};
   else for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{configurable:true,get(){throw new DOMException('Storage blocked','SecurityError');}});
 },failure);
 const reads=await mockBackend(page);await login(page);
 await expect(page.getByRole('tab',{name:'Visão geral',exact:true})).toBeVisible();expect(reads()).toBe(1);
 await page.goto('/clientes');
 // A reload intentionally loses an in-memory-only session; log in again in this browser.
 if(failure==='blocked'||failure==='quota'){await expect(page).toHaveURL(/\/login/);await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaDeTeste123!');await page.getByRole('button',{name:/entrar/i}).click();}
 await expect(page).toHaveURL(/\/clientes$/);await expect(page.getByRole('heading',{name:'Clientes',exact:true})).toBeVisible();expect(errors).toEqual([]);
});
test('falha ao pedir recuperação de senha permite nova tentativa sem confirmar envio',async({page})=>{
 await mockBackend(page);let attempts=0;
 await page.route('**/auth/v1/recover**',async route=>{attempts++;if(attempts===1)await route.abort('failed');else await route.fulfill({status:200,json:{}});});
 await page.goto('/reset-password');await page.getByLabel('E-mail',{exact:true}).fill(user.email);await page.getByRole('button',{name:/enviar link/i}).click();
 await expect(page.getByRole('button',{name:/enviar link/i})).toBeEnabled();await expect(page.getByRole('heading',{name:'Verifique seu e-mail'})).toHaveCount(0);
 await page.getByRole('button',{name:/enviar link/i}).click();await expect(page.getByRole('heading',{name:'Verifique seu e-mail'})).toBeVisible();await expect(page.getByRole('button',{name:/aguarde.*reenviar/i})).toBeDisabled();expect(attempts).toBe(2);
});
test('senha recusada mantém o link válido e a conclusão encerra somente esta sessão',async({page})=>{
 await mockBackend(page);let updates=0;const scopes:string[]=[];
 await page.route('**/auth/v1/logout**',async route=>{scopes.push(new URL(route.request().url()).searchParams.get('scope')||'');await route.fulfill({status:200,json:{}});});
 await page.route('**/auth/v1/user**',async route=>{
   if(route.request().method()!=='PUT')return route.fallback();updates++;
   if(updates===1)return route.fulfill({status:422,json:{code:'weak_password',msg:'Weak password'}});
   return route.fulfill({status:200,json:user});
 });
 await login(page);await expect(page.getByRole('tab',{name:'Visão geral',exact:true})).toBeVisible();await page.goto('/reset-password#type=recovery');
 await page.getByLabel('Nova senha',{exact:true}).fill('IsolatedPassword123!');await page.getByLabel('Confirmar senha').fill('IsolatedPassword123!');await page.getByRole('button',{name:/salvar|atualizar|redefinir/i}).click();
 await expect(page.getByLabel('Nova senha',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/salvar|atualizar|redefinir/i})).toBeEnabled();expect(scopes).toEqual([]);
 await page.getByRole('button',{name:/salvar|atualizar|redefinir/i}).click();await expect(page).toHaveURL(/\/login$/);expect(scopes).toEqual(['local']);expect(updates).toBe(2);
});
