# Auditoria das dependências — 2026-10-07

`npm run audit` e `npm run audit:production` passaram com zero vulnerabilidades.
Os cinco alertas altos de desenvolvimento foram eliminados pela remoção da
cadeia de `braces`, sem ocultar ou ignorar o aviso.

## Alterações

- Tailwind atualizado de 3.4.17 para 4.3.3 com o plugin oficial
  `@tailwindcss/vite`. `braces`, `chokidar`, `micromatch` e `fast-glob` não
  constam mais da árvore instalada.
- Tema, fontes, cores, raios e animações migrados da configuração TypeScript
  para o CSS. Classes atualizadas para preservar sombras, foco e filtros.
- Espaçamentos entre irmãos mantêm a posição usada pelo Tailwind 3, inclusive
  em formulários com campos ocultos. Testes verificam essa regra, cores de
  marca definidas em elementos internos e o desfoque dos cards translúcidos.
- `tailwind-merge` atualizado para 3.6.0, compatível com as classes do Tailwind 4.
- Configuração PostCSS e dependências que ficaram sem uso removidas. O override
  antigo de `postcss-selector-parser` também foi retirado.
- O override de `uuid@11.1.1` para `xcode` foi preservado.
- CI passou a auditar todas as dependências, incluindo as de desenvolvimento.

## Verificação

Build de produção, tipos, lint, testes do aplicativo e de interface são
executados antes da publicação. A comparação de 18 capturas em celular e
desktop inclui login, instalação, página pública, painel, cadastro de cliente,
cobranças, configurações e chat, com backend simulado.

O Tailwind 4 exige navegadores modernos: Safari 16.4+, Chrome 111+ e Firefox
128+. Os assets gerados não dependem das bibliotecas de compilação removidas.

Referências: [aviso original de braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[migração oficial do Tailwind](https://tailwindcss.com/docs/upgrade-guide) e
[compatibilidade do tailwind-merge](https://github.com/dcastil/tailwind-merge).
