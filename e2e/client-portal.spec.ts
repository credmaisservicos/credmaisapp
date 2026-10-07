import {expect,test} from '@playwright/test';

const client={id:'client-test',name:'Maria Teste'};
const portal={client,session_token:'portal-session-test',owner:{name:'Empresa teste'},branding:{company_name:'Empresa teste',portal_contact_email:'atendimento@example.invalid'},contracts:[{
  id:'contract-test',capital:200,total_amount:220,total_interest:20,interest_rate:10,num_installments:2,installment_amount:110,status:'active',frequency:'monthly',start_date:'2026-01-01',daily_interest_percent:0,
  installments:[{id:'open-test',installment_number:2,amount:110,paid_amount:10,status:'pending',due_date:'2099-01-01'},
    {id:'paid-test',installment_number:1,amount:110,paid_amount:110,status:'paid',due_date:'2026-01-01',paid_at:'2026-01-01'}],
}]};

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
    await page.goto('/login');
    await expect(page.getByLabel(/e-?mail/i)).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-client-portal-theme');
  });
}
