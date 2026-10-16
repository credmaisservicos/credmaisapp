---
version: anydesign-1
name: CredMais C+ Brand System
source: C:/Users/focussdev/Downloads/WhatsApp Image 2026-08-27 at 19.12.34.jpeg
captured_at: 2026-08-31
description: |
  Uma identidade financeira digital construída sobre profundidade azul-marinho e energia azul elétrica. O símbolo C+ concentra a promessa de evolução e controle; o laranja aparece com disciplina como assinatura, nunca como cor dominante.
colors:
  primary: "#006FEF"
  primary-bright: "#168BFF"
  accent: "#FF9D16"
  surface: "#020719"
  surface-elevated: "#07143D"
  text-primary: "#F5F7FF"
  text-muted: "#9CAAD1"
  border: "#173D78"
typography:
  display:
    fontFamily: "Manrope, Space Grotesk, sans-serif"
    fontSize: 48px
    fontWeight: 700
    letterSpacing: -0.04em
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  base: 4px
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96]
rounded:
  sm: 10px
  md: 14px
  lg: 20px
  pill: 9999px
components:
  brand-mark:
    asset: "/credmais-cplus-logo.jpg"
    rounded: "{rounded.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: 12px 24px
  card:
    backgroundColor: "{colors.surface-elevated}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.lg}"
  c-plus-electric-brand-mark:
    asset: "/credmais-cplus-logo.jpg"
    glowColor: "{colors.primary-bright}"
    accentColor: "{colors.accent}"
---

# Design Analysis — CredMais C+ Brand System

> Analysis generated with the `anydesign` skill.
> Date: 2026-08-31
> Analysis emphasis: reconstruction + design system

## Source

- **Source type**: imagem local
- **Path**: `C:/Users/focussdev/Downloads/WhatsApp Image 2026-08-27 at 19.12.34.jpeg`
- **Capture method**: visão direta da imagem fornecida
- **Detected limitations**: a referência contém o símbolo, mas não define tipografia, estados de interação ou layout responsivo; essas partes preservam a estrutura já validada do produto.

## TL;DR

Identidade tecnológica, enérgica e confiável, sustentada por superfícies azul-marinho e um foco azul elétrico. O símbolo C+ tridimensional é a assinatura visual; a aplicação deve manter o laranja em baixa frequência para que ele conserve seu valor de destaque.

## 1. Visual identity

### 1.1 Surface description

**Personality**: tecnológica, sólida, energética, financeira e premium.

**Mood**: controle, velocidade e confiança, evidenciados pelo alto contraste, pelo brilho azul e pela profundidade do símbolo.

**Detectable stylistic references**: ícone de aplicativo 3D com iluminação neon e acabamento de produto fintech.

**Information density**: equilibrada; o símbolo é denso, enquanto a interface ao redor deve ser contida.

**Implicit positioning**: produto financeiro digital para operadores que valorizam rapidez e visão clara da carteira.

**Confidence**: ✅ alta para identidade e cor; ⚠️ média para extrapolação à interface.

### 1.2 Brand voice / Atmosphere

A CredMais não trata controle financeiro como uma planilha silenciosa. A marca acredita que controle deve ser visível: luz que delimita o sistema, contraste que elimina ambiguidade e um “mais” integrado ao próprio nome. O azul não é decoração; é o sinal contínuo de que a plataforma está ativa e organizada.

O laranja representa ganho, ação e movimento, mas aparece apenas na borda inferior do símbolo. Essa restrição é essencial: a plataforma permanece confiável e concentrada no azul, enquanto o laranja marca momentos de oportunidade, destaque comercial ou aviso importante.

### 1.3 The "ONE brand thing"

- **The thing**: o monograma C+ azul, tridimensional e iluminado, sobre superfície azul-marinho.
- **Why it carries the brand**: reúne nome, promessa de crescimento e estética de produto digital em uma única forma.
- **How everything else supports it**: fundos escuros e textos frios reduzem ruído para o azul permanecer como foco.
- **Where it appears**: login, sidebar, navegação pública, splash, PWA e fallbacks dos portais. Logos white-label configurados por clientes continuam tendo precedência.

