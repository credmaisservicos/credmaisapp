import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import {readLocalPreference,writeLocalPreference} from '@/lib/browserStorage';

type Lang = "pt-BR" | "en-US" | "es-ES";

const DICT: Record<Lang, Record<string, string>> = {
  "pt-BR": {
    "common.save": "Salvar",
    "common.cancel": "Cancelar",
    "common.delete": "Excluir",
    "common.edit": "Editar",
    "common.loading": "Carregando...",
    "common.search": "Buscar",
    "common.close": "Fechar",
    "common.confirm": "Confirmar",
    "common.language": "Idioma",
    "nav.dashboard": "Painel",
    "nav.clients": "Clientes",
    "nav.collections": "Cobranças",
    "nav.settings": "Configurações",
    "auth.signIn": "Entrar",
    "auth.signOut": "Sair",
  },
  "en-US": {
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.edit": "Edit",
    "common.loading": "Loading...",
    "common.search": "Search",
    "common.close": "Close",
    "common.confirm": "Confirm",
    "common.language": "Language",
    "nav.dashboard": "Dashboard",
    "nav.clients": "Clients",
    "nav.collections": "Collections",
    "nav.settings": "Settings",
    "auth.signIn": "Sign in",
    "auth.signOut": "Sign out",
  },
  "es-ES": {
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.delete": "Eliminar",
    "common.edit": "Editar",
    "common.loading": "Cargando...",
    "common.search": "Buscar",
    "common.close": "Cerrar",
    "common.confirm": "Confirmar",
    "common.language": "Idioma",
    "nav.dashboard": "Panel",
    "nav.clients": "Clientes",
    "nav.collections": "Cobros",
    "nav.settings": "Ajustes",
    "auth.signIn": "Entrar",
    "auth.signOut": "Salir",
  },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const Ctx = createContext<I18nCtx>({ lang: "pt-BR", setLang: () => {}, t: (k) => k });

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = readLocalPreference("app-lang") as Lang | null;
    return stored && DICT[stored] ? stored : "pt-BR";
  });

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang: (l) => {
        writeLocalPreference("app-lang",l);
        setLangState(l);
      },
      t: (key) => DICT[lang][key] ?? DICT["pt-BR"][key] ?? key,
    }),
    [lang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useI18n = () => useContext(Ctx);

export const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: "pt-BR", label: "Português", flag: "🇧🇷" },
  { code: "en-US", label: "English", flag: "🇺🇸" },
  { code: "es-ES", label: "Español", flag: "🇪🇸" },
];
