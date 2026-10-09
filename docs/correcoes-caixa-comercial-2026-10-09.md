# Baixa comercial e Carteira — 09/10/2026

Correção das pendências **QA-03** e **QA-04**, comprovadas na [validação anterior](correcoes-qa-2026-10-08.md). Código publicado `a6d7512a134d09de6bd8c8e469336348d2ff41f5`, Cloudflare Pages `3064a6e9-26e5-4b64-bfa5-3914ef2b47ad`. Catálogo principal/www igual ao build aprovado, fingerprint `145fa52fcb7bc064c1c5ffdfb8cf68adf2fdbe3b84a073acf260cb72f713ebeb`.

## Correções

- **QA-03:** a função de recebimento declarava uma variável `r` e utilizava o mesmo nome como alias da tabela. A referência ambígua impedia qualquer baixa com erro SQL 42702. A migração substitui os nomes e explicita o titular da parcela, preservando os bloqueios, a identificação do pedido e a conclusão da venda somente após quitar todas as parcelas.
- **QA-04:** a Carteira considerava parcelas de empréstimos, aportes e despesas, mas omitira `business_income`, `security_deposit` e `business_refund`. O relatório agora inclui receitas comerciais e cauções como entradas, estornos/devoluções como saídas. Usa os lançamentos existentes, a mesma data financeira brasileira e os mesmos filtros/paginação, sem duplicar recebimentos de empréstimos ou presumir lucro comercial.

Migrações novas: `20261009000000_commercial_payment_alias.sql` e `20261009010000_wallet_commercial_cash.sql`. Os arquivos históricos não foram reescritos. A Carteira consulta dados em leitura; nenhum lançamento foi recriado para ajustar o saldo.

## Testes técnicos

Oito regressões contra as funções anteriores reproduziram os defeitos. Após correção, passaram **35 testes direcionados** de caixa/comercial e **971 testes em 120 arquivos** na suíte completa, além de typecheck, lint e build de produção.

A execução completa inicial encontrou um timeout no teste `paymentAllocationNotice.test.tsx / fecha a conferência e descarta resposta atrasada ao trocar de empresa`, aguardando o modal carregado por importação dinâmica. O caso passou isolado. A suíte completa passou com quatro workers; tentativas originais preservadas, sem relaxar as asserções ou modificar essa funcionalidade.

Em **PostgreSQL real, numa base temporária isolada**, passaram pagamento parcial e quitação, última parcela primeiro mantendo a dívida ativa, pedido repetido gerando um único recebimento, leitura consistente durante transação concorrente, aluguel e devolução única da caução, cancelamento com estorno único e recusa de parcela de outra empresa. A base temporária foi removida ao terminar. Zero pagamentos no banco de aplicação nessa etapa.

## Publicação e preservação dos dados

Backup antes da atualização em `/root/.credmais/commercial-cash-20261009T124730Z`, dump de 8.090.537 bytes e definições anteriores das duas funções para reversão pontual. A aplicação ocorreu numa transação com comparação dos registros de **20 tabelas**, numa mesma visão consistente do banco. Registros, titulares e grants permaneceram iguais. A publicação não gravou pagamentos nem enviou mensagens.

Uma verificação inicial de hash interrompeu a publicação antes de qualquer alteração por diferenças de quebra de linha CRLF/LF entre Windows e a leitura Python. Nova leitura confirmou definições rigorosamente iguais às salvas; o hash normalizado permitiu aplicar o mesmo conteúdo revisado. Evidência dessa verificação preservada.

As duas funções corrigidas foram conferidas no banco publicado. Evidências e credenciais somente em `.delivery.local/qa-agent/`, ignorada pelo Git. Os testes pela interface utilizam exclusivamente os registros fictícios existentes; a conta admin real permanece reservada à leitura.

## Atualiza??o do saldo ap?s navega??o

O QA real encontrou mais um defeito: a Carteira reutilizava por dois minutos o relat?rio salvo no navegador. Uma baixa correta podia aparecer no banco, mas o saldo permanecer antigo na mesma sess?o. A consulta agora usa `staleTime: 0` e `refetchOnMount: always`, buscando o saldo atual ao retornar ? tela e ao recarregar. C?digo `b78576c1615093cdaa7e5699ae9e0d316c71dcfc`.

Passaram seis testes Chromium: cache persistido com conex?o realtime ativa, retorno por navega??o, recarga, larguras 320/390/1366, busca/pagina??o e recupera??o de erro sem inventar saldo zero. O mock foi corrigido para responder ao protocolo Phoenix em arrays; a falha de configura??o inicial e as tentativas anteriores permanecem nas evid?ncias privadas. A su?te completa passou novamente: 971 testes em 120 arquivos, al?m de typecheck, lint e build.

Na primeira rodada real, as duas parcelas de venda foram baixadas uma vez cada e a venda concluiu somente ao quitar ambas. O teste foi interrompido ao detectar o saldo em cache. As parcelas j? pagas n?o ser?o repetidas; a rodada final verifica a mesma Carteira, o aluguel pendente e a devolu??o da cau??o.

A vers?o da Carteira foi publicada no Pages `3f60bae4-f4db-4324-bf01-261436bc2cf9`. Dom?nio principal e www responderam HTTP 200 com cat?logo id?ntico ao build: `4193bec81f74e96e1a92187ca4aa7f26f82887bb4e3786a7402e2be6be192608`. Os arquivos publicados da Carteira, entrada JavaScript e CSS corresponderam aos hashes locais e aos tipos de conte?do esperados. O deploy autom?tico continua habilitado.

## Valida??o pela interface publicada

Somente a conta fict?cia da auditoria foi alterada. As duas parcelas comerciais foram pagas uma vez cada; a venda permaneceu ativa ap?s a primeira e concluiu ap?s a segunda. A Carteira mostrou R$ 9,80 ap?s recarga normal. O aluguel pendente foi baixado uma vez por R$ 2,00, levando o saldo a R$ 11,80. A devolu??o ocorreu uma ?nica vez e retornou HTTP 204, esperado para RPC sem retorno; o GET confirmou opera??o conclu?da, cau??o de R$ 1,00 devolvida, ve?culo dispon?vel e exatamente um estorno de R$ 1,00.

No encerramento, o Chromium mostrou R$ 10,80 ap?s recarga e navega??o Painel ? Carteira na mesma sess?o. WebKit emulado em 390 ? 844 confirmou a identidade fict?cia, o mesmo saldo ap?s recarga e a loca??o conclu?da, somente em leitura. Zero erros de p?gina e zero falhas HTTP nesses dois cen?rios finais.

Limita??es de automa??o preservadas: uma recarga do produto interrompeu o contexto durante a primeira confer?ncia GET; uma asser??o esperava 200 para a devolu??o void, cujo retorno correto ? 204; outra navega??o procurou o r?tulo Dashboard em vez de Painel. A continua??o confirmou os registros antes de qualquer a??o e n?o repetiu os pagamentos ou a devolu??o. O fechamento de R$ 11,80 foi verificado na sess?o de continua??o, n?o na primeira p?gina interrompida.

Evid?ncias privadas: `commercial-finance-live-resultado.json` (rodada anterior interrompida), `commercial-finance-live-final-read.json`, `commercial-finance-live-final-webkit-read.json`, checkpoints e screenshots em `.delivery.local/qa-agent/`. Nenhuma mensagem ou convite foi enviado. Os resultados encerram QA-03, QA-04 e o defeito de cache observado nesta rodada; n?o substituem a auditoria integral nem encerram as dez pend?ncias hist?ricas.
