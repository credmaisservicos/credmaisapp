import {expect,test,type Page} from '@playwright/test';
test.use({serviceWorkers:'block'});
const user={id:'11111111-1111-4111-8111-111111111111',email:'bot@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
async function setup(page:Page,failSettings=false){
  await page.routeWebSocket('**',socket=>socket.close());
  let settings:any={id:'settings-test',user_id:user.id,bot_enabled:true,bot_auto_send:false,bot_retry_interval_hours:24,bot_send_hour:9,bot_send_minute:7,bot_work_days:['mon','tue','wed','thu','fri'],bot_escalation_rules:[{days:-3,channel:'whatsapp',template:''}],company_name:'Empresa teste'};
  const writes:any[]=[];const origin=new URL(process.env.VITE_SUPABASE_URL || 'https://supabase-not-configured.invalid').origin;
  await page.route(`${origin}/**`,async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;let data:unknown=[];
    if(path==='/auth/v1/token'){const exp=Math.floor(Date.now()/1000)+3600,b64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');data={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,exp,role:'authenticated'})}.test`,refresh_token:'test-refresh',token_type:'bearer',expires_in:3600,expires_at:exp,user};}
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/profiles')data={...user,name:'Conta teste',subscription_type:'lifetime',plan_tier:'completo',is_blocked:false,onboarding_completed_at:'2026-01-01T00:00:00Z'};
    else if(path==='/rest/v1/rpc/is_admin')data=false;
    else if(path==='/rest/v1/platform_settings')data={maintenance_mode:false};
    else if(path==='/rest/v1/settings_safe'){if(failSettings){await route.fulfill({status:503,json:{message:'Unavailable'}});return;}data=settings;}
    else if(path==='/rest/v1/settings'&&request.method()==='PATCH'){writes.push(request.postDataJSON());settings={...settings,...request.postDataJSON()};data={id:settings.id};}
    else if(path==='/functions/v1/whatsapp-health')data={webhook_ready:true,cron_ready:true,connection:'disconnected',ai_ready:false};
    await route.fulfill({status:200,json:data,headers:{'content-range':'*/0'}});
  });
  await page.goto('/login');await page.getByLabel(/e-?mail/i).fill(user.email);await page.getByLabel(/senha/i).first().fill('SenhaDeTeste123!');await page.getByRole('button',{name:/entrar/i}).click();await expect(page).toHaveURL(/dashboard$/);
  return {writes};
}
for(const width of [360,1366])test(`módulo único: navegação, revisão e salvamento em ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const {writes}=await setup(page);
  await page.goto('/comunicacao?tab=overview');
  await page.getByRole('tab',{name:'Configurações',exact:true}).click();await expect(page).toHaveURL(/tab=cobrancas/);
  await expect(page.getByRole('heading',{name:'Agente e cobranças',exact:true})).toBeVisible();
  await expect(page.getByLabel('Horário da cobrança',{exact:true})).toHaveValue('09:07');
  await page.getByLabel('Intervalo entre cobranças (h)',{exact:true}).fill('72');await page.getByRole('button',{name:'Salvar alterações',exact:true}).first().click();
  await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({bot_retry_interval_hours:72});
  await expect(page.getByText('Agente e cobranças atualizados',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel('Intervalo entre cobranças (h)',{exact:true})).toHaveValue('72');
  await page.getByRole('tab',{name:'Revisões',exact:true}).click();await expect(page).toHaveURL(/tab=revisoes/);await expect(page.getByRole('heading',{name:'Agente IA',exact:true})).toHaveCount(0);
  await page.getByRole('tab',{name:'Configurações',exact:true}).click();await expect(page).toHaveURL(/tab=cobrancas/);
  await page.getByText('Modelos de mensagem',{exact:true}).click();await expect(page.getByRole('heading',{name:'Templates de Mensagem',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);
});
test('configurações indisponíveis não permitem salvar valores padrão',async({page})=>{
  const {writes}=await setup(page,true);await page.goto('/comunicacao?tab=cobrancas');
  await expect(page.getByRole('alert').filter({hasText:'Não foi possível carregar as configurações'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Salvar alterações',exact:true})).toHaveCount(0);expect(writes).toEqual([]);
});
test('link antigo de conversas mantém o módulo e a aba correta',async({page})=>{
  await setup(page);await page.goto('/comunicacao/inbox');await expect(page).toHaveURL(/comunicacao\?tab=inbox/);await expect(page.getByRole('tab',{name:'Conversas',exact:true})).toHaveAttribute('data-state','active');
});
