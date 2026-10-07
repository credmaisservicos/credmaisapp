import {it,expect,vi,afterEach} from 'vitest';
import {authFailureMessage,isTemporaryAuthFailure} from '@/lib/authFailure';
afterEach(()=>vi.restoreAllMocks());
it.each([401,403,429])('does not retry an access denial or rate limit: %s',status=>expect(isTemporaryAuthFailure({status,message:'Failed to fetch'})).toBe(false));
it.each([502,503,504])('distinguishes server outages from internet loss: %s',status=>{
 expect(isTemporaryAuthFailure({status})).toBe(true);expect(authFailureMessage({status})).toContain('servidor');
});
it('only claims loss of internet when the browser reports offline',()=>{
 vi.spyOn(navigator,'onLine','get').mockReturnValue(true);expect(authFailureMessage(new TypeError('Failed to fetch'))).toContain('servidor');
 vi.spyOn(navigator,'onLine','get').mockReturnValue(false);expect(authFailureMessage(new TypeError('Failed to fetch'))).toContain('sem conexão');
});
it('expired refresh tokens ask for login again without retrying credentials',()=>{
 expect(isTemporaryAuthFailure({code:'refresh_token_not_found',message:'network'})).toBe(false);expect(authFailureMessage({code:'refresh_token_not_found'})).toContain('sessão expirou');
});
