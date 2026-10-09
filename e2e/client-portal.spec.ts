import {expect,test} from '@playwright/test';
test.use({serviceWorkers:'block',timezoneId:'America/Sao_Paulo'});

const client={id:'client-test',name:'Maria Teste'};
for(const allowed of [true,false])test(`comprovante por caminho exige autorização renovada (${allowed?'permitido':'recusado'})`,async({page})=>{
 test.skip(!process.env.E2E_BASE_URL?.startsWith('http://127.0.0.1'),'Only isolated backend');
 const clientId='11111111-1111-4111-8111-111111111111';
 const path=`portal-receipts/${clientId}/receipt.pdf`,origin='https://credmais-e2e.supabase.co';
 const signed=origin+'/storage/v1/object/sign/uploads/'+path+'?token=fresh-test-signature';
 const requests:any[]=[],files:string[]=[],writes:string[]=[];
 await page.routeWebSocket('**',socket=>socket.close());
 await page.context().route(origin+'/**',async route=>{
  const request=route.request(),url=new URL(request.url());let data:unknown=[];
  if(url.pathname.endsWith('/portal_login_by_token'))data={...portal,client:{...client,id:clientId},contracts:[{...portal.contracts[0],installments:[{...portal.contracts[0].installments[0],receipt_url:path}]}]};
  else if(url.pathname.endsWith('/functions/v1/upload-urls')){requests.push(request.postDataJSON());data={expires_in:300,urls:[allowed?signed:null]};}
  else if(url.pathname.includes('/storage/v1/object/')){files.push(request.url());await route.fulfill({status:200,contentType:'text/plain; charset=utf-8',body:'Comprovante fictício'});return;}
  if(['POST','PATCH','DELETE'].includes(request.method())&&/\/rest\/v1\/(transactions|contract_installments)$/.test(url.pathname))writes.push(url.pathname);
  await route.fulfill({status:200,json:data});
 });
 await page.goto('/portal-cliente?t='+portal.session_token);
 await page.getByRole('button',{name:/Abrir detalhes e pagar a parcela 2/}).click();
 const popupPromise=page.waitForEvent('popup');await page.getByRole('dialog').getByRole('link',{name:'Ver',exact:true}).click();const popup=await popupPromise;
 await expect.poll(()=>requests.length).toBe(1);
 expect(requests[0]).toEqual({references:[path],access:{kind:'portal',token:portal.session_token}});
 if(allowed){await expect(popup).toHaveURL(signed);await expect(popup.locator('body')).toContainText('Comprovante fictício');expect(files).toEqual([signed]);await popup.close();}
 else{await expect(page.getByText('Não foi possível abrir o arquivo',{exact:true})).toBeVisible();await expect.poll(()=>popup.isClosed()).toBe(true);expect(files).toEqual([]);}
 expect(writes).toEqual([]);
});
for(const [owner,label]of [['11111111-1111-4111-8111-111111111111','Empresa A'],['22222222-2222-4222-8222-222222222222','Empresa B']]){
 test(`portal preserva a empresa após sair e entrar novamente: ${label}`,async({page})=>{
  let scopedLogins=0,genericLogins=0;
  await page.routeWebSocket('**',socket=>socket.close());
  await page.route('https://credmais-e2e.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path.endsWith('/portal_client_login_for_owner')){
    scopedLogins++;expect(route.request().postDataJSON()._owner_id).toBe(owner);
    expect(route.request().postDataJSON()._cpf).toBe('11144477735');
   }else if(path.endsWith('/portal_client_login'))genericLogins++;
   await route.fulfill({status:200,json:/\/portal_(client_login_for_owner|login_by_token)$/.test(path)?{...portal,owner:{name:label},branding:{company_name:label}}:[]});
  });
  await page.goto('/portal-cliente?o='+owner);
  await page.getByLabel('Seu CPF',{exact:true}).fill('11144477735');
  await page.getByRole('button',{name:'Acessar o portal'}).click();
  await expect(page.getByRole('tab',{name:/Em aberto/})).toBeVisible();
  await page.getByRole('button',{name:'Sair com segurança'}).click();
  await expect(page).toHaveURL(new RegExp('portal-cliente\\?o='+owner+'&logout=1$'));
  await page.getByRole('button',{name:'Entrar novamente'}).click();
  await page.getByLabel('Seu CPF',{exact:true}).fill('11144477735');
  await page.getByRole('button',{name:'Acessar o portal'}).click();
  await expect(page.getByRole('tab',{name:/Em aberto/})).toBeVisible();
  expect(scopedLogins).toBe(2);expect(genericLogins).toBe(0);
 });
}
const portal={client,session_token:'550e8400-e29b-41d4-a716-446655440000',owner:{name:'Empresa teste'},branding:{company_name:'Empresa teste',portal_contact_email:'atendimento@example.invalid'},contracts:[{
  id:'contract-test',capital:200,total_amount:220,total_interest:20,interest_rate:10,num_installments:2,installment_amount:110,status:'active',frequency:'monthly',start_date:'2026-01-01',daily_interest_percent:0,
  installments:[{id:'open-test',installment_number:2,amount:110,paid_amount:10,status:'pending',due_date:'2099-01-01'},
    {id:'paid-test',installment_number:1,amount:110,paid_amount:110,status:'paid',due_date:'2026-01-01',paid_at:'2026-01-01'}],
}]};

