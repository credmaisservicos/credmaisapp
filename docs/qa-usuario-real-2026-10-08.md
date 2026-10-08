# QA independente do uso real — 08/10/2026

Roteiro reutilizável do agente: [QA de uso real](agentes/qa-real.md). Antes e após a execução, o responsável confirmou que o catálogo publicado permaneceu igual ao build validado e não houve alteração do código do aplicativo durante a rodada.

Foram registrados **66 cenários finais: 40 aprovados, quatro falhas de produto (dois defeitos), nove bloqueados e 13 não executados nesta rodada**. Esta é a primeira rodada independente de jornadas; casos bloqueados e não executados não representam aprovação.

**Resultado: dois defeitos funcionais confirmados.** Rodada 2026-10-08T17:14:08Z–2026-10-08T17:37:55.142Z, 23.8 minutos, encerrada antes do limite de 25 min. Nenhuma edição/publicação do produto ou commit.

Versão publicada: **340b098ea4e26ff9ad4ce10f4d08119040d16313**. Deployment: **6a58aca0-8a37-4db6-8cec-e86fe12b044a**. Fingerprint: **54c23fa7f84ca2616457a23c581b18df6d6144250b245fcca94a16a24b653285**. Código atualizado confirmado pelo responsável antes do início; HEAD 8d809b30a698d077c13a3376bb82bc3b944eb4f4 difere apenas em documentos.

Conta exclusiva fictícia, sem privilégios administrativos. GET Auth do navegador correspondeu exatamente ao owner privado; referências de cliente/contrato/bem/investidor/cobrador conferidas na mesma empresa antes das escritas. Telefone de todos os zeros do cobrador autorizado exclusivamente para QA; sem contato real ou convite.

## Contagens sem duplicar diagnósticos

| Estado final | Casos |
|---|---:|
|APROVADO|40|
|FALHA_PRODUTO|4|
|FALHA_AUTOMACAO|0|
|BLOQUEADO|9|
|NAO_EXECUTADO|13|

70 tentativas estão preservadas separadamente no JSON, com estado original e classificação contextual. Não somá-las aos casos finais. Falhas de automação incluem nomes de botão/seletor, prompt vazio, comparação de gênero/casing, regex que casava query, fórmula mensal presumida, origem do anexo e tabela de despesas presumida. Correções foram dirigidas ao alvo, sem recriar pagamentos/bens/garantia/modelo/anexo já salvos.

## Defeitos reproduzíveis

**QA-01 — Alta: interface não cria venda à vista, parcelada ou locação.** Cadastrar bem fictício disponível; abrir Registrar venda/Nova locação; selecionar cliente/bem fictício de QA; preencher valores/datas válidos e confirmar. POST create_business_operation retorna HTTP 400, P0001, “Operação inválida”; modal permanece. GET antes/depois prova zero operações comerciais. A fonte envia dados sem kind, exigido pelo servidor. Evidências: comercial.json, comercial-repro.json e comercial-repro-sale-error.png. Recebimentos, devolução de veículo/caução e caixa comercial ficaram bloqueados.

**QA-02 — Média: busca alfabética do portal do cobrador não filtra.** Entrar com token próprio gerado pela UI; buscar CLIENTE FICTICIO INEXISTENTE. Sem correspondência no nome, o cartãoQA/R$ 12 continua visível. Busca numérica inexistente zera os resultados. Fonte compara telefone/CPF com string vazia quando consulta não contém dígitos. Evidências: ultimo-alvo.json e collector-search-falha.png.

## Jornadas novas comprovadas

- Estoque: três bens fictícios próprios, valores/status após recarga, busca/filtros, obrigatórios e cancelamento sem gravação.
- Garantia: recebimento voluntário vinculado ao contrato QA, observação de devolução na UI, returned único e recarga; nenhum cadastro/devolução duplicado.
- Investidor: cadastro sem CPF/contato/PIX, empréstimo R$ 1+20%=R$ 1,20, inválido sem gravação, retorno parcial R$ 0,20 e quitação R$ 1 únicos/paid. Portal legítimo antes das baixas; pós-quitação do portal não reexecutado.
- Cobrador: cadastro exclusivamente fictício com número inválido autorizado, atribuição única do cliente QA, token legítimo, portal 360 px, filtros, recarga e saída somente leitura. Busca alfabética tem defeito próprio.
- Ferramentas: meta R$ 2/incremento R$ 1/50%; planilha com busca/CSV; simulador 20% mensal×2, total de R$ 14/parcela de R$ 7, modelo salvo único/carregado.
- Relatórios: CSV e PDF baixados; CSV cruzado com retornos de R$ 1,20 e parcelasR$ 24. PDF só integridade básica. Anexo TXT fictício criado pela UI, recarga e bytes exatos no gateway público HTTPS; nenhum arquivo apagado.
- Acesso: senha incorreta recusada, mostrar/ocultar, login/recarga/logout/relogin, proteção sem sessão, quatro rotas administrativas recusadas, sete aliases e404/retorno.
- Perfil/configuração: nome alterado/restaurado, tema alternado/restaurado; seis abas de comunicação e busca sem provedor. Bot/enviofalse preservados; nenhuma mensagem ou automação.
- Móvel: Chromium 360 px e WebKit iPhone emulado — menu→Comercial→Estoque, busca/filtros/modal inválido/cancelado, contrato próprio/filtros/voltar e cálculo. Sem overflow horizontal global. Nav inferior aparece sobre a composição inicial do modal; hit-test e clique do preço passaram após rolagem nos dois. Limitação visual, sem terceiro defeito funcional comprovado.

## Observação financeira e limites

Carteira inicial de R$ 4,00 e final de R$ 2,80 refletem retornos de R$ 1,20. Empréstimo do investidor registra capital recebido de R$ 1, sem entrada correspondente observada em transactions. A expectativa de negócio dessa captação não foi encerrada; sua integração com caixa não é declarada aprovada.

Portal do cliente legítimo 360 px validouCPF vazio/zeros inválidos com botão disabled e tema; login financeiro/parcelas/comprovante/PDF próprios bloqueados porque cliente QA não tem CPF. Não usada a conta WhatsApp anterior.

Criação/edição completa de cliente/contrato, pagamentos do cliente, gastos, anotações, tarefas/offline, login www e PWA offline ficam como **referência anterior**, conforme docs/teste-completo-2026-10-08.md e relatórios respectivos; não contam como execução nova. Dashboard/Hoje/Análises/Lucros/Histórico financeiro/hubs/suporte/notificações/chat e páginas públicas têm referências de carga/navegação anteriores, com funções não executadas claramente pendentes.

Sem aparelho físico/APK/teclado virtual real, recuperação por email/convites, WhatsApp/email/SMS/chat geral, agente/provedores reais, pagamentos externos, compra de plano, grandes volumes/juros de atraso integrais e revisão visual do PDF.

## Artefatos

Matriz consistente, inventário das 70 rotas com escopo, tentativas/erros HTTP e evidências: **resultado.json**. Scripts e capturas somente em **.delivery.local/qa-agent/**. Resultados privados preservados; resumo sem credenciais, tokens, URLs assinadas ou identificadores de contas/clientes.


## Diagnóstico de rede pendente

Foram preservados **três pageerrors WebKit** em consultas auxiliares de chat e perfil, com mensagem Fetch/access control. As jornadas móveis concluíram, mas não há isolamento suficiente da causa. Não é declarada ausência de erros; investigação direcionada permanece pendente. `automationDiagnostics` no resultado.json liga cada tentativa de automação ao cenário final ou à pré-condição bloqueada.
