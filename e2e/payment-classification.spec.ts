import {test,expect,type Page,type Route} from '@playwright/test';
import {emptyWalletCashReport} from './helpers/walletCash';
import {emptyFinancialAnalyticsReport} from './helpers/financialAnalytics';
test.use({serviceWorkers:'block'});
const owner='11111111-1111-4111-8111-111111111111',receipt='22222222-2222-4222-8222-222222222222',installment='33333333-3333-4333-8333-333333333333';
const user={id:owner,email:'classification@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
async function setup(page:Page,mode:'normal'|'lost'|'cancel'|'mismatch'='normal'){
 const origin=new URL(process.env.VITE_SUPABASE_URL||'https://supabase-not-configured.invalid').origin;
 const writes:{path:string;args:Record<string,unknown>}[]=[];let applied=false,cancelled=false,applications=0;
 await page.routeWebSocket('**',socket=>socket.close());
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 const handle=async(route:Route)=>{
  const req=route.request(),path=new URL(req.url()).pathname.replace(/^\/api\/supabase/,'');let data:unknown=[];
  if(path==='/auth/v1/token'){
   const exp=Math.floor(Date.now()/1000)+3600,b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
   data={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:owner,exp,role:'authenticated'})}.test`,refresh_token:'fictional-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};
  }else if(path==='/auth/v1/user')data=user;
  else if(path==='/rest/v1/profiles')data={...user,name:'Fictício',subscription_type:'lifetime',is_blocked:false,onboarding_completed_at:'2026-01-01T00:00:00Z'};
  else if(path==='/rest/v1/platform_settings')data={maintenance_mode:false,allow_new_registrations:true};
  else if(path==='/rest/v1/rpc/is_admin')data=false;
  else if(path==='/rest/v1/rpc/wallet_cash_report')data=emptyWalletCashReport();
  else if(path==='/rest/v1/rpc/financial_analytics_report')data=emptyFinancialAnalyticsReport();
  else if(path==='/rest/v1/rpc/payment_allocation_review')data={allocation_review_count:applied?0:1,unallocated_received_total:applied?0:100,overallocated_received_total:0,installments:applied?[]:[{id:installment,client_id:owner,installment_number:2,received:100,allocated:0}]};
  else if(path==='/rest/v1/rpc/payment_classification_detail')data={version:'c'.repeat(32),can_reconcile:mode!=='mismatch',installment:{id:installment,paid_amount:mode==='mismatch'?120:100},transactions:[{id:receipt,amount:100,date:'2026-01-02T12:00:00Z',principal:0,interest:0,fees:0,unallocated:100}],history:[]};
  else if(path==='/rest/v1/rpc/reclassify_payment_receipt'){
   const args=req.postDataJSON();writes.push({path,args});
   if(cancelled){await route.fulfill({status:400,json:{code:'P0001',message:'classification_cancelled'}});return;}
   const replayed=applied;
   if(mode!=='cancel'&&!applied){applied=true;applications++;}
   if(writes.filter(w=>w.path===path).length===1&&(mode==='lost'||mode==='cancel')){await route.fulfill({status:503,json:{message:'Resposta fictícia perdida'}});return;}
   data={ok:true,request_id:args._request_id,replayed};
  }else if(path==='/rest/v1/rpc/cancel_payment_classification'){
   const args=req.postDataJSON();writes.push({path,args});cancelled=!applied;data={ok:true,request_id:args._request_id,cancelled,replayed:applied};
  }else if(['POST','PATCH','DELETE'].includes(req.method())&&/transactions|profits|contract_installments|pay_installment/.test(path))writes.push({path,args:req.postDataJSON()});
  await route.fulfill({status:200,json:data,headers:{'content-range':'*/0'}});
 };
 await page.route(`${origin}/**`,handle);await page.route('**/api/supabase/**',handle);
 await page.goto('/login');await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaFicticia123!');
 await page.getByRole('button',{name:/entrar/i}).click();await expect(page).toHaveURL(/dashboard$/);await page.goto('/carteira');
 await page.getByRole('button',{name:'Conferir recebimentos'}).click();await expect(page.getByRole('dialog')).toBeVisible();
 return {writes,get applications(){return applications;},get cancelled(){return cancelled;}};
}
async function fill(page:Page){
 await page.getByLabel('Recebimento',{exact:true}).selectOption(receipt);
 await page.getByLabel('Capital',{exact:true}).fill('80,00');await page.getByLabel('Juros',{exact:true}).fill('15,00');await page.getByLabel('Encargos',{exact:true}).fill('5,00');
 await page.getByLabel('Motivo da correção').fill('Conferência humana fictícia do recebimento');
 await page.getByLabel('Referência do extrato ou comprovante').fill('Extrato fictício TESTE-001');
 await page.getByRole('checkbox').check();
}
for(const width of [320,1366])test(`conferência exige valores exatos e evidência em ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const state=await setup(page);await fill(page);
 const save=page.getByRole('button',{name:'Salvar classificação'});
 await page.getByLabel('Encargos',{exact:true}).fill('4,99');await page.getByRole('checkbox').check();await expect(save).toBeDisabled();
 expect(state.writes).toHaveLength(0);
 await page.getByLabel('Encargos',{exact:true}).fill('5,00');await expect(save).toBeDisabled();await page.getByRole('checkbox').check();
 await expect(save).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.getByRole('dialog').screenshot({path:info.outputPath('classification.png')});
 await save.click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(state.applications).toBe(1);expect(state.writes).toHaveLength(1);
 expect(state.writes[0].args).toMatchObject({_expected_owner:owner,_transaction_id:receipt,_principal:80,_interest:15,_fees:5,_confirmed:true});
 expect(state.writes[0].args).not.toHaveProperty('_amount');expect(state.writes[0].args).not.toHaveProperty('_date');
});
test('resposta perdida sobrevive à recarga e reaproveita o mesmo envio',async({page})=>{
 const state=await setup(page,'lost');await fill(page);await page.getByRole('button',{name:'Salvar classificação'}).click();
 await expect(page.getByRole('button',{name:'Verificar e concluir'})).toBeEnabled();expect(state.writes).toHaveLength(1);
 await page.reload();await page.getByRole('button',{name:'Verificar classificação pendente'}).click();
 await expect(page.getByRole('button',{name:'Verificar e concluir'})).toBeEnabled();expect(state.writes).toHaveLength(1);
 await page.getByRole('button',{name:'Verificar e concluir'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(state.writes).toHaveLength(2);expect(state.writes[0].args).toEqual(state.writes[1].args);expect(state.applications).toBe(1);
});
test('encerrar um envio não confirmado protege contra chegada tardia',async({page})=>{
 const state=await setup(page,'cancel');await fill(page);await page.getByRole('button',{name:'Salvar classificação'}).click();
 await page.getByRole('button',{name:'Encerrar tentativa'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(state.cancelled).toBe(true);expect(state.applications).toBe(0);expect(state.writes).toHaveLength(2);
 expect(state.writes[1].args._request_id).toBe(state.writes[0].args._request_id);
});
test('diferença entre parcela e caixa bloqueia edição sem inventar dinheiro',async({page})=>{
 const state=await setup(page,'mismatch');await expect(page.getByText(/total dos lançamentos não corresponde/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Salvar classificação'})).toHaveCount(0);expect(state.writes).toHaveLength(0);
});