test('valores do portal, PIX e PDFs respeitam parciais, encargos e cancelamentos',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:900});await page.clock.setFixedTime(new Date('2026-08-23T16:00:00-03:00'));
 await page.routeWebSocket('**',socket=>socket.close());
 const data={...portal,owner:{name:'Empresa fictícia',pix_key:'fictional@example.invalid'},contracts:[{
  ...portal.contracts[0],daily_interest_percent:1,daily_penalty_type:'fixed',daily_penalty_value:3,
  installments:[{id:'partial',installment_number:2,amount:100,paid_amount:40,status:'pending',due_date:'2026-08-21'},
   {id:'paid',installment_number:1,amount:110,paid_amount:110,status:'paid',due_date:'2026-08-01',paid_at:'2026-08-01'},
   {id:'cancelled',installment_number:3,amount:500,paid_amount:10,status:'cancelled',due_date:'2026-08-01'}],
 },{...portal.contracts[0],id:'cancelled-contract',status:'cancelled',installments:[{id:'cancelled-contract-row',installment_number:8,amount:900,paid_amount:20,status:'pending',due_date:'2026-08-01'}]}]};
 await page.route('https://credmais-e2e.supabase.co/**',route=>route.fulfill({status:200,json:new URL(route.request().url()).pathname.endsWith('/portal_login_by_token')?data:[]}));
 await page.goto('/portal-cliente?t=22222222-2222-4222-8222-222222222222');
 await expect(page.getByRole('tab',{name:/Em aberto/})).toContainText('1');
 await expect(page.getByRole('tabpanel').getByRole('button')).toHaveCount(1);
 await expect(page.locator('.portal-summary')).toContainText('R$ 180,00');
 await expect(page.getByText('R$ 68,01',{exact:true}).first()).toBeVisible();
 await expect(page.locator('.bento-hero')).toContainText('Vencida há 2 dia(s)');
 const statementPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Extrato PDF'}).click();
 const statement=await statementPromise;await statement.saveAs(testInfo.outputPath('financial-statement.pdf'));
 await page.getByRole('button',{name:/Abrir detalhes e pagar a parcela 2/}).click();
 await expect(page.getByRole('dialog')).toContainText('Você já pagou R$ 40,00');
 await expect(page.getByRole('dialog').getByText('R$ 68,01',{exact:true})).toBeVisible();
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new DOMException('Denied','NotAllowedError'))}}));
 await page.getByRole('button',{name:'Copiar código PIX',exact:true}).click();
 await expect(page.getByText('Não foi possível copiar',{exact:true})).toBeVisible();
 await expect(page.getByText('Código copiado!',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/avisar credor no WhatsApp/})).toHaveCount(0);
 await page.getByRole('button',{name:'Fechar',exact:true}).click();await page.getByRole('tab',{name:/Pagas/}).click();
 await page.getByRole('button',{name:/Ver pagamento a parcela 1/}).click();
 const receiptPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar recibo em PDF'}).click();
 const receipt=await receiptPromise;await receipt.saveAs(testInfo.outputPath('financial-receipt.pdf'));
});

