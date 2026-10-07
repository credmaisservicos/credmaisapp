import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { writeWebReleaseCatalog } from "./scripts/web-release-catalog.mjs";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), tailwindcss(), {
    name: "credmais-web-release-catalog",
    async writeBundle(options) {
      if (options.dir) await writeWebReleaseCatalog(options.dir);
    },
  }],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    target: "es2020",
    // O service worker lê este mapa para instalar o shell primeiro e preparar
    // as rotas lazy depois, sem saturar a rede na primeira abertura.
    manifest: "vite-manifest.json",
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Altera os nomes de todos os chunks nesta publicação. Isso evita que
        // o CDN reutilize respostas HTML que ficaram associadas a assets de um
        // deploy incompleto anterior.
        // Uma resposta HTML ficou associada a este ícone em parte do CDN.
        // Muda só seu nome e os imports dependentes para uma URL nova;
        // bibliotecas e outros ícones continuam aproveitando o cache existente.
        banner: "/* credmais-release: 2026-10-07-desktop-install */",
        entryFileNames: "assets/[name]-release20261007-[hash].js",
        chunkFileNames: (chunk) => chunk.name === "trash-2"
          ? "assets/[name]-cachefix20261007-[hash].js"
          : "assets/[name]-release20261007-[hash].js",
        // O bundle de entrada juntava React, framer-motion, o cliente do
        // Supabase e o Radix inteiro no MESMO arquivo do código do app. Duas
        // consequências ruins para quem abre no celular: baixa tudo de uma vez
        // e, a cada deploy, o hash muda e o navegador rebaixa os ~800 KB
        // inteiros — mesmo quando só uma tela mudou.
        //
        // Separar por biblioteca deixa o pedaço de fornecedor estável entre
        // deploys (fica no cache) e permite baixar em paralelo.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
          if (id.includes("node_modules/framer-motion") || id.includes("node_modules/motion-dom") || id.includes("node_modules/motion-utils")) return "vendor-motion";
          if (id.includes("node_modules/@tanstack/")) return "vendor-query";
          // Nada de agrupar recharts/d3 aqui. O Rollup coloca um módulo
          // compartilhado (o `clsx`, que o recharts também usa) dentro do
          // primeiro grupo que o contém — o que fazia a entrada depender dos
          // 400 KB de gráficos por causa de uma função de 300 bytes. Deixado
          // como está, o recharts fica só dentro do pedaço da Dashboard, que
          // já é carregado sob demanda.
        },
      },
    },
  },
});
