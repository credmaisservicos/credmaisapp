import {emptyFinancialAnalyticsReport} from './helpers/financialAnalytics';
import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {emptyWalletCashReport} from './helpers/walletCash';
test.use({serviceWorkers:'block'});
const owner='11111111-1111-4111-8111-111111111111',entry='77777777-7777-4777-8777-777777777777';
const user={id:owner,email:'cash@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const origin=new URL(process.env.VITE_SUPABASE_URL||'https://supabase-not-configured.invalid').origin;
async function setup(context:BrowserContext){
 const state={mode:'after' as 'after'|'before'|'ok'|'invalid',requests:[]as any[],cancelRequests:[]as any[],cash:[]as any[],journal:new Map<string,any>(),errors:[]as string[]};
 context.on('page',page=>page.on('pageerror',e=>state.errors.push(e.message)));
 await context.routeWebSocket('**',socket=>socket.close());
 const handle=async(route:import('@playwright/test').Route)=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname.replace(/^\/api\/supabase/,'');let data:unknown=[];
  if(path==='/auth/v1/token'){
   const exp=Math.floor(Date.now()/1000)+3600,b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
   data={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,exp,role:'authenticated'})}.test`,refresh_token:'fictional',expires_in:3600,expires_at:exp,token_type:'bearer',user};
  }else if(path==='/auth/v1/user')data=user;
  else if(path==='/rest/v1/profiles')data={...user,name:'Conta fictícia',subscription_type:'lifetime',is_blocked:false,onboarding_completed_at:'2026-01-01T00:00:00Z'};
  else if(path==='/rest/v1/rpc/is_admin')data=false; else if(path==='/rest/v1/rpc/financial_analytics_report') data=emptyFinancialAnalyticsReport();
  else if(path==='/rest/v1/platform_settings')data={maintenance_mode:false};
  else if(path==='/rest/v1/rpc/payment_allocation_review')data={allocation_review_count:0,unallocated_received_total:0,overallocated_received_total:0,installments:[]};
  else if(path==='/rest/v1/expenses')data=state.cash.filter(row=>row.kind==='expense_create').map(({kind,...row})=>row);
  else if(path==='/rest/v1/rpc/wallet_cash_report'){
   const report=emptyWalletCashReport();const income=state.cash.filter(r=>r.kind==='capital_injection').reduce((s,r)=>s+r.amount,0);
   const out=state.cash.filter(r=>r.kind!=='capital_injection').reduce((s,r)=>s+r.amount,0);
   report.totals={...report.totals,inflows:income,outflows:out,capital:income,manual_expenses:out,balance:income-out};
   report.period={...report.period,inflows:income,outflows:out,closing_balance:income-out};data=report;
  }else if(path==='/rest/v1/rpc/apply_manual_cash_operation'){
   const input=req.postDataJSON();state.requests.push(input);expect(input._expected_owner).toBe(owner);expect(input).not.toHaveProperty('user_id');
   if(state.journal.get(input._request_id)?.cancelled){await route.fulfill({status:400,json:{code:'P0001',message:'manual_cash_cancelled'}});return;}
   if(state.mode==='before'){await route.abort('failed');return;}
   if(state.mode==='invalid'){await route.fulfill({status:400,json:{code:'22023',message:'invalid_manual_cash_values'}});return;}
   const prior=state.journal.get(input._request_id);
   if(prior)data={...prior,replayed:true};
   else{
    const row={id:entry,user_id:owner,description:input._description,amount:input._amount,date:input._date,category:input._category,created_at:input._date,fee_amount:0,receipt_url:null,kind:input._operation};
    state.cash.push(row);data={ok:true,entry_id:row.id,operation:input._operation,replayed:false,current_state:'applied'};state.journal.set(input._request_id,data);
   }
   if(state.mode==='after'){await route.abort('failed');return;}
  }else if(path==='/rest/v1/rpc/cancel_manual_cash_operation'){
   const input=req.postDataJSON();state.cancelRequests.push(input);expect(input._expected_owner).toBe(owner);
   const prior=state.journal.get(input._request_id);
   if(prior&&!prior.cancelled)data={...prior,cancelled:false,replayed:true};
   else {data={ok:true,cancelled:true};state.journal.set(input._request_id,data);}
  }else if(['POST','PATCH','DELETE'].includes(req.method())&&/\/rest\/v1\/(?:transactions|expenses)$/.test(path))throw Error('Cash bypassed atomic RPC');
  await route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
 };
 await context.route(`${origin}/**`,handle);await context.route('**/api/supabase/**',handle);return state;
}
async function login(page:Page){await page.goto('/login');await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaFicticia123!');await page.getByRole('button',{name:/entrar/i}).click();await expect(page).toHaveURL(/dashboard$/);}
async function walletForm(page:Page,amount='12,34'){
 await page.goto('/carteira');await page.getByRole('button',{name:'Aporte',exact:true}).click();await page.getByLabel('Descrição',{exact:true}).fill('Aporte fictício');await page.getByLabel('Valor (R$)',{exact:true}).fill(amount);
}
const pending=(page:Page)=>page.getByRole('region',{name:'Tentativa financeira pendente'});
for(const width of [320,1366])test(`resposta perdida do aporte é retomada após recarregar sem duplicar em ${width}px`,async({context,page},testInfo)=>{
 const state=await setup(context);await page.setViewportSize({width,height:900});await login(page);await walletForm(page);
 await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();await expect(page.getByText('Não foi possível confirmar o lançamento',{exact:true})).toBeVisible();
 expect(state.cash).toHaveLength(1);const first=state.requests[0];await page.reload();await expect(pending(page)).toContainText('Aporte fictício');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:testInfo.outputPath('pending-cash.png'),fullPage:true});state.mode='ok';await pending(page).getByRole('button',{name:'Verificar e concluir'}).click();
 await expect(pending(page)).toHaveCount(0);expect(state.cash).toHaveLength(1);expect(state.requests.at(-1)).toEqual(first);expect(state.errors).toEqual([]);
});
test('encerrar um envio não recebido permite revisar e bloqueia sua chegada tardia',async({context,page})=>{
 const state=await setup(context);state.mode='before';await login(page);await walletForm(page);
 await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();await expect(page.getByText('Não foi possível confirmar o lançamento',{exact:true})).toBeVisible();
 const first=state.requests[0];await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();await pending(page).getByRole('button',{name:'Encerrar tentativa'}).click();await expect(pending(page)).toHaveCount(0);
 expect(state.cash).toHaveLength(0);state.mode='ok';
 const late=await page.evaluate(async({origin,input})=>{const r=await fetch(origin+'/rest/v1/rpc/apply_manual_cash_operation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return r.status;},{origin,input:first});
 expect(late).toBe(400);expect(state.cash).toHaveLength(0);
 await walletForm(page,'30,00');await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();await expect(page.getByText('Aporte registrado',{exact:true})).toBeVisible();
 expect(state.requests.at(-1)._request_id).not.toBe(first._request_id);expect(state.cash).toHaveLength(1);expect(state.cash[0].amount).toBe(30);
});
test('encerrar depois de gravar confirma o aporte e preserva o dinheiro',async({context,page})=>{
 const state=await setup(context);await login(page);await walletForm(page);await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();
 await expect(page.getByText('Não foi possível confirmar o lançamento',{exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();await pending(page).getByRole('button',{name:'Encerrar tentativa'}).click();
 await expect(page.getByText('Aporte registrado',{exact:true})).toBeVisible();await expect(pending(page)).toHaveCount(0);expect(state.cash).toHaveLength(1);expect(state.cash[0].amount).toBe(12.34);
});
test('gasto com resposta perdida é recuperado pela carteira depois de navegar',async({context,page})=>{
 const state=await setup(context);await login(page);await page.goto('/gastos');await page.getByRole('button',{name:'Novo Gasto',exact:true}).click();
 await page.getByLabel('Descrição',{exact:true}).fill('Despesa fictícia');await page.getByLabel('Valor (R$)',{exact:true}).fill('25,50');await page.getByRole('button',{name:'Registrar',exact:true}).click();
 await expect(page.getByText('Não foi possível confirmar o lançamento',{exact:true})).toBeVisible();const first=state.requests[0];expect(state.cash).toHaveLength(1);
 await page.goto('/carteira');await expect(pending(page)).toContainText('Despesa fictícia');state.mode='ok';await pending(page).getByRole('button',{name:'Verificar e concluir'}).click();
 await expect(pending(page)).toHaveCount(0);expect(state.requests.at(-1)).toEqual(first);expect(state.cash).toHaveLength(1);expect(state.errors).toEqual([]);
});
test('duas abas não preparam novos envios sobre a mesma tentativa pendente',async({context,page})=>{
 const state=await setup(context);state.mode='before';await login(page);await walletForm(page,'10,00');const second=await context.newPage();await walletForm(second,'20,00');
 await Promise.all([page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click(),second.getByRole('button',{name:'Confirmar Aporte',exact:true}).click()]);
 await expect.poll(()=>state.requests.length).toBe(1);await expect(page.getByText(/Há uma tentativa pendente|Não foi possível confirmar o lançamento/).first()).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();await second.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();state.mode='ok';await pending(page).getByRole('button',{name:'Verificar e concluir'}).click();await expect(pending(page)).toHaveCount(0);
 await pending(second).getByRole('button',{name:'Verificar e concluir'}).click();await expect(pending(second)).toHaveCount(0);expect(state.cash).toHaveLength(1);expect(state.requests).toHaveLength(2);await second.close();
});
test('armazenamento bloqueado não permite enviar uma operação sem guardar sua identidade',async({context,page})=>{
 await context.addInitScript(()=>{Object.defineProperty(IDBFactory.prototype,'open',{value(){throw new DOMException('Blocked','SecurityError');},configurable:true});});const state=await setup(context);await login(page);await walletForm(page);
 await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();await expect(page.getByText('Lançamento não enviado',{exact:true})).toBeVisible();expect(state.requests).toHaveLength(0);expect(state.cash).toHaveLength(0);
});
test('rejeição definitiva só libera os campos depois de bloquear o envio no servidor',async({context,page})=>{
 const state=await setup(context);state.mode='invalid';await login(page);await walletForm(page);
 await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();await expect(page.getByText('Lançamento não aplicado',{exact:true})).toBeVisible();
 await expect(pending(page)).toHaveCount(0);expect(state.cash).toHaveLength(0);expect(state.cancelRequests).toHaveLength(1);
 expect(state.cancelRequests[0]._request_id).toBe(state.requests[0]._request_id);await expect(page.getByLabel('Valor (R$)',{exact:true})).toBeEnabled();
 state.mode='ok';await page.getByLabel('Valor (R$)',{exact:true}).fill('20,00');await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();
 await expect(page.getByText('Aporte registrado',{exact:true})).toBeVisible();expect(state.cash).toHaveLength(1);expect(state.requests[1]._request_id).not.toBe(state.requests[0]._request_id);
});
test('valor com fração de centavo não vira falha de armazenamento nem envia caixa',async({context,page})=>{
 const state=await setup(context);await login(page);await walletForm(page,'12,345');await page.getByRole('button',{name:'Confirmar Aporte',exact:true}).click();
 await expect(page.getByText('Dados inválidos',{exact:true})).toBeVisible();expect(state.requests).toHaveLength(0);await expect(page.getByText('Armazenamento indisponível',{exact:true})).toHaveCount(0);
});
