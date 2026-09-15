# QA Report — System Juros (auditoria completa)

Executado em: 2026-07-08
Usuário de teste: `qa-test@systemjuros.local` (assinatura ativa até 2027)

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

- ✅ Criado edge function `seed-test-user` (protegida por `SEED_TEST_USER_TOKEN`) e usuário QA `qa-test@systemjuros.local` / `QaTest!2026#SystemJuros` com assinatura ativa.
- ✅ Rodada Playwright cobrindo todas as 30 telas autenticadas.

## O que fazer agora

1. Você liga *Leaked Password Protection* no dashboard.
2. Se quiser, eu removo o `seed-test-user` e deleto o usuário QA — ou deixo pra você usar em testes futuros.
3. Corrigir o item #2 (HEAD 403) e o #3 (admin check), se ainda reproduzirem no ambiente atual.
