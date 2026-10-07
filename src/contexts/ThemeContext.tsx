import { createContext, useContext, useState, useEffect } from "react";
import { useWhiteLabel } from "@/contexts/WhiteLabelContext";
import {readLocalPreference} from '@/lib/browserStorage';

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { effectiveTheme, setThemeMode, isLoaded } = useWhiteLabel();
  const [theme, setTheme] = useState<Theme>(() => {
    return readLocalPreference('theme')==='light'?'light':'dark';
  });

  useEffect(() => {
    if (isLoaded) {
      setTheme(effectiveTheme);
    }
  }, [effectiveTheme, isLoaded]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeMode(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