*Confidence*: ✅ alta.

## 2. Design System (tokens)

### 2.1 Colors

| Token | Hex | Role | Where it appears | Confidence |
|---|---|---|---|---|
| `primary` | `#006FEF` | Ação principal acessível | Botões, links, foco | ✅ alta |
| `primary-bright` | `#168BFF` | Brilho e hover | Glows, bordas ativas | ✅ alta |
| `accent` | `#FF9D16` | Destaque raro | Selos e detalhes comerciais | ✅ alta |
| `surface` | `#020719` | Fundo profundo | Site, shell e portais | ✅ alta |
| `surface-elevated` | `#07143D` | Superfície elevada | Cards e popovers | ⚠️ média |
| `text-primary` | `#F5F7FF` | Texto principal | Títulos e ações | ✅ alta |
| `text-muted` | `#9CAAD1` | Texto secundário | Legendas e metadados | ⚠️ média |
| `border` | `#173D78` | Divisão tonal | Cards, inputs e navegação | ⚠️ média |

### 2.2 Typography

- **Família de display**: Manrope / Space Grotesk, preservada do produto existente; a imagem não contém texto suficiente para inferir uma fonte nova.
- **Família de corpo**: Inter.
- **Display**: `{typography.display}` (48px, 700, tracking -0.04em).
- **Body**: `{typography.body}` (16px, 400, line-height 1.5).
- **Confidence**: ⚠️ média — decisão de continuidade, não extração da imagem.

### 2.3 Spacing

- Unidade base: `{spacing.base}` (4px).
- Escala: 4, 8, 12, 16, 24, 32, 48, 64 e 96px.
- Consistência: ✅ alta, derivada do sistema Tailwind existente.

### 2.4 Radii

- Pequeno: `{rounded.sm}` (10px) para botões.
- Médio: `{rounded.md}` (14px) para a marca em navegação.
- Grande: `{rounded.lg}` (20px) para cards.
- Pill: `{rounded.pill}` (9999px) para chips.

### 2.5 Elevation system

| Level | Name | Treatment | Use |
|---|---|---|---|
| 0 | Base navy | Sem sombra | Fundo de página |
| 1 | Tonal | Borda azul translúcida | Cards padrão |
| 2 | Electric lift | Borda + glow azul suave | Hover e seleção |
| 3 | Overlay | Sombra profunda + blur | Dialogs e menus |

#### Decorative depth

Gradientes radiais azuis podem criar atmosfera em escala de página. O glow deve se concentrar em foco, seleção e marca; não deve envolver todo componente simultaneamente.

### 2.6 Borders

