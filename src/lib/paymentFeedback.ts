export function paymentReviewDescription(data:unknown):string|undefined{
 return data&&typeof data==='object'&&'allocation_pending_review'in data&&data.allocation_pending_review===true
  ? 'O recebimento foi registrado. A divisão entre capital, juros e encargos precisa de conferência humana na Carteira.'
  : undefined;
}
