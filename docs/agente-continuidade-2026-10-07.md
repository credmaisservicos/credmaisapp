# Continuidade do atendimento — 2026-10-07

O bot mantém o assunto solicitado enquanto o cliente escolhe entre parcelas. “PIX da parcela 2” seguido de “escolher 2” ou “contrato …” gera o PIX da parcela pedida, sem exigir a repetição do pedido. Uma resposta contendo somente o contrato completa o número, data ou ordem anteriormente solicitados. Um novo número de parcela substitui o anterior; quando a referência anterior incluía contrato, ele continua sendo usado até uma troca explícita.

Perguntas de vencimento, saldo e encargos também atravessam a escolha de contrato. Uma pergunta explícita sobre vencimento substitui um pedido anterior de PIX. Listar parcelas ou iniciar uma solicitação de empréstimo limpa a escolha pendente. A intenção e a referência são estado do fluxo, validadas e preservadas durante a compactação da memória; a IA não pode substituí-las.

As opções continuam limitadas às parcelas exibidas, com escopo de conta e cliente e validade de 48 horas. Na resposta seguinte, o bot consulta novamente parcelas ativas e recalcula o saldo, incluindo pagamentos e encargos atuais. Uma opção expirada, paga, removida ou de outro cadastro não provoca pagamento de outra parcela.

Ao retomar uma sessão encerrada por inatividade, o bot processa o pedido atual, em vez de descartá-lo para apresentar o menu. Isso inclui PIX, pedido de atendente, escolha da modalidade salva e áudio transcrito. Uma saudação simples apresenta a etapa anteriormente salva, incluindo documentos de novos contatos. A pausa humana tem prioridade e não é desfeita por esse fluxo.

O roteamento por linguagem natural normaliza acentos, corrigindo pedidos como “quero solicitar empréstimo”. A etapa de documentos é persistida antes da orientação de envio. Falhas de persistência deixam o evento disponível para nova tentativa e não confirmam uma etapa ou seleção que não foi salva.

## Validação e publicação

Validação local: 468 testes Vitest, 185 compartilhados e 159 integrações HTTP sem rede, totalizando 812 testes. Esta rodada acrescenta 29 regressões, cobrindo pedidos fragmentados, alteração de intenção, referências inválidas, recalculo após recebimento parcial, retomada por texto e áudio, pausa humana e falhas de gravação. Tipos das 43 funções, tipos do app, lint, hooks e build aprovados. A suíte de 224 testes de interface permanece na verificação do CI.

A publicação das funções usa backup dos arquivos e do banco, sem migração ou alteração de pagamentos reais. Gemini e escopo do destinatário autorizado são preservados. A publicação web aciona a atualização automática do APK.

Os provedores de WhatsApp e transcrição foram simulados nesta rodada. Não houve novas mensagens para clientes reais. O teste não garante reconhecimento de qualquer frase ou áudio, nem comprova entrega física pelo WhatsApp; o bot continua encaminhando negociações e confirmações de recebimento para a equipe humana.
