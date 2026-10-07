# Correções da auditoria do bot — 07/10/2026

As correções foram feitas a partir da [auditoria original](auditoria-bot-2026-10-07.md). O atendimento usa uma fila persistente e a confirmação de recebimentos exige conferência humana no banco. A análise de um arquivo não confirma uma transferência.

| Achado | Correção |
|---|---|
| B01 — RPCs públicas | Rotinas de trabalhadores exigem `service_role`, com acesso revogado para visitantes e usuários autenticados. |
| B02 — configuração ausente | Configuração persistente do segredo do cron, segredo do webhook e origem do portal. As chaves de IA e transcrição continuam sendo dependências externas. |
| B03 — ferramentas sem vínculo | Consultas e PIX exigem o dono e o cliente identificado na conversa. CPF não permite selecionar outro cliente. |
| B04 — baixa por heurística | Removida a baixa automática e seu controle na interface. Comprovantes ficam privados e pendentes de conferência; o operador informa o valor realmente recebido. |
| B05 — encargos e pagamentos parciais | Consulta, PIX e cobrança incluem saldo de encargos. A confirmação acrescenta o novo recebimento ao total anterior. Renovação de juros exige valor compatível e novo vencimento futuro; pagamentos parciais exigem reconciliação antes de renovar. |
| B06 — pausa humana | A pausa permanece após encerramento de sessão. Um gatilho cancela automações pendentes durante a transferência, preservando envios manuais e aprovados. |
| B07 — perda e duplicidade | Eventos recebidos têm estado, prazo de processamento e tentativas persistentes. Fragmentos concorrentes continuam pendentes. Envios têm uma chave por solicitação; resultados incertos exigem conferência antes de reenviar. |
| B08 — opções ignoradas | Bot desativado preserva o inbox. Flags de áudio, comprovantes, horários e aprovação manual são respeitadas. Removido o controle de áudio de saída sem implementação. |
| B09 — cobrança divergente | Publicado o mesmo código auditado. Valores são reconsultados antes da entrega; cobranças com saldo alterado são canceladas. O cálculo usa a fórmula do pagamento no banco, inclusive piso gravado, juros compostos, multa e teto. |
| B10 — leitura incompleta | Parcelas, clientes e dados financeiros usam paginação. Falha de leitura não é tratada como ausência de dívida. |
| B11 — mídia e instâncias | Agendamentos preservam URL e tipo do anexo. O envio escolhe as credenciais da instância da conversa. A recepção conserva anexos privados mesmo com bot pausado. |
| B12 — CPF e portal | Busca de telefone restrita ao servidor, incluindo dono e DDD. O portal usa `portal_sessions` e link HTTPS com validade de 30 minutos. |

O inbox permite aprovar e descartar rascunhos, mostra falhas e sinaliza entrega incerta. O painel consulta a conexão no provedor e distingue a configuração do servidor da disponibilidade da IA. Aceitação pelo provedor não comprova entrega ou leitura no telefone.

As cobranças executam a cada cinco minutos e respeitam a hora e o minuto escolhidos pela conta. Follow-up executa a cada 30 minutos; entregas e recuperação de eventos executam a cada minuto. Datas de atendimento usam São Paulo; encargos acompanham o dia UTC usado pelo banco de produção.

## Validação

- 435 testes Vitest, incluindo execução real das migrações em PostgreSQL local em memória: isolamento, leases, pausa humana, pagamento parcial, encargos, rollback de excesso, repetição e renovação de juros.
- 121 testes das funções compartilhadas.
- 28 testes de integração com HTTP simulado e sem permissão de rede, incluindo o webhook completo e anexos.
- 211 testes de interface em navegador, com backend fictício.
- Tipos, lint, hooks, 43 funções de servidor e build aprovados.

Os testes não enviaram mensagens para clientes reais nem lançaram pagamentos em produção. Antes das migrações foi criado backup privado do banco e dos arquivos substituídos no servidor. As alterações de dados existentes se limitam à pausa das conversas já marcadas para atendimento humano e à desativação da confirmação automática antiga.

## Dependências para atendimento real

O provedor tinha uma conexão fechada e outra instância ausente. Os números precisam ser pareados pelo QR Code em **Configurações → WhatsApp**. Isso depende do celular com a conta do WhatsApp.

Não foram encontradas chaves de IA ou transcrição no servidor. Menus, consulta, PIX, portal, filas e atendimento humano funcionam sem essas chaves quando o WhatsApp está conectado. Arquivos que exigem análise são encaminhados à equipe. Para ativar IA e transcrição, configure as credenciais dos provedores no ambiente privado do servidor.
