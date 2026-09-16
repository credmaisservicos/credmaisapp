export type AssetKind = 'phone' | 'car' | 'motorcycle';
export type Billing = 'daily' | 'weekly' | 'monthly';
export type BusinessAsset = { id: string; kind: AssetKind; label: string; identifier: string; cost: number; price: number; condition: string; notes: string; status: string; photos: string[]; details: Record<string, string>; };
export type BusinessOperation = { id: string; client_id: string; asset_id: string; kind: 'sale' | 'rental'; status: string; total: number; down_payment: number; deposit: number; deposit_returned: number; start_date: string; end_date?: string; billing: Billing; rate: number; notes: string; details: Record<string, any>; returned_at?: string; created_at: string; };
export type BusinessReceivable = { id: string; operation_id: string; number: number; amount: number; paid_amount: number; due_date: string; status: string; };
export type BusinessPayment = { id: string; operation_id: string; kind: string; amount: number; method: string; created_at: string; };
export type Collateral = { id: string; contract_id: string; client_id: string; description: string; category: string; identifier: string; estimated_value: number; condition: string; storage_location: string; photos: string[]; notes: string; status: string; received_at: string; returned_at?: string; return_note?: string; };
export type CollateralInput = Pick<Collateral, 'description' | 'category' | 'identifier' | 'estimated_value' | 'condition' | 'storage_location' | 'photos' | 'notes'>;
export const emptyCollateral = (): CollateralInput => ({ description: '', category: 'Celular', identifier: '', estimated_value: 0, condition: '', storage_location: '', photos: [], notes: '' });
export const money = (value: number | string | null | undefined) => {
  const number = Number(value ?? 0);
  return (Number.isFinite(number) ? number : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};
export const billingLabels: Record<Billing,string> = { daily:'Diária', weekly:'Semanal', monthly:'Mensal' };
export const assetLabels: Record<AssetKind,string> = { phone:'Celular', car:'Carro', motorcycle:'Moto' };
export const statusLabels: Record<string,string> = { available:'Disponível', sold:'Vendido', rented:'Alugado', maintenance:'Manutenção', archived:'Arquivado', active:'Em andamento', completed:'Concluído', cancelled:'Cancelado', pending:'Em aberto', paid:'Pago', held:'Sob guarda', returned:'Devolvido' };
export function addBillingPeriod(date: string, billing: Billing, periods: number) {
  const parsed = new Date(`${date.slice(0,10)}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error('Data inválida');
  if (billing === 'monthly') {
    const day=parsed.getUTCDate();parsed.setUTCDate(1);parsed.setUTCMonth(parsed.getUTCMonth()+periods);
    const last=new Date(Date.UTC(parsed.getUTCFullYear(),parsed.getUTCMonth()+1,0)).getUTCDate();parsed.setUTCDate(Math.min(day,last));
  } else parsed.setUTCDate(parsed.getUTCDate()+periods*(billing==='weekly'?7:1));
  return parsed.toISOString().slice(0,10);
}
export function rentalPeriods(start: string,end: string,billing: Billing) {
  if (!start || !end || end<=start) return 0;
  let count=0;while(addBillingPeriod(start,billing,count)<end && count<=366)count++;
  if(count>366)throw new Error('Máximo de 366 cobranças por operação');return count;
}
export function splitReceivables(total: number,entry: number,count: number,firstDue: string,billing: Billing) {
  const cents=Math.round((total-entry)*100);
  if(!Number.isFinite(total)||!Number.isFinite(entry)||total<=0||entry<0||entry>total||!Number.isInteger(count)||count<1||count>366)throw new Error('Confira os valores e a quantidade de parcelas');
  if(!cents)return [];
  if(cents<count)throw new Error('Valor insuficiente para dividir em parcelas');
  return Array.from({length:count},(_,i)=>({number:i+1,amount:(Math.floor(cents/count)+(i<cents%count?1:0))/100,due_date:addBillingPeriod(firstDue,billing,i)}));
}
