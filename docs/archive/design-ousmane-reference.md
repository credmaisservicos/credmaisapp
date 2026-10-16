---
version: anydesign-1
name: Ousmane Ballon d'Or — adaptação CredMais
source: C:/Users/focussdev/Desktop/EU/saveweb2zip-com-www-ousmaneballondor-fr.zip
captured_at: 2026-09-01
description: |
  Referência editorial de longa rolagem, construída como uma sequência de capítulos cinematográficos. A adaptação CredMais preserva a escala tipográfica, as viradas cromáticas, a textura e o ritmo do scroll, substituindo integralmente a identidade esportiva por uma narrativa financeira original.
colors:
  ink: "#020719"
  ink-elevated: "#081633"
  paper: "#F1EEE7"
  primary: "#0877FF"
  accent: "#FF9F1A"
  text-light: "#F6F7FF"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 96px
    fontWeight: 600
    letterSpacing: -0.065em
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.7
spacing:
  base: 4px
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]
rounded:
  panel: 32px
  pill: 9999px
components:
  cinematic-hero:
    backgroundColor: "{colors.ink}"
    typography: "{typography.display}"
  chapter-band:
    backgroundColor: "{colors.accent}"
    typography: "{typography.display}"
  image-strip:
    backgroundColor: "{colors.ink-elevated}"
    rounded: "{rounded.panel}"
---

# Design Analysis — Ousmane Ballon d'Or / CredMais

> Analysis generated with the `anydesign` skill.
> Date: 2026-09-01
> Analysis emphasis: reconstruction + design system

## Source

- **Source type**: ZIP local com HTML, CSS, JavaScript, fontes e imagens.
- **Path**: `C:/Users/focussdev/Desktop/EU/saveweb2zip-com-www-ousmaneballondor-fr.zip`
- **Capture method**: inspeção do HTML/CSS, servidor local e Playwright.
- **Limitações**: o WebGL e alguns vídeos remotos da referência não carregaram offline; estrutura, imagens, tipografia, paleta e lógica GSAP/ScrollTrigger foram verificadas.

## TL;DR

A referência organiza uma biografia em capítulos grandes, alternando superfícies claras e saturadas, números monumentais e galerias de quatro imagens. A reconstrução transfere esse ritmo para a jornada “organizar, automatizar, receber e crescer”, mantendo a identidade CredMais e imagens originais.

## 1. Visual identity

### 1.1 Surface description

**Personalidade**: editorial, cinemática, enérgica, monumental e tátil. **Densidade**: equilibrada, com grandes vazios entre blocos densos. **Posicionamento**: produto financeiro premium e direto. **Confiança**: ✅ alta.

### 1.2 Brand voice / Atmosphere

O sistema acredita que administrar crédito é uma trajetória, não uma tabela. A rolagem transforma funções do produto em momentos narrativos, com pausas claras e mudanças de cor que sinalizam avanço.

### 1.3 The "ONE brand thing"

- **O elemento**: títulos de escala monumental atravessando capítulos cromáticos.
- **Por que carrega a marca**: converte operação financeira em movimento e decisão.
- **Suporte**: textos curtos, números grandes e imagens cinematográficas.
- **Escopo**: marketing; não deve invadir as telas densas do painel.
- **Confiança**: ✅ alta.

## 2. Design System (tokens)

### 2.1 Colors

| Token | Hex | Papel | Confiança |
|---|---|---|---|
| `ink` | `#020719` | Fundo principal | ✅ |
| `ink-elevated` | `#081633` | Galerias | ✅ |
| `paper` | `#F1EEE7` | Pausa editorial | ✅ |
| `primary` | `#0877FF` | Ação e capítulo | ✅ |
| `accent` | `#FF9F1A` | Virada cromática | ✅ |

### 2.2 Typography

Display entre 48–132px, peso 600, entrelinha 0.78–0.9 e tracking de `-0.065em`. Corpo entre 15–18px, entrelinha 1.7. Confiança ✅ alta para escala e ⚠️ média para equivalência da família.

### 2.3 Spacing

Base de 4px; seções usam 96–144px verticais no desktop e 80–96px no mobile.

### 2.4 Radii

Painéis visuais usam 32px; CTAs usam raio pill.

### 2.5 Elevation system

Nível 0 domina: faixas planas e contraste por cor. Nível 1 usa borda translúcida. Imagens usam profundidade atmosférica, sem sombras pesadas.

### 2.6 Borders

Bordas de 1px, normalmente branco a 10–20% ou ink a 15%.

### 2.7 Accessibility quick-check

Texto claro sobre `ink` tem alto contraste. Ink sobre `paper` também é seguro; textos sobre `accent` usam `ink`, nunca branco.

## 3. Components Inventory

### 3.1 Generic components

Botões pill de 56px, links sublinhados, navegação fixa translúcida e cards de plano com borda fina.

### 3.2 Signature components

#### Cinematic hero

Imagem full-bleed com gradiente de legibilidade, parallax de baixa amplitude e display em duas linhas.

#### Chapter band

Faixa de cor completa com índice gigante, rótulo técnico, título editorial e descrição alinhada à base.

#### Image strip

Galeria horizontal de quatro momentos, moldura arredondada e legendas extremas.

## 4. Layout & Composition

### 4.1 Grid & containers

Container entre 1120 e 1380px, grid editorial assimétrico e gutters de 20–48px.

### 4.2 Composition patterns

Hero dividido, introdução em papel, galeria panorâmica, quatro capítulos alternados, imagem-manifesto, números, planos e CTA final.

### 4.3 Responsive behavior

Em telas menores que 768px, grids empilham, títulos usam `clamp()`, botões ocupam a largura e a imagem do hero mantém o foco à direita. Alvos interativos têm pelo menos 44px.

### 4.4 Image behavior

Hero usa `object-cover`; galeria é uma composição panorâmica; imagem abstrata usa recorte parallax. Assets são WebP e carregamento não crítico é lazy.

## 5. Reconstruction Notes

Stack: React, Tailwind e Framer Motion, já presentes no projeto. O ponto delicado é equilibrar animação e legibilidade; movimentos ficam em 30–150px e revelações usam easing expo. Confiança: identidade ✅, cores ✅, tipografia ⚠️, componentes ✅, responsividade ✅.

## 6. Do's and Don'ts

### Do

- Reserve `{colors.accent}` (#FF9F1A) para capítulos e CTA final.
- Use `{typography.display}` em títulos curtos, com tracking negativo.
- Alterne `{colors.paper}`, `{colors.primary}` e `{colors.ink}` para marcar a jornada.
- Use imagens em grande escala e WebP otimizado.
- Respeite `prefers-reduced-motion` oferecido pelo navegador e pela biblioteca.

### Don't

- Não copie fotos, nomes, brasões ou lettering do atleta.
- Não use laranja para texto pequeno sobre branco.
- Não aplique títulos monumentais no painel administrativo.
- Não crie parallax agressivo que desloque conteúdo essencial.
- Não misture mais cores saturadas além de azul e laranja.

## 7. Open Questions

Material sufficient for complete reconstruction. Vídeo e áudio da referência foram deliberadamente omitidos para preservar desempenho, acessibilidade e a identidade própria do CredMais.

## 8. Companion files

- `design.md` e `design-tokens.json`: sistema-base da marca CredMais existente.
- `output/playwright/ousmane-reference.png`: captura da referência offline.
- `output/playwright/credmais-rebuild-desktop.png`: validação da reconstrução.
