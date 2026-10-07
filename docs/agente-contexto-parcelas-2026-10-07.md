# Atendimento: contexto, parcelas e comprovantes — 2026-10-07

Consultas de parcelas agora têm seleção determinística antes do menu, da FAQ e da IA. O cliente pode informar número, ordinal, contrato, vencimento, próxima parcela ou última parcela. Números repetidos em contratos diferentes exigem confirmação por opções ou referência do contrato. A última parcela é identificada por contrato; consultá-la não altera pagamentos nem conclui o contrato.

A referência escolhida fica na memória por até 48 horas e é revalidada contra as parcelas ativas do titular a cada mensagem. Perguntas curtas, PIX e segunda via usam essa referência. Uma seleção expirada, futura, paga, cancelada ou ausente não muda automaticamente para outra dívida. Abrir o menu ou iniciar uma solicitação de empréstimo limpa o contexto de pagamento. Pedidos para parar o bot ou falar com uma pessoa precedem consultas e saudações.

O valor informado e o campo de valor do PIX usam o mesmo saldo: valor original mais encargos, descontando o que já foi recebido. Os cenários cobrem parcela futura, vencimento hoje, pagamento parcial, multa diária fixa ou percentual, juros compostos, teto de encargos, piso de encargos já registrados e saldo restante apenas de encargos. Dez casos comparam a cotação à função SQL real de pagamento em PostgreSQL local; parcela sem saldo não gera recebimento fictício. As taxas e regras financeiras existentes foram preservadas. O bot informa encargos totais sem inventar a separação entre multa e juros de valores legados.

Uma legenda de comprovante com número de parcela segue o recebimento do arquivo, sem acionar o menu. Referência explícita única prevalece sobre a cotação anterior. Sem referência explícita, a seleção recente pode orientar a revisão; valores iguais em várias parcelas não identificam uma parcela única. Arquivos sem referência segura ficam sem parcela vinculada até a conferência humana. O valor cotado fica separado em metadados e não é usado como valor recebido. A baixa permanece manual, inclusive com configurações antigas de confirmação automática; não há negociação ou renovação automática.

Áudio transcrito utiliza o mesmo roteamento das mensagens escritas. Falhas de gravação do contexto deixam o evento disponível para nova tentativa e não enviam uma cotação sem registro. As ferramentas de IA não podem trocar a parcela previamente selecionada para gerar PIX. O contexto fornecido ao modelo distingue saldo, valor original, recebido e encargos, incluindo parcelas futuras.

## Validação

Foram aprovados 467 testes Vitest, 173 testes compartilhados e 114 integrações HTTP: 754 testes locais. A suíte contém 54 novos testes nesta rodada. Os testes HTTP executam sem permissão de rede, com banco e provedores simulados; nenhuma mensagem pode sair para usuários reais. As comparações financeiras usam as migrações reais em PGlite. Tipos das 43 funções, tipos do app, lint, hooks e build foram verificados. A suíte de 224 testes de interface continua no CI, sem mudança visual nesta rodada.

A publicação das funções utiliza backup dos arquivos e do banco, sem novas migrações ou alteração de clientes, contratos e pagamentos. A restrição de destinatário da conta de testes e o escopo do Gemini são preservados e conferidos após a publicação. O APK utiliza o conteúdo web e a atualização automática existente; uma publicação apenas do servidor não exige novo binário quando o conteúdo web permanece idêntico.

Os testes de áudio simulam a transcrição e o provedor; não comprovam reconhecimento perfeito de qualquer gravação real. Esta rodada não envia mensagens externas nem realiza pagamentos. A entrega física no WhatsApp e a interpretação de áudios reais exigem novas mensagens do número autorizado, mantendo os demais destinatários bloqueados para testes.
