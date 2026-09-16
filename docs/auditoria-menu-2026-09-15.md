# Auditoria do menu e responsividade — 2026-09-15

## Escopo validado

- Menu de operação: 39 rotas auditadas, incluindo Garantias, os três submódulos Comerciais, o redirecionamento de contrato e os detalhes de cliente/investidor.
- Menu administrativo: 8 rotas/seções, incluindo auditoria do bot, trilha de auditoria e histórico.
- Viewports: 280x640, 320x720, 390x844, 768x1024, 1024x768, 1366x900 e 1920x1080.
- Backend: sessão autenticada isolada e respostas Supabase simuladas, sem gravar dados reais.

## Resultado

- A Carteira agora converte valores financeiros inválidos para zero antes de calcular saldo, composição e percentuais, evitando `NaN` em indicadores; typecheck e lint passaram.

- Lista, Kanban e calendário de Cobranças agora declaram `type="button"` em todos os controles de ação e navegação; o smoke compacto permaneceu aprovado.

- No submódulo de Cobranças, parcelas sem vencimento não são mais rotuladas como “vence hoje”, e timestamps inválidos de cobrança não geram `NaN`; typecheck, lint e smoke compacto passaram.

- Cobranças agora trata vencimentos inválidos sem gerar `NaN` no detalhe da parcela, e o Kanban não classifica registros sem data como vencimentos futuros; smoke compacto passou.

- Suporte do usuário e Inbox administrativo agora tratam datas nulas ou inválidas com fallback legível, sem exceções do `date-fns`; o smoke autenticado compacto passou incluindo os dois módulos.

- O Inbox do WhatsApp agora normaliza conversas com nome/telefone/data/etiquetas ausentes antes de filtrar e gerar iniciais; o breakpoint de 280px com fixture parcial passou sem erro.

- A regressão do Portal do Investidor também cobre empréstimo com valores inválidos e `total_due` zero; a barra permanece em 0% e a interface não exibe `NaN` (1/1 aprovado).

- Foi adicionada regressão E2E específica para o Portal do Investidor com payload RPC incompleto: 1/1 passou em 320px, sem overflow ou erro JavaScript.

- Os portais do cliente e do investidor agora normalizam payloads RPC parciais, evitando exceções quando contratos, empréstimos, pagamentos, identidade ou branding chegam nulos; 12 verificações responsivas públicas passaram.

- Formulários e modais financeiros foram endurecidos contra submit implícito: botões de navegação, cancelamento, fechamento, busca de CEP e seletores auxiliares agora têm `type="button"`.

- Modais financeiros passaram a declarar `type="button"` em fechar, cancelar, buscar CEP e seletores auxiliares, evitando submits implícitos em formulários.

- O stream de negociação do Portal do Cliente agora tolera lista de mensagens vazia durante atualizações; typecheck, lint e matriz autenticada foram revalidados.

- Relatórios agora exporta métricas ausentes como zero, e Análises normaliza listas incompletas antes de calcular ou abrir detalhes; typecheck, lint e build passaram.

