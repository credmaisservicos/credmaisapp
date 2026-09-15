import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // `src/integrations/supabase/client.ts` lança quando estas faltam, e essa
    // guarda é justamente o que impede um build ir para produção sem credencial.
    // Nos testes ela derrubava o arquivo inteiro no import, antes da primeira
    // asserção — qualquer teste que importasse (mesmo indiretamente) o cliente
    // não rodava. Estes valores são de mentira de propósito: nenhum teste vai à
    // rede; eles só deixam o módulo carregar.
    env: {
      VITE_SUPABASE_URL: "https://projeto-de-teste.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "chave-anon-de-teste",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
