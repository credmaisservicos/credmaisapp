# Portal do cliente e negociação humana — 2026-10-07

O portal permite consultar contratos e parcelas, obter o PIX contratual, enviar comprovantes para conferência e baixar o extrato. A negociação automática foi removida; o cliente encontra os contatos da equipe responsável pelo contrato.

## Visual e uso

Paleta em preto, branco e cinza, com modos claro e escuro e preferência persistida. Sem neon, brilho, gradientes decorativos, sombras ou movimento dos cartões. Resumo financeiro, filtros e detalhes foram ajustados para telas pequenas. A paleta também alcança os diálogos de pagamentos e notificações e é removida ao sair do portal.

## Atendimento humano

Pedidos de desconto, parcelamento da dívida, mudança de prazo, pagamento parcial negociado ou renovação pagando juros são encaminhados antes dos menus e da IA. O encaminhamento pausa a conversa e notifica a equipe; consultas e PIX das condições contratuais continuam disponíveis. A proteção também bloqueia ofertas inesperadas da IA, incluindo descontos de 1%.

Simulações e propostas automáticas de leads foram retiradas. Leads qualificados e conversas antigas no estágio de simulação seguem para análise humana. A função legada `client-negotiation` responde HTTP 410 com `human_negotiation_required`, sem consultar dados do cliente ou chamar um modelo, inclusive para versões antigas do portal.

## Validação

- 457 testes do frontend; 157 testes compartilhados sem acesso à rede; 81 integrações HTTP com provedores simulados.
- 224 testes de interface isolada, incluindo seis cenários do portal em 320, 390 e 1366 pixels nos dois temas. Os seis foram repetidos após o ajuste final da paleta.
- Tipos do aplicativo e de 43 funções, lint, regras de hooks e conferência visual de capturas em celular e computador.
- Nenhuma migração de banco. Backup anterior à publicação dos 15 arquivos de servidor: `/root/.credmais/bot-source-20261007T123302Z`.

Os testes externos continuam restritos à conta e ao destinatário autorizados. A validação de negociação usa dados fictícios e provedores simulados; não é uma negociação realizada no WhatsApp de um cliente real. Não houve pagamento ou desembolso para testar esta alteração.
