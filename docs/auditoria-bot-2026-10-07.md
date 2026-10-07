# Auditoria do bot de atendimento — 07/10/2026

Este documento registra a situação anterior às correções. Veja o [registro das correções e dependências restantes](correcoes-bot-2026-10-07.md).

## Resultado

O bot tem fluxos implementados para atendimento, consulta de parcelas, PIX, portal, documentação de empréstimos, comprovantes e transferência para uma pessoa. **A configuração atual não permite considerar essas funções operacionais em produção.** Há também permissões de banco que precisam ser corrigidas antes de reativar as automações.

Auditoria sobre o commit `3e7f233af58d7e3655abade5426c24c365b98ff0`, com leitura do servidor e do banco de produção em transações `READ ONLY`. Os testes adversariais usaram dados fictícios e banco local em memória. Não foram enviados WhatsApps, feitas chamadas pagas de IA, registradas baixas ou alterados usuários e configurações reais. Nenhuma correção ou publicação foi feita nesta auditoria.

## Funções e situação

| Função | Implementação examinada | Situação |
|---|---|---|
| Receber WhatsApp e identificar cliente | `whatsapp-webhook`, `agent_core` | Segredo do webhook ausente; identificação sem paginação |
| Menu, FAQ e atendimento sem IA | Webhook, `faq_knowledge`, memória e máquina de estados | Implementados; sujeitos ao bloqueio de recepção |
| Atendimento e recuperação com IA | Webhook, `agent_tools`, `agent-chat` | `ANTHROPIC_API_KEY` ausente; ferramentas precisam de autorização por cliente |
| Consultar parcelas e saldo | Webhook, `agent_core`, ferramentas | Divergência para saldo remanescente apenas de encargos |
| Informar PIX e pagamento parcial | Menu, perfil do credor e ferramentas | Implementados; ferramenta de PIX retorna dados para geração, não confirma transferência bancária |
| Abrir portal do cliente | Menu e `enviar_portal_link` | Menu cria sessão; ferramenta usa outro tipo de token |
| Entender áudio | Transcrição pelo gateway Lovable | `LOVABLE_API_KEY` ausente; interruptor não respeitado no webhook |
| Enviar áudio/TTS | Configurações | Opção disponível na tela; nenhum consumidor de `bot_send_audio` encontrado nas funções |
| Cadastro de interessados e documentos | SDR, menu de modalidades e revisão visual | Implementados; revisão visual exige IA e não comprova autenticidade |
| Receber e revisar comprovantes | Webhook e `whatsapp_receipt_reviews` | Revisão humana implementada; baixa automática depende de heurística insuficiente |
| Promessas, pagamento e renovação | Memória, RPCs financeiras, cobranças | RPCs financeiras de sistema restritas a `service_role`; gatilhos de contrato e idempotência financeira presentes |
| Atendimento humano e pausa | Conversas, webhook, agendador | Encerramento por inatividade pode desfazer a pausa |
| Cobrança, agendamento e retorno | `auto-collection`, agendador, follow-up | Cron bloqueado por segredo ausente; vários controles incompletos |

## Evidência de produção

Fotografia coletada aproximadamente às 08:22–08:30 UTC de 07/10/2026:

- 14 configurações de contas; 2 com bot habilitado, ambas com envio automático e chave de WhatsApp preenchida; 1 com confirmação automática de comprovantes ligada.
- `CRON_SECRET`, `EVOLUTION_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY` e `SITE_URL` ausentes do ambiente do contêiner de funções e do ambiente do processo principal, conferido em `/proc/1/environ` sem divulgar valores. Não foi encontrado arquivo de ambiente montado nem argumento `--env-file`; o processo principal repassa o ambiente aos workers.
- Amostra de logs das últimas 24 horas: **1.449 recusas por `CRON_SECRET` não configurado**. Foram observadas 1.440 chamadas ao agendador e 1 à cobrança automática.
- Respostas HTTP retidas em `net._http_response`: **367 respostas 401 com `error=unauthorized`**. A retenção e a abrangência dessa tabela são diferentes das dos logs; os números não devem ser somados.
- Cron registra o agendador como `succeeded` 1.440 vezes. Isso confirma a execução SQL que agenda a requisição HTTP, não o sucesso HTTP nem a entrega do WhatsApp.
- Últimos registros de mensagens e ações do bot: **07/09/2026**. Nenhum registro nessas duas tabelas nos últimos sete dias. Isso não prova ausência de mensagens enviadas fora desse sistema.
- Histórico de agendamentos: 18 falhas manuais, sendo 14 `send_failed_400` e 4 `send_failed_404`; nenhum job pendente ou em processamento na fotografia.
- 19 conversas com `needs_human=true` e `bot_paused=false`; 6 com ambos ligados. O primeiro grupo pode continuar recebendo respostas automáticas, dependendo do caminho do fluxo.
- Nenhuma parcela ativa com saldo exclusivamente de encargos na fotografia. A falha desse cenário foi reproduzida com dados fictícios, sem afirmar que já ocorreu com um cliente real.
- Dez dos onze arquivos examinados correspondem ao publicado após normalização de quebras de linha. `auto-collection/index.ts` tem divergência funcional de cálculo financeiro.

