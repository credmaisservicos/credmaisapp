# Calendário brasileiro e atualização atômica de encargos

## Problemas confirmados

A baixa calcula os encargos sobre o valor original da parcela. A rotina automática usava o saldo após recebimentos parciais, podia reduzir encargos já registrados, ignorava snapshots de quitação e dependia de uma consulta REST limitada. Usava também a data UTC e horas completas desde o vencimento, enquanto o painel dependia do fuso do aparelho. Na produção, `due_date` é `timestamptz` e a configuração geral do PostgreSQL é UTC; duas datas históricas têm dias civis diferentes entre UTC e Brasil. Nenhum vencimento histórico é reescrito.

O gatilho que cancelava cobranças comparava o recebido apenas com o valor original. Podia encerrar a fila com juros pendentes, ignorava parcelas de status NULL e cancelava também mensagens genéricas de atendimento. O PostgreSQL ainda considera NaN maior que números comuns; novos saldos não finitos são recusados antes de serem transformados em status pago.

## Comportamento

O calendário financeiro usa `America/Sao_Paulo`, inclusive durante a virada UTC e nos dias históricos de horário de verão. As rotinas financeiras recebem configuração local de fuso; o banco mantém UTC. Datas civis selecionadas para contratos e parcelas são armazenadas em um instante fixo durante o dia brasileiro, independentemente do fuso do dispositivo.

Portal, painel e bot compartilham cálculo decimal com arredondamento de centavos equivalente ao PostgreSQL. A baixa do credor, a baixa do cobrador e a atualização automática usam uma mesma função SQL. Mantêm juros compostos, multa diária fixa ou percentual, teto do contrato, encargos registrados e congelamento por snapshot. Taxa zero/ausente mantém o padrão existente de 4% ao dia; taxa negativa não é convertida em cobrança positiva. A rotina não usa uma configuração global diferente daquela aplicada na baixa.

A atualização automática percorre lotes por cursor e bloqueia parcela e contrato antes de ler o saldo. Parcelas bloqueadas por outra transação são deixadas para a execução seguinte. Alteração e aviso ao cliente são atômicos; uma falha de aviso desfaz a alteração daquela parcela e é reportada. Só contratos ativos ou atrasados, com relações consistentes de dono e cliente, podem ser atualizados. Recebimentos, razão financeira e lucro não são criados pela rotina. Notificações usam o dia brasileiro e contadores de inserções efetivas. Falhas parciais retornam erro HTTP; não são apresentadas como sucesso.

Quitar ou cancelar uma parcela só cancela cobranças quando não há outro saldo em contrato ativo do mesmo cliente e dono. Saldos apenas de encargos e status NULL são conferidos. Mensagens de atendimento genérico, outros donos e entregas já iniciadas não são cancelados pelo gatilho. Propostas, descontos e renovações continuam exigindo pessoas; o bot não ganha autorização para negociar.

## Validação e publicação

Testes com `timestamptz` real comparam cálculo SQL, portal e bot, arredondamento de meio centavo, multas, pagamentos parciais, teto, snapshot e horário de verão. Baixas de credor e cobrador são executadas em banco fictício com configuração externa `Pacific/Kiritimati`, verificando o saldo e a restauração do fuso da conexão. A suíte cobre falhas atômicas de notificação, paginação, repetição, permissões e cancelamento por dono. Testes HTTP da função real usam backend simulado e execução sem permissão de rede.

Duas sessões de PostgreSQL em banco isolado confirmaram que um pagamento bloqueado não é sobrescrito e que execuções simultâneas não duplicam encargos ou notificações. Não foram feitas chamadas financeiras nem envios de mensagens à produção para testar.

A inicialização da biblioteca decimal do bot também foi verificada em um contêiner isolado com a mesma imagem do servidor. A primeira escolha falhou ao inicializar `LN10` nesse ambiente, apesar dos testes em Deno 2; os helpers anteriores foram restaurados durante a correção. O bot usa `decimal.js` 10.6.0, validada nessa imagem com os helpers reais, cotação de centavos e plano de cobrança. O frontend mantém `decimal.js-light` 2.5.1. Ambas as versões já estavam na árvore de dependências e são fixadas diretamente; os cálculos compartilhados recebem a implementação adequada ao ambiente. [API da biblioteca decimal](https://mikemcl.github.io/decimal.js/).

A publicação exige backup completo, definições e permissões anteriores para rollback, conferência do código remoto antes da troca e comparação dos registros de contratos, parcelas, transações e lucros antes/depois da migração. O SQL da migração só define funções e permissões; não executa atualização de encargos. A versão publicada e as evidências finais ficam no relatório de entrega privado.

## Pendências de entrega

A confirmação física do acesso nos aparelhos relatados e o DNS com `www` permanecem pendentes. Também permanecem a conciliação humana das composições financeiras legadas, a revisão do envio automático de recibos, os totais de caixa por período incluindo parciais e a validação física das instalações. Esses requisitos não são considerados concluídos pelos testes desta rodada.
