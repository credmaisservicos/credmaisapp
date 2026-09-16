import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // `types.ts` é gerado pelo Supabase. As Edge Functions usam Deno e já são
    // verificadas separadamente por scripts/checar-funcoes.mjs no CI.
    ignores: ["dist", "test-results/**", "playwright-report/**", "src/integrations/supabase/types.ts", "supabase/functions/**", "latest*.js", "z-index-*.js", "live-*.js", "*-release*.js"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Fast Refresh é uma conveniência de desenvolvimento; vários módulos
      // compartilham providers e helpers de propósito.
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // O typecheck continua obrigatório. Tipar o domínio será feito por módulo,
      // sem transformar quase mil integrações legadas em ruído no lint diário.
      "@typescript-eslint/no-explicit-any": "off",
      // O CI possui `scripts/checar-hooks.mjs` para a regra que quebra telas.
      // Dependências de effects legados exigem refatoração funcional individual
      // (adicioná-las automaticamente pode criar loops de rede).
      "react-hooks/exhaustive-deps": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
);
