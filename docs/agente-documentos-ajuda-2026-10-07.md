# Documentos e ajuda no atendimento — 2026-10-07

A coleta de documentos de clientes e novos contatos usa o arquivo privado já salvo na conversa. A triagem não baixa nem armazena uma segunda cópia. A classificação fica vinculada ao arquivo da caixa de entrada e ao evento do WhatsApp. Repetir um evento após falha de encaminhamento não duplica a validação nem cria outro caminho de arquivo.

Arquivo ilegível, incompleto ou com baixa qualidade permanece pendente mesmo quando o modelo retorna “accepted”. Uma indicação de aceite com risco visual médio, ou qualquer indicação de risco alto, exige conferência humana; classificação desconhecida também não completa os documentos. A triagem usa nomes padronizados para os documentos, sem repetir uma descrição do modelo que anuncie aprovação. Documentos compatíveis opcionais, como contracheque de trabalhador CLT e contrato de locadora de motorista de aplicativo, são guardados sem substituir documentos obrigatórios.

O bot registra a triagem antes de orientar o próximo envio. Falhas de armazenamento, gravação da etapa, encaminhamento ou notificação não confirmam uma operação que falhou. Arquivos para revisão humana e documentação completa pausam a automação e são encaminhados para a equipe. A triagem completa não aprova crédito nem confirma autenticidade jurídica. Com a IA desativada, o arquivo é preservado e encaminhado para uma pessoa, sem chamada ao modelo.

Comprovante de endereço, renda ou locadora permanece na coleta cadastral. Um comprovante de pagamento pode interromper essa etapa e segue a conferência humana de recebimento, sem baixa automática. A pausa humana continua preservando anexos na conversa para a equipe.

“Ajuda” e perguntas sobre documentos faltantes mostram os itens obrigatórios ainda pendentes, preservando a etapa. Ajuda na seleção da modalidade repete as opções correspondentes. “Menu” volta ao início e limpa a seleção financeira pendente. Novos contatos podem pedir atendente ou parar o bot durante a coleta de documentos ou escolha de modalidade, sem ficarem presos à resposta numérica. As gravações desses fluxos verificam o resultado e o escopo da conta.

## Validação e publicação

Passaram 468 testes Vitest, 198 compartilhados e 194 integrações HTTP: 860 testes locais, com 48 regressões novas nesta rodada. Os cenários incluem os dois tipos de contato, triagem inconsistente, risco visual, documentos opcionais, comprovantes cadastrais e de pagamento, falhas operacionais, repetição de evento, ajuda contextual e prioridade de atendimento humano. As integrações executam sem permissão de rede, com os provedores simulados.

Tipos das 43 funções, tipos do app, lint, hooks e build aprovados. A suíte de 224 testes de interface permanece na verificação do CI. A publicação usa backup das funções e do banco, sem migração ou alteração de pagamentos reais. Gemini e restrição ao destinatário autorizado da conta de testes são preservados; a publicação web aciona a atualização automática do APK.

Não houve novas mensagens para clientes reais nesta rodada. As imagens e PDFs da integração são arquivos fictícios; os testes exercitam as decisões e falhas declaradas pelo modelo, sem comprovar reconhecimento visual de qualquer documento real. A equipe permanece responsável pela conferência documental, aprovação de crédito e confirmação de recebimento.
