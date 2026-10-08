import {expect,it} from 'vitest';
import {uploadPath,uploadReference,validUploadPath} from '../../supabase/functions/_shared/upload_reference';
const origin='https://uploads.test.invalid';
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
