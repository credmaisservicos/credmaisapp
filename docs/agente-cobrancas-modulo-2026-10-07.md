# Agente e cobranças: módulo único de Atendimento

## Uso

Acesse **Atendimento**. As abas concentram resumo e diagnóstico, conexão, assistente interno, conversas, revisões de comprovantes e configurações do agente e da régua de cobranças. Links antigos de conversas e automações levam à aba correspondente.

Em **Configurações**, atendimento, aprovação, áudio e comprovantes ficam nos primeiros cartões. Agenda, expediente, limites e régua aparecem abaixo. Mensagens personalizadas e modelos ficam em seções expansíveis. Os controles preservam os valores já cadastrados; o salvamento envia apenas campos alterados do bot. As configurações gerais deixam de sobrescrever as regras do agente e a conexão ao salvar outros assuntos.

Falhas de leitura exibem opção de tentar novamente; valores padrão não podem ser salvos nessa situação. A navegação usa a URL como estado para permitir troca de aba, recarregamento e retorno pelo navegador.

## Cobranças

- A cobrança de atraso inclui somente parcelas vencidas ou que vencem no dia, de contratos ativos. As futuras permanecem fora desse total. Lembretes antecipados incluem apenas parcelas da mesma data de vencimento.
- Pagamentos parciais reduzem o saldo, sem quitar outras parcelas automaticamente.
- O intervalo escolhido pelo operador é respeitado em todos os níveis de atraso.
- Fila pendente, revisão ou resultado incerto impede uma nova cobrança automática ao mesmo cliente. Resultado incerto exige conferência da equipe antes de outro envio.
- Promessas abertas com vencimento hoje ou no futuro suspendem cobranças genéricas. Acordos e pausas são lidos novamente antes do envio de uma cobrança agendada.
- Com a opção de parar após pagamento ativa, um recebimento registrado depois do agendamento, inclusive parcial, cancela a cobrança. A consulta usa o histórico financeiro, que também registra pagamentos parciais.
- Mensagens da IA precisam citar valores do saldo selecionado. Modelos com valores incompatíveis usam uma mensagem segura com o total correto. Um resumo financeiro calculado pelo sistema acompanha a cobrança.
- A IA tem orçamento compartilhado de dez segundos por execução e até três segundos por tentativa. Esgotado esse tempo, as cobranças seguem com mensagens locais.
- As abordagens da IA não sugerem descontos, parcelamentos, prazos novos ou medidas jurídicas.
- Notificações diferenciam fila, aprovação e aceitação pelo provedor.

O QR de uma conexão existente reutiliza a instância cadastrada. Uma resposta HTTP 200 sem estado aberto ou QR não é tratada como conexão estabelecida. A configuração da conexão fica na própria aba Conexão; a baixa automática por comprovante não aparece nessa tela.

## Validação e publicação

Testes de funções usam HTTP simulado, sem permissão de rede: saldo parcial, parcelas futuras, promessa no dia, pausa humana, rodadas simultâneas, aprovação, falha de leitura, recebimento após agendamento e entrega incerta anterior. Testes de navegador verificam navegação, recarregamento, salvamento apenas do campo alterado, modelos e layout de 360 e 1366 pixels, além da recusa de salvamento sem leitura válida.

Publicação das funções com backup privado do banco e arquivos substituídos. Esta etapa não executa migrações nem altera pagamentos existentes. O site e o APK seguem a publicação automática.

Pareamento depende do celular que possui o número. IA e transcrição dependem das credenciais privadas no servidor; mensagens locais, consultas, filas e atendimento humano continuam disponíveis sem IA quando o WhatsApp está conectado.
