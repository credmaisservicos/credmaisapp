import { describe, expect, it } from "vitest";
import { detectInstallPlatform } from "@/lib/installPlatform";

describe("instalação conforme o aparelho", () => {
  it.each(["iPhone", "iPad", "iPod"])("usa instalação web no %s", (device) => {
    expect(detectInstallPlatform(`Mozilla/5.0 (${device})`)).toBe("ios");
  });
  it("reconhece iPad com identificação de navegador de desktop", () => {
    expect(detectInstallPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe("ios");
    expect(detectInstallPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 0)).toBe("desktop");
  });
  it("seleciona Android para celular e tablet", () => {
    expect(detectInstallPlatform("Mozilla/5.0 (Linux; Android 15; Pixel) Chrome/130 Mobile")).toBe("android");
    expect(detectInstallPlatform("Mozilla/5.0 (Linux; Android 15) Chrome/130")).toBe("android");
  });
  it("mantém computadores no instalador do navegador", () => {
    expect(detectInstallPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
    expect(detectInstallPlatform("")).toBe("desktop");
  });
});