test('parcelas do dia permanecem fora do atraso no portal do cobrador',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-08-23T22:00:00-03:00'));await page.routeWebSocket('**',socket=>socket.close());
 // O teste exerce o fuso brasileiro onde YYYY-MM-DD era interpretado como o dia anterior.
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('https://credmais-e2e.supabase.co/**',route=>route.fulfill({status:200,json:new URL(route.request().url()).pathname.endsWith('/collector_login_by_token')?{
  collector:{id:'collector-test',name:'Cobrador teste'},owner_id:'owner-test',owner:{name:'Empresa teste'},clients:[{id:'client-test',name:'Cliente fictício',installments:[
   {id:'today',installment_number:1,amount:100,paid_amount:40,status:'pending',due_date:'2026-08-23'},
   {id:'cancelled',installment_number:2,amount:900,paid_amount:0,status:'cancelled',due_date:'2026-08-01'},
  ]}],
 }:[]}));
 await page.goto('/cobrador-externo');await page.getByLabel(/token/i).fill('fictional-collector');await page.getByRole('button',{name:'Acessar Portal',exact:true}).click();
 await expect(page.getByText('Cobrador teste',{exact:true})).toBeVisible();
 await expect(page.getByText('R$ 40,00',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Atrasadas/}).click();await expect(page.getByText('Cliente fictício',{exact:true})).toHaveCount(0);
});

for(const width of [320,390,1366])for(const theme of ['light','dark'] as const) {
  test(`portal ${width}px ${theme}: readable payments and human contact without negotiation bot`,async({page},testInfo)=>{
    test.skip(!process.env.E2E_BASE_URL?.startsWith('http://127.0.0.1'),'Uses only isolated test backend');
    await page.setViewportSize({width,height:900});
    await page.addInitScript(initial=>{if(!localStorage.getItem('portal-cliente-theme'))localStorage.setItem('portal-cliente-theme',initial);},theme);
    let negotiationCalls=0;
    await page.route('**/functions/v1/client-negotiation',async route=>{negotiationCalls++;await route.abort();});
    await page.route('https://credmais-e2e.supabase.co/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(path.endsWith('/portal_login_by_token')?portal:[])});
    });
    await page.goto('/portal-cliente?t=22222222-2222-4222-8222-222222222222');
    await expect(page.getByRole('tab',{name:/Em aberto/})).toBeVisible();
    await expect(page.getByText('R$ 100,00',{exact:true}).first()).toBeVisible();
    await expect(page.getByRole('heading',{name:'Fale com a equipe'})).toBeVisible();
    await expect(page.getByText('Assistente de negociação',{exact:false})).toHaveCount(0);
    await expect(page.locator('textarea[name="negotiation_message"], input[name="negotiation_message"]')).toHaveCount(0);
    const appearance=await page.locator('.bento-hero').evaluate(el=>{
      const style=getComputedStyle(el),rgb=style.backgroundColor.match(/\d+/g);
      return {backgroundImage:style.backgroundImage,boxShadow:style.boxShadow,monochrome:rgb?.[0]===rgb?.[1]&&rgb?.[1]===rgb?.[2]};
    });
    expect(appearance).toEqual({backgroundImage:'none',boxShadow:'none',monochrome:true});
    const coloredText=await page.locator('.portal-shell .text-primary').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).color).filter(color=>{const rgb=color.match(/\d+/g);return rgb&&!(rgb[0]===rgb[1]&&rgb[1]===rgb[2]);}));
    expect(coloredText).toEqual([]);
    expect(await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:testInfo.outputPath(`portal-${width}-${theme}.png`),fullPage:true});
    await page.getByRole('button',{name:/Abrir detalhes e pagar a parcela/}).click();
    await expect(page.getByRole('dialog',{name:'Detalhes da parcela 2'})).toBeVisible();
    await expect(page.getByRole('dialog').getByText('R$ 100,00',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Fechar',exact:true}).click();
    await page.getByRole('tab',{name:/Pagas/}).click();
    await expect(page.getByRole('tabpanel')).toContainText('R$ 110,00');
    await page.getByRole('tab',{name:/Atrasadas/}).click();
    await expect(page.getByRole('tabpanel')).toContainText('Nenhuma parcela atrasada');
    await page.getByRole('button',{name:'Ver contatos',exact:true}).click();
    await expect(page.getByRole('link',{name:/E-mail/})).toHaveAttribute('href',/^mailto:atendimento@example.invalid/);
    await page.getByRole('button',{name:/Fechar ajuda/}).click();
    await page.getByRole('button',{name:theme==='dark'?'Ativar modo claro':'Ativar modo escuro'}).click();
    await expect(page.locator('html')).toHaveAttribute('data-client-portal-theme',theme==='dark'?'light':'dark');
    expect(await page.evaluate(()=>localStorage.getItem('portal-cliente-theme'))).toBe(theme==='dark'?'light':'dark');
    await page.reload();
    await expect(page.getByRole('tab',{name:/Em aberto/})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-client-portal-theme',theme==='dark'?'light':'dark');
    expect(negotiationCalls).toBe(0);
    // A real UUID session must keep creditor routes inaccessible until logout.
    await page.goto('/login');
    await expect(page).toHaveURL(/\/portal-cliente$/);
    await page.getByRole('button',{name:'Sair com segurança'}).click();
    await expect(page).toHaveURL(/portal-cliente\?logout=1/);
    await page.goto('/login');
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-client-portal-theme');
  });
}

