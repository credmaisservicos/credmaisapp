import {test,expect,type Page} from '@playwright/test';
import {emptyFinancialAnalyticsReport} from './helpers/financialAnalytics';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
const owner='11111111-1111-4111-8111-111111111111',contractId='33333333-3333-4333-8333-333333333333';
const user={id:owner,email:'financial@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function backend(page:Page){
 const state={status:'active',dailyRate:4,requests:[] as any[],writes:[] as string[]};
 await page.clock.setFixedTime(new Date('2026-08-31T22:00:00-03:00'));
 // Financial fixtures do not depend on the public font CDN. Its unavailable
 // response is exercised separately in boot-resilience in both browsers.
 await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({contentType:'text/css',body:''}));
 await page.routeWebSocket('**',socket=>socket.close());
 const origin=new URL(process.env.VITE_SUPABASE_URL||'https://supabase-not-configured.invalid').origin;
 const contract=()=>({id:contractId,user_id:owner,client_id:owner,capital:1000,total_amount:1200,total_interest:200,num_installments:10,status:state.status,daily_interest_percent:state.dailyRate,max_interest_cap_percent:0,daily_penalty_type:'percentage',daily_penalty_value:0,loan_mode:'fixed',created_at:'2026-07-01T12:00:00Z',clients:{id:owner,name:'Cliente fictício'}});
 const installment=()=>({id:'44444444-4444-4444-8444-444444444444',user_id:owner,client_id:owner,contract_id:contractId,installment_number:1,amount:100,paid_amount:40,paid_principal:30,paid_interest:10,paid_fees:0,late_fee:0,pre_settlement_snapshot:null,status:'overdue',due_date:'2026-08-30T12:00:00-03:00',contracts:contract(),clients:{id:owner,name:'Cliente fictício',phone:'11999999999',whatsapp:'11999999999'}});
 const report=()=>{
  const r=emptyFinancialAnalyticsReport();r.wallet.as_of='2026-09-01T01:00:00Z';r.wallet.financial_day='2026-08-31';
  Object.assign(r.wallet.totals,{receipts:100,inflows:100,outflows:1000,disbursements:1000,principal:80,profit:20,balance:-900});
  r.receipts=[{id:'receipt-two',contract_id:contractId,client_id:owner,client_name:'Cliente fictício',installment_id:installment().id,date:'2026-09-01T01:00:00Z',day:'2026-08-31',amount:60,principal:50,interest:10,fees:0,unclassified:0,description:'Quitação fictícia',category:'loan_payment'},
   {id:'receipt-one',contract_id:contractId,client_id:owner,client_name:'Cliente fictício',installment_id:installment().id,date:'2026-07-30T12:00:00-03:00',day:'2026-07-30',amount:40,principal:30,interest:10,fees:0,unclassified:0,description:'Parcial fictício',category:'loan_payment'}];
  r.capital=[{contract_id:contractId,disbursed:1000,returned:80,outstanding:920}];return r;
 };
 await page.route(`${origin}/**`,async route=>{
  const url=new URL(route.request().url()),path=url.pathname;let data:unknown=[];
  if(['POST','PATCH','DELETE'].includes(route.request().method())&&/^\/rest\/v1\/(contracts|contract_installments|transactions|clients)$/.test(path))state.writes.push(path);
  if(path==='/auth/v1/token'){const exp=Math.floor(Date.now()/1000)+3600;data={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,role:'authenticated',exp})}.test`,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user};}
  else if(path==='/auth/v1/user')data=user;
  else if(path==='/rest/v1/profiles')data={...user,name:'Conta fictícia',subscription_type:'lifetime',plan_tier:'essencial',is_blocked:false,onboarding_completed_at:user.created_at};
  else if(path==='/rest/v1/platform_settings')data={maintenance_mode:false};
  else if(path==='/rest/v1/rpc/is_admin')data=false;
  else if(path==='/rest/v1/rpc/financial_analytics_report'){const r=report(),args=route.request().postDataJSON()||{};state.requests.push(args);if(args._from)r.receipts=r.receipts.filter(x=>x.day!>=args._from&&x.day!<=args._to);data=r;}
  else if(path==='/rest/v1/rpc/wallet_cash_report')data=report().wallet;
  else if(path==='/rest/v1/contracts')data=[contract()];
  else if(path==='/rest/v1/contract_installments'){
   const item=installment();data=state.status==='active'?[item]:[{...item,status:'paid',paid_amount:100,paid_at:'2026-09-01T01:00:00Z'}];
   if(url.searchParams.get('status')==='eq.paid'&&state.status==='active')data=[];
   const gte=url.searchParams.get('due_date');if(gte?.startsWith('gte.')&&Date.parse(gte.slice(4))>Date.parse(item.due_date))data=[];
  }else if(path==='/rest/v1/clients'){
   const client={id:owner,user_id:owner,name:'Cliente fictício',status:'Ativo',created_at:user.created_at};
   data=route.request().headers().accept?.includes('pgrst.object')?client:[client];
  }
  await route.fulfill({status:200,json:data,headers:{'content-range':'0-0/0'}});
 });
 await page.goto('/login',{waitUntil:'domcontentloaded'});await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaDeTeste123!');await page.getByRole('button',{name:/entrar/i}).click();await expect(page).toHaveURL(/dashboard$/);
 return state;
}

for(const width of [390,1366])test(`juros zero informa o cálculo efetivo sem alterar a dívida em ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const state=await backend(page);state.dailyRate=0;
 await page.goto(`/clientes/${owner}`);await page.getByTitle('Editar empréstimo',{exact:true}).first().click();
 const dialog=page.getByRole('dialog',{name:'Editar Empréstimo'});
 await expect(dialog.getByRole('note')).toContainText('0 ou vazio usa 4% de juros ao dia');
 await dialog.getByRole('spinbutton',{name:'Juros de atraso ao dia'}).fill('0.5');
 await expect(dialog.getByRole('note')).toContainText('0,5% ao dia');
 await expect(dialog.getByRole('note')).not.toContainText('0 ou vazio');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 await expect(dialog).not.toBeVisible();expect(state.writes).toEqual([]);
});
test('painel mantém recebido, lucro e principal comprovados depois da conclusão',async({page})=>{
 const state=await backend(page);
 const total=page.getByRole('button').filter({has:page.getByText('Total Recebido',{exact:true})});await expect(total).toContainText('100,00');
 await expect(page.getByRole('button').filter({has:page.getByText('Capital na Rua',{exact:true})})).toContainText('920,00');
 await expect(page.getByRole('button').filter({has:page.getByText('Lucro Gerado',{exact:true})})).toContainText('20,00');
 await expect(page.getByText('+R$ 60,00 hoje',{exact:true})).toBeVisible();
 state.status='completed';await page.reload();await expect(total).toContainText('100,00');await expect(page.getByRole('button').filter({has:page.getByText('Capital na Rua',{exact:true})})).toContainText('920,00');
});
test('Hoje usa o caixa canônico e WhatsApp manual usa somente o saldo cotado',async({page})=>{
 await backend(page);await page.addInitScript(()=>{window.open=((url:any)=>{(window as any).__auditWhatsapp=String(url);return null;}) as any;});
 await page.goto('/hoje');await expect(page.getByText(/Caixa/).filter({hasText:'-900,00'})).toBeVisible();
 await page.getByRole('button',{name:'Cobrar Cliente fictício pelo WhatsApp',exact:true}).click();
 const url=await page.evaluate(()=>(window as any).__auditWhatsapp);expect(new URL(url).searchParams.get('text')).toContain('64,00');
});
test('Análises e Relatórios não atribuem o parcial antigo ao mês de quitação',async({page})=>{
 await backend(page);await page.goto('/analises');await expect(page.getByRole('button').filter({hasText:'Recebido no período'})).toContainText('60,00');
 await page.goto('/relatorios');await expect(page.getByLabel('Mês do relatório')).toHaveValue('2026-08');
 await expect(page.getByText('Recebido',{exact:true}).locator('..').locator('..')).toContainText('60,00');
 await page.getByLabel('Mês do relatório').fill('2026-07');await expect(page.getByText('Recebido',{exact:true}).locator('..').locator('..')).toContainText('40,00');
});
test('filtro Hoje acompanha a virada brasileira com a tela aberta',async({page})=>{
 await backend(page);await page.clock.install({time:new Date('2026-08-31T23:59:50-03:00')});
 await page.goto('/analises');await page.getByRole('button',{name:'Hoje',exact:true}).click();
 const received=page.getByRole('button').filter({hasText:'Recebido no período'});await expect(received).toContainText('60,00');
 await page.clock.runFor(70000);await expect(received).toContainText('0,00');
 await expect(received).not.toContainText('60,00');
});
for(const width of [390,1366])test(`detalhes do cliente usam caixa comprovado e gráfico real em ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});const state=await backend(page);await page.goto(`/clientes/${owner}`);
 const summary=page.getByRole('region',{name:'Resumo financeiro'});
 const metric=(label:string)=>summary.locator('article').filter({has:page.getByText(label,{exact:true})});
 await expect(metric('Total recebido')).toContainText('100,00');await expect(metric('Capital em aberto')).toContainText('920,00');
 await expect(metric('Juros e encargos recebidos')).toContainText('20,00');await expect(metric('Saldo em aberto')).toContainText('64,00');
 const graph=page.getByRole('img',{name:'Recebimentos registrados nos últimos seis meses'});
 await expect(graph.locator('title')).toContainText('2026-07: R$ 40,00');await expect(graph.locator('title')).toContainText('2026-08: R$ 60,00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:testInfo.outputPath('client-cash-summary.png'),fullPage:true});
 state.status='completed';await page.reload();await expect(metric('Total recebido')).toContainText('100,00');await expect(metric('Capital em aberto')).toContainText('920,00');await expect(metric('Saldo em aberto')).toContainText('0,00');
});