## Achados prioritários

### B01 — Crítico: RPCs internas acessíveis a visitantes

O catálogo de produção confirmou permissão `EXECUTE` para **`anon` e `authenticated`** em `claim_due_whatsapp_messages`, `claim_whatsapp_followups`, `claim_whatsapp_event`, `claim_whatsapp_response_window` e `claim_collection_dispatch`.

As duas primeiras são `SECURITY DEFINER`, não verificam o chamador nem restringem por credor e retornam linhas das tabelas. Reivindicar um job muda seu estado para `processing`; reivindicar follow-up devolve a conversa. A RLS das tabelas está habilitada, mas não neutraliza essas funções executadas com privilégios do definidor.

**Reprodução isolada:** as definições SQL obtidas de produção foram carregadas no PGlite, com filas e contatos fictícios. Sob `SET ROLE anon`, foi possível ler texto privado agendado, ler telefone da conversa e reivindicar job de outro dono. Nenhuma RPC de reivindicação foi executada em produção durante a auditoria.

**Correção:** revogar acesso de `PUBLIC`, `anon` e `authenticated` às RPCs de trabalho interno, conceder somente a `service_role` e adicionar verificação de papel na própria função. Auditar também o conjunto restante de RPCs `SECURITY DEFINER`. Criar regressão que prove recusa para visitantes e usuários comuns, preservando a execução do worker.

### B02 — Crítico operacional: recepção e cron bloqueados por configuração

As funções corretamente recusam requisições sem seus segredos obrigatórios. O servidor está sem esses segredos, enquanto o cron continua chamando as funções. A chave Anthropic também está ausente. Os botões habilitados no aplicativo não refletem essas dependências.

**Correção:** após restringir as RPCs, configurar os segredos no ambiente efetivamente repassado aos workers e alinhar o segredo com cron e Evolution. Configurar a IA e a origem pública correta do portal. Validar recepção e execução em homologação, depois verificar HTTP e entrega em uma conversa de teste controlada. Preservar o bloqueio por padrão; remover a autenticação ampliaria a exposição.

Evidências: `whatsapp-webhook/index.ts:742`, `whatsapp-schedule-runner/index.ts:17`, `_shared/guard.ts:39` e logs agregados de produção.

### B03 — Alto: ferramentas da IA não vinculadas ao cliente confirmado

`ToolContext` contém somente banco, URL e data. `listar_parcelas_em_aberto`, `gerar_link_pix` e `enviar_portal_link` aceitam os IDs escolhidos pelo modelo sem validar o credor e o cliente autorizado. O webhook passa um cliente Supabase com chave de serviço; a identidade só aparece no texto do prompt.

**Reprodução isolada:** as três ferramentas aceitaram os IDs de um cliente fictício de outro dono. A recuperação passa por uma segunda verificação textual, mas essa verificação não autoriza consultas ao banco nem garante bloqueio de um token dentro de um link. Não foi tentada exploração do modelo ou consulta a dados de outro usuário em produção.

**Correção:** tornar `ownerId` e `verifiedClientId` obrigatórios no contexto; validar esses dois vínculos antes de qualquer consulta, token ou cálculo; impedir que argumentos do modelo substituam a identidade da conversa.

Evidências: `_shared/agent_tools.ts:92`, `:165`, `:212`, `:263`; `whatsapp-webhook/index.ts:2643`.

### B04 — Alto: comprovante visual pode provocar baixa sem confirmação bancária

