import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import {readLocalPreference,writeLocalPreference} from '@/lib/browserStorage';
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {privateUploadPath,resolveUploadUrl} from '@/lib/uploadUrls';

export type ModuleKey =
  | "analises" | "relatorios" | "inadimplencia" | "cobradores" | "portais"
  | "lucros" | "gastos" | "comunicacao_inbox" | "chat_interno"
  | "simulador" | "metas" | "tarefas" | "anotacoes" | "planilha" | "puxada_dados"
  | "penhores" | "veiculos" | "alugueis" | "estoque";

export const DEFAULT_MODULES: Record<ModuleKey, boolean> = {
  analises: true, relatorios: true, inadimplencia: true, cobradores: true, portais: true,
  lucros: true, gastos: true, comunicacao_inbox: true, chat_interno: true,
  simulador: true, metas: true, tarefas: true, anotacoes: true, planilha: true, puxada_dados: true,
  penhores: false, veiculos: false, alugueis: false, estoque: false,
};

interface WhiteLabelConfig {
  companyName: string;
  companyLogo: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  accentColor: string;
  themeMode: "light" | "dark" | "system";
  sidebarStyle: "default" | "minimal" | "gradient";
  loginTitle: string;
  loginSubtitle: string;
  footerText: string;
  borderRadius: string;
  fontFamily: string;
  modulesEnabled: Record<ModuleKey, boolean>;
}

interface WhiteLabelContextType {
  config: WhiteLabelConfig;
  refresh: () => void;
  isLoaded: boolean;
  setThemeMode: (mode: "light" | "dark" | "system") => void;
  effectiveTheme: "light" | "dark";
}

const defaults: WhiteLabelConfig = {
  companyName: "CREDMAIS APP",
  companyLogo: null,
  faviconUrl: null,
  primaryColor: "#F5BD59",
  accentColor: "#E3A33E",
  themeMode: "dark",
  sidebarStyle: "default",
  loginTitle: "CREDMAIS APP",
  loginSubtitle: "SISTEMA DE GESTÃO DE EMPRÉSTIMOS",
  footerText: `© ${new Date().getFullYear()} CREDMAIS APP · TODOS OS DIREITOS RESERVADOS`,
  borderRadius: "16",
  fontFamily: "default",
  modulesEnabled: DEFAULT_MODULES,
};

const WhiteLabelContext = createContext<WhiteLabelContextType>({
  config: defaults,
  refresh: () => {},
  isLoaded: false,
  setThemeMode: () => {},
  effectiveTheme: "dark",
});

export const useWhiteLabel = () => useContext(WhiteLabelContext);

function hexToHSL(hex: string): string {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hexToHSLValues(hex: string) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const FONT_MAP: Record<string, string> = {
  default: "'Space Grotesk', 'Inter', system-ui, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
  nunito: "'Nunito', system-ui, sans-serif",
};

let faviconGeneration=0;
function applyConfig(config: WhiteLabelConfig) {
  const generation=++faviconGeneration;
  const root = document.documentElement;
  const { primaryColor: primary, accentColor: accent } = config;

  const pHSL = hexToHSL(primary);
  const { h, s } = hexToHSLValues(primary);
  root.style.setProperty("--primary", pHSL);
  root.style.setProperty("--ring", pHSL);
  const pVals = hexToHSLValues(primary);
  const fgLight = pVals.l > 55 ? `${h} ${Math.min(s, 20)}% 8%` : `0 0% 100%`;
  root.style.setProperty("--primary-foreground", fgLight);
  root.style.setProperty("--gradient-gold", `linear-gradient(135deg, ${primary}, ${accent}, ${primary})`);
  root.style.setProperty("--gradient-button", `linear-gradient(135deg, ${primary}, ${accent}, ${primary})`);
  root.style.setProperty("--shadow-glow", `0 0 20px ${primary}33, 0 0 60px ${primary}15`);

  const br = config.borderRadius || "16";
  root.style.setProperty("--radius", `${br}px`);

  const font = FONT_MAP[config.fontFamily] || FONT_MAP.default;
  root.style.setProperty("--font-body", font);

  // Browser tab title (skip public landing)
  if (typeof document !== "undefined" && config.companyName) {
    const path = window.location.pathname;
    const isLanding = path === "/" || path.startsWith("/landing");
    if (!isLanding) document.title = config.companyName;
  }

  // Favicon
  if (typeof document !== "undefined") {
    const faviconUrl = config.faviconUrl || "/favicon.ico";
    const applyFavicon=(url:string)=>{
    if(generation!==faviconGeneration)return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
    document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']").forEach(icon => {
      icon.href = url;
      icon.removeAttribute("type");
      icon.removeAttribute("sizes");
    });
    let apple = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = url;
    };
    if(privateUploadPath(faviconUrl))void resolveUploadUrl(faviconUrl,{kind:'brand'}).then(url=>{if(url)applyFavicon(url);}).catch(()=>{});
    else if(!faviconUrl.startsWith('storage://'))applyFavicon(faviconUrl);
  }
}