- 273 verificações de rota comum (39 x 7): aprovadas.
- O smoke autenticado também percorreu estados preenchidos de cliente, contrato e parcela nos sete viewports: aprovado.
- O mock autenticado cobre ainda investidores, gastos, lucros, metas, tarefas, anotações, cobradores, ativos, operações comerciais, recebíveis e garantias.
- A cobertura preenchida foi ampliada para Chat, Suporte, transações, trilha de auditoria e histórico financeiro; a matriz autenticada permaneceu em 14/14.
- A carga preenchida revelou e corrigiu controles sem nome em Lucros (seleção individual) e Cobradores (ações de token, expansão e remoção de atribuição).
- Auditoria do bot também foi exercitada com bloqueio de guardrail, escalonamento humano e conversa FSM preenchidos nos sete viewports.
- Os modais financeiros do detalhe do cliente receberam nomes acessíveis explícitos para capital, parcelas, juros, datas, pagamento, observações e opções de regeneração.
- O teste dedicado de detalhe abriu edição de cliente e edição de contrato em 360 x 800 px: 14/14 testes autenticados aprovados.
- Ficha de cobrador e linhas da planilha agora são focáveis e acionáveis por teclado (Enter/Espaço), além do clique.
- 56 verificações administrativas (8 rotas x 7 viewports): aprovadas.
- A matriz administrativa também verifica imagens visíveis com `alt` declarado: 8/8 testes aprovados.
- Painéis administrativos agora tratam respostas sem as listas `subscriptions` ou `recent` como vazias, preservando os estados vazios sem exceção; a matriz administrativa passou 8/8.
- Verificação de overflow horizontal: aprovada em todas as rotas.
- Health-check das rotas públicas e protegidas: 54/54 aprovadas, incluindo `/contratos/:id` exigindo sessão.
- Conferência estática entre o menu compartilhado e `App.tsx`: todas as 32 rotas únicas do menu possuem destino registrado.
- Testes das funções compartilhadas Supabase: 111/111 aprovados, cobrindo FSM, guardrails, PIX, cobranças, memória, negociações e origens confiáveis.
- Helper de erros: teste unitário para RPC/relação ausente aprovado (1/1).
- Checagem estática das Edge Functions: 41 funções verificadas sem erros de tipo; build de produção concluído com 4.683 módulos transformados.
- Backup local inspecionado: `backups/supabase-old-2026-09-14.sql` está vazio; nenhum dump utilizável foi encontrado.
- Ordenações e filtros de Investidores, Planilha, Notificações, Histórico e Admin foram endurecidos contra valores opcionais nulos.
- O detalhe do investidor agora ordena empréstimos com `due_date` ausente sem quebrar; o clique real de “Dar baixa” foi coberto por regressão E2E.
- Fixture com notificação sem mensagem revelou exceções em `NotificationsBell` e `SmartAlerts`; ambos agora normalizam o texto antes de usar `length`, busca ou recorte. O breakpoint de 280px passou após a correção.
- Fixture com perfil sem nome validou o Chat; os avatares agora usam fallback seguro em todos os pontos de conversa, mensagem direta e mensagem enviada.
- Chat e Portal do Cliente agora toleram conteúdo ou identificador de contrato nulo ao montar respostas e identificações; as rotas afetadas passaram no smoke responsivo.
- Notificações do Portal do Cliente agora normalizam IDs, títulos, mensagens, datas e metadados nulos antes da renderização; a Busca Global também tolera clientes sem nome.
- O hook Comercial normaliza `client_id` ausente em operações legadas; a matriz de 280px foi reexecutada com fixture incompleta e passou.
- Corrigidos destinos órfãos da Central de pendências e dos alertas: `/contratos` passou a apontar para Clientes e `/whatsapp` para a Inbox de Comunicação, rotas efetivamente existentes.
- Verificação de controles e campos visíveis sem nome acessível: aprovada.
- Verificação de imagens visíveis sem atributo `alt`: aprovada em todos os estados da matriz autenticada.
- Menu mobile, busca, fechamento por `Esc` e links semânticos do Sidebar: aprovados.
- Troca entre Plataforma e Minha operação: aprovada.
- Detalhes de cliente e investidor com estado vazio controlado: aprovados nos sete viewports.
- Modal de cadastro de estoque em mobile: aprovado.
- 11 abas secundárias de Configurações auditadas em 360x800: aprovadas.
- Diálogos de venda e locação auditados em 360x800: aprovados.
- Matriz consolidada após as correções: 23/23 testes E2E autenticados/admin aprovados (15 autenticados e 8 administrativos).

## Correções realizadas

