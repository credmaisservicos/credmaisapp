import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block',viewport:{width:390,height:844}});
test('fontes externas demoradas não impedem abrir o formulário de acesso',async({page})=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});let requested=false;
 await page.route('https://fonts.googleapis.com/**',async route=>{requested=true;await pending;if(!page.isClosed())await route.fulfill({status:200,contentType:'text/css',body:'/* synthetic delayed font */'}).catch(()=>{});});
 const backend=new URL(process.env.VITE_SUPABASE_URL||'https://supabase-not-configured.invalid').origin;
 await page.route(`${backend}/**`,route=>route.fulfill({json:null}));
 await page.route('**/api/supabase/**',route=>route.fulfill({json:null}));
 try{
  await page.goto('/login',{waitUntil:'commit'});
  await expect(page.getByLabel(/e-?mail/i)).toBeVisible({timeout:5000});
  await expect(page.getByLabel(/senha/i).first()).toBeVisible();
  await expect.poll(()=>requested).toBe(true);
  // The font response is still held: these controls must be usable now.
  await page.getByLabel(/e-?mail/i).fill('ficticio@example.test');
  await expect(page.getByLabel(/e-?mail/i)).toHaveValue('ficticio@example.test');
 }finally{release();}
});
