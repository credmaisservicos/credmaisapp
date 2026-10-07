# Acesso em outros aparelhos e recuperação de senha — 2026-10-07

## Falhas reproduzidas

O adaptador personalizado de sessão propagava erros de leitura e gravação do armazenamento do navegador. A autenticação podia ter sido aceita pelo servidor e ainda assim falhar ao salvar o token. Dois testes de regressão falharam com o código anterior, reproduzindo armazenamento cheio e acesso bloqueado. Preferências de tema, idioma, apresentação de clientes, notificações e conclusão do tour também podiam interromper telas por falha no armazenamento.

Isso representa uma causa possível para acessos que funcionam em um aparelho e falham em outro. A causa específica do relato continua sem confirmação no aparelho afetado; não se deve atribuir qualquer mensagem de conexão a esse problema.

## Comportamento corrigido

A sessão fica nesta janela quando o armazenamento não está disponível. A escolha de lembrar a conta continua sendo respeitada quando o navegador permite persistência. A migração entre armazenamento persistente e temporário preserva o token atual; logout limpa as duas cópias e uma gravação recusada não recupera um token antigo. Se a sessão existir apenas em memória, o login informa que será necessário entrar novamente ao recarregar ou fechar o app. As permissões continuam sendo verificadas no servidor.

Preferências e caches públicos têm tratamento próprio, separado da sessão. Falhas de armazenamento não interrompem o painel ou a área de clientes. A conclusão do tour fica vinculada à conta: o marcador antigo de outra pessoa não conclui o tour da conta atual. Consultas e temporizadores do tour não abrem orientação após sair da conta.

Requisições de autenticação recebem cancelamento de rede após 15 segundos, incluindo espera pelo corpo da resposta. Outros pedidos, como uploads, mantêm o comportamento anterior. Não foi adicionada repetição automática de gravação de senha ou solicitação de e-mail. O proxy publicado anteriormente continua encaminhando HTTP pelo domínio do app e mantendo a chave original de armazenamento do SDK.

A recuperação de senha libera os botões quando há erro ou demora, impede envio duplicado e aplica intervalo de 45 segundos entre envios confirmados. Senha recusada, diferente da confirmação ou falha temporária permite corrigir o formulário sem encerrar um link válido. Sessão inválida exige um novo link. Após concluir, o logout é limitado à sessão local. Links solicitados pelo APK apontam ao site público, preservando uma rota de retorno segura. A interface não promete um prazo fixo de validade do link.

## Evidências e limites

548 testes Vitest e 229 testes de interface passaram, com tipos, lint, regras de hooks e build de produção aprovados. A CI também executa as 222 verificações compartilhadas e 220 integrações HTTP existentes; estes componentes não receberam alterações nesta rodada.

Os testes usam contas fictícias e respostas interceptadas. Incluem o SDK real de autenticação com armazenamento indisponível, simulação de quota e bloqueio total no navegador, retorno ao login após recarregar uma sessão em memória, acesso à área de clientes, senha recusada seguida de correção, cancelamento de rede e isolamento do tour por conta. Não foram enviados e-mails reais, alteradas senhas de usuários ou efetuadas cobranças para esses testes.

A inspeção do servidor confirmou presença das configurações SMTP e endereço público de retorno. Isso não comprova entrega de e-mail. O funcionamento no aparelho que apresentou o erro, a entrega real de recuperação e os cenários do checklist manual permanecem sujeitos a validação própria. Esta alteração não exige migração de banco nem republicação das funções do bot e não altera registros financeiros.
