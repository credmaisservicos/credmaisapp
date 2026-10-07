# Gemini e testes de atendimento — 07/10/2026

O agente aceita Gemini diretamente no servidor, com texto, mídia e chamadas de ferramentas. Os consumidores existentes mantêm a assinatura do helper de IA. A conta autorizada usa `gemini-3.5-flash-lite`, confirmado por geração e consulta fictícia de saldo na API real. A chave consultou a lista de modelos, mas `gemini-2.5-flash` respondeu 404 ao gerar conteúdo.

## Configuração

As variáveis ficam somente no ambiente das funções; nunca no frontend, APK ou repositório:

```text
GEMINI_API_KEY=<segredo do servidor>
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_ALLOWED_USER_IDS=<UUID da conta autorizada>
BOT_TEST_OWNER_ID=<UUID da conta de testes>
BOT_TEST_RECIPIENT=<telefone brasileiro com 55 e DDD>
```

`GEMINI_ALLOWED_USER_IDS` limita o uso da chave por conta. Chamadas sem contexto de dono não usam a chave quando a lista está preenchida. Os demais provedores configurados continuam disponíveis aos consumidores existentes.

O modo de testes permite respostas automáticas somente ao destinatário autorizado, mantendo `bot_auto_send=false`. Mensagens recebidas de outros contatos continuam registradas, sem resposta nem geração de rascunho de IA. A entrega também verifica o destinatário antes de aceitar aprovação manual. A identificação aceita a representação do WhatsApp brasileiro com ou sem o nono dígito, preservando o DDD. Contas fora do modo de testes seguem a política original. Remover as duas variáveis `BOT_TEST_*` encerra a restrição temporária; a configuração normal de envio volta a valer.

Ferramentas continuam verificando dono e cliente no servidor. O adaptador preserva as assinaturas dos blocos do modelo entre consultas e resultados de ferramentas. Erros, bloqueios e respostas truncadas usam o fallback existente; o corpo de erro do Gemini não é registrado.

Referências: [API de geração](https://ai.google.dev/api/generate-content), [chamadas de funções](https://ai.google.dev/gemini-api/docs/function-calling).

## Correções encontradas no teste

- Consulta de parcelas, portal e pedido de atendente interrompem a seleção da modalidade do empréstimo; respostas numéricas continuam escolhendo a modalidade.
- O menu tem uma única instrução e os textos de ajuda seguem a mesma numeração: 2 para parcelas, 3 para renegociação, 5 para atendente. `portal` gera o acesso exclusivo do cliente.
- Perguntas contendo “entender melhor” deixam de ser interpretadas como elogios. Orientações sobre desconto e antecipação dependem da equipe, sem prometer um desconto calculado automaticamente.
- O diagnóstico de atendimento reconhece Gemini, incluindo disponibilidade de áudio. Sugestões do inbox e cobranças passam o dono à seleção do provedor.

## Validação

893 testes automatizados distintos aprovados: 457 Vitest, 156 compartilhados sem rede, 62 integrações HTTP sem rede e 218 testes de interface com backend fictício. Tipos de 43 funções, lint, tipos do app e regras de hooks verificados. Os testes abrangem valor parcial, juros, promessa, pausa humana, comprovante pendente, erro do provedor, isolamento de contas e restrição do destinatário de testes.

Na conta de testes autorizada foi criado um cliente identificado como teste, com nome, CPF validado e telefone informados pelo titular. Uma parcela fictícia de R$ 1,00 exercita cobrança e consulta, sem desembolso e sem lançamento de pagamento. A cobrança e respostas iniciais foram aceitas pelo provedor; mensagens reais do telefone de teste foram recebidas. Até a publicação das correções não houve envio para outro destinatário da conta nem transação financeira do cliente de teste.

O portal publicado foi exercitado com esse cliente em 360 e 1366 pixels: login, parcela fictícia, filtros, recarregamento da sessão, detalhes de pagamento, download do extrato PDF e logout. Sem erro de página, resposta HTTP de erro ou transbordamento horizontal. Os extratos e capturas ficam na área local ignorada e não são publicados.

A API real do Gemini respondeu a uma consulta fictícia com chamada de função e leitura do resultado; nenhum dado de cliente real foi usado nesse teste de API. A publicação inclui backup privado das funções, banco e configuração, sem migração nova. Conversas livres, áudio, comprovantes e negociação pelo WhatsApp dependem de mensagens do telefone autorizado para verificar o percurso externo completo; a cobertura automatizada usa provedores simulados.