`validateReceipt` aceita mídia com valor compatível, mesmo sem data, sem identificação do favorecido e sem confirmação da liquidação. O limite é uma pontuação heurística. Com `bot_auto_confirm_payment=true`, essa confiança permite chamar as RPCs de pagamento/renovação.

**Reprodução isolada:** uma suposta imagem com valor de R$100, sem data e sem qualquer transferência verificada, foi classificada como `trusted=true`. A validação recebe sinais extraídos da mídia; esse teste não realizou OCR nem criou uma imagem falsa. Hash evita reutilização idêntica conhecida, mas não demonstra que o dinheiro entrou e pode mudar com alteração do arquivo.

**Correção:** condicionar baixa automática a confirmação independente do recebimento, ou encaminhar comprovantes para aprovação humana. Exigir correspondência de destinatário, identificador da transação e valor quando houver integração bancária. Manter a idempotência dos lançamentos existentes.

Evidências: `_shared/bot_utils.ts:197`, `:315`; `whatsapp-webhook/index.ts:2877`, `:2961`, `:3072`.

### B05 — Alto: saldo de encargos omitido e quitação comunicada incorretamente

`agent_core`, ferramentas, follow-up e partes da cobrança/agendamento testam `amount - paid_amount > 0`, sem considerar encargos restantes. O fluxo enriquecido principal do webhook já inclui `late_fee`, portanto os caminhos divergem. `calculateAgentOverdueCharge` soma os encargos ao saldo base truncado em zero.

**Reprodução isolada:** parcela de R$100, encargos de R$20 e pagamento acumulado de R$110 ainda deve R$10. Ela desapareceu da listagem e do menu baseado no núcleo; a ferramenta recusou o PIX; o cálculo isolado retornou R$20.

Além disso, após uma baixa, a mensagem de quitação usa `paid_amount >= amount`, sem ler `late_fee`. Pode anunciar parcela quitada quando ainda faltam encargos, mesmo que o banco mantenha corretamente o saldo.

**Correção:** compartilhar a regra financeira oficial de saldo e arredondamento entre consultas, cobranças, PIX e mensagens. Comunicar quitação conforme resultado persistido, incluindo encargos, e cobrir pagamentos antes, durante e depois da liquidação do principal.

Evidências: `_shared/agent_core.ts:209`, `_shared/agent_tools.ts:115`, `:189`, `:228`; `whatsapp-schedule-runner/index.ts:59`; `whatsapp-webhook/index.ts:3100`.

### B06 — Alto: encerramento por inatividade pode desfazer atendimento humano

Toda resposta enviada por `botSay` agenda encerramento em dez minutos, inclusive respostas de transferência para humano. O agendador permite `session_timeout` em conversa pausada. Quando esse encerramento vira a última mensagem, o webhook reabre a sessão e limpa `bot_paused` e `needs_human` **antes** de verificar a pausa.

**Cenário confirmado pela lógica:** pedir atendente → mensagem do bot → pausa → aguardar sem resposta humana → encerramento automático → cliente responde → pausa é removida. Também há caminhos de SDR que marcam apenas `needs_human`.

**Correção:** transição única de handoff que pause o bot e cancele timers/retornos automáticos; encerramento não deve remover decisão humana. Retomada explícita pelo atendente ou política documentada com estado próprio.

Evidências: `whatsapp-webhook/index.ts:962`, `:978`, `:1007`, `:1302`; `whatsapp-schedule-runner/index.ts:44`.

### B07 — Alto: falha após reivindicação pode perder mensagem; janela de agrupamento incompleta

`claim_whatsapp_event` grava uma reivindicação definitiva antes do processamento. Não há estado de conclusão, expiração ou liberação nesse RPC. Falha posterior pode devolver erro, mas o reenvio encontra o evento reivindicado e é descartado. A memória local também marca o ID antes da reivindicação.

O agrupamento reivindica janela de oito segundos, aguarda quatro e lê fragmentos uma vez. Uma mensagem que chega entre a leitura e o término da janela é registrada e devolve `grouped_with_previous`, sem estar na leitura já concluída.

`claim_due_whatsapp_messages` também só busca `pending`; job que fica `processing` após queda do worker não tem recuperação por lease nessa função. Não foi localizada rotina de recuperação nas funções SQL examinadas nem no cron. Na fotografia não havia job preso.

