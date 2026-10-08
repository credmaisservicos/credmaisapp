import {expect,it} from 'vitest';
import {clientPortalUrl,publicAppOrigin} from '@/lib/publicAppLinks';
it('separa links de duas empresas, inclusive quando compartilham clientes com o mesmo CPF',()=>{
 expect(clientPortalUrl('company-a','https://app.example')).toBe('https://app.example/portal-cliente?o=company-a');
 expect(clientPortalUrl('company-b','https://app.example')).toBe('https://app.example/portal-cliente?o=company-b');
 expect(clientPortalUrl(null)).toBe('');
});
it('não compartilha o localhost ou protocolo da WebView como portal público',()=>{
 for(const origin of ['https://localhost','capacitor://localhost','http://127.0.0.1:5173','null'])
  expect(clientPortalUrl('owner',origin)).toBe('https://credmaisapp.com.br/portal-cliente?o=owner');
 expect(publicAppOrigin('https://empresa.example/path')).toBe('https://empresa.example');
});
