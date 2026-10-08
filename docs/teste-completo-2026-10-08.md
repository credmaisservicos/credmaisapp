# Verificação completa solicitada

Rodada solicitada pelo usuário em 8 de outubro de 2026, após a correção de DNS. Executar uma matriz completa uma vez, conservar falhas e corrigir somente quando a evidência identificar o problema. Não repetir testes para ocultar falhas.

Produção: criar uma empresa exclusiva de QA, sem número WhatsApp nem credenciais de pagamento, com clientes e contratos explicitamente fictícios. Testar autenticação e módulos publicados em desktop e celular emulado. Escritas financeiras reais dessa empresa só podem usar os registros fictícios criados para esta rodada. Nenhuma conta ou cliente preexistente recebe alterações. Mensagens externas permanecem restritas ao número previamente autorizado na conta de testes do usuário.

Homologação isolada: executar a CI completa, incluindo tipos, lint, dependências, funções, integrações, unitários, navegadores e PostgreSQL/Auth/Storage/Edge com duas empresas fictícias. Operações destrutivas, concorrência, isolamento entre empresas e provedores de pagamento são verificados nessa rede isolada.

| Escopo | Estado |
| --- | --- |
| CI completa do código atual e fixture corrigida | [37806673464](https://github.com/credmaisservicos/credmaisapp/actions/runs/37806673464) aprovada; nova validação necessária após correções identificadas na produção. |
| Conta exclusiva de QA e login real | Criada sem privilégio administrativo, sem contatos externos; bloqueio de conta sem assinatura conferido. Acesso de QA concedido por sete dias apenas nessa empresa. |
| Módulos publicados, desktop e celular emulado | Primeira rodada em 34 rotas, Chromium desktop/360px e WebKit iPhone emulado. Evidência identificou HTTP 400 na leitura dos clientes comerciais, HTTP 404 em chamada opcional da tela Hoje e landmarks main aninhados. Corrigir e validar publicação. |
| Cliente, contrato, parcial, quitação, estorno e caixa fictícios | Cliente/contrato de três parcelas criados pela interface. Última paga mantém contrato ativo; parcial mantém saldo; quitação completa conclui; estorno reabre e corrige o caixa. R$ 10 de aporte - R$ 30 de liberação + R$ 24 recebidos = R$ 4, todos fictícios. |
| Relatórios, exportação, anexos e isolamento | PDF de relatório real gerado na empresa fictícia. Upload real aprovado, mas a URL renovada apontou para kong:8000 e falhou com ENOTFOUND. Correção usa o gateway público configurado, preservando caminho/token, autorização e prazo. Regressões unitárias e downloads reais de owner/portal na homologação adicionados; conferir publicação. |
| Portal da conta autorizada | Quatro combinações 360/1366px claro/escuro aprovadas: acesso, filtros, detalhes, recarga, PDF, saída e empresa preservada. Sem negociação automática. |
| Cobranças e contexto do WhatsApp autorizado | Gemini real preservou resultado da ferramenta fictícia. Conversa autorizada atualmente pausada para humano; webhook real devolveu paused, zero respostas e finanças preservadas. Configuração atual tem envio automático ativo; testes antigos que presumiam flag desativada recusaram execução antes de enviar. Não alterar a escolha atual do usuário. |
| Recuperação de acesso, rede e sessão | A executar |

Credenciais, CPF, tokens, mensagens e capturas com dados ficam somente na pasta privada ignorada `.delivery.local`. Relatório público deve registrar resultados e limites sem expor esses dados. Recebimento físico no WhatsApp/e-mail, uso prolongado em aparelhos externos e pagamentos do Mercado Pago não podem ser declarados aprovados apenas por emulação ou aceite do provedor.

Correções desta rodada: consultas comerciais passam a solicitar somente as colunas existentes id/name/cpf_cnpj. Hoje conserva o resumo financeiro canônico e seus alertas de composição/data, removendo a chamada opcional inexistente e o selo de conciliação que ela alimentava. Páginas internas comerciais e chat usam section dentro do main único do layout. Nenhuma migração nem alteração de contas financeiras preexistentes.

A leitura real de um arquivo recém-criado revelou a terceira falha: o SDK assinava pelo endereço interno do Docker. O endpoint upload-urls agora converte somente assinaturas do gateway interno/público confiável para SUPABASE_PUBLIC_URL. Não usa Host/Origin da requisição para decidir o destino, nem permite origem estrangeira, credenciais ou rota de objetos públicos. Também substitui a porta interna. Regressões cobrem token/caminho codificados, prefixo público e origens/rotas inválidas. A homologação passa a baixar os bytes dos links emitidos pelo Edge, além de verificar a sua presença.

Diagnósticos de automação preservados: tour inicial aberto bloqueou clique da primeira execução; o teste passou a esperar e encerrar o tour pela interface. Duas asserções usavam rótulos diferentes dos valores reais do servidor (completed e loan_disbursement); foram ajustadas sem reexecutar pagamentos já aplicados. WebKit registrou cancelamentos por navegação durante a carga inicial; a próxima rodada espera o fim dessa carga, sem ignorar erros. A primeira matriz de produção continua retida separadamente.
