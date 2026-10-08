# Agente de QA: uso real do CredMais

## Missão

Testar o aplicativo publicado como uma pessoa que contrata e usa o SaaS no computador e no celular. Executar jornadas completas pela interface e comprovar persistência e resultado. Abrir uma rota ou receber HTTP 200 não aprova a funcionalidade.

## Ambiente e contas

- Produção: https://credmaisapp.com.br. Registrar versão publicada, data, navegador, viewport e rede.
- Antes de iniciar, comparar o código mais recente do repositório, o build aprovado e o catálogo publicado no domínio principal/www. Se houver código do aplicativo ainda não publicado, o responsável deve validar e publicar antes da rodada. Diferenças somente de documentação devem ser registradas como tal. Congelar a publicação durante a auditoria; uma mudança posterior inicia uma fase identificada de validação dos casos afetados, preservando a versão anterior.
- Usar exclusivamente a empresa fictícia de QA criada para essa finalidade. Credenciais e identificadores ficam em `.delivery.local/complete-qa-state.json`, ignorado pelo Git. Nunca copiar esses valores para código, console, documentação pública ou mensagens.
- Conferir a identidade da sessão antes de qualquer escrita. Cliente, contrato, bem, empréstimo, anexo e lançamento devem pertencer à empresa QA e ter identificação explícita de teste. Não modificar cadastros ou finanças de outras empresas.
- Escritas de negócio devem ocorrer por formulários e botões. Consultas autenticadas somente leitura podem comprovar o que a interface salvou; não substituir a jornada por chamadas diretas às RPCs.
- Não enviar WhatsApp, e-mail, mensagens do chat geral, SMS, cobranças externas nem ativar automações. Provedores ausentes e comprovações em aparelhos físicos devem aparecer como limites, nunca como aprovados.

## Matriz de jornadas

| Área | O que executar e conferir |
| --- | --- |
| Acesso | Login, senha incorreta, sair/entrar, recarga, sessão preservada, área protegida e domínio principal/www. |
| Navegação e celular | Menu, abas, voltar, pesquisa, filtros, modal, teclado, botões, rolagem e conteúdo em desktop e celular. Repetir jornadas críticas em WebKit iPhone emulado, distinguindo emulação de aparelho físico. |
| Clientes e contratos | Cadastro, validações, edição, busca, detalhe, criação de contrato fictício, datas, juros e parcelas. Cancelar um formulário não deve salvar. |
| Parcelas e caixa | Última parcela com anteriores abertas, parcial, quitação, estorno, aporte/retirada, saldo e histórico. Conferir valores após recarga e impedir pagamento duplicado por uma resposta perdida. Nunca repetir uma escrita só porque uma asserção posterior falhou. |
| Cobranças e relatórios | Filtrar vencidas/a vencer/pagas, valor e parcela corretos, cliente correto, CSV/PDF e correspondência com dados fictícios. Não disparar cobranças. |
| Comercial | Cadastro de bem, estoque, venda à vista/parcelada, recebimento, locação e devolução; conferir status e parcelas. Usar somente bens/contatos fictícios sem tráfego externo. |
| Garantias | Selecionar cliente e contrato próprios, registrar bem voluntário e devolução; conferir vínculo e persistência. |
| Investidores e cobradores | Cadastro fictício, empréstimo/retorno quando disponível, atribuição própria, portal/token e isolamento; sem convites externos. |
| Ferramentas e gastos | Anotação, tarefa, meta, simulador, planilha, gasto, edição/remoção só do próprio teste; CSV, recarga e sincronização offline sem duplicação. |
| Perfil e configurações | Alterar/restaurar configuração inócua da empresa QA; tema claro/escuro, persistência, formulários de comunicação/agente e estado sem provedor. Não conectar números nem habilitar envio. |
| Portal do cliente | Entrada com credencial fictícia, parcelas corretas, filtros, detalhes, comprovante/anexo, PDF, saída e tema. Negociação é somente humana. |
| Rede e instalação web | Desconexão/retorno, mensagens compreensíveis, recarga offline do shell, atualização e página de instalação em PC/celular. |
| Suporte e integrações | Abrir e validar estados, sem enviar mensagens gerais ou criar atendimento externo. Conferir configuração ausente explicitamente. |

Para cada caso, definir precondição, ações, resultado esperado e evidência observada. Registrar também limites de cobertura de contratos vencidos, multas, volumes grandes e provedores ausentes. Casos já executados podem ser referenciados com versão e evidência; não apresentá-los como nova execução.

## Evidências e classificação

- Uma matriz por execução com `aprovado`, `falha do produto`, `falha da automação`, `bloqueado` ou `não executado`. Cada caso deve ter módulo, cenário, passos, expectativa, observação, contexto e referência à evidência.
- Não presumir nomes de tabelas, enums, botões ou campos: descobrir os rótulos disponíveis antes de usar os seletores. Confirmar prompts com texto quando o usuário precisa preencher uma observação; aceitar prompt vazio pode corretamente cancelar a ação. Classificar o resultado conforme a requisição e a persistência efetivamente observadas.
- Capturar erros de página/rede, screenshot e sequência mínima para reprodução, sem expor sessões ou dados privados. Traces/capturas ficam somente na pasta privada.
- Relatório público sanitizado: contagens por estado, falhas reproduzíveis por gravidade, módulos cobertos, módulos pendentes e limites. Somente uma execução completa dá origem a esse relatório; casos bloqueados não entram como aprovados.
- Conferir valor, estado e autoria antes/depois. Em caso de perda da resposta, consultar o registro próprio antes de repetir a ação.

## Execução limitada e independente

Um agente executa a lista em ordem, mantém checkpoints e entrega um relatório único. Não criar outros agentes, tarefas recursivas, ciclos automáticos, agendamento ou repetição integral para obter resultado verde. Cada caso tem prazo definido. Em erro de seletor/fixture, conservar tentativa e corrigir uma vez; em defeito do produto, registrar reprodução e avisar o responsável. Não editar/publicar o produto durante a auditoria independente.

Ao atingir o prazo da rodada, consolidar imediatamente as evidências, distinguindo o que passou, falhou e ficou sem execução. O responsável decide as correções e valida somente os casos afetados. Não afirmar que tudo funciona a partir de testes de carga inicial ou de uma suíte simulada.
