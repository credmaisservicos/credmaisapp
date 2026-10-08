import {expect,it} from 'vitest';
import {clientPortalUrl,clientPortalLogoutPath,publicAppOrigin} from '@/lib/publicAppLinks';
it('separa links de duas empresas, inclusive quando compartilham clientes com o mesmo CPF',()=>{
 expect(clientPortalUrl('company-a','https://app.example')).toBe('https://app.example/portal-cliente?o=company-a');
 expect(clientPortalUrl('company-b','https://app.example')).toBe('https://app.example/portal-cliente?o=company-b');
 expect(clientPortalUrl(null)).toBe('');
});
it('logout preserva a empresa e descarta token, CPF e parâmetros sem vínculo',()=>{
 const owner='11111111-1111-4111-8111-111111111111';
 expect(clientPortalLogoutPath('?o='+owner+'&t=private-token&cpf=private')).toBe('/portal-cliente?o='+owner+'&logout=1');
 expect(clientPortalLogoutPath('?t=private-token')).toBe('/portal-cliente?logout=1');
 expect(clientPortalLogoutPath('?o=invalid&t=private-token')).toBe('/portal-cliente?logout=1');
});
it('não compartilha o localhost ou protocolo da WebView como portal público',()=>{
 for(const origin of ['https://localhost','capacitor://localhost','http://127.0.0.1:5173','null'])
  expect(clientPortalUrl('owner',origin)).toBe('https://credmaisapp.com.br/portal-cliente?o=owner');
 expect(publicAppOrigin('https://empresa.example/path')).toBe('https://empresa.example');
});
