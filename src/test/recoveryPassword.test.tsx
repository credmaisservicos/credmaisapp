import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import ResetPassword from '@/pages/ResetPassword';
const api=vi.hoisted(()=>({request:vi.fn(),update:vi.fn(),signOut:vi.fn(),toast:vi.fn(),native:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{resetPasswordForEmail:api.request,updateUser:api.update,signOut:api.signOut,onAuthStateChange:()=>({data:{subscription:{unsubscribe:vi.fn()}}})}}}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:api.toast})}));
vi.mock('@/contexts/WhiteLabelContext',()=>({useWhiteLabel:()=>({config:{companyName:'Teste',companyLogo:null}})}));
vi.mock('@/components/ConstellationBackground',()=>({default:()=>null}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>api.native}}));
const open=async(recovery=false,next='')=>{
 window.history.replaceState({},'',`/reset-password${recovery?'#type=recovery':''}`);
 render(<MemoryRouter initialEntries={['/reset-password'+next]}><ResetPassword/></MemoryRouter>);
 await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
};
const request=async()=>{fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'isolated@example.test'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/enviar link/i}));});};
const expireCooldown=async()=>{for(let i=0;i<45;i++)await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});};
const update=async()=>{
 fireEvent.change(screen.getByLabelText('Nova senha'),{target:{value:'IsolatedPassword123!'}});
 fireEvent.change(screen.getByLabelText('Confirmar senha'),{target:{value:'IsolatedPassword123!'}});
 await act(async()=>{fireEvent.submit(screen.getByLabelText('Nova senha').closest('form')!);});
};
beforeEach(()=>{
 vi.useFakeTimers();vi.resetAllMocks();api.native=false;
 api.request.mockResolvedValue({error:null});api.update.mockResolvedValue({error:null});api.signOut.mockResolvedValue({error:null});
 vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();window.history.replaceState({},'','/');});
it('request exceptions restore the form and never announce an email that failed',async()=>{
 api.request.mockRejectedValueOnce(new TypeError('Failed to fetch'));await open();await request();
 expect(screen.getByRole('button',{name:/enviar link/i})).toBeEnabled();expect(screen.queryByText('Verifique seu e-mail')).toBeNull();
 expect(api.toast).toHaveBeenLastCalledWith(expect.objectContaining({title:'Conexão indisponível',variant:'destructive'}));
 await request();expect(screen.getByText('Verifique seu e-mail')).toBeVisible();expect(api.request).toHaveBeenCalledTimes(2);
});
it('request timeouts end the spinner without duplicating or claiming a send',async()=>{
 api.request.mockReturnValue(new Promise(()=>{}));await open();await request();
 expect(screen.getByRole('button',{name:'Enviando…'})).toBeDisabled();
 await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
 expect(screen.getByRole('button',{name:/enviar link/i})).toBeEnabled();expect(api.request).toHaveBeenCalledTimes(1);expect(screen.queryByText('Verifique seu e-mail')).toBeNull();
});
it('initial email send starts the resend cooldown',async()=>{
 await open();await request();expect(screen.getByRole('button',{name:/aguarde 45s/i})).toBeDisabled();
 await expireCooldown();expect(screen.getByRole('button',{name:/reenviar link/i})).toBeEnabled();
});
it.each(['exception','timeout'])('a resend %s releases the button and retains the previous confirmation',async failure=>{
 await open();await request();await expireCooldown();
 if(failure==='exception')api.request.mockRejectedValueOnce(new TypeError('Failed to fetch'));else api.request.mockReturnValueOnce(new Promise(()=>{}));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:/reenviar link/i}));if(failure==='timeout')await vi.advanceTimersByTimeAsync(15_000);});
 expect(screen.getByText('Verifique seu e-mail')).toBeVisible();expect(screen.getByRole('button',{name:/reenviar link/i})).toBeEnabled();expect(api.request).toHaveBeenCalledTimes(2);
});
it('double submission makes only one email request',async()=>{
 api.request.mockReturnValue(new Promise(()=>{}));await open();
 fireEvent.change(screen.getByLabelText('E-mail'),{target:{value:'isolated@example.test'}});
 await act(async()=>{const form=screen.getByLabelText('E-mail').closest('form')!;fireEvent.submit(form);fireEvent.submit(form);});expect(api.request).toHaveBeenCalledTimes(1);
});
it('native recovery links use the public site and preserve a safe next route',async()=>{
 api.native=true;await open(false,'?next=%2Fclientes');await request();
 expect(api.request).toHaveBeenCalledWith('isolated@example.test',{redirectTo:'https://credmaisapp.com.br/reset-password?next=%2Fclientes'});
});
it.each(['same_password','weak_password','validation_failed'])('password rejection %s keeps the recovery session usable',async code=>{
 api.update.mockResolvedValueOnce({error:{code,status:422,message:code}});await open(true);await update();
 expect(screen.getByLabelText('Nova senha')).toBeVisible();expect(api.signOut).not.toHaveBeenCalled();expect(api.toast).toHaveBeenLastCalledWith(expect.objectContaining({variant:'destructive'}));
 await update();expect(api.update).toHaveBeenCalledTimes(2);expect(api.signOut).toHaveBeenCalledWith({scope:'local'});
});
it('password update timeout allows retry without claiming a saved password or ending the session',async()=>{
 api.update.mockReturnValue(new Promise(()=>{}));await open(true);await update();await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);});
 expect(screen.getByLabelText('Nova senha')).toBeVisible();expect(api.signOut).not.toHaveBeenCalled();expect(api.update).toHaveBeenCalledTimes(1);expect(api.toast).not.toHaveBeenCalledWith(expect.objectContaining({title:'✓ Senha atualizada'}));
});
it('expired recovery sessions are ended only in this browser session',async()=>{
 api.update.mockResolvedValue({error:{status:401,code:'no_session',message:'Auth session missing'}});await open(true);await update();
 expect(api.signOut).toHaveBeenCalledWith({scope:'local'});expect(screen.queryByLabelText('Nova senha')).toBeNull();expect(screen.getByText('Sessão expirou')).toBeVisible();
});
