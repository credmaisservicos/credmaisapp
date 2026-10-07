# QA Report — CredMais

## Listas grandes e consultas repetidas — 2026-10-07

Cobranças monta clientes e parcelas em blocos de 30, mantendo os totais e a
seleção sobre o conjunto completo. Eventos do banco compartilham um canal por
hook e atualizam consultas em janelas de 250 ms. Contratos e parcelas também
atualizam o resumo da lista de clientes.

Na medição com 500 clientes fictícios e 6.000 parcelas, os nós DOM passaram de
42.014 para 4.405. Os limites e os tempos observados estão em
[docs/mobile-performance.md](docs/mobile-performance.md).

Validação: 413 testes Vitest, 111 testes de funções, 208 testes de interface,
tipos, lint, regras de hooks, 42 funções verificadas e build aprovados. O teste
do catálogo também passou. As novas regressões cobrem totais completos,
seleção, busca além do primeiro bloco, todas as páginas e cancelamento de
eventos ao trocar de conta. Backend simulado; nenhuma alteração em dados de
clientes reais. Não houve teste em telefone físico nesta rodada.

## Revisão de desempenho em celulares — 2026-10-07

As ilustrações usadas pelas telas passaram de 43,58 MB para 0,83 MB; os PNGs
anteriores permanecem em resolução menor para compatibilidade. No cenário
medido, os arquivos solicitados na abertura caíram de aproximadamente 10 MB
para 1 MB. O shell offline instala primeiro, com até dois downloads simultâneos;
as rotas adicionais são preparadas depois, conforme a conexão.

Foram corrigidas a apresentação inicial que sumia antes de montar o app, as
recargas disparadas somente pelo tempo de espera e a sobreposição do título
do painel. Menus permanecem visíveis durante a troca de telas. Painel, clientes
e cobranças avisam quando não têm dados disponíveis offline, evitando totais
zerados ou espera infinita. Consultas paginadas têm limite de espera por página.

Validação: 408 testes Vitest, 111 testes de funções, 206 testes de interface,
tipos, lint, regras de hooks, build, 1 teste do catálogo e 9 testes do publicador.
Backend simulado na interface; os testes do publicador usam arquivos temporários.
Não houve alteração de dados de clientes nesta revisão. A medição e os limites
do cenário estão em [docs/mobile-performance.md](docs/mobile-performance.md).

## Preparação inicial de entrega — 2026-10-07

Limpeza de 50 módulos sem uso, 31 dependências e exemplos de teste do template.
Os fluxos ativos, projetos Android/iOS e arquivos de usuários foram preservados.
Nenhum registro de produção foi alterado nesta preparação.

| Verificação | Resultado |
|---|---|
| Tipos do frontend, lint e regras de hooks | Aprovados |
| Tipos das funções de servidor | 42 funções aprovadas |
| Testes das funções e bot | 111 aprovados |
| Integração dos handlers de recibos, WhatsApp e assinatura | 14 aprovados, com HTTP simulado e sem permissão de rede |
| Suíte Vitest e regressões de atualização | 396 aprovados na suíte completa; 13 regressões de PWA/formulários aprovadas |
| Catálogo público e empacotamento seguro | 1 teste Node e 9 testes Python aprovados |
| Interface isolada: login, rotas públicas, internas, admin e estilos | 202 aprovados, incluindo 4 regressões da migração Tailwind |
| Instalação em Android e iPhone simulados | Prompt Android capturado antes da navegação; guia acessível do iPhone aprovado |
| Instalação em computadores e notebooks | Prompt e guias Windows/macOS/Linux aprovados; Chrome confirmou zero erros de instalabilidade no site HTTPS publicado |
| Arquivos na CDN após publicação | 218 arquivos JS/CSS conferidos sem parâmetros de cache; hashes correspondem ao catálogo publicado |
| Build web de produção | Aprovado |
| Sincronização Capacitor Android/iOS | Aprovada |
| Compilação Android release | Assinatura RSA 4096, package e ausência de debug verificados; builds automáticos 2 a 7 aprovados |
| APK público final | Versão 1.0.6/build 7; hash do download e correspondência com o build web verificados; downloads parciais funcionam e arquivos privados retornam 404 |
| Atualização PWA em HTTPS real | Formulário editado preservado durante deploy; uma recarga automática após fechar o formulário |
| Auditoria de dependências de produção | Zero alertas conhecidos |
| Auditoria completa, incluindo ferramentas de desenvolvimento | Zero alertas conhecidos após migração para Tailwind 4.3.3 |
| Sondagens que tentam escrever no backend | Desativadas por padrão; 49 casos ignorados sem opt-in |

O build web está em `dist/`. `npm run mobile:apk` gera apenas o APK de
homologação, identificado como `CredMais-debug.apk`. O APK de clientes foi
assinado com uma chave persistente protegida fora do Git, com backup local e
no VPS. O serviço de publicação incrementa o versionCode automaticamente.
O iOS recebeu os assets atualizados, mas a compilação e assinatura do IPA exigem
Mac/Xcode e Apple Developer e não foram realizadas neste computador Windows.
A página `/baixar` identifica o aparelho: Android baixa o APK release assinado
por HTTPS; iPhone oferece instalação web no Safari. O serviço no VPS acompanha
as publicações e substitui o APK somente após verificar hashes, assinatura,
package e versão. O APK anterior fica disponível em caso de falha.

