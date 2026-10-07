# Auditoria das dependências — 2026-10-07

`npm audit` passou de 11 para 5 alertas. `npm run audit:production` passou com
zero vulnerabilidades. Os cinco alertas restantes derivam da mesma biblioteca
`braces@3.0.3`, usada pelas ferramentas de compilação do Tailwind 3.

## Correções aplicadas e verificadas

- `postcss-selector-parser@7.1.6` substitui as versões vulneráveis utilizadas
  pelo Tailwind e pelo plugin de tipografia. O build e os testes da interface
  verificam a compatibilidade com os seletores e as classes do aplicativo.
- `uuid@11.1.1` substitui a versão vulnerável usada por `xcode`. O parser do
  projeto Xcode, a geração de identificadores e `cap sync ios` foram verificados.

As versões corrigidas estão fixadas em `overrides` e no lockfile. Não foi
aplicada a sugestão de downgrade do Capacitor ou de migração automática para
Tailwind 4.

Referências: [PostCSS](https://github.com/advisories/GHSA-rj75-hqrm-r3gf)
e [UUID](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Dependência sem correção publicada

O aviso [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
afeta `braces <=3.0.3` e não informa uma versão corrigida. O registro npm ainda
publica 3.0.3 como a versão mais recente na data desta verificação.

`braces` propaga os alertas a `chokidar`, `micromatch`, `fast-glob` e `tailwindcss`.
A cadeia é de desenvolvimento: seus padrões vêm dos arquivos e da configuração
do projeto. Ela não é enviada no JavaScript do app nem recebe dados de clientes
durante o uso do site. Não houve remoção do aviso nem uso de uma versão fictícia
para silenciar a auditoria.

Antes de compilar, mantenha fontes e padrões de glob sob controle do repositório.
Acompanhe uma correção de `braces` ou planeje uma migração homologada do Tailwind.
A avaliação deve ser refeita se a compilação passar a consumir padrões ou fontes
fornecidos por usuários externos.
