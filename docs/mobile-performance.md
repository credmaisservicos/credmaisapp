# Carregamento e interface em celulares

Revisão de 7 de outubro de 2026, com backend simulado e sem alterar dados de clientes.

## Alterações

- As 27 ilustrações do Credinho usam WebP com dimensões adequadas à tela. O conjunto passou de 43,58 MB para 0,83 MB. Os PNGs antigos continuam disponíveis em resolução menor para compatibilidade com versões abertas; o conjunto completo de ilustrações distribuído passou a 8,87 MB.
- O service worker instala primeiro o shell e o painel, com até dois downloads simultâneos. As demais telas são armazenadas quando utilizadas. Em uma conexão rápida, são preparadas em segundo plano após 30 segundos, enquanto a página está visível. Essa preparação é dispensada em 2G/3G ou com economia de dados.
- Uma navegação com HTML salvo usa esse shell após três segundos se a rede não responder. Falhas HTTP não substituem o shell salvo. Consultas financeiras continuam fora do cache do service worker.
- A abertura espera o React montar antes de remover a apresentação inicial. A espera por uma tela não apaga mais o cache offline nem recarrega automaticamente. Depois de 15 segundos, aparece a opção de tentar novamente.
- O menu permanece visível durante o carregamento das rotas. A troca de rota reinicia o aviso de espera apenas para aquela tela.
- Os cartões no celular dispensam os desfoques e os círculos decorativos grandes. O painel mantém o título acima da ilustração e usa menos altura para os banners. A tela de entrada também reserva menos espaço decorativo.
- Cada página de uma consulta feita por `fetchAll` tem espera máxima de 20 segundos. Uma falha interrompe a consulta inteira para evitar mostrar totais parciais.
- Painel, clientes e cobranças distinguem a falta de dados salvos da ausência de registros. Uma tela sem dados disponíveis offline informa a necessidade de conexão, em vez de mostrar valores zerados ou manter uma espera infinita. As informações já salvas continuam disponíveis.
- HTML retornado por engano no endereço de um chunk JavaScript é recusado e não fica conservado como código no cache.
- Atualizações aguardam a conexão voltar antes de substituir ou recarregar a publicação em uso; as leituras também iniciam pausadas quando o app já abre sem rede.

## Medição de referência

Chromium sem janela, viewport 390 × 844, CPU limitada a 1/4 e rede a 256 KiB/s com latência de 120 ms. Foram observados os primeiros 30 segundos de cada abertura, incluindo pedidos do service worker. Fontes externas foram bloqueadas nas duas medições e todas as chamadas ao backend foram simuladas.

| Tela | Bytes servidos antes | Bytes servidos depois | Pedidos antes | Pedidos depois |
| --- | ---: | ---: | ---: | ---: |
| Entrada | 10.730.285 | 1.064.533 | 253 | 65 |
| Painel | 10.589.997 | 1.051.963 | 272 | 68 |

Essa comparação mede a redução de arquivos solicitados neste cenário, não a velocidade garantida em todos os aparelhos. As imagens novas representam redução de 98,1%; incluindo as imagens de compatibilidade, a redução do conjunto é de 79,7%.

Os testes cobrem abertura com importação atrasada, navegação entre telas com rede lenta, espera sem apagar o offline, instalação com concorrência limitada, preparação das rotas adicionais, rede sem resposta e falhas HTTP. A bateria de interface também verifica telas públicas, menus, formulários e tamanhos de celular, tablet e desktop.

Ainda é necessário observar o uso em celulares físicos e contas com volumes reais diferentes para identificar problemas específicos que não se reproduzam com os dados simulados.

## Carteiras grandes e atualizações em tempo real

Na segunda revisão, cobranças passou a desenhar 30 cartões de clientes por vez, com o botão **Carregar mais clientes**. Cada grupo aberto mostra inicialmente até 30 parcelas, com a opção **Mostrar mais parcelas**. Buscar, trocar filtros ou ordenar reinicia essa apresentação. Totais, seleção global, seleção por cliente e consultas continuam usando todos os registros; o calendário também mantém o conjunto completo.

Os eventos do banco agora compartilham um canal por chamada do hook e são agrupados em janelas de 250 ms. Uma sequência de alterações não dispara uma nova consulta para cada evento. Trocar de conta, de tabelas ou de chaves encerra o canal anterior e cancela a atualização pendente. O resumo de contratos na lista de clientes também é invalidado quando contratos ou parcelas mudam.

Medição local em Chromium sem janela, viewport 390 × 844 e CPU limitada a 1/4, com **500 clientes fictícios e 6.000 parcelas**. O service worker foi desativado nas duas medições para observar a montagem da lista.

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Cartões montados inicialmente | 500 | 30 |
| Nós DOM reportados pelo navegador | 42.014 | 4.405 |
| Tempo observado até montar os cartões | 10.538 ms | 2.733 ms |
| Tempo de execução de scripts | 2,703 s | 0,703 s |
| Tempo de layout | 1,058 s | 0,214 s |

Os nós DOM diminuíram 89,5% nesse cenário. Os tempos são uma amostra de execução local e podem variar; não são uma promessa de desempenho em aparelhos físicos. As consultas ainda carregam os registros completos, portanto esta alteração reduz o custo de desenhar a lista, sem reduzir os dados financeiros recebidos.

A validação inclui uma carteira de 120 clientes e 1.440 parcelas, total de R$ 144.000, busca por um cliente fora do primeiro bloco, seleção global e filtrada, carregamento até o último cliente e um grupo com 75 parcelas. Cinco testes do hook verificam agrupamento de 500 eventos, alteração das assinaturas, cancelamento na saída e isolamento na troca de conta. Todos os dados e as chamadas de backend desses testes são simulados.
