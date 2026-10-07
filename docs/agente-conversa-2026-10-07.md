# Clareza da conversa do bot — 2026-10-07

O atendimento responde ao assunto perguntado: vencimento, saldo ou encargos. Perguntas informativas preservam a parcela selecionada e não enviam PIX. O cliente pode pedir o código na mensagem seguinte. A solicitação de saldo total lista as parcelas em aberto, inclui pagamentos e encargos no total e informa que parcelas futuras estão incluídas; não gera um pagamento agregado entre contratos.

Agradecimentos e recusas simples recebem respostas curtas, preservando o contexto. Uma saudação não promete enviar PIX nem pede quitação. O primeiro pedido de portal pode abrir o acesso diretamente, sem uma apresentação que interrompa o pedido. Explicações gerais de multas e juros informam que as condições dependem do contrato, sem escolher uma parcela ou inventar taxas.

Contestações de titularidade, cobrança, valor, fraude ou contratação encaminham para conferência humana antes de consultar ou exibir parcelas. O bot pausa o atendimento automático, sem negociar nem registrar dinheiro recebido. Após duas solicitações não compreendidas, há saída para uma pessoa da equipe; o comportamento também vale quando a IA informa necessidade de esclarecimento. Falha de encaminhamento não confirma atendimento humano que não foi registrado.

Os textos automáticos e exemplos enviados à IA deixam de prometer retorno, baixa ou novo contato sem confirmação operacional. Previsão informada pelo cliente não é apresentada como acordo ou alteração do vencimento. O fallback local não associa o saldo de várias parcelas à primeira parcela. Menu e encaminhamento numérico verificam a gravação antes de confirmar ao cliente.

## Validação e publicação

Passaram 468 testes Vitest, 179 compartilhados e 136 integrações HTTP: 783 testes locais, com 24 novos testes nesta rodada. Os cenários cobrem pergunta informativa sem PIX, continuidade da parcela, resposta breve, saldo total, contestação sem exposição de dívida, explicação de encargos, portal na primeira mensagem, saudações, esclarecimento local e com IA, falhas no encaminhamento e no estado do menu. As integrações usam provedores simulados e executam sem permissão de rede.

Tipos das 43 funções, tipos do app, lint, hooks e build foram verificados. A suíte de 224 testes de interface continua no CI. A publicação das funções usa backup dos arquivos e do banco, sem migração ou mudança de pagamentos reais. O Gemini e a restrição ao destinatário autorizado da conta de testes são preservados. A publicação web aciona a atualização automática do APK.

As respostas do modelo permanecem variáveis; os testes verificam as regras e os caminhos de conversa descritos, sem garantir interpretação perfeita de qualquer frase ou áudio. Nenhuma mensagem nova foi enviada para usuários reais nesta rodada. Entrega física no WhatsApp e áudio real precisam de mensagens do destinatário autorizado.