Os alertas de desenvolvimento foram eliminados pela migração para Tailwind 4.3.3
e pela preservação do override de `uuid@11.1.1` para `xcode`. A cadeia de `braces`
foi removida. As auditorias completa e de produção retornam zero alertas
conhecidos. A avaliação e as verificações de compatibilidade estão em
`docs/security-audit.md`.

O frontend foi publicado no Cloudflare Pages em 2026-10-07 após validar a prévia.
A página pública é `https://credmaisapp.com.br/baixar`. O deployment anterior
foi registrado em `.delivery.local/releases/deployment-rollback.json`.
O APK release está publicado em
`https://credmaisapp-downloads.fcoipz.easypanel.host/CredMais.apk`, com metadados
em `latest.json` e versões anteriores arquivadas. Houve geração automática real
dos builds 2 a 7 após deploys, com a mesma assinatura do build 1. A versão
final publicada e verificada é 1.0.6 (build 7), correspondente ao deployment
`https://6e3e3a19.credmaisapp-vtf.pages.dev`. O compilador passou a ignorar cache
da CDN também nos assets, após detectar um fallback HTML antigo para JavaScript;
o teste de regressão e a geração automática foram aprovados. Os nomes dos chunks
web foram renovados, e os 218 arquivos JS/CSS foram validados diretamente na CDN.
Não houve publicação
em lojas nem teste de instalação em telefone físico conectado. Consulte
`docs/mobile-app.md` para a operação e recuperação da assinatura.

## Relatório histórico — julho de 2026

Executado em: 2026-07-08
Usuário de teste: `qa-test@systemjuros.local` (assinatura ativa até 2027)

Registro histórico de julho de 2026. Para validar a versão atual, execute
`npm run check` e `npm run test:e2e:local`. Os testes locais usam dados simulados.

## Resumo

| Bloco | Resultado |
|---|---|
| Rotas públicas (8 páginas) | ✅ 8/8 OK |
| Rotas autenticadas (30 páginas) | ✅ 30/30 renderizam sem erro JS |
| Login (email+senha) | ✅ Funciona, redireciona pra /dashboard |
| Guard de assinatura | ✅ Libera acesso quando `subscriptions.status='active'` |
| Guard de admin | ⚠️ "Acesso Restrito" mesmo com `profiles.is_admin=true` (usa `user_roles`) |
| SEO / meta tags | ✅ `<title>` e `<meta description>` em todas as páginas |
| Edge functions | ✅ Bootam sem erro; nenhuma exceção nos logs |
| Linter Supabase | ⚠️ 1 item a ligar (leaked password protection) |
| Webhook Mercado Pago | ✅ Implementado via `mercadopago-webhook` |

## Detalhamento dos 30 fluxos autenticados testados

Dashboard, Hoje, Clientes (lista/busca/novo), Carteira, Cobranças, Inadimplência, Histórico, Análises, Lucros, Gastos, Metas, Tarefas, Anotações, Planilha, Simulador, Comunicação, Inbox WhatsApp, Relatórios BI, Notificações, Auditoria, Cobradores, Chat, Perfil, Configurações, Admin, Suporte, Sobre, Puxada de Dados — todas retornaram HTTP 200 com H1 correto, zero erros de console (fora do "Failed to load resource" descrito abaixo) e zero requests falhados relevantes.

Screenshots: `/tmp/browser/audit/screenshots/auth/*.png`.

## Achados

### 🔴 Alta severidade (bloqueia venda)

### 🟡 Média severidade (barulho / feature quebrada)
2. **HEAD count em `contract_installments` retorna 403** — a query do TopBar (`select id, count=exact, head=true`) recebe 403 em toda navegação. Não bloqueia UI, mas o contador de "vencidos" no topo fica zerado. Investigar policy: provavelmente a policy usa `USING (user_id = auth.uid())` mas o PostgREST está aplicando a policy no COUNT antes do filtro. Já que a query já filtra por `user_id=eq.<uid>`, uma segunda policy `SELECT` mais permissiva pra `authenticated` resolveria, ou trocar por `.select("id")` sem `head` e contar no client.
3. **Página `/admin` mostra "Acesso Restrito" mesmo com `profiles.is_admin=true`** — usa `has_role(user_id, 'admin')` da tabela `user_roles`. Divergência com o resto do código (que checa `profile.is_admin`). Decidir uma fonte da verdade e alinhar.
4. **Leaked Password Protection desativada** — ative em Supabase Dashboard → Authentication → Providers → Email.

### 🟢 Baixa severidade
5. Linter reportou 22 SECURITY DEFINER funções expostas — revisadas, são as RPCs públicas de portal por design (`portal_client_login`, `has_role`, `is_admin` etc). Sem ação.
6. `pg_trgm` está no schema `public` — inofensivo, mover exige recriar índices.

## Ações minhas nesta rodada

- ✅ Criada uma função temporária `seed-test-user` e uma conta técnica de QA. Credenciais não devem ser armazenadas no repositório.
- ✅ Rodada Playwright cobrindo todas as 30 telas autenticadas.

## O que fazer agora

1. Você liga *Leaked Password Protection* no dashboard.
2. Se quiser, eu removo o `seed-test-user` e deleto o usuário QA — ou deixo pra você usar em testes futuros.
3. Corrigir o item #2 (HEAD 403) e o #3 (admin check), se ainda reproduzirem no ambiente atual.