- Base: `{colors.border}` (#173D78) com 1px.
- Hover/foco: `{colors.primary-bright}` (#168BFF) em transparência, acompanhado de ring visível.

### 2.7 Accessibility quick-check

Consulte `design-a11y.md`. Texto principal e texto azul-claro sobre o fundo marinho passam AAA; texto branco sobre o azul de ação passa AA para texto normal.

## 3. Components Inventory

### 3.1 Generic components

#### brand-mark

- Asset oficial: `{components.brand-mark}` (`/credmais-cplus-logo.jpg`).
- Uso em formato quadrado, com `object-cover` e raio médio.
- Variantes PWA são recortadas para preservar a leitura em tamanhos pequenos.
- Confidence: ✅ alta.

#### button-primary

- Fundo `{colors.primary}` (#006FEF), texto `{colors.text-primary}` (#F5F7FF).
- Hover usa `{colors.primary-bright}` (#168BFF); glow restrito a CTAs de alto valor.
- Confidence: ✅ alta.

#### card

- Superfície `{colors.surface-elevated}` (#07143D), borda `{colors.border}` (#173D78), raio `{rounded.lg}` (20px).
- Elevação prioritariamente tonal, com sombra profunda apenas em overlays.
- Confidence: ⚠️ média.

### 3.2 Signature components

#### c-plus-electric-brand-mark

- **What it is**: monograma C+ tridimensional dentro de um ícone azul-marinho iluminado.
- **Why it's signature**: o sinal “mais” integra literalmente a promessa da marca.
- **Composition**: superfície marinha, forma azul elétrica, cruz branca e filete laranja inferior.
- **Where it appears**: pontos de identidade, instalação e carregamento; não como textura repetida.
- **Confidence**: ✅ alta.

## 4. Layout & Composition

### 4.1 Grid & containers

O produto preserva seus containers de 1160–1400px, grid Tailwind e ritmo vertical baseado em 4px. A nova marca altera identidade, não densidade operacional.

### 4.2 Composition patterns

- Site público com hero de texto à esquerda e marca ampliada à direita.
- Workspace com sidebar marinha e superfícies tonais.
- Portais com fundo aurora azul, cards bento e logo do credor quando personalizada.

### 4.3 Responsive behavior

Breakpoints permanecem os já implementados pelo Tailwind. A marca usa proporção 1:1, `object-cover` e tamanhos mínimos legíveis; CTAs preservam alvos de toque próximos ou superiores a 44px.

### 4.4 Image behavior

- **Marca principal**: JPG quadrado no produto e PNG recortado nos ícones PWA.
- **Logo white-label**: sempre tem precedência nos ambientes personalizados.
- **Hero**: a marca pode aparecer ampliada e com baixa opacidade, sem grayscale.
- **Ícones de interface**: Lucide, mantendo traço e herdando tokens semânticos.

## 5. Reconstruction Notes

### Suggested stack

React + Tailwind + shadcn/ui, mantendo CSS custom properties como fonte semântica das cores.

### Quick wins

- Trocar os fallbacks de logo por um único asset oficial.
- Atualizar tokens `primary`, `accent`, superfícies e glows.
- Regenerar favicon, apple-touch e ícones PWA a partir da mesma marca.

### Tricky bits

- Preservar personalizações white-label sem reintroduzir a paleta antiga nos fallbacks.
- Garantir contraste do botão azul; o azul visual mais brilhante fica reservado a hover/glow.
- Evitar repetição excessiva do JPG grande em contextos puramente decorativos.

### Implicit states to define

Hover usa azul brilhante; foco usa ring azul; loading usa marca com pulso sutil; erro mantém vermelho semântico; aviso pode usar laranja.

### Confidence map

| Layer | Confidence | Why |
|---|---|---|
| Identity | ✅ alta | Símbolo e atmosfera claros |
| Colors | ✅ alta | Amostragem visual direta e contraste validado |
| Typography | ⚠️ média | Preservada do produto, não inferida da imagem |
| Spacing | ✅ alta | Sistema existente consistente |
| Components | ⚠️ média | Derivados da identidade aplicada ao produto |
| Layout | ✅ alta | Código responsivo existente preservado |

## 6. Do's and Don'ts

### Do

- Use `{colors.primary}` (#006FEF) em ações principais e `{colors.primary-bright}` (#168BFF) em brilho/hover.
- Reserve `{colors.accent}` (#FF9D16) para selos, oportunidade e pequenos pontos de atenção.
- Mantenha o símbolo C+ colorido; o azul e o filete laranja são parte da assinatura.
- Use fundos `{colors.surface}` (#020719) com elevação tonal azul, não cinza neutro.
- Preserve logos e cores configurados por clientes white-label nos ambientes deles.

### Don't

- Não aplique grayscale ao símbolo C+.
- Não use laranja como fundo dominante de páginas ou grandes cards.
- Não recupere bege, dourado ou preto quente da identidade anterior.
- Não coloque glow intenso em todos os cards; ele deve indicar foco ou ação.
- Não distorça, achate ou recorte o C+ de modo que a cruz branca desapareça.

## 7. Open Questions

- A imagem fornecida é o arquivo mestre definitivo ou haverá uma versão vetorial/transparente?
- A marca deve continuar usando o nome textual “CredMais App” ao lado do símbolo ou existe um novo wordmark?
- O filete laranja deve aparecer também em componentes comerciais ou permanecer exclusivo do logo?

## 8. Companion files

- [x] `design-tokens.json` — tokens em formato W3C DTCG.
- [x] `design-a11y.md` — contraste WCAG 2.1.
- [ ] `design-screenshot.png` — não necessário; a fonte local original foi analisada diretamente.
