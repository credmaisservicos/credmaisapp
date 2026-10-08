import {emptyFinancialAnalyticsReport} from './helpers/financialAnalytics';
import {test,expect,type Page} from '@playwright/test';
import {emptyWalletCashReport} from './helpers/walletCash';
test.use({serviceWorkers:'block'});
const user={id:'11111111-1111-4111-8111-111111111111',email:'review@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const report={allocation_review_count:2,unallocated_received_total:100,overallocated_received_total:20,installments:[
 {id:'installment-1',client_id:user.id,installment_number:1,received:100,allocated:0,classified_profit:0,recorded_profit:0},
 {id:'installment-2',client_id:user.id,installment_number:2,received:50,allocated:70,classified_profit:10,recorded_profit:5},
]};
async function setup(page:Page,firstFailure=false){
 const origin=new URL(process.env.VITE_SUPABASE_URL||'https://supabase-not-configured.invalid').origin;
 const writes:string[]=[];let reviews=0;
 await page.routeWebSocket('**',socket=>socket.close());
 const handle=async(route:import('@playwright/test').Route)=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace(/^\/api\/supabase/,'');let data:unknown=[];
  if(path==='/auth/v1/token'){
   const exp=Math.floor(Date.now()/1000)+3600,b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
   data={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,exp,role:'authenticated'})}.test`,refresh_token:'fictional-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};
  }else if(path==='/auth/v1/user')data=user;
  else if(path==='/rest/v1/profiles')data={...user,name:'Fictício',subscription_type:'lifetime',is_blocked:false,onboarding_completed_at:'2026-01-01T00:00:00Z'};
  else if(path==='/rest/v1/rpc/is_admin')data=false; else if(path==='/rest/v1/rpc/financial_analytics_report') data=emptyFinancialAnalyticsReport();
  else if(path==='/rest/v1/rpc/wallet_cash_report')data=emptyWalletCashReport();
  else if(path==='/rest/v1/platform_settings')data={maintenance_mode:false,allow_new_registrations:true};
  else if(path==='/rest/v1/rpc/payment_allocation_review'){
   reviews++;expect(request.postDataJSON()||{}).toEqual({});
   if(firstFailure&&reviews===1){await route.fulfill({status:503,json:{message:'Unavailable'}});return;}
   data=report;
  }else if(['POST','PATCH','DELETE'].includes(request.method())&&/pay_installment|transactions|profits|contract_installments/.test(path))writes.push(path);
  await route.fulfill({status:200,json:data,headers:{'content-range':'*/0'}});
 };
 await page.route(`${origin}/**`,handle);await page.route('**/api/supabase/**',handle);
 await page.goto('/login');await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaFicticia123!');
 await page.getByRole('button',{name:/entrar/i}).click();await expect(page).toHaveURL(/dashboard$/);
 await page.goto('/carteira');return {writes,get reviews(){return reviews;}};
}
for(const width of [320,390,1366])test(`conferência financeira informa pendência sem alterar recebimentos em ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});const state=await setup(page);
 const section=page.getByRole('region',{name:'Conferência dos recebimentos'});
 await expect(section.getByText('2 parcela(s) com recebimentos para revisar')).toBeVisible();
 await expect(section.getByText('Sem classificação: R$ 100,00')).toBeVisible();
 await expect(section.getByText('Classificação acima do recebido: R$ 20,00')).toBeVisible();
 await expect(section.getByText('Lucro registrado: R$ 5,00 · composição registrada: R$ 10,00')).toBeVisible();
 await expect(section.getByRole('link',{name:'Ver cliente'}).first()).toHaveAttribute('href',`/clientes/${user.id}`);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await section.screenshot({path:testInfo.outputPath('allocation-review.png')});expect(state.writes).toEqual([]);
});
test('falha de conferência não mascara a pendência e permite repetir a leitura',async({page})=>{
 const state=await setup(page,true);
 await expect(page.getByText('Não foi possível conferir a classificação dos recebimentos.')).toBeVisible();
 await page.getByRole('button',{name:'Conferir novamente'}).click();
 await expect(page.getByText('2 parcela(s) com recebimentos para revisar')).toBeVisible();
 expect(state.reviews).toBe(2);expect(state.writes).toEqual([]);
});
