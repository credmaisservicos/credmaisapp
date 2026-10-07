# CredMais App

SaaS multi-tenant para gestão de crédito, contratos, parcelas, cobranças,
investidores e comunicação com clientes.

## Tecnologias

- React 18, TypeScript e Vite
- Tailwind CSS, shadcn/ui e Radix UI
- Supabase Auth, PostgreSQL, RLS, Realtime, Storage e Edge Functions
- TanStack Query com persistência em IndexedDB
- Vitest e Playwright

## Desenvolvimento local

Requisitos: Node.js 22.12+ e npm. O projeto usa `package-lock.json` como lockfile.

```sh
npm ci
cp .env.example .env
npm run dev
```

Preencha no `.env` a URL e a chave pública (`anon`) do projeto Supabase. Nunca
coloque a chave `service_role` em variáveis `VITE_*`, pois elas são incorporadas
ao JavaScript entregue ao navegador.

O servidor local abre em `http://localhost:8080`.

## Verificação

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Para executar tipos, lint, regras de hooks, funções de servidor, testes e build:

```sh
npm run check
```

Os checks das funções usam Deno 2 instalado ou o executam pelo npx. Isso funciona
também no Windows e exige rede quando as dependências ainda não estão em cache.

O lint opera com tolerância zero a avisos. O typecheck e o verificador dedicado
de hooks também são executados no CI.

Para validar a entrega sem usar o banco de produção:

```sh
npx playwright install chromium
npm run test:e2e:local
```

Esse comando gera `dist-e2e`, inicia um preview e verifica login, rotas públicas,
redirecionamentos, telas internas e admin em celular e desktop. O build usa
configuração fictícia de Supabase e as telas autenticadas recebem dados simulados.
O servidor local é encerrado ao terminar; `dist` permanece como artefato de produção.

Os testes E2E convencionais usam por padrão `https://credmaisapp.com.br`. Para
apontar para uma instância local já iniciada:

```sh
E2E_BASE_URL=http://localhost:8080 npm run test:e2e
```

No PowerShell:

```powershell
$env:E2E_BASE_URL="http://localhost:8080"; npm run test:e2e
```

## Estrutura

- `src/pages`: páginas e fluxos de navegação
- `src/components`: componentes compartilhados e módulos de interface
- `src/lib`: regras de negócio, cálculos e utilitários
- `src/integrations/supabase`: cliente e tipos gerados do banco
- `supabase/migrations`: evolução do schema, políticas RLS e RPCs
- `supabase/functions`: webhooks, automações e integrações de servidor
- `e2e`: testes de rotas, autenticação e garantias financeiras
- `docs`: procedimentos operacionais e reconciliação financeira

## Segurança e multi-tenancy

Os dados operacionais são isolados por `user_id` e políticas RLS. Funções com
`verify_jwt = false` devem validar internamente assinatura de webhook, token de
portal ou segredo de cron. Toda nova função pública deve receber também limite
de requisições e proteção contra repetição do mesmo evento.

## Caminho financeiro

Alterações em contratos, parcelas, pagamentos, estornos, multas ou distribuição
de investidores exigem testes de regressão. Consulte os scripts e relatórios em
`docs/` antes de corrigir saldos diretamente no banco.

## Publicação

O frontend tem configuração de Cloudflare Workers (`wrangler.jsonc`), Cloudflare
Pages (`public/_headers`) e Vercel (`vercel.json`). Confirme qual provedor atende
o domínio antes de publicar. Os headers da Vercel e de Pages pertencem a esses
provedores; um Worker utiliza o código de `worker.ts`.

`npm run deploy:cloudflare:worker` publica usando `wrangler.jsonc`.
`npm run deploy:cloudflare:pages` publica no projeto Pages `credmaisapp`.
O alias antigo `deploy:cloudflare` continua apontando para Pages.

Para uma entrega: execute `npm run check` e `npm run test:e2e:local`, confira as
variáveis públicas de produção e preserve uma versão anterior do artefato para
rollback. Alterações do banco são publicadas separadamente, com backup e revisão
das migrações pendentes. Os testes financeiros autenticados devem usar uma conta
técnica em staging. Contas, saldos e cobranças reais não são dados de teste.
Execute também `npm run audit:production`; o CI recusa novos alertas moderados,
altos ou críticos nas dependências de produção.

O CI também verifica os controles de acesso e segredos versionados. Relatórios
antigos em `docs/` e `QA-REPORT.md` registram revisões anteriores e não substituem
os checks da versão que será entregue.

As sondagens de segurança em `e2e/dinheiro.spec.ts` incluem tentativas de escrita
com credenciais inválidas. Elas ficam desativadas por padrão e exigem
`E2E_ALLOW_SECURITY_PROBES=1`, `E2E_BASE_URL`, `E2E_SUPABASE_URL` e `E2E_ANON_KEY`
de **homologação**. No CI, configure as variáveis `E2E_SECURITY_BASE_URL` e
`E2E_SECURITY_SUPABASE_URL` e o secret `E2E_SECURITY_ANON_KEY`; sem elas o job é
ignorado. Nunca aponte esse job para o banco com clientes reais.

## Aplicativos e downloads

A página pública `/baixar`, acessível pelo site, login e painel, identifica o
aparelho e oferece um único botão de instalação. No Android, abre a confirmação
de instalação web quando o navegador disponibiliza essa opção; caso contrário,
orienta pelo menu. No iPhone/iPad, mostra os três passos no Safari para adicionar
o app web à tela inicial. A confirmação no aparelho é necessária.

Opcionalmente, configure `VITE_ANDROID_APK_URL` com a URL HTTPS de um APK
**release assinado**, ou o caminho `/downloads/CredMais.apk` se o servidor
hospedar o arquivo. Nesse caso, o botão Android inicia o download do APK.
Não publique APK de debug como versão dos clientes. Consulte
[o procedimento mobile](docs/mobile-app.md) para assinatura e atualização.

O APK release está em
`https://credmaisapp-downloads.fcoipz.easypanel.host/CredMais.apk`.
O VPS verifica novas publicações do site a cada minuto e gera uma versão Android
maior, preservando a assinatura e a última versão válida. Use
`npm run deploy:cloudflare` para sincronizar também o projeto nativo e aguardar
a conclusão do web e do APK. A instalação de atualizações no Android exige
confirmação do usuário; o app instalado oferece um aviso quando há versão nova.