for(const failure of ['quota','blocked']as const){
 test(`portal cliente com armazenamento ${failure}: CPF, isolamento e logout`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(failure=>{
   if(failure==='quota')Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
   else for(const name of ['sessionStorage','localStorage'])Object.defineProperty(window,name,{configurable:true,get(){throw new DOMException('Blocked','SecurityError');}});
  },failure);
  await page.route('https://credmais-e2e.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   await route.fulfill({status:200,json:/\/portal_(client_login|login_by_token)$/.test(path)?portal:[]});
  });
  await page.goto('/portal-cliente');await page.getByLabel('Seu CPF',{exact:true}).fill('11144477735');
  await page.getByRole('button',{name:'Acessar o portal'}).click();await expect(page.getByRole('tab',{name:/Em aberto/})).toBeVisible();
  await page.evaluate(()=>{history.pushState({},'', '/dashboard');dispatchEvent(new PopStateEvent('popstate'));});
  await expect(page).toHaveURL(/\/portal-cliente$/);await expect(page.getByRole('tab',{name:/Em aberto/})).toBeVisible();
  await page.getByRole('button',{name:'Sair com segurança'}).click();await expect(page).toHaveURL(/portal-cliente\?logout=1/);
  await page.goto('/login');await expect(page.getByLabel(/e-?mail/i)).toBeVisible();expect(errors).toEqual([]);
 });
 test(`portal cobrador com armazenamento ${failure}: entrar e sair sem travar`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.routeWebSocket('**',socket=>socket.close());
  await page.addInitScript(failure=>{
   if(failure==='quota')Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
   else Object.defineProperty(window,'sessionStorage',{configurable:true,get(){throw new DOMException('Blocked','SecurityError');}});
  },failure);
  await page.route('https://credmais-e2e.supabase.co/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   await route.fulfill({status:200,json:path.endsWith('/collector_login_by_token')?{collector:{id:'collector-test',name:'Cobrador teste'},owner_id:'owner-test',owner:{name:'Empresa teste'},clients:[]}:[]});
  });
  await page.goto('/cobrador-externo');await page.getByLabel(/token/i).fill('isolated-collector-token');
  await page.getByRole('button',{name:'Acessar Portal',exact:true}).click();await expect(page.getByText('Cobrador teste',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Sair do portal'}).click();await expect(page.getByLabel(/token/i)).toBeVisible();expect(errors).toEqual([]);
 });
}
