import {expect,it} from 'vitest';
import {publicSignedUploadUrl,uploadPath,uploadReference,validUploadPath} from '../../supabase/functions/_shared/upload_reference';
const origin='https://uploads.test.invalid';
const owner='11111111-1111-4111-8111-111111111111';
it.each([
 `${owner}/comprovantes/receipt.pdf`,
 `portal-receipts/${owner}/receipt.pdf`,
 `client-docs/${owner}/documento março.pdf`,
])('renova identificador legado sem esquema: %s',path=>{
 expect(uploadPath(path,[origin])).toBe(path);
});
it.each(['portal-receipts/not-a-client/receipt.pdf',`${owner}/../other/file.pdf`,`${owner}/file?token=old`,`${owner}/%2e%2e/file.pdf`,'dashboard/receipt.pdf','//foreign.invalid/file.pdf'])('não confunde rota relativa ou caminho inseguro com anexo: %s',path=>{
 expect(uploadPath(path,[origin])).toBeNull();
});
it('persiste identificador sem token e preserva espaço e acentos do arquivo',()=>{
 const path='owner/documentos/comprovante março.pdf';const ref=uploadReference(path);
 expect(ref).toBe('storage://uploads/owner/documentos/comprovante%20mar%C3%A7o.pdf');
 expect(uploadPath(ref,[origin])).toBe(path);expect(ref).not.toContain('token');
});
it.each(['../other/file','owner/../other','owner//file','/owner/file','owner\\file','owner/%2e%2e/file','owner/file?token=1','owner/file\0'])('recusa caminho ambíguo ou traversal: %s',path=>{
 expect(validUploadPath(path)).toBe(false);expect(()=>uploadReference(path)).toThrow('invalid_upload_path');
});
it('lê referências anteriores sem confiar no token antigo',()=>{
 expect(uploadPath(origin+'/storage/v1/object/sign/uploads/owner/file.pdf?token=previous-long-lived-token',[origin])).toBe('owner/file.pdf');
});
it('não interpreta URL de terceiros, outras pastas ou credenciais como anexo local',()=>{
 for(const url of ['https://foreign.invalid/storage/v1/object/sign/uploads/owner/file.pdf',origin+'/storage/v1/object/sign/backups/owner/file.pdf','https://user:password@uploads.test.invalid/storage/v1/object/sign/uploads/file.pdf'])expect(uploadPath(url,[origin])).toBeNull();
});
it.each(['storage://uploads/owner/%ZZ','storage://uploads/owner/%2E%2E/file','storage://uploads/owner/%252e%252e/file'])('recusa referência mal codificada: %s',ref=>expect(uploadPath(ref,[origin])).toBeNull());
it('publica assinatura criada pelo gateway interno sem alterar caminho ou token',()=>{
 const path='/storage/v1/object/sign/uploads/owner/comprovante%20mar%C3%A7o.pdf?token=short-signature';
 expect(publicSignedUploadUrl('http://kong:8000'+path,origin,'http://kong:8000')).toBe(origin+path);
});
it('preserva prefixo do gateway público e assinaturas já públicas',()=>{
 const path='/storage/v1/object/sign/uploads/owner/file.pdf?token=signature';
 expect(publicSignedUploadUrl(origin+path,origin,'http://kong:8000')).toBe(origin+path);
 expect(publicSignedUploadUrl('http://kong:8000'+path,'https://app.test.invalid/api/supabase','http://kong:8000')).toBe('https://app.test.invalid/api/supabase'+path);
});
it.each(['https://foreign.invalid/storage/v1/object/sign/uploads/owner/file.pdf?token=x','http://kong:8000/storage/v1/object/public/uploads/owner/file.pdf','http://user:password@kong:8000/storage/v1/object/sign/uploads/owner/file.pdf','javascript:alert(1)'])('não publica assinatura de origem ou rota inesperada: %s',url=>{
 expect(publicSignedUploadUrl(url,origin,'http://kong:8000')).toBeNull();
});