**Correção:** caixa de entrada persistida com estados recebida/processando/concluída, lease e recuperação; fila para mensagens posteriores ao corte; retry com limite e idempotência da entrega. Testar falhas entre recebimento, banco, IA, provedor e gravação final.

Evidências: `whatsapp-webhook/index.ts:770`, `:825`, `:899`; definições de produção de `claim_whatsapp_event`, `claim_whatsapp_response_window` e `claim_due_whatsapp_messages`.

### B08 — Alto: controles exibidos não governam todos os envios

- “Aprovação Manual — Revise cada mensagem antes de enviar” grava `bot_auto_send`, mas não foi encontrado consumo desse campo nas funções de envio/cobrança examinadas.
- `bot_process_audio` e `bot_process_receipts` estão na tela, mas o webhook não os consulta antes dos respectivos fluxos.
- `bot_send_hour` e `bot_send_minute` aparecem como horário configurável; a cobrança roda em cron fixo às 13:00 UTC e não lê esses campos.
- Agendador não consulta `bot_enabled`, modo de aprovação ou situação da assinatura antes de enviar jobs automáticos. Suas verificações de pausa e bloqueio são insuficientes para substituir esses controles.

**Correção:** contrato único de elegibilidade para envio, separando explicitamente ação manual de automação; aprovação persistida e verificável; janelas e horários aplicados no servidor. O teste deve conferir que desligar uma função impede chamadas ao provedor.

Evidências: `src/components/configuracoes/sections/BotSection.tsx:60`, `:158`, `:174`, `:209`; `whatsapp-schedule-runner/index.ts:86`; buscas dos campos em `supabase/functions`.

### B09 — Médio: cobrança publicada diverge do repositório

O arquivo publicado de `auto-collection` calcula encargos compostos ao vivo e usa o maior entre esse cálculo e o valor armazenado. O repositório usa apenas `late_fee` materializado. A divergência foi confirmada após normalizar CRLF/LF; as diferenças dos outros dez arquivos examinados eram apenas de representação ou inexistentes.

**Correção:** decidir e documentar a fonte oficial do valor financeiro, alinhar cobrança e atendimento, versionar as funções e publicar com manifesto verificável. Um novo deploy do arquivo local pode modificar os valores comunicados aos clientes.

Evidência: `auto-collection/index.ts:377` e comparação com o arquivo montado no servidor.

### B10 — Médio: limites silenciosos e falhas de consulta tratados como ausência

Identificação busca todos os clientes de um credor sem paginação; depende do limite configurado no PostgREST. Núcleo de parcelas também não pagina. A ferramenta limita a vinte linhas antes de filtrar canceladas/contratos inativos e devolve a quantidade como `total`, sem informar truncamento. O menu recorta em trinta parcelas. Alguns caminhos ignoram `error` e passam a tratar dados ausentes como cliente desconhecido ou nenhuma parcela.

**Reprodução isolada:** vinte parcelas canceladas seguidas de uma ativa resultaram em `total=0` na ferramenta.

**Correção:** filtrar no banco, paginar, diferenciar total global de quantidade mostrada e distinguir indisponibilidade de ausência. Identificar por telefone normalizado indexado em vez de carregar toda a carteira.

Evidências: `_shared/agent_core.ts:101`, `:176`; `_shared/agent_tools.ts:180`; `whatsapp-webhook/index.ts:1357`.

### B11 — Médio: agendamento perde mídia e configuração de instância

`whatsapp-send` aceita mídia e horário juntos, mas persiste somente texto/caption ou `[mídia agendada]`. O runner envia exclusivamente `sendText`. O job pode aparecer enviado sem o anexo solicitado.

O runner usa a instância da conversa com URL/chave da configuração principal, sem resolver as credenciais de `whatsapp_instances` como o webhook faz. Isso pode falhar quando a conversa pertence a outro servidor Evolution. Não havia instâncias adicionais na fotografia; esse segundo caso é risco de configuração, não incidente confirmado.

**Correção:** persistir e validar tipo/anexo no job, ou recusar claramente agendamento de mídia enquanto indisponível; resolver a instância e suas credenciais por dono e conversa.

Evidências: `whatsapp-send/index.ts:97`; `whatsapp-schedule-runner/index.ts:86`, `:102`.

### B12 — Médio: ferramentas de CPF e portal usam contratos incompatíveis

