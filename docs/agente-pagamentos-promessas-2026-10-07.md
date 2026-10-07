# Agente: valores, promessas e continuidade do atendimento

## Comportamento corrigido

- A cotação de pagamento somente dos juros acompanha `renew_installment_interest`: juros salvos por parcela, modos Price, carência, bullet e percentual e encargos já registrados. Não usa uma taxa geral para todas as parcelas. Parcelas com pagamento parcial são encaminhadas à equipe. Nenhuma cotação altera vencimentos ou registra recebimento.
- A conferência aceita `1.234,56` e `100.50`. Um campo apagado permanece inválido; não recupera automaticamente o valor extraído do comprovante. Valores com mais de duas casas decimais ou formato inválido são rejeitados.
- Promessas novas ou corrigidas são gravadas antes da confirmação ao cliente, por meio do evento de auditoria que materializa `payment_promises`. O cancelamento encerra o registro operacional aberto, com filtro de dono e cliente. Saudações e contexto consultam os registros vigentes; uma promessa futura não gera pedido para antecipar o pagamento.
- Datas usam o calendário de São Paulo. “Hoje”, dia do mês e dia da semana não mudam pela hora do servidor; datas impossíveis ou anteriores ao dia atual são recusadas. Datas escritas com barra não são interpretadas como dinheiro.
- A memória preserva a etapa do menu, modalidade de solicitação, documentos já recebidos e contexto de pagamento. Atualizações da IA não substituem esses controles. Falha ao gravar a etapa deixa o evento disponível para tentar novamente.
- Um comprovante mantém a indicação de pagamento somente dos juros quando o pedido tem menos de 48 horas e corresponde à mesma parcela ativa. Contextos expirados, de outra parcela ou com data futura são ignorados. A confirmação financeira continua manual e validada no banco.
- Mensagens de PIX e acompanhamento informam conferência da equipe antes da baixa. Erros de consulta de comprovante, contrato e promessa não produzem confirmação falsa.

## Verificação

457 testes Vitest, 140 testes compartilhados de funções sem rede, 54 testes HTTP simulados sem rede e 218 testes de navegador com backend fictício: 869 testes distintos. Os testes SQL usam PostgreSQL em memória e comparam a cotação do bot com o recebimento calculado pela função financeira, incluindo arredondamento de meio centavo. Também exercitam criação, correção, cancelamento e cumprimento de promessas com recebimentos parciais.

Tipos, lint, regras de hooks, 43 funções e build aprovados. A conferência de comprovantes foi exercitada em 360 pixels, inclusive campo vazio e ausência de rolagem horizontal. Nenhum pagamento ou envio de mensagem de clientes reais foi usado nos testes.

## Publicação

Publicação de cinco arquivos de funções com backup privado prévio do banco e dos arquivos substituídos. Não há nova migração nesta etapa. O site e o APK seguem os fluxos automáticos existentes.

O envio pelo WhatsApp depende do pareamento do número. Respostas de IA e transcrição dependem das credenciais privadas no servidor; os fluxos locais e a revisão humana permanecem disponíveis sem essas credenciais.

A verificação no endereço público detectou uma resposta HTML para o chunk do ícone `trash-2`, que interrompia a importação inicial do app. O build gera uma identificação nova apenas para esse arquivo e seus imports dependentes, preservando o cache das demais bibliotecas. A validação pública deve verificar também o tipo MIME dos módulos no navegador, além do conteúdo baixado pelo catálogo.
