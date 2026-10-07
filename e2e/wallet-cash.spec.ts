import {test,expect,type Page} from '@playwright/test';
import {emptyWalletCashReport} from './helpers/walletCash';
test.use({serviceWorkers:'block'});
const user={id:'11111111-1111-4111-8111-111111111111',email:'wallet@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
async function setup(page:Page,options:{fail?:boolean;paging?:boolean}={}){
 const requests:any[]=[],writes:string[]=[],errors:string[]=[];let failed=options.fail;
 page.on('pageerror',error=>errors.push(error.message));await page.routeWebSocket('**',socket=>socket.close());
 const origin=new URL(process.env.VITE_SUPABASE_URL||'https://supabase-not-configured.invalid').origin;
 const handle=async(route:import('@playwright/test').Route)=>{
  const req=route.request(),path=new URL(req.url()).pathname.replace(/^\/api\/supabase/,'');let data:unknown=[];
  if(path==='/auth/v1/token'){
   const exp=Math.floor(Date.now()/1000)+3600,b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
   data={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,exp,role:'authenticated'})}.test`,refresh_token:'fictional',expires_in:3600,expires_at:exp,token_type:'bearer',user};
  }else if(path==='/auth/v1/user')data=user;
  else if(path==='/rest/v1/profiles')data={...user,name:'Fictício',subscription_type:'lifetime',is_blocked:false,onboarding_completed_at:'2026-01-01T00:00:00Z'};
  else if(path==='/rest/v1/rpc/is_admin')data=false;
  else if(path==='/rest/v1/platform_settings')data={maintenance_mode:false};
  else if(path==='/rest/v1/rpc/payment_allocation_review')data={allocation_review_count:0,unallocated_received_total:0,overallocated_received_total:0,installments:[]};
  else if(path==='/rest/v1/rpc/wallet_cash_report'){
   const input=req.postDataJSON();requests.push(input);expect(Object.keys(input).sort()).toEqual(['_days','_limit','_offset','_search']);
   if(failed){await route.fulfill({status:503,json:{message:'Unavailable'}});return;}
   const report=emptyWalletCashReport();
   report.totals={...report.totals,inflows:110,receipts:110,principal:90,profit:10,unclassified:10,undated_amount:10,legacy_gap_amount:10,balance:110};
   report.warnings={...report.warnings,undated_amount:10,legacy_gap_amount:10};
   report.period={...report.period,inflows:input._days===7?60:110,opening_balance:input._days===7?50:0,closing_balance:110};
   const items=[{id:'transaction:a',type:'in' as const,desc:'Recebimento parcial antigo',amount:40,date:'2026-09-18T15:00:00Z',source:'Recebimento',removable:false,remove_id:null},
    {id:'transaction:b',type:'in' as const,desc:'Recebimento final',amount:60,date:'2026-10-07T15:00:00Z',source:'Recebimento',removable:false,remove_id:null},
    {id:'legacy:a',type:'in' as const,desc:'Recebimento histórico sem lançamento completo',amount:10,date:null,source:'Recebimento legado',removable:false,remove_id:null}];
   if(options.paging){report.timeline_count=101;report.timeline=Array.from({length:Math.min(50,101-input._offset)},(_,i)=>({...items[1],id:`t:${input._offset+i}`,desc:`Movimento ${input._offset+i+1}`}));}
   else {report.timeline=input._days===7?[items[1]]:items;report.timeline=report.timeline.filter(item=>item.desc.toLowerCase().includes(input._search.toLowerCase()));report.timeline_count=report.timeline.length;}
   data=report;
  }else if(['POST','PATCH','DELETE'].includes(req.method()) && /transactions|expenses|pay_installment|contract_installments/.test(path))writes.push(path);
  await route.fulfill({json:data});
 };
 await page.route(`${origin}/**`,handle);await page.route('**/api/supabase/**',handle);
 await page.goto('/login');await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaFicticia123!');
 await page.getByRole('button',{name:/entrar/i}).click();await expect(page).toHaveURL(/dashboard$/);await page.goto('/carteira');
 return {requests,writes,errors,recover(){failed=false;}};
}
for(const width of [320,390,1366])test(`carteira mostra caixa parcial e data desconhecida sem inventar recebimento em ${width}px`,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});const state=await setup(page);
 const closing=page.getByRole('region',{name:'Fechamento financeiro do período'});
 await expect(closing.getByText('R$ 110,00',{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('region',{name:'Conferência do caixa'})).toContainText('Sem data de recebimento: R$ 10,00');
 await expect(page.getByText('Data a conferir',{exact:true})).toBeVisible();await expect(page.getByText('Recebimento parcial antigo',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'7 dias',exact:true}).click();
 await expect(closing.getByText('R$ 60,00',{exact:true})).toBeVisible();await expect(closing.getByText('R$ 50,00',{exact:true})).toBeVisible();
 await expect(page.getByText('Recebimento parcial antigo',{exact:true})).toHaveCount(0);await expect(page.getByText('Data a conferir',{exact:true})).toHaveCount(0);
 expect(state.requests.every(r=>r._limit===50)).toBe(true);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
 await page.screenshot({path:testInfo.outputPath('wallet-cash.png'),fullPage:true});
});
test('busca não modifica os totais e histórico navega por páginas de 50',async({page})=>{
 const state=await setup(page,{paging:true});
 await expect(page.getByText('Página 1 de 3')).toBeVisible();await page.getByRole('button',{name:'Próxima',exact:true}).click();
 await expect(page.getByText('Página 2 de 3')).toBeVisible();expect(state.requests.at(-1)._offset).toBe(50);
 await page.getByRole('textbox',{name:'Buscar no histórico da carteira'}).fill('recebimento');
 await expect(page.getByText('Página 1 de 3')).toBeVisible();expect(state.requests.at(-1)._search).toBe('recebimento');expect(state.requests.at(-1)._offset).toBe(0);
 expect(state.writes).toEqual([]);
});
test('falha do resumo não mostra saldo zero e permite nova leitura',async({page})=>{
 const state=await setup(page,{fail:true});await expect(page.getByText('Não foi possível carregar a carteira')).toBeVisible({timeout:20000});
 await expect(page.getByText('Saldo Total',{exact:true})).toHaveCount(0);state.recover();await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
 await expect(page.getByText('Saldo Total',{exact:true})).toBeVisible();expect(state.writes).toEqual([]);
});
