import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { isNativeApp } from "@/lib/native";
import { appDistribution } from "@/lib/appDistribution";
import { availableNativeUpdate, type NativeAppUpdate } from "@/lib/nativeAppUpdate";

export default function NativeAppUpdateBanner() {
  const [update, setUpdate] = useState<NativeAppUpdate | null>(null);
  useEffect(() => {
    const apkUrl = appDistribution.android;
    if (!isNativeApp() || !apkUrl?.startsWith("https://")) return;
    let active = true;
    let removeListener: (() => Promise<void>) | undefined;
    let checkedAt = 0;
    const controller = new AbortController();
    const metadataUrl = new URL("latest.json", apkUrl).href;
    async function start() {
      try {
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        const check = async () => {
          if (!active || Date.now() - checkedAt < 300_000) return;
          checkedAt = Date.now();
          try {
            const response = await fetch(metadataUrl, { cache: "no-store", signal: controller.signal });
            if (!response.ok) return;
            const candidate = availableNativeUpdate(await response.json(), info.build, apkUrl!);
            if (active) setUpdate(candidate);
          } catch { /* Uma falha de rede não impede o uso da versão instalada. */ }
        };
        await check();
        if (!active) return;
        const listener = await App.addListener("appStateChange", ({ isActive }) => { if (isActive) void check(); });
        if (active) removeListener = () => listener.remove();
        else await listener.remove();
      } catch { /* Navegadores e shells sem o plugin não exibem esse aviso. */ }
    }
    void start();
    return () => { active = false; controller.abort(); void removeListener?.(); };
  }, []);
  if (!update) return null;
  return <div className="mx-auto max-w-[1600px] px-4 pt-3 sm:px-5 md:px-6 lg:px-8">
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.07] px-4 py-3">
      <p className="flex-1 text-sm text-foreground">Uma nova versão do CredMais está disponível ({update.versionName}).</p>
      <a href={update.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Download size={16} />Atualizar aplicativo</a>
      <p className="w-full text-xs text-muted-foreground">Baixe o APK e confirme a atualização no Android. Sua conta continua a mesma.</p>
    </div>
  </div>;
}
