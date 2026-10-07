import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {OnboardingTourAuto} from '@/components/onboarding/OnboardingTour';

const api=vi.hoisted(()=>({user:{id:'account-b'} as {id:string}|null,read:vi.fn(),update:vi.fn()}));
let accountNumber=0;
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:api.user})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({
 select:()=>({eq:()=>({maybeSingle:api.read})}),update:api.update,
})}}));
beforeEach(()=>{
 vi.useFakeTimers();vi.resetAllMocks();api.user={id:`account-b-${++accountNumber}`};localStorage.clear();
 api.read.mockResolvedValue({data:{onboarding_completed_at:null},error:null});
 api.update.mockReturnValue({eq:vi.fn().mockResolvedValue({error:null})});
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();localStorage.clear();});
const open=async()=>{const view=render(<OnboardingTourAuto/>);await act(async()=>{await vi.advanceTimersByTimeAsync(0);});return view;};
it('a legacy completion from another account does not complete the current account',async()=>{
 localStorage.setItem('sj_onboarding_completed_v1','1');localStorage.setItem('sj_onboarding_completed_v1_account-a','1');
 await open();await act(async()=>{await vi.advanceTimersByTimeAsync(1200);});
 expect(screen.getByText('Bem-vindo ao CREDMAIS APP! 👋')).toBeVisible();expect(api.update).not.toHaveBeenCalled();
});
it('server completion does not interrupt the app when caching is denied',async()=>{
 api.read.mockResolvedValue({data:{onboarding_completed_at:'2026-01-01'},error:null});
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
 await open();await act(async()=>{await vi.advanceTimersByTimeAsync(1200);});
 expect(screen.queryByText('Bem-vindo ao CREDMAIS APP! 👋')).toBeNull();expect(api.update).not.toHaveBeenCalled();
});
it('leaving the account cancels a pending tour and closes an existing tour',async()=>{
 const user=api.user;const view=await open();expect(vi.getTimerCount()).toBe(1);
 api.user=null;view.rerender(<OnboardingTourAuto/>);expect(vi.getTimerCount()).toBe(0);
 api.user=user;view.rerender(<OnboardingTourAuto/>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
 await act(async()=>{await vi.advanceTimersByTimeAsync(1200);});expect(screen.getByText('Bem-vindo ao CREDMAIS APP! 👋')).toBeVisible();
 api.user=null;view.rerender(<OnboardingTourAuto/>);expect(screen.queryByText('Bem-vindo ao CREDMAIS APP! 👋')).toBeNull();
});
