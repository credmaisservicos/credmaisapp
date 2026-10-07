import { afterEach,beforeEach, describe, expect, it,vi } from "vitest";
import {createRememberMeStorage} from "@/integrations/supabase/remember";

describe("remember me storage", () => {
  let rememberMeStorage:Storage,getRememberMe:()=>boolean,setRememberMe:(remember:boolean)=>void;
  afterEach(()=>vi.restoreAllMocks());
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    ({rememberMeStorage,getRememberMe,setRememberMe}=createRememberMeStorage());
  });

  it("moves the Supabase session when the preference changes", () => {
    localStorage.setItem("sb-test-auth-token", "persisted-session");

    setRememberMe(false);
    expect(getRememberMe()).toBe(false);
    expect(localStorage.getItem("sb-test-auth-token")).toBeNull();
    expect(sessionStorage.getItem("sb-test-auth-token")).toBe("persisted-session");

    setRememberMe(true);
    expect(getRememberMe()).toBe(true);
    expect(sessionStorage.getItem("sb-test-auth-token")).toBeNull();
    expect(localStorage.getItem("sb-test-auth-token")).toBe("persisted-session");
  });

  it("writes through to the currently selected storage", () => {
    setRememberMe(false);
    rememberMeStorage.setItem("sb-test-auth-token", "temporary-session");
    expect(sessionStorage.getItem("sb-test-auth-token")).toBe("temporary-session");
    expect(localStorage.getItem("sb-test-auth-token")).toBeNull();
  });
  it('keeps login usable when the browser cannot save the session',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Storage full','QuotaExceededError');});
    expect(()=>rememberMeStorage.setItem('sb-isolated-auth-token','new-session')).not.toThrow();
    expect(rememberMeStorage.getItem('sb-isolated-auth-token')).toBe('new-session');
  });
  it('honors the session-only preference when browser storage is blocked',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Blocked','SecurityError');});
    setRememberMe(false);expect(getRememberMe()).toBe(false);
  });
  it('can log in when the storage getters themselves are denied',()=>{
    const unavailable=()=>{throw new DOMException('Blocked','SecurityError');};
    const state=createRememberMeStorage(unavailable,unavailable);
    state.setRememberMe(false);state.rememberMeStorage.setItem('sb-test-auth-token','ephemeral');
    expect(state.isAuthSessionTemporary()).toBe(true);
    expect(state.getRememberMe()).toBe(false);expect(state.rememberMeStorage.getItem('sb-test-auth-token')).toBe('ephemeral');
    expect(state.rememberMeStorage.length).toBe(1);expect(state.rememberMeStorage.key(0)).toBe('sb-test-auth-token');
  });
  it('an unsaved new token takes precedence over an older disk session',()=>{
    localStorage.setItem('sb-test-auth-token','old-account');
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Quota','QuotaExceededError');});
    rememberMeStorage.setItem('sb-test-auth-token','new-account');expect(rememberMeStorage.getItem('sb-test-auth-token')).toBe('new-account');
  });
  it('failed removal cannot resurrect a logged-out session when storage recovers',()=>{
    localStorage.setItem('sb-test-auth-token','old-account');expect(rememberMeStorage.getItem('sb-test-auth-token')).toBe('old-account');
    const remove=vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
    rememberMeStorage.removeItem('sb-test-auth-token');remove.mockRestore();
    expect(rememberMeStorage.getItem('sb-test-auth-token')).toBeNull();setRememberMe(false);setRememberMe(true);
    expect(rememberMeStorage.getItem('sb-test-auth-token')).toBeNull();
  });
  it('logout removes duplicate copies from both storage preferences',()=>{
    localStorage.setItem('sb-test-auth-token','session');sessionStorage.setItem('sb-test-auth-token','stale-session');
    rememberMeStorage.removeItem('sb-test-auth-token');setRememberMe(false);
    expect(localStorage.getItem('sb-test-auth-token')).toBeNull();expect(sessionStorage.getItem('sb-test-auth-token')).toBeNull();expect(rememberMeStorage.getItem('sb-test-auth-token')).toBeNull();
  });
  it('observes a new login in another tab after a successful logout',()=>{
    rememberMeStorage.setItem('sb-test-auth-token','old');rememberMeStorage.removeItem('sb-test-auth-token');
    localStorage.setItem('sb-test-auth-token','fresh-from-another-tab');
    expect(rememberMeStorage.getItem('sb-test-auth-token')).toBe('fresh-from-another-tab');
  });
  it('migration to unavailable session storage retains the session in memory',()=>{
    localStorage.setItem('sb-test-auth-token','current');
    const denied=()=>{throw new DOMException('Blocked','SecurityError');};
    const state=createRememberMeStorage(()=>localStorage,denied);state.setRememberMe(false);
    expect(state.rememberMeStorage.getItem('sb-test-auth-token')).toBe('current');expect(localStorage.getItem('sb-test-auth-token')).toBeNull();
  });
  it('separate windows cannot reuse an in-memory session',()=>{
    const denied=()=>{throw new DOMException('Blocked','SecurityError');};const first=createRememberMeStorage(denied,denied);first.rememberMeStorage.setItem('sb-test-auth-token','private');
    expect(createRememberMeStorage(denied,denied).rememberMeStorage.getItem('sb-test-auth-token')).toBeNull();
  });
  it('clearing auth preserves unrelated app data and pending drafts',()=>{
    localStorage.setItem('client-draft','keep');localStorage.setItem('sb-test-auth-token','session');rememberMeStorage.clear();
    expect(localStorage.getItem('client-draft')).toBe('keep');expect(rememberMeStorage.getItem('sb-test-auth-token')).toBeNull();
  });
});
