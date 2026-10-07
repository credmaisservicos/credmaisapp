import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const plugins = vi.hoisted(() => ({
  keyboard: vi.fn(async () => ({ remove: vi.fn() })),
  style: vi.fn(async () => {}),
  background: vi.fn(async () => {}),
  hide: vi.fn(async () => {}),
}));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: plugins.keyboard } }));
vi.mock('@capacitor/status-bar', () => ({ StatusBar: { setStyle: plugins.style, setBackgroundColor: plugins.background }, Style: { Dark: 'dark', Light: 'light' } }));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: plugins.hide } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('Capacitor', { getPlatform: () => 'android' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('libera a interface nativa mesmo quando o navegador bloqueia o armazenamento', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  const { iniciarShellNativo } = await import('@/lib/native');
  await expect(iniciarShellNativo()).resolves.toBeUndefined();
  expect(plugins.style).toHaveBeenCalledWith({ style: 'dark' });
  expect(plugins.hide).toHaveBeenCalledTimes(1);
});

it('mantém o tema salvo e inicializa o shell somente uma vez', async () => {
  localStorage.setItem('theme', 'light');
  const { iniciarShellNativo } = await import('@/lib/native');
  await iniciarShellNativo(); await iniciarShellNativo();
  expect(plugins.style).toHaveBeenCalledWith({ style: 'light' });
  expect(plugins.hide).toHaveBeenCalledTimes(1);
});

it('a falha de um plugin visual não impede a liberação da interface', async () => {
  plugins.keyboard.mockRejectedValueOnce(new Error('Plugin unavailable'));
  plugins.style.mockRejectedValueOnce(new Error('Plugin unavailable'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { iniciarShellNativo } = await import('@/lib/native');
  await expect(iniciarShellNativo()).resolves.toBeUndefined();
  expect(plugins.hide).toHaveBeenCalledTimes(1);
});
