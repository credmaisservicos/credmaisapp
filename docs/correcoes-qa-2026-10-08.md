# Correções dirigidas da auditoria de uso real — 08/10/2026

Validação final de 09/10: ajuste de cache publicado em `b78576c`; venda quitada, aluguel pago, caução devolvida uma vez e saldo R$ 10,80 verificados na conta fictícia. Chromium confirmou recarga e navegação na mesma sessão; WebKit móvel confirmou saldo e locação concluída. [Evidências e limites da rodada](correcoes-caixa-comercial-2026-10-09.md).

Atualização de 09/10: **QA-03 e QA-04 corrigidos e publicados** em `a6d7512`; [migrações, testes e preservação dos dados](correcoes-caixa-comercial-2026-10-09.md). Os resultados abaixo descrevem a versão anterior e permanecem preservados.

Esta fase trata dos dois defeitos confirmados na [auditoria independente anterior](qa-usuario-real-2026-10-08.md). Os resultados e as limitações da rodada anterior permanecem preservados; esta validação não equivale a uma nova auditoria integral do aplicativo.

## Versão publicada e verificação técnica

Código: `7ab1b0b7438333f0a8230b0b1f2b3739f67b089b`. Cloudflare Pages: `fa8c9e13-002d-452b-9729-ef9bf8ea0ee3`. Fingerprint do catálogo: `56c2327466b05433ee986e5a40a9e5fc841e919dcd0a5a841805b92b81144763`.

Os catálogos dos domínios principal e www são idênticos ao build local aprovado. Os 227 arquivos JavaScript/CSS publicados foram conferidos por conteúdo, tamanho e MIME. Os formulários de login carregaram e permitiram digitação em Chromium e WebKit. Publicação congelada durante a execução dirigida do agente.

Os testes reproduziram cinco falhas antes das correções. Após os ajustes, passaram os 12 testes direcionados em três arquivos, incluindo os formulários React reais de venda à vista, venda parcelada e locação e a busca por nome, telefone, CPF e WhatsApp. Typecheck, lint e build de produção passaram.

A CI completa [37819710406](https://github.com/credmaisservicos/credmaisapp/actions/runs/37819710406) também terminou aprovada: verificações técnicas, testes/build, interface e homologação real isolada de duas empresas. Sondagens opcionais foram puladas e não contam como aprovadas.

A rodada dirigida do agente ocorreu de 17:52:27Z a 18:02:24Z, em dez minutos: **16 cenários finais, dez aprovados, três falhas de produto correspondentes a dois defeitos novos, dois bloqueados e um não executado**. Tentativas de automação e seus diagnósticos foram preservados separadamente; não somá-los aos cenários finais. Isso mantém os dois defeitos-alvo corrigidos e explicita as pendências encontradas depois.

## Alterações

| Defeito | Correção | Evidência de uso real |
|---|---|---|
| QA-01 / alta — criar venda ou locação retorna “Operação inválida” | O formulário envia explicitamente `kind`, distinguindo `sale` e `rental`, como exige a RPC. | Três criações pela interface retornaram HTTP 200 e persistiram após recarga: venda à vista R$ 3 concluída; venda R$ 3 com entrada R$ 1 e duas parcelas de R$ 1; locação diária R$ 2 com caução R$ 1. Cliente, bem, datas e autoria conferidos na empresa fictícia. |
| QA-02 / média — busca alfabética mantém cliente sem correspondência | A comparação com telefone/CPF exige que a consulta contenha dígitos, impedindo que uma string vazia corresponda a todos os clientes. | Em Chromium 360 px e WebKit iPhone emulado, consulta alfabética inexistente e numérica inexistente exibiram lista vazia; nome correspondente e limpar restauraram o cliente atribuído; recarga e saída passaram. Usado somente token próprio já existente. |

Todas as escritas comerciais ocorreram exclusivamente na empresa fictícia de QA, reutilizando seus três bens de teste já existentes. Sem envio de mensagens, cobranças externas ou alteração de registros financeiros de clientes reais. Conta admin fornecida pelo usuário reservada a verificação de acesso, permissões e navegação, sem escritas de negócio.

## Conta admin fornecida pelo usuário

Login real aprovado; o aplicativo encaminhou corretamente para `/admin`. A identidade autenticada correspondeu à conta fornecida, o perfil próprio foi carregado e `is_admin` confirmou a permissão administrativa. Quatro abas principais do painel foram abertas e conferidas, incluindo recarga. Em 360 px, recarga e abertura/fechamento do menu passaram sem overflow global. Sem erros de página ou respostas HTTP de falha nessa execução corrigida.

Foi preservada a tentativa inicial cujo script esperava incorretamente `/dashboard`; o redirecionamento efetivo para `/admin` era correto. O formulário comercial dessa conta não foi concluído: o botão esperado não estava disponível na jornada executada. Isso limita a cobertura da conta admin e não comprova um defeito do produto. Não foram alterados usuários, planos, suporte, bots, configurações da plataforma ou finanças nessa conta.

As tentativas iniciais de busca também permanecem preservadas: espera de visibilidade do input em Chromium e sessão antiga recusada com HTTP 403 em WebKit. A execução dirigida passou com login fictício novo para consulta do token existente e um contexto público separado do portal, sem recriar token ou dados.

## Defeitos adicionais descobertos ao desbloquear a criação

| Pendência | Reprodução e evidência | Limite da execução |
|---|---|---|
| QA-03 / alta — baixa de parcela comercial recusada | Clicar em Baixar na venda parcelada ou no aluguel próprio retorna HTTP 400, código SQL `42702`, `column reference "r.operation_id" is ambiguous`. A função declara variável `r` e reutiliza esse nome como alias SQL. | Nenhuma baixa foi concluída nem repetida. Devolução/restituição da caução não foi executada, pois o cenário parou no recebimento recusado; não há falha comprovada de `close_business_operation`. |
| QA-04 / alta — Carteira ignora movimentos comerciais | A venda à vista, a entrada da venda parcelada e a caução criaram `business_income` de R$ 3 + R$ 1 e `security_deposit` de R$ 1 em transactions. Saldo Total permaneceu R$ 2,80, enquanto a soma com esses movimentos seria R$ 7,80. | Divergência comprovada na empresa fictícia; sem recomposição de saldos ou alteração de transações de empresas reais. |

Os novos defeitos ficam separados das duas correções solicitadas. As demais pendências históricas e os casos não executados/bloqueados na auditoria anterior continuam em [pendências de entrega](pendencias-entrega-2026-10-08.md).

Evidências, credenciais, capturas e relatórios detalhados ficam somente em `.delivery.local/qa-agent/`, ignorada pelo Git. Relatório público sem sessões, tokens ou identificadores privados.
