import type {ManualCashDraft} from '@/lib/manualCashOperations';
const names={capital_injection:'Aporte',capital_withdrawal:'Retirada de capital',expense_create:'Novo gasto',expense_update:'Alteração de gasto',expense_delete:'Exclusão de gasto',capital_delete:'Remoção de capital'};
export function PendingManualCash({pending,busy,storageError,onRetry,onCancel}:{pending:ManualCashDraft|null;busy:boolean;storageError:boolean;onRetry:()=>void;onCancel:()=>void}){
 if(!pending&&!storageError)return null;
 return <section aria-label="Tentativa financeira pendente" className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm space-y-2">
  <p className="font-semibold">{pending?'Há um lançamento aguardando confirmação':'Armazenamento indisponível'}</p>
  {pending?<>
   <p>{names[pending.input.operation]}{pending.input.description?`: ${pending.input.description}`:''}{pending.input.amount!==null?` — ${pending.input.amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`:''}</p>
   <p>Verifique esta tentativa antes de registrar outra. A verificação pode concluir o envio caso ele ainda não tenha chegado ao servidor.</p>
   <button type="button" onClick={onRetry} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 font-semibold disabled:opacity-50">{busy?'Verificando...':'Verificar e concluir'}</button>
   <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 rounded-lg border border-border px-4 ml-2 disabled:opacity-50">Encerrar tentativa</button>
   <p className="text-xs text-muted-foreground">Encerrar bloqueia o envio antigo se ele não foi aplicado. Se já foi salvo, será confirmado. Isso não estorna um lançamento existente.</p>
  </>:<p>Não foi possível guardar a tentativa com segurança. Permita o armazenamento do navegador antes de registrar lançamentos.</p>}
 </section>;
}