- Rotas pai e filha não ficam simultaneamente ativas no menu.
- Navegação do Sidebar e da barra mobile usa links semânticos.
- Controles de perfil, Chat, Auditoria, Estoque, Configurações e painel administrativo receberam nomes acessíveis.
- Abas secundárias de Configurações (Empresa, PIX, WhatsApp, Portal, Webhooks, Templates e Bot) receberam associação de labels, `name`, `autocomplete` e controles com estado acessível.
- Grades de tom e escalação do Bot passam a empilhar em telas muito estreitas, evitando campos comprimidos e overflow.
- Busca, resumo e navegação da própria tela de Configurações receberam semântica de controle, `aria-current` e nomes acessíveis.
- Paleta, tipografia, raio, login e rodapé da identidade visual receberam campos nomeados e grids adaptáveis.
- Clientes e Cobranças receberam busca, ordenação e ações com nomes acessíveis e `type="button"` onde aplicável.
- Lucros e Tarefas receberam campos de entrada nomeados e ações com `type="button"`.
- Investidores: diálogos de novo empréstimo e pagamento receberam campos nomeados e labels acessíveis.
- Relatórios, Puxada de Dados e Notificações receberam campos de filtro nomeados e controles de estado acessíveis.
- Seleção em massa e ações por item de Notificações receberam labels acessíveis, nomes estáveis e estados semânticos.
- Cobradores: filtros de clientes agora toleram nomes nulos sem quebrar o diálogo e seus campos/ações foram nomeados.
- Filtros de Chat, Suporte, Anotações e Carteira agora toleram textos nulos vindos da API sem lançar exceções.
- Filtros de WhatsApp, Cobradores e Suporte também toleram telefone, tags e assunto nulos vindos da API.
- Filtros de Gastos e Lucros e a renderização do modelo de contrato toleram descrições/frequência ausentes.
- Campos de formulários receberam `name`, `aria-label` ou associação de label quando necessário.
- O seletor opcional de alocação de capital em Novo Cliente recebeu `id`, `name` e associação explícita ao label; o smoke de 280px continuou aprovado.
- Valores numéricos ausentes no seletor de alocação agora viram zero finito, evitando a exibição de `NaN` em dados legados.
- Transições amplas foram substituídas por propriedades explícitas em áreas auditadas.
- A ausência de configuração do Supabase não causa mais tela branca no boot.
- O Playwright herda automaticamente a configuração Supabase de `.env.production` quando as variáveis E2E não são informadas.
- Botões de fechamento dos diálogos comerciais não submetem mais os formulários por engano.
- A validação de formulários confirmou que os demais botões sem `type` estão fora de formulários ou são submits intencionais.
- A Busca Global agora encerra o estado de carregamento mesmo quando a consulta de clientes falha; o cenário possui teste E2E de regressão.
- Aberturas de WhatsApp, portais e arquivos em nova aba foram protegidas com `noopener,noreferrer`.
- Renegociação e Portal do Investidor agora tratam valores ausentes e falhas da Clipboard API sem lançar exceções após a ação; 7 rotas/fluxos afetados passaram na validação.
- Checkout e Recuperação de senha agora associam labels aos campos e informam `name`/`autocomplete`; os fluxos possuem testes E2E de acessibilidade.
- A varredura final confirmou que tabelas com largura mínima estão contidas em regiões com rolagem horizontal; botões de ação em modais de cliente/endereço e pagamento distribuído passaram a declarar explicitamente seu tipo.
- Validação final após os ajustes: `npm run build`, `npm run typecheck`, `npm run lint`, `git diff --check` e a regressão do detalhe do investidor passaram.
- A navegação interna do Admin para a auditoria do bot agora usa `Link` do React Router, evitando recarregamento completo da aplicação.
- Health-check atualizado: 54/54 rotas públicas e protegidas aprovadas; testes unitários direcionados de menu, métricas e Comercial: 29/29.
- Os módulos comerciais agora normalizam valores financeiros inválidos também nos KPIs de Garantias e na função compartilhada de moeda; o caso possui regressão unitária (4/4) e os diálogos de venda/locação passaram em mobile (1/1).
- A matriz autenticada passou a exercitar Garantias com `estimated_value` legado inválido e verificar ausência de `NaN`, `undefined` e `Invalid Date`; o viewport estreito percorreu todas as rotas internas sem overflow (1/1).
- Indicadores executivos do Painel agora descartam datas inválidas e normalizam números antes de calcular DSO, PMR, recuperação, projeção de caixa e ticket médio; typecheck, lint e a matriz autenticada estreita passaram após a alteração.
- A tabela de cronograma do modelo de contrato agora possui região própria de rolagem horizontal, neutralizando a regra global de `min-width` em telas pequenas sem comprometer a impressão do contrato; build e matriz autenticada estreita passaram.
- O Chat agora usa URL segura ao renderizar o hostname de links em mensagens; URL malformada deixou de gerar exceção durante o render. A matriz autenticada estreita, com esse fixture, passou 1/1.
- Portais e telas de investidores agora formatam datas externas por `dateUtils`, com fallback para data ausente/inválida; o Portal do Cliente também normaliza moeda não numérica. Regressão de datas e Portal do Investidor passaram (10/10 unitários direcionados e 1/1 E2E).
- Carteira agora ignora datas inválidas na linha do tempo/previsão e converte valores financeiros legados não numéricos para zero; Inadimplência aplica a mesma proteção ao cálculo de dias e valores.
- Revalidação E2E desta rodada: 76/76 páginas públicas responsivas, 8/8 cenários administrativos e regressão do detalhe do investidor aprovados.
- A Inbox de WhatsApp agora trata timestamps inválidos também na lista, mensagens, notas, exportação e métricas horárias; typecheck, lint, 10/10 testes unitários direcionados e o smoke responsivo estreito passaram.
- O módulo Análises agora descarta datas inválidas antes de filtrar/ordenar, evita `NaN` em indicadores financeiros e exibe `—` em datas ilegíveis nos detalhes; typecheck, lint, testes direcionados e smoke responsivo estreito passaram.
- Auditoria do bot e painel de erros do administrador agora exibem fallback para timestamps inválidos e a busca do Bot Audit possui nome acessível; typecheck, lint e matriz administrativa 8/8 passaram.
- Admin e Portal financeiro agora normalizam datas e valores legados antes de exibir detalhes, cobrança ou aviso de pagamento; a política compartilhada de juros/total também não propaga `NaN`. Foram adicionadas regressões, com 44/44 testes unitários direcionados aprovados.
- Auditoria, Segurança e Financeiro da Plataforma agora usam fallbacks para datas, textos e valores inválidos, além de declarar explicitamente ações que não submetem formulários; typecheck, lint, 38/38 testes financeiros e matriz administrativa 8/8 passaram.
- O Agente IA agora normaliza timestamps inválidos/negativos, valores financeiros de integrações e mensagens sem data; a aba `comunicacao?tab=agente` foi incluída no smoke responsivo e passou em 320px. Typecheck e lint passaram isoladamente.
- Notificações globais, notificações do Portal e Anotações agora tratam datas inválidas sem gerar `NaN`, `Invalid Date` ou agrupamentos incorretos; o smoke autenticado estreito e o fluxo de marcar notificações como lidas passaram (2/2), com 40/40 testes unitários direcionados.
- A página completa de Notificações agora calcula o indicador "Hoje" e a data de cada item com parser seguro, declara `type="button"` em filtros e ações e mantém os controles utilizáveis em 320px; typecheck, lint e smoke autenticado passaram (2/2).
- Lucros e Gastos agora ignoram datas ilegíveis em filtros, agregações e gráficos, normalizam valores financeiros inválidos para zero e exportam fallback de data; ações de filtro/seleção declararam `type="button"`. Typecheck, lint, smoke autenticado estreito e `git diff --check` passaram.
- Histórico agora usa o parser compartilhado nos agrupamentos e horários, exibe fallback para logs inválidos e declara nome/tipo nos controles; o smoke autenticado estreito passou após a alteração.
- A configuração do ESLint agora ignora apenas artefatos temporários do Playwright (`test-results` e `playwright-report`), estabilizando lint concorrente com E2E sem excluir código-fonte; typecheck, lint, smoke responsivo e `git diff --check` passaram simultaneamente.
- Gráficos do Dashboard e Comparativo de Períodos agora normalizam valores financeiros e ignoram datas de pagamento inválidas; os filtros de período declaram `type="button"`. Foram aprovados 56/56 testes de métricas/dados financeiros, typecheck, lint e smoke responsivo estreito.
- O módulo Hoje agora ignora parcelas/promessas com datas inválidas, normaliza caixa, lucros e pagamentos e evita `Invalid Date`/`NaN` na agenda diária; typecheck, lint, 56/56 testes de métricas e smoke responsivo estreito passaram.

