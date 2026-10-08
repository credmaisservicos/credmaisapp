# QA Checklist — CredMais

Checklist manual de validação dos fluxos críticos. Use staging com contas e dados de teste.
As verificações automáticas são `npm run check` e `npm run test:e2e:local`.

## Evidências automáticas da entrega — 2026-10-07

| Fluxo | Evidência |
|---|---|
| Pagamento parcial e última parcela fora da ordem | Testes das funções SQL em PostgreSQL isolado via PGlite; contrato continua ativo enquanto houver pendência |
| Recibo e isolamento entre donos | Handler real de `auto-receipt` executado com HTTP simulado; visitante e parcela de outro dono recusados; recibo usa o valor parcial recebido |
| WhatsApp | Handler real de `whatsapp-send`; envio, falha do provedor, agendamento e proteção de conversa de outro dono verificados |
| Assinatura | Handler real de `mercadopago-webhook`; HMAC inválido, valor insuficiente, ativação, validade, evento duplicado e plano vitalício verificados |
| Instalação | Android/iPhone e computadores em testes de navegador; critérios de instalação Chrome no site HTTPS verificados |
| Acesso e recuperação | SDK real com armazenamento bloqueado e navegador com quota excedida; login, painel e clientes carregam; senha recusada permite correção; confirmação física e entrega real de e-mail pendentes |
| Logout e portais | Dois acessos temporários no servidor confirmam logout local; navegador verifica cliente/cobrador com armazenamento bloqueado, isolamento de rotas e proteção contra respostas atrasadas |
| Inicialização nativa e erro de conexão | Preferência bloqueada não impede liberar o splash; mensagens distinguem rede, servidor, sessão e permissão; abertura pública em três contextos novos do Chromium, sem comprovação física |
| Saldos e documentos do portal | PostgreSQL isolado compara quatro cotações com baixa SQL; cancelamentos não cobram, recebimentos parciais somam, PDF inclui saldo e exige pagamento confirmado para recibo |
| Recebimentos sucessivos e classificação | Índice único real de lucro, centavos, encargos crescentes, passagem credor/cobrador, dados legados, estorno, isolamento e rollback verificados em PostgreSQL isolado; conferência na Carteira testada em 320, 390 e 1366 pixels |

Execute `npm run test:integrations` para os 220 testes dos handlers. Eles usam
apenas credenciais e dados fictícios, interceptam as chamadas HTTP e rodam sem
permissão de rede. Essas evidências não substituem o checklist manual com
aparelhos físicos, banco de staging e contas sandbox dos provedores.

## 1. Autenticação
- [ ] Cadastro abre o checkout com nome e e-mail; pagamento e conclusão do cadastro vinculam a conta correta, sem duplicação
- [ ] Login com credenciais válidas → redireciona para `/dashboard`
- [ ] Login com credenciais inválidas exibe mensagem clara
- [ ] "Lembrar-me" mantém sessão após fechar o navegador (localStorage)
- [ ] Sem "Lembrar-me" sessão expira ao fechar (sessionStorage)
- [ ] Armazenamento cheio ou bloqueado permite login nesta janela e avisa sobre a sessão temporária
- [ ] Aparelho que apresentou erro consegue entrar e carregar o próprio perfil
- [ ] Endereço com `www` possui DNS e certificado válidos; atualmente somente o endereço sem `www` foi confirmado
- [ ] "Esqueceu a senha" envia e-mail e `/reset-password` atualiza senha
- [ ] Logout limpa sessão e redireciona para `/login`
- [ ] Sair ou abrir o portal em um aparelho mantém o acesso da mesma conta nos demais aparelhos

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
- [ ] Pagamento que cobre a base mas deixa encargos mantém a parcela em aberto
- [ ] Pagar a última parcela mantém o contrato ativo se outra parcela ainda estiver em aberto ou parcialmente paga
- [ ] Quitar a última pendência conclui o contrato, mesmo pagando fora da ordem

## 6. WhatsApp (Evolution API)
- [ ] Conectar instância via QR code
- [ ] Enviar template de cobrança manual
- [ ] Bot envia automaticamente conforme regras de escalonamento
- [ ] `bot_stop_on_payment=true` interrompe ao receber pagamento

## 7. Agente IA (provedor configurado; Gemini na conta de testes)
- [ ] Mensagem recebida no WA é processada pela IA
- [ ] Áudio é transcrito (se `bot_process_audio=true`)
- [ ] Comprovante é interpretado (se `bot_process_receipts=true`)
- [ ] Pedidos de negociação, desconto, prazo ou condições diferentes pausam o bot e chegam a uma pessoa; o bot não negocia
- [ ] Previsão voluntária mantém as condições originais, vincula a parcela correta e não confirma recebimento

## 8. Portal do Cliente (externo)
- [ ] Login somente por CPF (`portal_client_login`), com limite de tentativas e recusa de CPF ambíguo
- [ ] Cliente vê apenas seus contratos e parcelas
- [ ] PIX exibido corretamente
- [ ] Branding (cores/logo) reflete configuração do dono
- [ ] Aparência clara/escura em preto e branco, sem neon; negociação disponível somente com uma pessoa

## 9. Portal do Cobrador
- [ ] Login via token (`collector_tokens`)
- [ ] Cobrador vê apenas clientes atribuídos (`collector_assignments`)
- [ ] Pode registrar pagamento
- [ ] Armazenamento bloqueado permite acesso nesta janela; sair impede restaurar dados por uma resposta atrasada

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

- [x] Carteira: relatório autenticado de caixa, recebimentos parciais pela data real, diferenças históricas sem data, composição explícita e histórico paginado. Testes e limites: `docs/caixa-carteira-2026-10-07.md`.
- [x] Aportes, retiradas e despesas: repetição após falha de conexão preserva a mesma tentativa; cancelamento bloqueia chegadas atrasadas; edição concorrente de despesa exige revisão. Testes e limites: `docs/lancamentos-manuais-2026-10-08.md`.
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
