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
it.each(['Load failed','TypeError: Load failed','The Internet connection appears to be offline.'])('recognizes Safari network failures: %s',message=>{
 vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 expect(isTemporaryAuthFailure({message,status:0})).toBe(true);
 expect(authFailureMessage({message,status:0})).toContain('servidor');
});
it.each([401,403,429])('Safari messages do not override HTTP access decisions: %s',status=>{
 expect(isTemporaryAuthFailure({message:'Load failed',status})).toBe(false);
});
it('does not classify arbitrary loading or application errors as network failures',()=>{
 expect(isTemporaryAuthFailure(new TypeError('Cannot read properties of undefined'))).toBe(false);
 expect(isTemporaryAuthFailure(new Error('Profile load failed validation'))).toBe(false);
});
