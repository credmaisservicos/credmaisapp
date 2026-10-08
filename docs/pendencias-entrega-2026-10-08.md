# Pendências para a entrega completa

As correções publicadas e os testes automatizados comprovam os cenários registrados nos relatórios. A entrega integral continua aberta pelos itens abaixo. Os testes financeiros desta rodada usam banco isolado e dados fictícios; os dados de usuários reais são preservados.

| Item | Trabalho restante | Dependência ou limite atual |
| --- | --- | --- |
| Acesso em outros aparelhos | Reproduzir e resolver o erro no aparelho e na rede afetados; configurar `www.credmaisapp.com.br` e sua associação ao site. | O domínio sem `www` passou nos testes públicos. A credencial disponível não administra a zona DNS. Falta evidência do endereço, erro, aparelho e rede afetados. |
| Conciliação histórica | Disponibilizar e validar um fluxo humano de correção, com auditoria por lançamento, usando documentos e extrato bancário. | Não inventar componentes, datas ou recebimentos antigos. O relatório sinaliza diferenças; isso não comprova saldo conciliado. |
| Resumos financeiros | Concluir a comparação de Hoje, Análises, Painel e Relatórios com o caixa e o calendário financeiro canônicos, incluindo parciais e encargos. | O relatório da Carteira e a proteção dos lançamentos manuais já têm validação própria. |
| Homologação e segurança | Configurar ambiente de staging separado e executar a suíte autenticada e os fluxos completos de entrega. | A etapa de staging da CI está sem configuração e permanece pulada; teste de produção não deve fabricar movimentações reais. |
| E-mail e assinatura | Comprovar entrega real da recuperação de senha e assinatura por Mercado Pago em sandbox, incluindo webhook e liberação de acesso. | SMTP configurado e testes simulados não comprovam entrega ou checkout completos. |
| WhatsApp | Validar os recibos e os últimos ajustes de cobrança, contexto, áudio e transferência humana com o provedor e o telefone autorizado. | Manter os demais destinatários bloqueados durante testes; bot não negocia nem confirma dinheiro a partir de comprovante sozinho. |
| Instalação e desempenho | Exercitar instalação, atualização, retorno ao app e uso prolongado em Android, iPhone e computadores físicos, incluindo celulares modestos. | APK assinado e publicação automática são conferidos separadamente. Perfis emulados não comprovam funcionamento em todos os aparelhos. |
| Redes com restrições | Concluir a auditoria das conexões diretas usadas por agente, exportações e atualização em tempo real. | O fluxo HTTP principal já usa o domínio do app; falta conferir todos os caminhos em uma rede que bloqueie o backend direto. |

Para lançamentos manuais, manter os dados do navegador até confirmar a tentativa. Limpar o armazenamento, usar outro navegador ou permanecer numa versão antiga exige conferir o histórico antes de repetir o cadastro. A proteção atual não substitui a conferência humana do caixa.
