/** Changes to credit conditions always belong to a human, before menus or AI. */
export function requestsHumanNegotiation(text: string): boolean {
  const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/desconto (?:em|na) folha/g, 'consignado');
  return /\b(?:renegoci\w*|negoci\w*|acordo|reparcel\w*|refinanci\w*|descont\w*|abat\w*|prorrog\w*|adiar|postergar)\b/.test(normalized)
    || /(?:tirar|perdoar|reduzir|diminuir|remover|zerar)\s+(?:o |os |a |as )?(?:juros|multa|valor|taxa)/.test(normalized)
    || /(?:mudar|alterar|trocar|aumentar|estender)\s+(?:o |a |as )?(?:data|vencimento|prazo|parcelas)/.test(normalized)
    || /(?:mais|maior)\s+prazo|(?:parcelar|dividir)\s+(?:a |o |essa |esse )?(?:divida|debito|saldo|conta|valor)|parcelar de novo/.test(normalized)
    || /(?:parcelar|dividir)\s+(?:em\s+)?\d/.test(normalized)
    || /pagamento parcial|pagar uma parte|pagar metade|(?:consigo|posso) pagar\s+(?:r\$\s*)?\d/.test(normalized)
    || /(?:faz|fazer|fecha|fechar|deixa|deixar)\s+por\s+\d|(?:pago|pagar)\s+(?:so|apenas|somente)|consigo pagar (?:so|apenas|somente)|nao (?:consigo|posso|tenho como) pagar/.test(normalized)
    || /(?:pagar|pago)\s+(?:so |apenas |somente )?(?:o |os )?juros|(?:renovar|renovacao|rolar|rolagem)\s+(?:o |os |de )?(?:juros|emprestimo|contrato)/.test(normalized);
}

export const HUMAN_NEGOTIATION_REPLY = 'A negociação é feita somente por uma pessoa da equipe. Encaminhei seu pedido para atendimento humano, que continuará por aqui.';
