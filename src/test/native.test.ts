import { afterEach, describe, expect, it } from "vitest";
import { isNativeApp, nativePlatform } from "@/lib/native";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  platform?: string;
};

const comCapacitor = (cap: CapacitorGlobal | undefined) => {
  if (cap === undefined) delete (globalThis as { Capacitor?: unknown }).Capacitor;
  else (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor = cap;
};

afterEach(() => comCapacitor(undefined));

describe("detecção do app nativo", () => {
  it("trata o navegador como web quando o Capacitor não injetou nada", () => {
    comCapacitor(undefined);
    expect(nativePlatform()).toBe("web");
    expect(isNativeApp()).toBe(false);
  });

  // Este é o caso que decidia errado: no APK o `pathname` é sempre "/", então
  // quem responde "é nativo?" define se o app abre na operação ou na landing.
  it("reconhece Android e iOS pelo global da WebView", () => {
    comCapacitor({ getPlatform: () => "android" });
    expect(nativePlatform()).toBe("android");
    expect(isNativeApp()).toBe(true);

    comCapacitor({ getPlatform: () => "ios" });
    expect(nativePlatform()).toBe("ios");
    expect(isNativeApp()).toBe(true);
  });

  // O Capacitor injeta `window.Capacitor` também no build web, e ali
  // `getPlatform()` responde "web". Confundir os dois traria de volta o bug:
  // o site abriria na área logada em vez da landing.
  it("não confunde o Capacitor rodando em web com o app nativo", () => {
    comCapacitor({ getPlatform: () => "web", isNativePlatform: () => false });
    expect(nativePlatform()).toBe("web");
    expect(isNativeApp()).toBe(false);
  });

  it("cai para `platform` quando a WebView não expõe `getPlatform`", () => {
    comCapacitor({ platform: "android" });
    expect(nativePlatform()).toBe("android");
    expect(isNativeApp()).toBe(true);
  });

  it("não quebra com um global de formato inesperado", () => {
    comCapacitor({});
    expect(nativePlatform()).toBe("web");
    expect(isNativeApp()).toBe(false);
  });
});
