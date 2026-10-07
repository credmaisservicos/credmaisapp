import { apkDownloadUrl } from "@/lib/appDistribution";

export interface NativeAppUpdate { url: string; versionName: string; }

export function availableNativeUpdate(metadata: unknown, installedBuild: string, apkUrl: string): NativeAppUpdate | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = metadata as Record<string, unknown>;
  const build = Number(installedBuild);
  if (!Number.isSafeInteger(build) || build < 1 || value.packageName !== "br.com.credmais.app" ||
    !Number.isSafeInteger(value.versionCode) || Number(value.versionCode) <= build ||
    typeof value.versionName !== "string" || !/^[\w.+-]{1,40}$/.test(value.versionName) ||
    typeof value.apkUrl !== "string") return null;
  const url = apkDownloadUrl(value.apkUrl);
  return url === apkUrl ? { url, versionName: value.versionName } : null;
}
