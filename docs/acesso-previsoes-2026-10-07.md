# Acesso e previsões de pagamento — 2026-10-07

## Recuperação de acesso

O login e as consultas HTTP do cliente Supabase passam por `/api/supabase` no domínio do app, incluindo o APK. O endereço original do SDK permanece igual para manter a chave de armazenamento e as sessões existentes. Homologação e testes locais continuam com seus próprios servidores. O proxy encaminha a operação uma única vez para um destino fixo, preserva a autorização do usuário e as regras do banco, remove cookies e impede cache das respostas. Sessões inválidas e negativas de permissão permanecem bloqueadas. Os arquivos estáticos continuam servidos diretamente pelo Pages; somente a rota da API usa a função. Conexões de tempo real e links externos de arquivos permanecem no endereço original.

Falhas temporárias na leitura do perfil recebem uma tentativa adicional, após 500 ms, com limite de 10 segundos por consulta e cancelamento da requisição pendente. Negativas 401 recebem a renovação já existente, uma única vez; 403 e limites 429 não são repetidos automaticamente. A conta precisa continuar sendo a mesma durante a tentativa. Erros de sessão, permissão, indisponibilidade do servidor e ausência de conexão possuem mensagens distintas. O usuário pode tentar novamente ou abrir o login, e uma verificação que falhou é retomada ao voltar ao app ou reconectar. Não há liberação de permissões em cache para contornar uma negativa online.

O diagnóstico em produção encontrou autenticação e leitura pública sem dados respondendo HTTP 200, CORS funcionando, segredos JWT consistentes e acesso ao próprio perfil aprovado para as 14 contas cadastradas. Isso não comprova a causa do erro em cada aparelho relatado: não houve reprodução no dispositivo afetado. A mudança reduz a dependência do domínio separado do servidor e trata falhas transitórias, sem atribuir toda falha à internet do usuário.

## Previsões vinculadas à parcela

A previsão é materializada na mesma transação que a auditoria, com a parcela explicitamente selecionada. O gatilho verifica titular e cliente na parcela e no contrato, contrato ativo, estado da parcela e data válida. Falhas fazem a auditoria e a previsão voltarem juntas, sem remendo posterior do vínculo. Parcelas quitadas, canceladas, inexistentes ou de outra conta não recebem previsões. Saldo de encargos também pode ter previsão, sem baixa, recebimento ou alteração de vencimento.

Somente uma declaração explícita do cliente inicia esse fluxo. Perguntas, negações, intenção incerta e pedidos de estorno vão para uma pessoa. A data de pagamento não é confundida com vencimento ou número da parcela: “pago sexta” não escolhe a sexta parcela. A data e o valor são preservados enquanto o cliente escolhe a parcela ou completa o contrato. Escolhas expiradas, alteradas ou quitadas não selecionam outra dívida. Uma correção de data preserva o valor voluntariamente informado quando a parcela é a mesma.

Status e cancelamento consultam a previsão operacional atual. Cancelamento confere ID, titular, cliente, fonte e estado; ausência ou referência diferente não anuncia cancelamento. Previsões humanas ou importadas permanecem protegidas contra mudanças pelo bot. O modelo não grava previsões nem pode anunciar uma gravação inexistente. A previsão não negocia condições, muda vencimento ou confirma pagamento; recebimentos continuam dependendo de conferência humana.

## Validação

517 testes Vitest, 222 testes compartilhados e 220 integrações HTTP sem rede, além de 225 testes de interface. Tipos do app e das 43 funções, lint, hooks e build verificados. Os cenários incluem recuperação automática, expiração da sessão, mudança de conta durante a espera, negativas de acesso, CORS nativo, preservação de autorização e corpo, ausência de cache e falhas atômicas no banco.

Na publicação de teste, saúde e leitura pública sem dados responderam 200, as três origens nativas receberam preflight 204 e sessão inválida recebeu 403. Uma consulta autenticada apenas na conta de testes autorizada confirmou acesso ao próprio perfil, sem expor dados. Um teste Chromium com respostas fictícias bloqueou o domínio direto do backend e chegou ao painel pelo domínio do app, recuperando uma primeira falha 503 no perfil.

A publicação das funções usa backup do banco e dos arquivos antes de aplicar a migração que substitui o gatilho. Não altera dados financeiros existentes. Os cenários de WhatsApp foram executados com provedores simulados, sem novas mensagens para clientes; Gemini e a restrição da conta e destinatário de testes são mantidos. A publicação web aciona a atualização do APK assinado.

Referências de implementação: [Pages em modo avançado](https://developers.cloudflare.com/pages/functions/advanced-mode/), [roteamento de funções](https://developers.cloudflare.com/pages/functions/routing/) e [cliente Supabase com fetch personalizado](https://supabase.com/docs/reference/javascript/initializing).