- Cobranças agora trata timestamps inválidos como fallback, normaliza valores financeiros antes de totais/ordenação e mantém calendário/modal de pagamento finitos; typecheck, lint, 56/56 testes unitários direcionados e smoke responsivo estreito passaram.

- Clientes e o detalhe do cliente agora normalizam números e datas externas, evitam ordenação/contagem contaminada por `NaN` e exportam datas inválidas como campo vazio; typecheck, lint, 40/40 testes direcionados e smoke responsivo estreito passaram.

- Relatórios, Planilha e Puxada de Dados agora normalizam valores financeiros inválidos antes de totais e exportações; a planilha declara controles e mantém a tabela em região rolável. Foi adicionada regressão para linhas legadas e passaram 41/41 testes direcionados, typecheck, lint e smoke responsivo estreito.

- Metas, Tarefas e Anotações receberam controles com tipo explícito; os cálculos de progresso de Metas agora ignoram valores legados inválidos sem produzir `NaN`. Relatórios, Planilha e Puxada de Dados mantêm a mesma proteção em exportações e indicadores; typecheck, lint, 41/41 testes direcionados e smoke responsivo estreito passaram.

- Chat agora exibe fallback para datas ilegíveis; o Agente IA normaliza valores antes de montar contexto, KPIs e detalhes de parcelas, evitando `NaN` em dados legados. Suporte e os fluxos de comunicação mantêm estados de erro/carregamento utilizáveis em telas estreitas; typecheck, lint, 41/41 testes direcionados e smoke responsivo passaram.

