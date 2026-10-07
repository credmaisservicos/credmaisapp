export type InstallPlatform = "android" | "ios" | "desktop";

/** A plataforma escolhe o fluxo; a disponibilidade do prompt vem do navegador. */
export function detectInstallPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  return /Android/i.test(userAgent) ? "android" : "desktop";
}

export type DesktopInstallBrowser = "chrome" | "edge" | "safari" | "other";

export function detectDesktopInstallBrowser(userAgent: string): DesktopInstallBrowser {
  if (/Edg\//i.test(userAgent)) return "edge";
  if (/Chrome\//i.test(userAgent)) return "chrome";
  if (/Macintosh/i.test(userAgent) && /Version\/.*Safari\//i.test(userAgent)) return "safari";
  return "other";
}
