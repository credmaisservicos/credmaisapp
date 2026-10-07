# Recuperação do acesso no Safari e no app instalado — 2026-10-07

## Falhas reproduzidas

Na conferência pública após a primeira publicação desta rodada, Chromium e WebKit receberam `text/html` ao importar `trash-2-cachefix20261007-DEhA9Clb.js`. A inicialização mostrou “A conexão está demorando”, mesmo com internet e API disponíveis. Consultas HTTP simples ao mesmo arquivo retornavam JavaScript; por isso a disponibilidade da API e uma conferência isolada por URL não comprovavam a abertura do app. A falha foi registrada nos dois motores sem autenticar usuários reais.

O SDK usa `X-Retry-Count` nas novas tentativas de consultas GET. O proxy HTTP do app não permitia esse cabeçalho no preflight das origens nativas. A publicação anterior respondeu HTTP 204 ao OPTIONS, mas omitiu o cabeçalho permitido. Em uma janela nova do WebKit com origem `https://localhost`, a consulta pública de perfis com `limit=0` retornou 200 sem o cabeçalho e falhou com `TypeError: Load failed` quando ele foi incluído. O mesmo teste no Chromium não reproduziu a recusa; o comportamento do WebKit foi confirmado antes da publicação.

A recuperação do perfil também ignorava a mensagem `Load failed` do Safari, inclusive com o prefixo `TypeError:` retornado pelo PostgREST. Se as tentativas do SDK falhassem, o app não realizava sua tentativa limitada de recuperação. Seis cenários de regressão reproduziram esse comportamento antes da correção. Outros três reproduziram a falta do cabeçalho no proxy.

## Alterações

O arquivo afetado recebe uma URL nova. A função de entrega passa a validar respostas de `/assets/*`: HTML e MIME incorreto para JavaScript/CSS retornam 404 sem cache no navegador ou CDN; falhas HTTP também não recebem cache imutável. Arquivos válidos mantêm o cache existente. A configuração `_routes.json` inclui os assets para que essa validação seja executada em produção. Quatro cenários reproduziram respostas inválidas cacheáveis antes dessa correção. O fallback das rotas do app continua preservado.

O proxy permite `x-retry-count` somente dentro das origens e rotas já autorizadas. Não adiciona novas origens, repetição de operações nem acesso a dados. Respostas 401, 403 e 429 continuam sendo respeitadas.

Mensagens específicas de falha de rede do Safari recebem o mesmo tratamento das falhas de rede dos demais navegadores. A consulta do perfil pode se recuperar uma vez; falhas persistentes mostram conexão com o servidor indisponível, sem liberar permissões do cache online. Mensagens genéricas de erro de aplicação não são tratadas como falha de rede.

Os testes de login passam a incluir o motor WebKit com configuração de iPhone, além do Chromium. A regressão de rede esgota as três tentativas GET do SDK antes de verificar a recuperação do app. Os testes interceptam todas as respostas do backend e não enviam e-mails, pagamentos ou mensagens reais.

## Validação e limites

663 testes unitários e 18 testes de login passaram, incluindo autorização do proxy, classificação das falhas e recuperação do perfil. Tipos, lint, hooks e build foram conferidos. Os nove cenários de login passaram tanto no Chromium quanto no WebKit e cobrem primeira entrada, falha do perfil, recuperação de rede, armazenamento indisponível, senha recusada e isolamento das sessões dos portais.

A inspeção atual do servidor encontrou 14 contas com perfil e respostas de autenticação e REST disponíveis. Isso não confirma a causa em cada aparelho relatado. É preciso registrar o link usado, navegador/app, aparelho e rede para os casos que persistirem.

O endereço publicado é `https://credmaisapp.com.br`. O domínio com `www` ainda não possui registro DNS nem domínio adicional ativo no projeto Pages. A credencial disponível para Pages não lista a zona DNS; esta alteração não modifica o domínio com `www`.

Não há migração de banco, alterações financeiras ou mudanças nas funções do bot nesta publicação.

Referência de infraestrutura: o Pages encaminha rotas não encontradas para o shell de uma SPA e utiliza cache distribuído para assets. As respostas personalizadas das Functions precisam definir seus próprios cabeçalhos. [Entrega do Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/), [cabeçalhos nas Functions](https://developers.cloudflare.com/pages/configuration/headers/).