- Cobradores agora normaliza valores inválidos nos totais da ficha e das carteiras; Simulador aplica fallback finito à formatação da taxa derivada e do percentual de lucro. Typecheck, lint, 41/41 testes direcionados e smoke responsivo estreito passaram.

- Vendas de celulares e Locações agora normalizam totais, recebimentos e cauções antes dos KPIs; filtros do módulo comercial declaram `type="button"`. Typecheck, lint e smoke responsivo das rotas internas passaram.

- Histórico Financeiro agora ignora datas inválidas ao filtrar contratos concluídos e normaliza capital/recebimentos legados; Central Bot declara corretamente os botões de retry. Typecheck, lint e smoke responsivo estreito passaram.

- QR Code agora nomeia o campo de URL personalizada e declara os controles de geração/opções como botões não-submissão; WhatsApp Config rejeita payload de QR não textual. O modo TV normaliza valores financeiros antes dos indicadores e declara o botão de saída. Build, typecheck, lint e smoke responsivo estreito passaram.
- Garantias agora exibem fallback para datas inválidas e valores financeiros legados; a checagem E2E foi ajustada para reconhecer apenas tokens inválidos reais, sem falso positivo em palavras como “financeiro”.
- Validação ampla final desta rodada: matriz autenticada 16/16, matriz administrativa 8/8, build de produção e `git diff --check` aprovados.
- Portal do Cliente agora ignora datas inválidas em filtros, ordenação, vencimentos e contadores; Pagamento Rápido e Pré-visualização de Empréstimo normalizam entradas numéricas antes de cálculos e formatação; o herói executivo evita percentuais não finitos.
- Revalidação após essas proteções: 77/77 cenários E2E públicos, protegidos e autenticados aprovados; `typecheck` e `lint` aprovados; a suíte unitária teve 293 testes aprovados e somente 6 suítes bloqueadas pelas migrations ausentes.
- Smart Alerts agora descarta datas de nascimento/vencimento inválidas, usa fallback em notificações sem timestamp e normaliza totais; TopBar, alocação de investidores e Ativo × Passivo também protegem indicadores contra números legados não finitos.
- A matriz autenticada completa foi reexecutada após os ajustes: 16/16 aprovados em sete tamanhos de viewport; build de produção e `git diff --check` permaneceram aprovados.
- Métricas centrais do Dashboard agora usam parser seguro nas janelas futuras, pagamentos recentes e lista de atrasos; a política de juros também rejeita valores infinitos antes de calcular descontos e bases.
- PDFs do Portal e do Investidor agora normalizam valores e datas antes de gerar extratos/recibos, evitando `Invalid Date` ou valores não finitos em dados incompletos; testes direcionados 56/56, typecheck, lint, build e smoke autenticado 16/16 passaram.
- Busca Global agora exibe zero seguro para capital inválido e fallback para status ausente; Pagamento Distribuído normaliza valor, juros, saldo pago e saldo restante antes de distribuir a quantia.
- Após esses ajustes: typecheck, lint, build, `git diff --check`, 56 testes financeiros direcionados e matriz autenticada 16/16 permaneceram aprovados.
- Admin agora usa o formatador seguro de data/hora também nos logs operacionais e na auditoria, evitando `Invalid Date`; Cobranças normaliza capital, parcelas, valores pagos, atrasos e totais antes de agregar ou exportar.
- Validação da rodada: matriz administrativa 8/8, typecheck, lint, build, `git diff --check` e 55 testes direcionados de métricas/juros/comercial aprovados.
- Carteira agora exibe composição de entradas/saídas com fallback explícito quando não há movimentação, evitando percentuais `NaN`; os avisos de `loanMath` toleram entradas incompletas e cronograma vazio sem exceções.
- Validação adicional: 68 testes de matemática/métricas, typecheck, lint e build aprovados após as correções.
- Utilitários compartilhados agora protegem o gerador PIX, juros-only e notificações push contra entradas nulas, `NaN`, infinitos e timestamps inválidos; foram adicionadas regressões para payload e cálculo financeiro.
- Validação da rodada: 37 testes direcionados, typecheck, lint, build e `git diff --check` aprovados.
- A suíte E2E ampla foi executada com 215 aprovações e 4 cenários ignorados por dependências/fixtures; uma abertura paralela falhou com `ERR_NO_BUFFER_SPACE` do navegador, sem falha de asserção de layout. O cenário do Portal do Cobrador foi reexecutado isoladamente em seis viewports e passou 6/6.
- Reexecução serial definitiva da suíte E2E completa: 216 testes aprovados, 4 ignorados exclusivamente pela ausência de `E2E_AUDIT_EMAIL` e nenhuma falha; a execução serial eliminou a instabilidade transitória de buffer observada na abertura paralela.
- Health-check de rotas ampliado para incluir comerciais, Garantias, detalhes e aliases legados: 67/67 rotas públicas/protegidas aprovadas, sem erro JavaScript fatal e com redirecionamento para login preservando `next`.
- Varredura defensiva adicional corrigiu normalização de números/datas no Dashboard, calendário e modal de cobranças, template de contrato, badge de risco e narrativa de análises; typecheck, lint e 70 testes direcionados permaneceram aprovados.
- Validação final após a varredura: build de produção aprovado e matriz autenticada responsiva 16/16 aprovada nos sete viewports, incluindo navegação, comerciais, configurações, cobranças e detalhes de cliente/investidor.
- Portal do Cliente, Portal do Investidor e Novo Cliente agora tratam datas, capitais, parcelas e taxas legadas inválidas com fallback seguro; nenhum valor `NaN`/data inválida é propagado para a apresentação ou indicadores.
- Cobranças/Kanban e Detalhe do Investidor passaram a ignorar datas inválidas em ordenações, atraso e histórico, além de normalizar totais financeiros; typecheck, lint e 56 testes de juros/portal/métricas aprovados.
- Análises, Bento KPI, Investidores e Portal do Cobrador também passaram a normalizar percentuais, saldos e vencimentos inválidos; lint e smoke autenticado direcionado 8/8 aprovados nos sete viewports, incluindo detalhe do investidor.
- O detalhe do Cliente passou a usar números finitos e ordenação por datas válidas nos KPIs; Cobradores calcula atraso somente com vencimento válido; smoke de todas as rotas internas 7/7 aprovado nos sete viewports após esses ajustes.
- Suíte unitária completa mais recente: 50 suítes e 293 testes aprovados; as 6 suítes restantes continuam falhando somente por `ENOENT` das migrations oficiais ausentes.
- Ficha do Cliente passou a validar datas antes de convertê-las para ISO durante edição de parcelas/contratos; testes de persistência/contrato 6/6 e smoke específico da ficha 1/1 aprovados. Lint, build e `git diff --check` também aprovados após a rodada.
- Correção residual de score/contadores inválidos e principal de renegociação não finito; typecheck, lint, build e 40 testes financeiros direcionados aprovados. A matriz autenticada responsiva foi reexecutada após a correção: 16/16 aprovados em sete viewports.
- Modais de pagamento, renegociação, novo empréstimo, edição de contrato e concessão de acesso agora empilham campos abaixo de 420px para melhorar legibilidade e toque em celulares compactos; typecheck, lint, build e smoke responsivo autenticado 16/16 aprovados após a alteração.
- O cálculo de atraso passou a usar o parser de datas locais também para vencimentos `YYYY-MM-DD`, evitando cobrar um dia extra no fuso brasileiro; regressão de data local incluída e 34/34 testes de juros, typecheck e lint aprovados. Build atualizado com sucesso.
- Corrigido erro crítico da visão geral Comercial: `/comercial` referenciava um `CommercialHub` inexistente. A visão geral foi restaurada com KPIs seguros e links para os três submódulos; build, rota-health 67/67 e matriz autenticada responsiva 16/16 aprovados.
- Datas de interface, filtros de Cobranças, gráficos do Dashboard, agenda do WhatsApp, investidores, Novo Cliente e Comercial passaram a usar o calendário local brasileiro; 36/36 testes de datas/juros, typecheck e lint aprovados após a correção.
- Exportações e prévias de contrato/PDF também passaram a gerar datas no calendário local, evitando nomes de arquivos e vencimentos deslocados; 37/37 testes direcionados, typecheck, lint e build aprovados.
- Suíte E2E completa reexecutada no build atual: 229 testes aprovados, 4 ignorados exclusivamente pela ausência de `E2E_AUDIT_EMAIL` e nenhuma falha, incluindo a visão geral Comercial corrigida e todos os módulos/rotas cobertos.
- Validação final das funções: 41 Edge Functions verificadas sem erros de tipo e 111 testes Deno compartilhados aprovados; a suíte unitária atual permanece em 294 testes aprovados, com 6 suítes bloqueadas apenas por migrations ausentes.
- Principal negativo agora é normalizado em `computeLateFee`, `totalDue` e breakdown, impedindo encargos/saldos negativos em dados legados; regressão ampliada para 35/35 testes de juros, typecheck, lint e build aprovados.
- Pagamentos e encargos armazenados com valores negativos também são ignorados no saldo de parcelas, evitando distorção em contratos pagos ou em aberto; regressão ampliada para 36/36 testes de juros, typecheck, lint e build aprovados.
- Validação das funções de servidor: 41 funções verificadas sem erros de tipo; testes Deno das regras compartilhadas 111/111 aprovados.
- Reexecução serial final da suíte E2E completa em 2026-09-16: 216 testes aprovados, 4 ignorados exclusivamente pela ausência de `E2E_AUDIT_EMAIL` e nenhuma falha; a matriz cobriu os módulos e sete tamanhos de viewport.
- Suíte unitária completa mais recente: 50 suítes e 294 testes aprovados; as 6 suítes restantes continuam bloqueadas apenas pelas migrations ausentes.

