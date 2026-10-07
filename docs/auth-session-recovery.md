# Recuperação da sessão e do perfil

Revisão de 7 de outubro de 2026 após o relato da tela **Não foi possível verificar seu acesso**.

A consulta do perfil pode receber HTTP 401 quando o token de acesso armazenado é rejeitado. O app anteriormente mostrava o erro sem renovar essa sessão. Além disso, um novo login ou uma renovação para o mesmo usuário era ignorado pelo carregamento de perfil, mesmo quando a consulta anterior havia falhado.

O carregamento agora renova a sessão uma única vez ao receber 401 e repete as consultas de perfil e de permissão administrativa. A nova sessão deve pertencer ao mesmo usuário. Se a renovação falhar ou a consulta continuar rejeitada, o acesso permanece indisponível e o botão de tentar novamente continua disponível.

Uma consulta que falhou também pode ser retomada após `SIGNED_IN` ou `TOKEN_REFRESHED` na mesma conta. Consultas já bem-sucedidas não são repetidas por notificações duplicadas. As consultas continuam começando fora do callback de autenticação do SDK. Ao reconectar, o perfil é revalidado, inclusive quando havia sido carregado do cache offline.

Respostas tardias são descartadas após logout, troca de conta ou desmontagem do provider. Uma negativa HTTP 403 não provoca renovação nem é substituída por permissões em cache. Falhas na consulta administrativa não promovem o usuário a administrador.

Diagnóstico do servidor foi feito com leituras: disponibilidade de autenticação e REST, preflight CORS, presença dos perfis, acesso às próprias linhas via RLS e consistência das chaves de autenticação entre os serviços. Nenhuma política, chave, conta ou registro financeiro foi alterado.

As regressões usam backend fictício e cobrem 401 recuperável e persistente, novo login, renovação na mesma conta, reconexão, revogação de administrador, logout e troca de usuário durante a renovação.

## Logout local e acesso aos portais

O logout normal, a saída do portal e os atalhos de recuperação agora encerram somente a sessão do navegador atual. O código anterior usava o escopo global, inclusive ao entrar no portal do cliente, e podia invalidar a renovação da conta em outros aparelhos.

Ao abrir o portal, a área do credor fica bloqueada neste documento, inclusive durante a limpeza da sessão. Depois de capturar a sessão anterior para encerrá-la no servidor com escopo local, o adaptador impede que uma renovação atrasada grave novamente credenciais do credor. A saída completa recarrega o documento. As rotas do app e a tela de login não mostram conteúdo do credor enquanto o portal está ativo; verificações de assinatura da conta também não são iniciadas por essas rotas.

As credenciais do cliente e do cobrador usam somente armazenamento da aba. Quando o navegador bloqueia esse armazenamento, a sessão fica em memória nesta janela. CPF e dados financeiros não são gravados nesse adaptador; o marcador do cliente só aceita token UUID válido. Logout impede recuperar uma cópia antiga nesta janela. Uma sessão apenas em memória precisa de novo acesso ao recarregar ou fechar o documento. Essa tolerância não substitui as validações de titular, cliente, token e atribuição no servidor.

Consultas de login e atualização dos portais são canceladas após 10 segundos. Falha de rede ou demora libera o formulário, sem afirmar que o token é inválido. Uma credencial de cobrador recusada pelo servidor remove a tela e a cópia local. Respostas antigas de login, atualização e pagamento não restauram o portal após sair ou desmontar a tela; uma operação financeira já enviada pode ter sido processada pelo servidor e não é automaticamente repetida. Os dados do formulário de assinatura são limpos ao sair, e uma falha na consulta de assinaturas não interrompe a página.

As assinaturas das duas RPCs de contrato foram conferidas no catálogo do PostgreSQL e incluídas nos tipos do cliente, sem alterar as funções implantadas. O fluxo de login por CPF mantém a validação existente e a confirmação do servidor.

### Validação e pendências

569 testes unitários e 234 testes de interface: 218 cenários principais e 16 verificações responsivas. Cobrem armazenamento cheio e bloqueado nos dois portais, isolamento com token UUID válido, logout local, formulário após falha, credencial revogada, cancelamento e resposta atrasada de pagamento. Uma passagem local da matriz responsiva encontrou a raiz vazia ao abrir relatórios; a repetição passou, sem causa determinada. O teste agora registra erros de JavaScript e scripts que falharam para diagnosticar uma recorrência.

No servidor, duas sessões temporárias da conta de testes autorizada confirmaram o escopo: a primeira foi encerrada e não conseguiu renovar; a segunda renovou normalmente. Sessões anteriores foram preservadas e as duas temporárias foram removidas. A geração dos links ocorreu pela API administrativa, sem envio de e-mail e sem mudança de senha. Nenhum pagamento real ou mensagem foi enviado; não houve migração nem alteração de registros financeiros ou funções do bot nesta rodada.

A confirmação no aparelho que apresentou o erro e a entrega real de e-mail continuam pendentes. Permanecem em revisão as chamadas HTTP diretas da tela de agente e exportação, conexões de tempo real em redes restritas e os demais itens do checklist de entrega. Esses resultados não comprovam a conclusão de toda a aplicação.
