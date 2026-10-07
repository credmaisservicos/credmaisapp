import { beforeEach,afterEach, describe, expect, it,vi } from "vitest";
import { clearPortalSession, hasPortalSession,savePortalToken,endCreditorSessionForPortal,performFullPortalLogout,recordPortalLoginAttempt,isPortalLoginBlocked } from "@/lib/portalSession";
import {tabSessionStorage} from '@/lib/tabSessionStorage';
const api=vi.hoisted(()=>({getSession:vi.fn(),signOut:vi.fn(),remoteSignOut:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:api.getSession,signOut:api.signOut,admin:{signOut:api.remoteSignOut}}}}));

const KEY = "portal-cliente-session";

describe("sessão isolada do portal", () => {
  beforeEach(() => {
    vi.resetAllMocks();clearPortalSession();tabSessionStorage.removeItem('portal-cliente-attempts');
    tabSessionStorage.removeItem('cobrador-token');sessionStorage.clear();localStorage.clear();
    api.getSession.mockResolvedValue({data:{session:null}});api.signOut.mockResolvedValue({error:null});
    api.remoteSignOut.mockResolvedValue({error:null});
  });
  afterEach(()=>{vi.restoreAllMocks();});

  it("reconhece o token temporário salvo pelo PortalCliente", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ token: "550e8400-e29b-41d4-a716-446655440000" }));
    expect(hasPortalSession()).toBe(true);
  });

  it("não trata CPF legado ou conteúdo malformado como sessão", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ cpf: "12345678901" }));
    expect(hasPortalSession()).toBe(false);
    sessionStorage.setItem(KEY, JSON.stringify({ token: "token-invalido" }));
    expect(hasPortalSession()).toBe(false);
    sessionStorage.setItem(KEY, "{");
    expect(hasPortalSession()).toBe(false);
  });

  it("remove a sessão do portal", () => {
    sessionStorage.setItem(KEY, JSON.stringify({ token: "550e8400-e29b-41d4-a716-446655440000" }));
    clearPortalSession();
    expect(hasPortalSession()).toBe(false);
  });

  it('keeps a verified portal session and its guard working when storage is denied',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new DOMException('Blocked','SecurityError');});
    expect(savePortalToken('550e8400-e29b-41d4-a716-446655440000')).toBe(false);expect(hasPortalSession()).toBe(true);
    clearPortalSession();expect(hasPortalSession()).toBe(false);
  });
  it('never accepts an invalid token for persistence',()=>{
    expect(()=>savePortalToken('invalid')).toThrow();expect(hasPortalSession()).toBe(false);
  });
  it('coalesces portal entry cleanup and signs out only this browser session',async()=>{
    api.getSession.mockResolvedValue({data:{session:{access_token:'isolated-test'}}});
    await Promise.all([endCreditorSessionForPortal(),endCreditorSessionForPortal()]);
    expect(api.getSession).toHaveBeenCalledTimes(1);expect(api.signOut).toHaveBeenCalledExactlyOnceWith({scope:'local'});
    expect(api.remoteSignOut).toHaveBeenCalledExactlyOnceWith('isolated-test','local');
  });
  it('full portal logout clears in-memory credentials without a global signout retry',async()=>{
    api.getSession.mockResolvedValue({data:{session:{access_token:'isolated-test'}}});api.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
    savePortalToken('550e8400-e29b-41d4-a716-446655440000');tabSessionStorage.setItem('cobrador-token','isolated-collector');
    await performFullPortalLogout();expect(hasPortalSession()).toBe(false);expect(tabSessionStorage.getItem('cobrador-token')).toBeNull();
    expect(api.signOut).toHaveBeenCalledExactlyOnceWith({scope:'local'});
  });
  it('retains the secondary attempt limit even when browser storage is blocked',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
    for(let i=0;i<8;i++)recordPortalLoginAttempt(false);
    expect(isPortalLoginBlocked()).toEqual({blocked:true,waitSec:900});
    recordPortalLoginAttempt(true);expect(isPortalLoginBlocked().blocked).toBe(false);
  });
});