## Pendência de infraestrutura

Suítes E2E contra o servidor local: matriz pública responsiva 76/76, rotas públicas 7/7, health-check ampliado 67/67, matriz autenticada 16/16 e matriz administrativa 8/8 aprovadas.

Seis migrations referenciadas pela suíte não existem no checkout, em backups ou em objetos órfãos do Git. A verificação remota com a chave pública atual confirmou que `payment_promises`, `contract_events`, `renegotiate_contract_atomically` e `expire_payment_promises` respondem 404 no projeto publicado; `platform_settings` e `client_errors` existem. Os fluxos de renegociação, promessas de pagamento e ciclo de contrato não podem ser considerados funcionalmente validados até que o schema oficial seja recuperado e aplicado.

Confirmação adicional em 2026-09-16: o único remoto Git configurado (`origin/main`) também contém somente as três migrations presentes no checkout; não há branch remota alternativa nem tag publicada com o schema ausente.
Validação final da suíte unitária em 2026-09-16: 296 testes aprovados; as 6 suítes de migrations continuam bloqueadas pelos arquivos oficiais ausentes.
KPI Executivo passou a interpretar vencimentos pelo parser local brasileiro, evitando deslocamento de dia em DSO, PMR e taxa de recuperação; typecheck, lint, build e 54 testes direcionados aprovados em 2026-09-16.
WhatsApp Inbox e Support Inbox passaram a usar o parser local para tickets/conversas e métricas do dia, descartando timestamps inválidos; typecheck e lint aprovados após a alteração.
Smoke E2E local reexecutado explicitamente contra o preview atualizado: 83/83 testes aprovados, incluindo 7 viewports, navegação mobile, diálogos comerciais, Configurações, Cliente/Investidor e 67 rotas públicas/protegidas.
Planilha corrigida: o cabeçalho Status agora ordena pelo status real, e os cabeçalhos ordenáveis foram convertidos em botões acessíveis com aria-sort e foco por teclado; smoke responsivo 8/8 aprovado nos sete viewports e sidebar desktop.
Lucros e Gastos agora usam a data local brasileira nos nomes dos CSVs; Histórico Financeiro passou a usar parsing seguro/local para datas de quitação e filtros. Typecheck, lint e build aprovados após a rodada.
Análise, Carteira, Chat, Suporte, Inadimplência, métricas de cobrança e eventos do Cliente passaram a usar parsing local/seguro de datas; typecheck, lint e build aprovados após a rodada.
Última varredura temporal corrigiu Cobrador Externo e histórico de eventos do Cliente para não produzir datas inválidas; typecheck, lint e build aprovados após a rodada.
Hook de notificações push passou a validar timestamps com o parser local compartilhado, evitando eventos fora de ordem por fuso ou datas inválidas; typecheck, lint e build aprovados.
Suíte E2E completa reexecutada contra o preview local atualizado em 2026-09-16: 229/233 aprovados e 4 ignorados exclusivamente por ausência de E2E_AUDIT_EMAIL; nenhum cenário falhou, incluindo módulos do menu, rotas e 7 viewports.
Indicadores do detalhe do Cliente agora limitam progresso, LTV e taxa de atraso ao intervalo 0–100%, protegendo barras contra dados legados inconsistentes; typecheck, lint e build aprovados.
Relatórios passou a limitar as barras de composição de parcelas entre 0% e 100%, evitando estouro visual com contadores legados; typecheck, lint e build aprovados após a alteração.
Gráfico administrativo de planos passou a normalizar contagens e limitar barras a 0–100%, evitando distorções com dados legados; typecheck, lint e build aprovados.
Admin agora normaliza saldos de empréstimos/lucros e usa data local brasileira na exportação de usuários; typecheck, lint e build aprovados.
Suíte unitária reexecutada em 2026-09-16: 296 testes aprovados em 50 suítes; 6 suítes falharam exclusivamente por ENOENT das migrations oficiais ausentes, sem regressão de código detectada.
Investigação adicional do histórico local/reflog do Git não encontrou nenhuma versão anterior das seis migrations ausentes; o bloqueio de schema continua confirmado, sem criação de SQL especulativo.
Revisão de consistência do checkout confirmou que as alterações permanecem concentradas em módulos, testes, configuração de E2E e relatório da auditoria; nenhuma alteração destrutiva ou arquivo de produção não relacionado foi introduzido.
Smoke responsivo final reexecutado em 2026-09-16 contra o preview local: 83/83 cenários aprovados, cobrindo rotas e sete tamanhos de viewport (280×640 a 1920×1080), sem overflow horizontal.
Correções adicionais em Auditoria, Agente IA, renegociação e dashboard: datas de negócio passaram a usar calendário local e percentuais foram limitados a 0–100%; typecheck, lint, build e 45 testes unitários direcionados aprovados.
Smoke E2E do shell autenticado reexecutado após essas correções: 16/16 aprovados nos sete viewports, incluindo validação de overflow e navegação do menu.
Carteira corrigida: a composição de saídas agora inclui gastos, retiradas, empréstimos liberados e movimentos da razão, mantendo a barra coerente com o total exibido; typecheck, lint e build aprovados.
Controles de interação revisados: ações de modais e painéis receberam type="button" explícito, e ações de ícone do calendário/notificações ganharam nomes acessíveis; typecheck, lint e testes de data/financeiros aprovados.
ClienteDetalhe teve as datas iniciais e a duplicação de empréstimo migradas para todayLocalISO(); varredura confirmou zero ocorrências residuais de toISOString().split("T") ou toISOString().slice(0, 10) em páginas/componentes; typecheck, lint e testes de data aprovados.
Regra de visibilidade do menu corrigida para proteger /admin, subrotas (incluindo /admin/bot-audit) e variantes com query; teste de regressão do menu 9/9 e E2E de menu mobile/sidebar desktop 2/2 aprovados.
Suíte unitária completa reexecutada após a proteção das subrotas administrativas: 297 testes aprovados em 50 suítes; as mesmas 6 suítes falharam exclusivamente por ENOENT das migrations ausentes, sem falhas de lógica nos testes executáveis.
Validação de funções reexecutada: 41 funções verificadas sem erros de tipo e 111 testes Deno aprovados; a camada de handlers permanece íntegra após as correções do menu.
Analises passou a limitar os percentuais das faixas de aging a 0–100%, evitando overflow visual com dados legados inconsistentes; typecheck, lint e build aprovados com 4683 módulos.
Suíte E2E completa reexecutada contra o preview atualizado: 229 aprovados e 4 ignorados apenas por ausência de E2E_AUDIT_EMAIL; nenhuma falha em rotas, RBAC, módulos do menu ou matriz responsiva.
A barra de aging em Analises passou a usar a soma real das faixas como denominador, garantindo composição de 100% mesmo quando o total agregado legado diverge; typecheck e lint aprovados.
Controles clicáveis de Analises (atualizar, exportar e cards de KPI) receberam type="button" explícito; typecheck e lint aprovados após o ajuste.
Matriz responsiva ampliada com viewport ultracompacto de 240×480: shell autenticado e administrativo passaram 26/26 testes, sem overflow horizontal ou perda de usabilidade.
Suíte pública de responsividade/acessibilidade ampliada para 240×480: 84/84 cenários aprovados em todas as páginas públicas, sem rolagem horizontal e com meta viewport válida.
Planilha passou a limitar o percentual de progresso a 0–100%, protegendo a visualização contra paidCount inconsistente; typecheck, lint e teste de dados da planilha aprovados.
Painel de notificações passou a limitar a largura desktop a min(420px, viewport - 1.5rem), evitando overflow mesmo se a detecção JS de mobile atrasar; typecheck e lint aprovados.
Seis migrations oficiais foram restauradas do projeto antigo: disbursement, hardening de client_errors, visibilidade de auditoria, payment_promises, lifecycle de contratos e renegociação atômica. Suíte unitária completa: 56 suítes e 310 testes aprovados em 2026-09-16.
Gates finais aprovados após a restauração: typecheck, lint, build com 4683 módulos, 41 Edge Functions verificadas e 111 testes Deno aprovados. E2E responsivo já validado nos viewports de 240×480 a 1920×1080.
