# Testes completos com conta exclusiva de QA — 8 de outubro de 2026

Criada uma empresa exclusiva de QA, sem privilégio administrativo, contatos externos, número WhatsApp ou credenciais de pagamento. O bloqueio de conta sem assinatura foi conferido; depois, somente essa empresa recebeu sete dias de acesso para QA. Cliente, contrato, tarefas, anotações, investidor e arquivo são explicitamente fictícios. Nenhuma operação financeira foi aplicada a contas preexistentes.

## Publicação

Web: **340b098ea4e26ff9ad4ce10f4d08119040d16313**. Cloudflare: **6a58aca0-8a37-4db6-8cec-e86fe12b044a**, concluída às **16:50:13 UTC**. Fingerprint: **54c23fa7f84ca2616457a23c581b18df6d6144250b245fcca94a16a24b653285**; catálogo publicado igual ao build local. Publicação automática permanece habilitada. O foco desta rodada é a web; o APK não foi usado como comprovação.

## Matriz automatizada completa

[CI 37809899592](https://github.com/credmaisservicos/credmaisapp/actions/runs/37809899592) aprovada na base **925042459186ccc575f1e05becd03cbfc91e7539**:

- **955 testes unitários / 117 arquivos**, tipos, lint, hooks, funções, build e dependências aprovados; auditoria reportou zero vulnerabilidades.
- **225 testes compartilhados** e **312 integrações HTTP com provedores simulados** aprovados.
- **196 verificações reais isoladas** com PostgreSQL, Auth, PostgREST, Storage e Edge Runtime: duas empresas fictícias, rede Docker interna, zero conexões a produção, mensagens ou dados de clientes copiados. Pagamento parcial/integral/estorno, caixa, classificação humana, concorrência, referências entre empresas, portais, recuperação de senha, permissões e downloads de anexos assinados.
- Interface isolada: **275 casos principais, 16 responsivos, três de isolamento de uploads e dez de classificação humana**, aprovados diretamente, sem retry/flaky registrado.

[Evidência da homologação](https://github.com/credmaisservicos/credmaisapp/actions/runs/37809899592/artifacts/11565365047) e [da interface](https://github.com/credmaisservicos/credmaisapp/actions/runs/37809899592/artifacts/11564224549) retidas por sete dias. Somente sondagens opcionais de UI externa foram puladas; a homologação real obrigatória executou.

O commit publicado acrescenta à base validada somente o destino do botão Tarefas abertas. Esse endereço recebeu lint/tipos/build locais e teste de clique nos três contextos publicados, sem repetir a CI completa por um link.

## Quatro correções comprovadas e publicadas

1. **Clientes comerciais:** Comercial, Vendas, Locações e Garantias solicitavam coluna inexistente, causando HTTP 400. Agora usam id/name/cpf_cnpj. Cliente fictício selecionável nas três operações; contrato da garantia também listado.
2. **Hoje:** retirada chamada opcional a RPC inexistente que gerava HTTP 404, junto com o selo dependente dela. Preservados resumo financeiro canônico e alertas de composição/data. Páginas comerciais e chat usam section dentro do main único do layout, corrigindo landmarks aninhados.
3. **Anexos:** upload real criou link renovado para kong:8000, inacessível ao usuário. Endpoint passa a usar o gateway público configurado, preservando token, caminho e validade. Aceita somente origens confiáveis e rota privada válida; não confia no Host/Origin do visitante. Seis regressões unitárias e oito verificações isoladas de URL/download acrescentadas. Produção confirmou bytes exatos e prazo de cinco minutos; visitante e outra empresa não obtêm o link.
4. **Tarefas:** botão de Hoje abria /tarefas e mostrava Página não encontrada. Corrigido para /ferramentas/tarefas e clicado nos três contextos publicados.

Backend de anexos publicado com backup **/root/.credmais/upload-public-origin-20261008T163914Z**, hashes conferidos, sem migração financeira, reinício global, movimentação ou exclusão de arquivos de clientes.

## Testes reais no aplicativo publicado

**34 rotas em Chromium desktop, Chromium celular 360px e WebKit iPhone emulado**, com login real na empresa QA: **109 verificações** incluindo retorno de rede/recarga, atalhos e PDF. Rotas sem overflow, erros de página ou HTTP nos contextos aprovados. Páginas públicas, proteção de área autenticada e PWA offline/retorno: **31 verificações**. Seletores comerciais: **três verificações**. Catálogo: **227 JS/CSS** com bytes, hashes e tipos conferidos, incluindo as duas respostas iniciais transitórias descritas abaixo.

Pela interface, criado cliente e contrato de três parcelas. Pagar a última manteve o contrato ativo enquanto havia outras dívidas; parcial manteve saldo; quitação completa concluiu; estorno reabriu e ajustou o caixa. Conferência real: **R$ 10 de aporte − R$ 30 de liberação + R$ 24 recebidos = R$ 4**, inteiramente fictícios.

Anotação criada/editada/recarregada; tarefa criada/concluída/reaberta; tarefa offline sincronizada uma única vez ao reconectar. Gasto fictício criado, editado, exportado em CSV e excluído somente na empresa QA; caixa voltou ao valor anterior. Investidor fictício cadastrado sem contato ou empréstimo. PDF gerado. Upload, renovação da URL, download e recusas de acesso externo conferidos.

Login real pelo domínio principal e www identifica a mesma empresa. Sair de uma sessão temporária invalidou seu refresh sem invalidar a outra; sessão original de QA permaneceu válida. Nenhum e-mail enviado ao endereço fictício.

## Portal, agente e provedores

Portal da conta de testes previamente autorizada aprovado em **360/1366px e claro/escuro**: login, filtros, detalhes, recarga, PDF e saída; empresa preservada, sem negociação automática, overflow ou erros HTTP/página. Nenhuma operação financeira nessa conta.

Gemini real preservou o valor devolvido pela ferramenta fictícia. Conversa WhatsApp autorizada está pausada para atendimento humano: webhook real retornou paused, zero respostas externas e finanças preservadas. Envio automático está atualmente habilitado nessa conta, mas a pausa foi respeitada; não alterada a configuração do usuário nem acionado runner geral. Testes antigos que presumiam envio desativado recusaram execução antes de enviar e foram conservados como diagnóstico.

Leitura real confirmou **ausência das três credenciais do Mercado Pago**; endpoint indica não configurado. Nenhum pagamento real/sandbox foi declarado testado. SMTP está configurado, mas recebimento em caixa postal externa não foi comprovado.

## Diagnósticos conservados e limites

Fixtures corrigidas: tour inicial bloqueando clique; asserções com nomes diferentes dos enums reais completed/loan_disbursement; navegação durante carga inicial WebKit; botão comercial chamado Registrar venda em vez do nome presumido. Não repetidos pagamentos já aplicados. A primeira matriz que revelou os problemas do aplicativo foi preservada.

Imediatamente após a publicação, dois dos 227 JS/CSS retornaram 404. Ambos depois responderam 200 com bytes/hashes corretos, conferidos individualmente; causa exata da janela inicial não comprovada. Na mesma janela, o primeiro login desktop não apareceu em 12 segundos. Tentativa retida; verificação separada desse contexto passou com 37 casos, sem repetir os 72 casos móveis aprovados. Três asserções públicas leram texto antes da montagem; passaram a esperar a interface, conferindo também erros HTTP/página nos casos afetados. Esses diagnósticos não foram apagados nem contados como aprovação inicial.

Credenciais, CPF, tokens, capturas e relatórios privados ficam somente na pasta ignorada .delivery.local. Emulação não comprova o aparelho físico com sem conexão, instalação/uso prolongado ou recebimento no WhatsApp/e-mail. URLs atuais corrigidas não revogam links antigos de longa duração. Decisão sobre juros zero e conciliação histórica com documentos reais continuam abertas. A [lista de pendências](pendencias-entrega-2026-10-08.md) mantém esses limites e o histórico das causas ainda não comprovadas.
