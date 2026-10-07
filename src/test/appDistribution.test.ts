import { describe, expect, it } from "vitest";
import { apkDownloadUrl } from "@/lib/appDistribution";

describe("links de instalação publicados", () => {
  it("mantém download nativo indisponível sem link publicado", () => {
    expect(apkDownloadUrl("")).toBeNull();
  });
  it("aceita APK local ou servido por HTTPS", () => {
    expect(apkDownloadUrl("/downloads/CredMais.apk")).toBe("/downloads/CredMais.apk");
    expect(apkDownloadUrl("https://cdn.example.com/CredMais.apk?v=2")).toBe("https://cdn.example.com/CredMais.apk?v=2");
  });
  it.each(["javascript:alert(1)", "http://example.com/app.apk", "//example.com/app.apk", "/\\example.com/app.apk", "https://user:password@example.com/app.apk", "/index.html", "https://example.com/app.ipa"])("recusa APK inválido: %s", (value) => {
    expect(apkDownloadUrl(value)).toBeNull();
  });
});