`buscar_cliente_por_cpf` chama `search_clients_by_document`, cuja definição de produção filtra por `auth.uid()`. A recuperação usa chave de serviço sem identidade de usuário; nesse contexto o filtro não fornece a identidade do credor e tende a retornar vazio. A ferramenta deve receber o dono validado, não remover o isolamento do RPC.

`enviar_portal_link` busca `client_tokens`, mas o login por `?t=` usa `portal_login_by_token`, que consulta somente `portal_sessions` não expiradas. O menu já cria uma sessão nessa tabela. A ferramenta não verifica `is_active`, ignora erros e pode retornar link sem sessão ou URL relativa porque `SITE_URL` está ausente.

**Correção:** criar sessão curta para o cliente confirmado, usando o mesmo contrato do menu; validar origem pública, vínculo e expiração; propagar falhas de consulta.

Evidências: `_shared/agent_tools.ts:145`, `:263`; `whatsapp-webhook/index.ts:1375`; `src/pages/PortalCliente.tsx:182`; definições SQL de produção de busca por documento e login por token.

## Pendências adicionais

- A função `whatsapp-followup` existe, mas não há cron dela na lista de jobs do banco. O webhook agenda retornos por outro caminho. Sem examinar serviços externos não é possível concluir que a função nunca é chamada.
- Chamadas principais do webhook à Anthropic e o loop de ferramentas não têm timeout explícito; o worker publicado tem orçamento de sessenta segundos. Revisão documental pode consumir até 45 segundos antes de outros passos. É necessário orçamento por etapa e recuperação após timeout.
- O painel precisa distinguir configuração preenchida, execução HTTP, aceitação pelo provedor e confirmação de entrega. “Bot ligado” e cron `succeeded` não bastam para informar disponibilidade.
- Ainda há mapas em memória indexados somente por JID ou ID da mensagem. Devem incluir dono/instância e ser auxiliares; a consistência entre workers precisa residir no banco.
- A aprovação visual de documento deve manter a análise humana de crédito; ela verifica legibilidade e sinais visuais, sem autenticar origem, identidade ou decisão bancária.

## Proteções verificadas

- Webhook e cron fecham por padrão quando o segredo está ausente.
- Envio manual e recibos exigem usuário autenticado e conferem o dono; testes de tentativa com outro dono passam.
- RPCs `system_register_payment`, `system_pay_client_balance` e `system_renew_installment_interest` negam execução a `anon` e `authenticated`, permitindo `service_role`.
- Tabelas de WhatsApp e de ações do bot examinadas têm RLS habilitada.
- Login por token do portal verifica expiração; `portal_sessions` tem RLS habilitada e nenhuma política pública de leitura/escrita observada.
- Existem guardrails de texto/PIX, detecção de reuso de comprovante, lançamentos financeiros atômicos e deduplicação financeira por `source_key`.

## Validação e limites

**111 testes existentes de funções e 14 testes de integração passaram**, sem permissão de rede nos processos Deno. Quatro reproduções adicionais passaram demonstrando: falta de vínculo das ferramentas, saldo de encargos omitido, comprovante aceito por heurística e dívida escondida pelo limite. Dois cenários SQL no PGlite demonstraram leitura/reivindicação anônima de jobs e leitura de conversa pelo follow-up, usando definições de produção.

Esses testes adicionais confirmam os problemas descritos; passar neles não significa que o comportamento é seguro. A integração existente cobre envio manual, recibos e pagamentos de assinatura, mas não exercita o webhook WhatsApp completo nem todas as interações com o agendador.

Não foram executados testes de exploração em produção, transferência bancária, OCR pago, entrega real no WhatsApp, recuperação após queda de worker ou testes com todos os tipos de documentos. A auditoria não afirma ocorrência de vazamento ou fraude com usuários reais.

## Ordem de execução recomendada

1. Restringir as RPCs internas e testar acesso de visitante/usuário comum/worker em banco isolado.
2. Vincular ferramentas ao credor/cliente e impedir baixa automática baseada somente na imagem.
3. Corrigir saldo parcial, mensagens de quitação, pausa humana e processamento com retry.
4. Aplicar os controles de envio e remover promessas de funções ainda sem implementação.
5. Alinhar código financeiro publicado, integrar testes completos do webhook e só então restaurar segredos e automações com validação controlada.
6. Monitorar erro HTTP, fila, tempo de resposta e confirmação de entrega por conta, sem expor conteúdo ou dados pessoais nos alertas.
