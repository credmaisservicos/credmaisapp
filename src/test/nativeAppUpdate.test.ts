import { describe, expect, it } from "vitest";
import { availableNativeUpdate } from "@/lib/nativeAppUpdate";

const url = "https://credmaisapp-downloads.fcoipz.easypanel.host/CredMais.apk";
const metadata = { packageName: "br.com.credmais.app", versionCode: 2, versionName: "1.0.1", apkUrl: url };
describe("atualizações nativas", () => {
  it("oferece uma versão maior do mesmo aplicativo e endereço", () => {
    expect(availableNativeUpdate(metadata, "1", url)).toEqual({ url, versionName: "1.0.1" });
  });
  it.each([2, 1])("não oferece instalação da mesma versão ou downgrade (%s)", versionCode => {
    expect(availableNativeUpdate({ ...metadata, versionCode }, "2", url)).toBeNull();
  });
  it.each([null, {}, { ...metadata, versionCode: "2" }, { ...metadata, versionCode: 2.5 }, { ...metadata, packageName: "outro.app" }, { ...metadata, apkUrl: "https://outro.exemplo/App.apk" }, { ...metadata, versionName: "<script>" }])("recusa metadados inválidos ou de outro aplicativo (%j)", data => {
    expect(availableNativeUpdate(data, "1", url)).toBeNull();
  });
});
