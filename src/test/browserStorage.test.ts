import {it,expect,vi,afterEach} from 'vitest';
import {readLocalPreference,writeLocalPreference} from '@/lib/browserStorage';
afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
it('reads optional preferences without throwing when storage access is blocked',()=>{
 vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new DOMException('Blocked','SecurityError');});expect(readLocalPreference('isolated-preference-1')).toBeNull();
});
it('a write failure retains the latest preference in this window instead of an old disk value',()=>{
 localStorage.setItem('isolated-preference-2','old');const blocked=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
 expect(writeLocalPreference('isolated-preference-2','latest')).toBe(false);expect(readLocalPreference('isolated-preference-2')).toBe('latest');
 blocked.mockRestore();expect(writeLocalPreference('isolated-preference-2','saved')).toBe(true);expect(readLocalPreference('isolated-preference-2')).toBe('saved');expect(localStorage.getItem('isolated-preference-2')).toBe('saved');
});
