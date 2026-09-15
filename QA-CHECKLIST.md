# QA Checklist — SYSTEM JUROS

Checklist manual de validação dos fluxos críticos. Marque cada item ao testar em ambiente real.

## 1. Autenticação
- [ ] Cadastro novo (e-mail + senha) cria perfil e `trial_ends_at` = +3 dias
- [ ] Login com credenciais válidas → redireciona para `/dashboard`
- [ ] Login com credenciais inválidas exibe mensagem clara
- [ ] "Lembrar-me" mantém sessão após fechar o navegador (localStorage)
- [ ] Sem "Lembrar-me" sessão expira ao fechar (sessionStorage)
- [ ] "Esqueceu a senha" envia e-mail e `/reset-password` atualiza senha
- [ ] Logout limpa sessão e redireciona para `/login`

## 2. Proteção de Rotas
- [ ] Acessar `/dashboard` sem login → `/login?next=/dashboard`
- [ ] Após login, redireciona para `next`
- [ ] Conta bloqueada (`is_blocked=true`) mostra tela "Conta Bloqueada"
- [ ] Assinatura expirada mostra "Acesso Restrito" (exceto Perfil/Sobre/Config)

## 3. Clientes
- [ ] Criar cliente novo (3 steps) salva em `clients`
- [ ] Editar cliente persiste alterações
- [ ] Busca fuzzy por nome retorna resultados
- [ ] Busca por CPF/CNPJ exato funciona
- [ ] Upload de avatar/documentos vai ao bucket `uploads`

## 4. Empréstimos / Contratos
- [ ] Criar contrato parcelado gera N parcelas com juros corretos
- [ ] Criar contrato porcentagem (loan_mode=percentage)
- [ ] Frequência diária/semanal/mensal respeita dias úteis
- [ ] Período de carência (`grace_periods`) atrasa primeira parcela
- [ ] Total = capital + juros (validar com loanMath unit tests)

## 5. Cobranças / Parcelas
- [ ] Marcar parcela como paga → dispara `notify_installment_paid` → edge `auto-receipt`
- [ ] Recibo gerado e salvo em `receipt_url`
- [ ] Multa diária aplicada via cron em parcelas vencidas
- [ ] Pagamento parcial registra `paid_amount` < `amount`

## 6. WhatsApp (Evolution API)
- [ ] Conectar instância via QR code
- [ ] Enviar template de cobrança manual
- [ ] Bot envia automaticamente conforme regras de escalonamento
- [ ] `bot_stop_on_payment=true` interrompe ao receber pagamento

## 7. Agente IA (DeepSeek)
- [ ] Mensagem recebida no WA é processada pela IA
- [ ] Áudio é transcrito (se `bot_process_audio=true`)
- [ ] Comprovante é interpretado (se `bot_process_receipts=true`)
- [ ] Negociação automática segue regras de `bot_negotiation_enabled`

## 8. Portal do Cliente (externo)
- [ ] Login somente por CPF (`portal_client_login`), com limite de tentativas e recusa de CPF ambíguo
- [ ] Cliente vê apenas seus contratos e parcelas
- [ ] PIX exibido corretamente
- [ ] Branding (cores/logo) reflete configuração do dono

## 9. Portal do Cobrador
- [ ] Login via token (`collector_tokens`)
- [ ] Cobrador vê apenas clientes atribuídos (`collector_assignments`)
- [ ] Pode registrar pagamento

## 10. Pagamento de Assinatura (Mercado Pago)
- [ ] Botão "Assinar" abre checkout Mercado Pago
- [ ] Webhook atualiza `subscriptions.status=active` e `current_period_end`
- [ ] `subscription_expires_at` no perfil é atualizado
- [ ] Conta sai do estado "Acesso Restrito"

## 11. Cron Jobs (pg_cron)
- [ ] Job diário de multas roda às 00:05 (verificar logs)
- [ ] Job de cobranças automáticas roda no horário configurado
- [ ] `automation_logs` registra execuções

## 12. Financeiro
- [ ] TopBar exibe KPIs corretos (Capital, A Receber, Recebido, Lucro)
- [ ] Filtro de período atualiza todos os KPIs
- [ ] Despesas debitam de `expense_balance`
- [ ] Lucro gerado = recebido - capital investido

## 13. Multi-tenant / Segurança
- [ ] Usuário A NÃO vê dados do usuário B (RLS)
- [ ] Tentativa de acessar contrato de outro tenant retorna vazio
- [ ] Admin (`is_admin=true`) vê todos os perfis em /admin

## 14. UX / Resiliência
- [ ] OfflineIndicator aparece ao perder conexão
- [ ] ErrorBoundary captura erros sem tela branca
- [ ] Empty states exibidos nas 9 páginas listadas
- [ ] Confirmação antes de deletar registros

---
**Como usar:** abra um ambiente de staging com dados de teste, percorra cada seção e marque os itens. Reporte falhas como issues no repositório.
