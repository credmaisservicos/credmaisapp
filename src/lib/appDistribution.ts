/** Só expõe links publicados; uma configuração ausente mantém a opção PWA. */
export function apkDownloadUrl(value: string | undefined): string | null {
  const url = value?.trim();
  if (!url) return null;
  if (/^\/(?!\/)[^?#]*\.apk$/i.test(url) && !url.includes("\\")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && /\.apk$/i.test(parsed.pathname)
      ? parsed.href : null;
  } catch { return null; }
}

export const appDistribution = {
  android: apkDownloadUrl(import.meta.env.VITE_ANDROID_APK_URL),
};
