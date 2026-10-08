# Confirmação de lançamentos manuais

Aportes, retiradas e despesas passam por uma operação autenticada e atômica. Cada tentativa recebe uma identidade que é guardada antes do envio. Se a resposta se perder, recarregar a página, navegar entre Carteira e Gastos ou verificar novamente usa a mesma tentativa. O servidor retorna o resultado anterior sem criar outro lançamento. Envios simultâneos em duas abas compartilham a tentativa pendente no mesmo navegador.

“Verificar e concluir” pode concluir o envio original se ele ainda não chegou ao servidor. “Encerrar tentativa” consulta o servidor: se o lançamento já existe, confirma o resultado; se não existe, bloqueia uma chegada atrasada daquele envio. Encerrar não estorna dinheiro. Depois de uma confirmação, outro lançamento voluntário, mesmo de valor igual, recebe uma nova identidade.

Editar ou excluir uma despesa exige que seu registro ainda corresponda ao que foi aberto. Uma alteração concorrente exige atualizar a lista e revisar os dados. Repetir uma operação confirmada não desfaz alterações posteriores e não recria registros excluídos. O formulário informa alterações posteriores ao confirmar uma tentativa antiga. A exclusão de aportes e retiradas verifica titular, tipo e ausência de vínculo com contrato ou parcela.

O titular vem de `auth.uid()`. A identidade da conta esperada também é conferida para impedir que uma troca de sessão envie a operação para outra conta. O registro de confirmação é privado: somente as duas funções autenticadas acessam a nova tabela. A mutação financeira e o registro de confirmação são gravados na mesma transação.

Sem armazenamento disponível, o login continua permitido, mas um novo lançamento manual não é enviado sem guardar sua identidade. Limpar os dados do navegador ou trocar de navegador perde a tentativa local; isso exige conferir o histórico antes de cadastrar novamente. Versões antigas do aplicativo precisam ser atualizadas para usar esse fluxo. Esta proteção não substitui conciliação bancária e não corrige automaticamente movimentos históricos.

Validação: 808 testes unitários, incluindo 35 casos da nova operação. PostgreSQL isolado verificou chamadas simultâneas, cancelamento antes e depois da gravação, rollback e edição concorrente. Os 259 casos principais de navegador passaram com dados fictícios, incluindo resposta perdida, recarga, navegação, duas abas, armazenamento bloqueado e validação de centavos em Chromium e WebKit. A publicação e a matriz responsiva são conferidas separadamente no relatório de entrega.

A migração cria somente a tabela de confirmações e duas funções. A aplicação em produção exige backup anterior, conferência das permissões e comparação das tabelas financeiras, funções e gatilhos existentes. Para reverter o frontend, preserve a tabela e as funções enquanto houver tentativas pendentes. Nunca apague o histórico de confirmação depois de sua utilização.

A aplicação no servidor criou um backup completo e confirmou registros idênticos em contratos, parcelas, transações, lucros e despesas antes e depois. Funções, permissões e gatilhos financeiros existentes foram preservados. A tabela nova estava vazia após a migração; nenhum lançamento financeiro ou mensagem real foi usado para testar a aplicação.
