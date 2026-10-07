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
    // Backend fictício nos testes; nunca utiliza as credenciais de produção.
    env: {
      VITE_SUPABASE_URL: "https://projeto-de-teste.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "chave-anon-de-teste",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
