import {afterEach,expect,it,vi} from 'vitest';
import {createTabSessionStorage} from '@/lib/tabSessionStorage';
afterEach(()=>{vi.restoreAllMocks();sessionStorage.clear();});
it('keeps the latest credential instead of a stale disk token after quota errors',()=>{
 const store=createTabSessionStorage();sessionStorage.setItem('private-token','old');
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
 expect(store.setItem('private-token','current')).toBe(false);expect(store.getItem('private-token')).toBe('current');
});
it('does not revive a token when removal is denied and storage later recovers',()=>{
 const store=createTabSessionStorage();store.setItem('private-token','old');
 const denied=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new DOMException('Blocked','SecurityError');});
 store.removeItem('private-token');denied.mockRestore();expect(store.getItem('private-token')).toBeNull();
 store.setItem('private-token','new');expect(store.getItem('private-token')).toBe('new');
});
it('read failures retain the last credential only in this tab',()=>{
 const store=createTabSessionStorage();store.setItem('private-token','current');
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new DOMException('Blocked','SecurityError');});
 expect(store.getItem('private-token')).toBe('current');expect(createTabSessionStorage().getItem('private-token')).toBeNull();
});
it('does not persist a credential if the sessionStorage accessor itself is blocked',()=>{
 const source=()=>{throw new DOMException('Blocked','SecurityError');};const store=createTabSessionStorage(source);
 store.setItem('private-token','current');expect(store.getItem('private-token')).toBe('current');
 expect(createTabSessionStorage(source).getItem('private-token')).toBeNull();store.removeItem('private-token');expect(store.getItem('private-token')).toBeNull();
});
