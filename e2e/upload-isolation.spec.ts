import {test,expect} from '@playwright/test';
import proxy from '../public/_worker.js';
const html='<html><body>Arquivo fictício<script>document.documentElement.dataset.stolen=localStorage.getItem("file-isolation-sentinel");</script></body></html>';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="document.documentElement.dataset.stolen=localStorage.getItem(\'file-isolation-sentinel\')"><rect width="40" height="40" fill="black"/></svg>';
async function fileResponse(body:string,type:string){
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>new Response(body,{headers:{'Content-Type':type,'Content-Security-Policy':"default-src * 'unsafe-inline'"}});
 try{return await proxy.fetch(new Request('https://credmaisapp.com.br/api/supabase/storage/v1/object/sign/uploads/test/file?token=fictional'),{ASSETS:{fetch:async()=>new Response('unused')}});}
 finally{globalThis.fetch=previous;}
}
for(const [type,body]of [['text/html',html],['image/svg+xml',svg]]){
 test(`arquivo ${type} no proxy não executa scripts nem lê a sessão do app`,async({page})=>{
  const response=await fileResponse(body,type);
  await page.route('**/file-test-owner',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><body>App fictício</body></html>'}));
  await page.route('**/api/supabase/storage/**',route=>route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body}));
  await page.goto('/file-test-owner');
  await page.evaluate(()=>localStorage.setItem('file-isolation-sentinel','fictional-marker'));
  await page.goto('/api/supabase/storage/v1/object/sign/uploads/test/file?token=fictional');
  expect(await page.evaluate(()=>document.documentElement.getAttribute('data-stolen'))).toBe(null);
  expect(await page.evaluate(()=>{try{localStorage.getItem('file-isolation-sentinel');return false;}catch{return true;}})).toBe(true);
 });
}
test('imagem SVG autorizada continua renderizando sob isolamento do proxy',async({page})=>{
 const response=await fileResponse(svg,'image/svg+xml');
 await page.route('**/file-test-owner',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><body><img alt="Logo fictício" src="/api/supabase/storage/v1/object/sign/uploads/test/file?token=fictional"></body></html>'}));
 await page.route('**/api/supabase/storage/**',route=>route.fulfill({status:200,headers:Object.fromEntries(response.headers),body:svg}));
 await page.goto('/file-test-owner');
 await expect(page.getByAltText('Logo fictício')).toBeVisible();
 expect(await page.getByAltText('Logo fictício').evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBe(40);
});
