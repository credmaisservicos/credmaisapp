# Revisão de segurança para produção

Data: 2026-08-19

Escopo: frontend React/TypeScript, funções Supabase, configuração de hospedagem, dependências e artefato de produção. A revisão foi feita sem ler, alterar ou criar dados reais de usuários.

## Resultado

Não há vulnerabilidades críticas ou altas conhecidas abertas no código ativo. O build não contém `service_role`, token de acesso Supabase ou a antiga chave fixa da Evolution API. `npm audit --omit=dev` encontrou 0 vulnerabilidades nas 289 dependências de produção.

## Achados corrigidos

### SEC-001 — segredo do WhatsApp consultado pelo navegador

- Severidade: alta
- Local: `src/pages/CentralBot.tsx`, consulta de diagnóstico da Central do Bot
- Evidência: a tela consultava `settings.whatsapp_api_key` para decidir se a integração estava configurada.
- Impacto: um segredo operacional poderia chegar ao cliente web se as permissões do banco fossem ampliadas ou configuradas incorretamente.
- Correção: a tela agora consulta `settings_safe.whatsapp_api_key_configured`, que fornece apenas um booleano e respeita o isolamento do usuário.
- Mitigação adicional: gravação/rotação do segredo permanece na função `settings-set-secret`; o frontend não relê a chave.

### SEC-002 — redirecionamento por conteúdo de notificação

- Severidade: média
- Local: `src/hooks/usePushNotifications.ts`, ação de clique da notificação nativa
- Evidência: `row.link` era atribuído diretamente a `window.location.href`.
- Impacto: um registro malformado ou comprometido poderia redirecionar o usuário para outra origem.
- Correção: o destino agora é analisado como URL e aceito somente quando pertence à mesma origem; links inválidos são ignorados.

### SEC-003 — CSP somente em observação

- Severidade: média
- Local: `public/_headers` e `vercel.json`
- Evidência: o cabeçalho era `Content-Security-Policy-Report-Only` e permitia `unsafe-eval`.
- Impacto: a política não bloqueava recursos ou execução fora da lista permitida.
- Correção: CSP passou a ser aplicada, `unsafe-eval` foi removido e `frame-ancestors 'self'` foi adicionado. Os demais cabeçalhos incluem HSTS, `nosniff`, política de referência e política de permissões.

### SEC-004 — token do portal do cobrador persistente

- Severidade: baixa
- Local: `src/pages/CobradorExterno.tsx`, autenticação do portal externo
- Evidência: o token de acesso era salvo em `localStorage` e continuava disponível depois de fechar o navegador.
- Impacto: em dispositivo compartilhado, outra pessoa poderia reabrir o portal sem reapresentar a credencial; uma injeção executada futuramente também teria uma janela de exposição maior.
- Correção: o token passou para `sessionStorage`, é removido no logout e expira automaticamente ao encerrar a aba.

## Controles verificados

- 41 funções Supabase passaram pela checagem estática do projeto.
- Funções de cron e webhook com `verify_jwt = false` fecham por padrão e exigem segredo compartilhado; funções de usuário validam JWT no servidor.
- A view `settings_safe` usa permissões do invocador e não expõe segredos.
- React escapa conteúdo por padrão; o único `dangerouslySetInnerHTML` ativo gera CSS de gráfico a partir da configuração interna do componente. O `innerHTML` do shell recebe apenas uma constante local de recuperação.
- O service worker armazena apenas recursos estáticos, não respostas autenticadas.
- Rotas protegidas exigem sessão e autorização efetiva permanece no banco/RLS e nas funções, não apenas na interface.
- Lockfile presente e pipeline local usa checagens reproduzíveis.

## Validação executada

- TypeScript e ESLint: aprovados.
- Funções Supabase: 41 aprovadas na checagem; 96 testes Deno aprovados.
- Frontend: 151 testes unitários aprovados.
- Build Vite de produção: aprovado.
- Playwright: 147 cenários de saúde de rotas, autenticação, acessibilidade básica e responsividade aprovados.
- Dependências de produção: 0 avisos conhecidos no `npm audit`.
- Busca de segredos no `dist`: nenhum resultado.

## Bloqueio externo de publicação

A migração `20260819010000_portal_cliente_somente_cpf.sql` está versionada, mas a API do projeto Supabase vinculado responde `403 LegacyDbConfigLoginRoleStatusError`: a conta autenticada não possui privilégios suficientes para acessar o banco. Por segurança, o frontend CPF-only não deve ser publicado antes dessa migração. É necessário conceder à conta acesso adequado ao projeto Supabase ou aplicar a migração pelo proprietário; depois disso, executar a validação final e publicar o mesmo commit no Cloudflare.

## Ação operacional necessária

Rotacionar as credenciais que já foram compartilhadas fora do cofre de segredos (token pessoal Supabase e chave da Evolution API) e atualizar somente os secrets do provedor. Nenhuma dessas credenciais deve ser enviada por chat ou gravada no frontend.
