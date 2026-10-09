# Ajustes seguros disponíveis — 09/10/2026

Escopo desta rodada: corrigir o que permite avançar sem alterar dívidas reais, revogar arquivos existentes ou depender de um aparelho externo. Código publicado `0ca45be592ed19f22d406192602756b7275ea72f`, Cloudflare Pages `0ebf80a9-10e2-4d10-a06f-0f337ccc7cca`. Catálogo idêntico ao build no domínio principal e www: `72c37e15abb55ad80a3d1a1fdcf93a98cd980521fcf7804d91451d45f91c82fa`.

## Alterações publicadas

- **Comprovantes por caminho:** o portal podia guardar um caminho simples quando a assinatura inicial falhava. O leitor interpretava esse valor como endereço relativo do site, impedindo abrir o anexo. Agora reconhece somente pastas existentes com UUID do titular/cliente e renova o acesso após verificar a autorização. Traversal, caminhos ambíguos, rotas do aplicativo e sessões de outra empresa continuam recusados. URLs assinadas antigas e referências `storage://` continuam compatíveis.
- **Informação de juros:** cadastro, edição, renegociação e configurações exibem a taxa efetiva da regra atual. Zero ou vazio usa o padrão de 4% ao dia, além da multa escolhida. Alterar o campo atualiza o aviso; cancelar preserva a taxa salva. Nenhuma regra de cálculo, contrato existente ou dívida foi alterada nesta rodada.
- **Diagnóstico de navegadores:** a matriz isolada conserva início/fim, código de saída, sinal do processo, memória disponível, limites de cgroup, `/dev/shm` e o último megabyte do log do navegador. As capturas ficam nos artefatos de teste. A instrumentação usa exclusivamente o backend fictício do runner; timeout e quantidade de retries permanecem iguais. Ela prepara evidência para O02/Q01, sem declarar suas causas resolvidas.

## Validação

Seis regressões falharam antes dos ajustes pelos sintomas esperados. Após a correção passaram **46 testes direcionados**, **983 testes em 120 arquivos**, typecheck, lint, hooks e build. Os seis cenários novos de navegador passaram: autorização permitida/recusada de comprovante por caminho em Chromium e juros zero em 390/1366 px no Chromium e WebKit.

A primeira matriz local interrompeu após 23 aprovações porque o arquivo de texto fictício não declarava UTF-8. A navegação autorizada ocorreu, mas a asserção encontrou acentos incorretos. A fixture foi corrigida sem modificar a aplicação ou relaxar asserções. Trace, screenshots, execução interrompida e diagnósticos foram preservados. O console PowerShell classificou avisos de cor do Node como erro nativo na execução direcionada; o relatório Playwright registra seis aprovações. O gate completo de CI da versão publicada é registrado no encerramento abaixo.

Na versão publicada, **Chromium desktop e WebKit em 390 px** confirmaram os avisos de juros e o cancelamento na conta fictícia. A comparação das taxas antes/depois permaneceu igual, nenhuma escrita financeira foi tentada e não ocorreu overflow horizontal. Não houve operação de negócio em conta real.

O teste real de anexo reutilizou um objeto fictício já existente, sem criar, substituir ou excluir arquivos. Antes da alteração, o endpoint recusava o caminho simples. Depois da publicação, autorizou o acesso do titular, respondeu HTTP 200 com os mesmos bytes, produziu assinatura com `exp - iat = 300` e recusou visitante com HTTP 401. Uma asserção inicial que comparava a validade com o relógio local foi corrigida: o servidor estava um segundo à frente; a duração é conferida pelos tempos de emissão/expiração da própria assinatura. Nenhuma validação foi removida.

## Publicação no servidor

Backup da fonte anterior em `/root/.credmais/safe-pending-20261009T135429Z`. A fonte foi verificada por hash antes da substituição e conferida depois: `403240d8f661f8a5333a04437bf748085e14400ae9d56bdee7e8b8f5f7f6f6c9`. O runtime mantinha a versão anterior em memória; somente o processo de funções foi reiniciado, com parada graciosa de 30 segundos. Banco, Storage e Studio não foram reiniciados.

Zero comandos de banco, arquivos de clientes modificados ou mensagens enviados pela publicação. Os arquivos publicados de entrada, cadastro, detalhes, configurações e aviso correspondem ao build local. O deploy automático continua habilitado.

## Dependências que permanecem abertas

- **S05:** migrar os escritores que ainda persistem assinaturas longas e revogar o legado exige compatibilidade com versões já instaladas. Nenhum token antigo foi revogado nesta rodada.
- **C02:** decidir se zero deve significar ausência de juros ou manter o padrão atual; alinhar geração dos documentos e novos contratos após essa decisão. Os documentos existentes e os cálculos de dívidas reais não foram reescritos. O formulário de cadastro ainda persiste o zero legado; o novo aviso torna o efeito atual explícito.
- **O02/Q01:** a causa das ocorrências históricas de crash/confirmação permanece sem comprovação; os novos diagnósticos não substituem a investigação da tentativa correspondente.
- **M01:** leitura atual do ambiente confirmou ausência de chave pública, token de acesso e segredo de webhook do Mercado Pago. Os valores não foram expostos. Testes de sandbox dependem dessas credenciais.
- **E01:** host, usuário, senha e remetente SMTP estão configurados; falta confirmar entrega numa caixa postal autorizada e concluir o link recebido.
- **A02/W01/I01/C01:** combinação física afetada por “sem conexão”, recepção WhatsApp no aparelho, instalação/atualização física e conciliação com documentos reais continuam exigindo comprovação externa ou humana.

Esta rodada avança partes técnicas da lista de dez itens; não equivale a encerrar os dez itens nem a homologar todo o aplicativo novamente. Evidências privadas em `.delivery.local/qa-agent/pending-safe-*`, fora do Git.

## Encerramento do gate

[CI 37939614700](https://github.com/credmaisservicos/credmaisapp/actions/runs/37939614700) aprovada no commit publicado: 983 unitários, 225 testes compartilhados das funções, 312 integrações simuladas e **204 verificações reais isoladas**. A matriz de interface registrou **281 aprovações diretas e um caso após retry**, além de 16 responsivos, três de isolamento de arquivos e dez de conferência financeira.

O retry ocorreu no caso WebKit `senha recusada mantém o link válido e a conclusão encerra somente esta sessão`: após a segunda tentativa, a primeira execução permaneceu em `/reset-password#type=recovery` e excedeu o limite de dez segundos para chegar ao login. A tentativa seguinte passou. Essa ocorrência não foi atribuída ao produto, à infraestrutura ou à fixture sem investigar o trace correspondente, e não é declarada resolvida. O teste não foi alterado nesta rodada; timeout e retries não foram aumentados, e a CI não foi repetida para ocultá-lo. Logs, trace, screenshot e diagnósticos permanecem no artefato `interface-simulada-37939614700-1` e na cópia privada da auditoria. O run anterior foi cancelado pela concorrência normal ao publicar a correção UTF-8 da fixture.