function applyThemeMode(mode: "light" | "dark") {
  const root = document.documentElement;
  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  writeLocalPreference("theme",mode);
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export const WhiteLabelProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [config, setConfig] = useState<WhiteLabelConfig>(defaults);
  const [isLoaded, setIsLoaded] = useState(false);
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">("dark");
  const ownerId = user?.id ?? null;
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const loadGeneration = useRef(0);
  const loadedOwner = useRef<string | null | undefined>(undefined);

  const resolveTheme = useCallback((mode: "light" | "dark" | "system"): "light" | "dark" => {
    if (mode === "system") return getSystemTheme();
    return mode;
  }, []);

  const loadConfig = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const ownerChanged = loadedOwner.current !== ownerId;
    loadedOwner.current = ownerId;
    if (!ownerId) {
      let publicBrand = defaults;
      try {
        const cached = JSON.parse(localStorage.getItem("credmais-public-brand") || "null");
        if (cached && typeof cached === "object") publicBrand = { ...defaults, ...cached };
      } catch { /* cache inválido: usa o padrão */ }
      setConfig(publicBrand);
      applyConfig(publicBrand);
      setIsLoaded(true);
      const stored=readLocalPreference('theme');
      const resolved=stored==='light'?'light':'dark';
      setEffectiveTheme(resolved);
      applyThemeMode(resolved);
      return;
    }

    if (ownerChanged) {
      setIsLoaded(false);
      setConfig(defaults);
      applyConfig(defaults);
      setEffectiveTheme("dark");
      applyThemeMode("dark");
    }

      const { data } = await Promise.resolve(supabase
      .from("settings_safe")
      .select("company_name, company_logo_url, favicon_url, primary_color, accent_color, theme_mode, sidebar_style, login_title, login_subtitle, footer_text, border_radius, font_family, modules_enabled")
      .eq("user_id", ownerId)
      .maybeSingle())
      .catch(() => ({ data: null }));

    if (generation !== loadGeneration.current || currentOwner.current !== ownerId) return;

    if (data) {
      const s = data as any;
      const newConfig: WhiteLabelConfig = {
        companyName: s.company_name || defaults.companyName,
        companyLogo: s.company_logo_url || null,
        faviconUrl: s.favicon_url || null,
        primaryColor: s.primary_color || defaults.primaryColor,
        accentColor: s.accent_color || defaults.accentColor,
        themeMode: (s.theme_mode || defaults.themeMode) as WhiteLabelConfig["themeMode"],
        sidebarStyle: (s.sidebar_style || defaults.sidebarStyle) as WhiteLabelConfig["sidebarStyle"],
        loginTitle: s.login_title || defaults.loginTitle,
        loginSubtitle: s.login_subtitle || defaults.loginSubtitle,
        footerText: s.footer_text || defaults.footerText,
        borderRadius: s.border_radius || defaults.borderRadius,
        fontFamily: s.font_family || defaults.fontFamily,
        modulesEnabled: { ...DEFAULT_MODULES, ...(s.modules_enabled || {}) },
      };
      setConfig(newConfig);
      // Cache restrito a dados públicos mantém a marca na tela de login após logout.
      writeLocalPreference("credmais-public-brand", JSON.stringify({
        companyName: newConfig.companyName, companyLogo: newConfig.companyLogo,
        faviconUrl: newConfig.faviconUrl, primaryColor: newConfig.primaryColor,
        accentColor: newConfig.accentColor, loginTitle: newConfig.loginTitle,
        loginSubtitle: newConfig.loginSubtitle, footerText: newConfig.footerText,
        borderRadius: newConfig.borderRadius, fontFamily: newConfig.fontFamily,
      }));
      applyConfig(newConfig);
      const resolved = resolveTheme(newConfig.themeMode);
      setEffectiveTheme(resolved);
      applyThemeMode(resolved);
    } else {
      applyThemeMode("dark");
    }
    setIsLoaded(true);
  }, [ownerId, resolveTheme]);

  useEffect(() => {
    loadConfig();
    return () => { loadGeneration.current++; };
  }, [loadConfig]);

  useEffect(() => {
    if (isLoaded) {
      applyConfig(config);
      const resolved = resolveTheme(config.themeMode);
      setEffectiveTheme(resolved);
      applyThemeMode(resolved);
    }
  }, [config, isLoaded, resolveTheme]);

  // Listen for system theme changes when mode is "system"
  useEffect(() => {
    if (config.themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = getSystemTheme();
      setEffectiveTheme(resolved);
      applyThemeMode(resolved);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [config.themeMode]);

  const setThemeMode = useCallback((mode: "light" | "dark" | "system") => {
    setConfig(prev => ({ ...prev, themeMode: mode }));
    const resolved = resolveTheme(mode);
    setEffectiveTheme(resolved);
    applyThemeMode(resolved);
  }, [resolveTheme]);

  return (
    <WhiteLabelContext.Provider value={{ config, refresh: loadConfig, isLoaded, setThemeMode, effectiveTheme }}>
      {children}
    </WhiteLabelContext.Provider>
  );
};
