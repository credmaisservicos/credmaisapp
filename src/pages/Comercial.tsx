import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Car, Check, ChevronRight, CircleDollarSign, Package, Plus, RotateCcw, ShieldCheck, Smartphone, Store, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatBR, todayLocalISO } from '@/lib/dateUtils';
import { fetchAll } from '@/lib/fetchAll';
import { assetLabels, billingLabels, emptyCollateral, money, rentalPeriods, splitReceivables, statusLabels, type AssetKind, type CollateralInput } from '@/lib/commercial';
import { commercialRpc, useCommercial } from '@/hooks/useCommercial';
import { CollateralFields, Field, SelectField } from '@/components/commercial/CommercialFields';
import '@/components/commercial/commercial.css';
import '@/components/commercial/commercial-overrides.css';
import '@/components/commercial/quick-actions.css';
import '@/components/commercial/sale-overrides.css';

type Tab = 'inventory' | 'sales' | 'rentals';
const today = todayLocalISO;
const safeNumber = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
const safeDateLabel = (value: unknown) => formatBR(String(value ?? '')) || 'Data indisponível';
const initialAsset = { kind: 'phone' as AssetKind, label: '', identifier: '', cost: '', price: '', condition: 'Novo', notes: '' };

export default function Comercial() {
  const { user } = useAuth(); const { toast } = useToast(); const qc = useQueryClient();
  const location = useLocation();
  const isOverview = location.pathname === '/comercial' || location.pathname === '/comercial/';
  const tab: Tab = location.pathname.includes('/vendas') ? 'sales' : location.pathname.includes('/locacoes') ? 'rentals' : 'inventory';
  const [showAsset, setShowAsset] = useState(false); const [showOperation, setShowOperation] = useState<'sale'|'rental'|null>(null);
  const [asset, setAsset] = useState(initialAsset); const [saving, setSaving] = useState(false);
  const { data, isLoading, error, refresh } = useCommercial();
  const { data: clients = [] } = useQuery({ queryKey: ['commercial-clients', user?.id], enabled: !!user, queryFn: () => fetchAll((f,t) => supabase.from('clients').select('id,name,cpf_cnpj').eq('user_id', user!.id).order('name').range(f,t)) });
  const availablePhones = data.assets.filter(a => a.kind === 'phone' && a.status === 'available');
  const availableVehicles = data.assets.filter(a => (a.kind === 'car' || a.kind === 'motorcycle') && a.status === 'available');
  const activeRentals = data.operations.filter(o => o.kind === 'rental' && o.status === 'active');
  const openReceivables = data.receivables.filter(r => r.status === 'pending');
  const totalOpen = openReceivables.reduce((sum,r) => sum + safeNumber(r.amount) - safeNumber(r.paid_amount), 0);
  const tabs = [{ path:'/comercial/estoque', id:'inventory' as Tab, label:'Estoque', icon:Package }, { path:'/comercial/vendas', id:'sales' as Tab, label:'Vendas de celulares', icon:Smartphone }, { path:'/comercial/locacoes', id:'rentals' as Tab, label:'Locações', icon:Car }];
  const reload = async () => { await refresh(); await qc.invalidateQueries({ queryKey:['commercial-clients'] }); };
  const saveAsset = async (e: React.FormEvent) => { e.preventDefault(); if (saving) return; setSaving(true); try { await commercialRpc('save_business_asset', { _data:{ ...asset, cost:Number(asset.cost)||0, price:Number(asset.price)||0 }, _id:null }); toast({ title:'Bem cadastrado', description:'Ele já está disponível para uma nova operação.' }); setShowAsset(false); setAsset(initialAsset); await reload(); } catch (err) { toast({ title:'Não foi possível salvar', description:(err as Error).message, variant:'destructive' }); } finally { setSaving(false); } };
  if (isOverview) return <><CommercialHub data={data} isLoading={isLoading} error={error} /><QuickActions /></>;
  return <section className="commercial-page">
    <section className="commercial-hero"><div><span className="commercial-eyebrow">Operações comerciais</span><h1>{isOverview ? 'Seu comercial, organizado por módulo.' : tab==='inventory' ? 'Estoque de bens e celulares.' : tab==='sales' ? 'Vendas de celulares.' : 'Locações de carros e motos.'}</h1><p>{isOverview ? 'Escolha uma frente de trabalho e acompanhe cada operação com clareza.' : tab==='inventory' ? 'Cadastre IMEI, placas, custos e preços em um inventário sempre atualizado.' : tab==='sales' ? 'Registre vendas à vista ou parceladas, vinculadas ao celular e ao cliente.' : 'Controle diárias, cauções, quilometragem e devoluções sem perder nenhum detalhe.'}</p></div><div className="commercial-actions">{isOverview ? <><Link className="commercial-primary" to="/comercial/estoque"><Package size={16}/> Abrir estoque</Link><Link className="commercial-secondary" to="/comercial/vendas"><Smartphone size={16}/> Nova venda</Link></> : tab==='inventory' ? <button className="commercial-primary" onClick={()=>setShowAsset(true)}><Plus size={16}/> Novo bem</button> : <button className="commercial-primary" onClick={()=>setShowOperation(tab==='sales'?'sale':'rental')}><Plus size={16}/> Nova operação</button>}</div></section>
    <nav className="commercial-subnav" aria-label="Módulos comerciais"><Link className={isOverview?'is-active':''} to="/comercial">Visão geral</Link>{tabs.map(({path,label,icon:Icon,id})=><Link key={id} className={!isOverview&&tab===id?'is-active':''} to={path}><Icon size={15}/> {label}</Link>)}</nav>
    <section className="commercial-kpis"><article><span>Bens disponíveis</span><strong>{data.assets.filter(a=>a.status==='available').length}</strong></article><article><span>Locações ativas</span><strong>{activeRentals.length}</strong></article><article><span>A receber</span><strong>{money(totalOpen)}</strong></article></section>
    {isOverview && <section className="commercial-module-grid"><Link className="commercial-module-card" to="/comercial/estoque"><span className="commercial-module-icon"><Package size={22}/></span><div><h2>Estoque</h2><p>Celulares, carros e motos cadastrados, com custo, preço e disponibilidade.</p></div><ChevronRight size={18}/></Link><Link className="commercial-module-card" to="/comercial/vendas"><span className="commercial-module-icon"><Smartphone size={22}/></span><div><h2>Vendas de celulares</h2><p>Venda à vista ou parcelada com parcelas e recebimentos automáticos.</p></div><ChevronRight size={18}/></Link><Link className="commercial-module-card" to="/comercial/locacoes"><span className="commercial-module-icon"><Car size={22}/></span><div><h2>Locações de veículos</h2><p>Aluguel de carros e motos com período, caução e devolução.</p></div><ChevronRight size={18}/></Link></section>}
    {!isOverview && <nav className="commercial-tabs" aria-label="Operações"><>{tabs.map(({id,label,icon:Icon,path})=><Link key={id} aria-current={tab===id?'page':undefined} className={tab===id?'is-active':''} to={path}><Icon size={15}/> {label}</Link>)}</></nav>}
    {isLoading ? <div className="commercial-empty"><h2>Carregando operações…</h2></div> : error ? <div className="commercial-empty"><h2>Não foi possível carregar as operações</h2><p className="commercial-muted">Aplique a migração comercial antes de usar este módulo.</p></div> : <>
      {!isOverview && tab==='inventory' && <Inventory assets={data.assets} onNew={()=>setShowAsset(true)} />}
      {tab==='sales' && <Operations kind="sale" assets={data.assets} operations={data.operations} receivables={data.receivables} onNew={()=>setShowOperation('sale')} />}
      {tab==='rentals' && <Operations kind="rental" assets={data.assets} operations={data.operations} receivables={data.receivables} onNew={()=>setShowOperation('rental')} />}
    </>}
    {showAsset && <div className="commercial-overlay" role="dialog" aria-modal="true"><div className="commercial-modal commercial-dialog"><div className="commercial-toolbar"><div><span className="commercial-eyebrow">Estoque</span><h2>Novo bem comercial</h2></div><button type="button" className="commercial-secondary" onClick={()=>setShowAsset(false)} aria-label="Fechar"><X size={17}/></button></div><form onSubmit={saveAsset}><div className="commercial-form-grid"><SelectField label="Tipo" value={asset.kind} onChange={v=>setAsset({...asset,kind:v as AssetKind})} required><option value="phone">Celular</option><option value="car">Carro</option><option value="motorcycle">Moto</option></SelectField><Field label="Nome / modelo" required minLength={2} value={asset.label} onChange={e=>setAsset({...asset,label:e.target.value})}/><Field label={asset.kind==='phone'?'IMEI (15 dígitos)':'Placa'} required value={asset.identifier} onChange={e=>setAsset({...asset,identifier:e.target.value})}/><Field label="Custo de aquisição (R$)" type="number" min="0" step="0.01" value={asset.cost} onChange={e=>setAsset({...asset,cost:e.target.value})}/><Field label={asset.kind==='phone'?'Preço de venda (R$)':'Valor de referência (R$)'} type="number" min="0" step="0.01" value={asset.price} onChange={e=>setAsset({...asset,price:e.target.value})}/><Field label="Condição" value={asset.condition} onChange={e=>setAsset({...asset,condition:e.target.value})}/></div><div className="commercial-actions"><button type="button" className="commercial-secondary" onClick={()=>setShowAsset(false)}>Cancelar</button><button className="commercial-primary" disabled={saving}>{saving?'Salvando…':'Salvar bem'}</button></div></form></div></div>}
    {showOperation && <OperationDialog kind={showOperation} assets={showOperation==='sale'?availablePhones:availableVehicles} clients={clients} onClose={()=>setShowOperation(null)} onSaved={reload}/>} 
  </section>;
}

function CommercialHub({ data, isLoading, error }: { data: any; isLoading: boolean; error: unknown }) {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const operations = Array.isArray(data?.operations) ? data.operations : [];
  const receivables = Array.isArray(data?.receivables) ? data.receivables : [];
  const available = assets.filter((asset: any) => asset.status === "available").length;
  const activeRentals = operations.filter((operation: any) => operation.kind === "rental" && operation.status === "active").length;
  const openAmount = receivables
    .filter((receivable: any) => receivable.status === "pending")
    .reduce((sum: number, receivable: any) => sum + Math.max(0, safeNumber(receivable.amount) - safeNumber(receivable.paid_amount)), 0);

  return (
    <section className="commercial-page commercial-hub">
      <section className="commercial-hero">
        <div>
          <span className="commercial-eyebrow">Central comercial</span>
          <h1>Seu comercial, organizado por módulo.</h1>
          <p>Escolha uma frente para controlar estoque, vendas, locações e recebimentos.</p>
        </div>
      </section>
      <nav className="commercial-subnav" aria-label="Módulos comerciais">
        <Link className="is-active" to="/comercial">Visão geral</Link>
        <Link to="/comercial/estoque"><Package size={15} /> Estoque</Link>
        <Link to="/comercial/vendas"><Smartphone size={15} /> Vendas</Link>
        <Link to="/comercial/locacoes"><Car size={15} /> Locações</Link>
      </nav>
      {isLoading ? (
        <div className="commercial-empty"><h2>Carregando central comercial…</h2></div>
      ) : error ? (
        <div className="commercial-empty"><h2>Não foi possível carregar a central</h2><p className="commercial-muted">Aplique a migração comercial antes de usar este módulo.</p></div>
      ) : (
        <>
          <section className="commercial-kpis commercial-kpis-4" aria-label="Resumo comercial">
            <article><span>Bens disponíveis</span><strong>{available}</strong><small>{assets.length} cadastrados</small></article>
            <article><span>Locações ativas</span><strong>{activeRentals}</strong><small>Carros e motos em circulação</small></article>
            <article><span>A receber</span><strong>{money(openAmount)}</strong><small>Parcelas pendentes</small></article>
            <article><span>Operações</span><strong>{operations.length}</strong><small>Vendas e locações</small></article>
          </section>
          <section className="commercial-hub-grid" aria-label="Acessar módulos comerciais">
            <Link className="commercial-hub-card commercial-hub-card-stock" to="/comercial/estoque">
              <div className="commercial-hub-card-head"><span className="commercial-module-icon"><Package size={23} /></span><ChevronRight size={18} /></div>
              <h2>Estoque</h2><p>Cadastre bens, IMEI, placas, custos e preços.</p><strong>{available} disponíveis</strong>
            </Link>
            <Link className="commercial-hub-card commercial-hub-card-sales" to="/comercial/vendas">
              <div className="commercial-hub-card-head"><span className="commercial-module-icon"><Smartphone size={23} /></span><ChevronRight size={18} /></div>
              <h2>Vendas de celulares</h2><p>Registre vendas à vista ou parceladas.</p><strong>{operations.filter((operation: any) => operation.kind === "sale").length} vendas</strong>
            </Link>
            <Link className="commercial-hub-card commercial-hub-card-rentals" to="/comercial/locacoes">
              <div className="commercial-hub-card-head"><span className="commercial-module-icon"><Car size={23} /></span><ChevronRight size={18} /></div>
              <h2>Locações de veículos</h2><p>Controle períodos, cauções e devoluções.</p><strong>{activeRentals} em andamento</strong>
            </Link>
          </section>
        </>
      )}
    </section>
  );
}

export function Inventory({assets,onNew}:{assets:any[];onNew:()=>void}) { return <section><div className="commercial-toolbar"><div><h2>Inventário</h2><p className="commercial-muted">IMEI, placas e situação atual de cada bem.</p></div><button className="commercial-primary" onClick={onNew}><Plus size={16}/> Cadastrar bem</button></div>{assets.length===0?<Empty text="Nenhum bem no estoque ainda."/>:<div className="commercial-grid">{assets.map(a=><article className="commercial-card" key={a.id}><div className="commercial-icon">{a.kind==='phone'?<Smartphone size={21}/>:<Car size={21}/>}</div><div className="commercial-toolbar"><h2>{a.label}</h2><span className="commercial-badge" data-status={a.status}>{statusLabels[a.status]||a.status}</span></div><p className="commercial-muted">{assetLabels[a.kind as AssetKind]} · {a.identifier}</p><div className="commercial-summary">Venda: <strong>{money(a.price)}</strong><br/>Custo: {money(a.cost)} · {a.condition}</div></article>)}</div>}</section> }
export function Operations({kind,assets,operations,receivables,onNew}:{kind:'sale'|'rental';assets:any[];operations:any[];receivables:any[];onNew:()=>void}) { const rows=operations.filter(o=>o.kind===kind); return <section><div className="commercial-toolbar"><div><h2>{kind==='sale'?'Vendas de celulares':'Locações de veículos'}</h2><p className="commercial-muted">{kind==='sale'?'Venda à vista ou parcelada, vinculada ao IMEI.':'Diária, semanal ou mensal, com caução e devolução.'}</p></div><button type="button" className="commercial-primary" onClick={onNew}><Plus size={16}/> Nova operação</button></div>{rows.length===0?<Empty text={kind==='sale'?'Nenhuma venda registrada.':'Nenhuma locação registrada.'}/>:<div className="commercial-grid">{rows.map(o=>{const asset=assets.find(a=>a.id===o.asset_id);const pending=receivables.filter(r=>r.operation_id===o.id&&r.status==='pending');const due=pending.reduce((s,r)=>s+safeNumber(r.amount)-safeNumber(r.paid_amount),0);return <article className="commercial-card" key={o.id}><div className="commercial-toolbar"><span className="commercial-badge" data-status={o.status}>{statusLabels[o.status]||o.status}</span><span className="commercial-muted">{safeDateLabel(o.start_date)}</span></div><h2>{asset?.label||'Bem da operação'}</h2><p className="commercial-muted">{asset?.identifier} · {kind==='rental'?`${billingLabels[o.billing]} · ${money(o.rate)}`:`Total ${money(o.total)}`}</p><div className="commercial-summary">{kind==='rental'?`Período até ${o.end_date?safeDateLabel(o.end_date):'—'}`:`Saldo em aberto: ${money(due)}`}<br/>{o.deposit>0&&`Caução: ${money(o.deposit)} · ${o.deposit_returned>0?'devolvida':'retida'}`}</div><OperationActions operation={o} receivable={pending[0]} due={due}/><footer><span className="commercial-muted">Cliente {o.client_id.slice(0,8)}…</span><ChevronRight size={16}/></footer></article>})}</div>}</section> }
function OperationActions({operation,receivable,due}:{operation:any;receivable?:any;due:number}) { const {toast}=useToast();const [busy,setBusy]=useState(false);const mutate=async(action:'pay'|'return'|'cancel')=>{if(busy)return;setBusy(true);try{if(action==='pay'){if(!receivable)throw new Error('Não há parcela pendente');await commercialRpc('receive_business_payment',{_receivable_id:receivable.id,_amount:Number(receivable.amount)-Number(receivable.paid_amount),_method:'pix',_request_id:crypto.randomUUID()});toast({title:'Parcela baixada'});}else{if(action==='return'&&!window.confirm('Confirmar devolução do veículo e devolução integral da caução?'))return;await commercialRpc('close_business_operation',{_operation_id:operation.id,_action:action,_data:action==='return'?{odometer:Number(window.prompt('Quilometragem final')||0),method:'pix'}:{method:'pix'},_request_id:crypto.randomUUID()});toast({title:action==='return'?'Locação encerrada':'Operação cancelada'});}window.location.reload();}catch(err){toast({title:'Ação não concluída',description:(err as Error).message,variant:'destructive'});}finally{setBusy(false)}};return <div className="commercial-actions">{receivable&&<button className="commercial-secondary" disabled={busy} onClick={()=>mutate('pay')}><CircleDollarSign size={14}/> Baixar {money(due)}</button>}{operation.kind==='rental'&&operation.status==='active'&&<button className="commercial-secondary" disabled={busy} onClick={()=>mutate('return')}><RotateCcw size={14}/> Devolver</button>}{operation.status==='active'&&<button className="commercial-secondary" disabled={busy} onClick={()=>mutate('cancel')}><X size={14}/> Cancelar</button>}</div> }
export function CollateralList({items,onNew,onSaved}:{items:any[];onNew:()=>void;onSaved:()=>Promise<void>}) { return <section><div className="commercial-toolbar"><div><h2>Garantias sob guarda</h2><p className="commercial-muted">Registre, fotografe e devolva bens com histórico auditável.</p></div><button type="button" className="commercial-primary" onClick={onNew}><Plus size={16}/> Nova garantia</button></div>{items.length===0?<Empty text="Nenhuma garantia registrada."/>:<div className="commercial-grid">{items.map(i=><article className="commercial-card" key={i.id}><div className="commercial-icon"><ShieldCheck size={21}/></div><div className="commercial-toolbar"><h2>{i.description}</h2><span className="commercial-badge" data-status={i.status}>{statusLabels[i.status]}</span></div><p className="commercial-muted">{i.category} · {i.identifier||'Sem identificação'}</p><div className="commercial-summary">Valor estimado: <strong>{money(i.estimated_value)}</strong><br/>{i.storage_location||'Local de guarda não informado'}</div><footer><span className="commercial-muted">Recebido em {safeDateLabel(i.received_at)}</span>{i.status==='held'?<button type="button" className="commercial-secondary" onClick={async()=>{const note=window.prompt('Informe quem recebeu e a observação da devolução:');if(!note)return;try{await commercialRpc('return_loan_collateral',{_id:i.id,_note:note});await onSaved();}catch(err){alert((err as Error).message)}}}><Check size={14}/> Registrar devolução</button>:<span className="commercial-muted">Devolvido em {i.returned_at?safeDateLabel(i.returned_at):'—'}</span>}</footer></article>)}</div>}</section> }
function Empty({text}:{text:string}) { return <div className="commercial-empty"><Store className="mx-auto mb-3 text-primary"/><h2>{text}</h2><p className="commercial-muted">Use o botão acima para começar.</p></div> }

function OperationDialog({kind,assets,clients,onClose,onSaved}:{kind:'sale'|'rental';assets:any[];clients:any[];onClose:()=>void;onSaved:()=>Promise<void>}) { const {toast}=useToast();const [form,setForm]=useState<any>({client_id:'',asset_id:'',total:'',down_payment:'0',installments:'1',first_due:today(),start_date:today(),end_date:'',billing:'monthly',rate:'',deposit:'0',method:'pix',odometer:'0',fuel:'',notes:''});const [saving,setSaving]=useState(false);const periods=kind==='rental'&&form.end_date?rentalPeriods(form.start_date,form.end_date,form.billing):Number(form.installments)||1;const preview=kind==='rental'&&form.rate?Number(form.rate)*periods:(Number(form.total)||0);const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!form.client_id||!form.asset_id)return;setSaving(true);try {if(kind==='sale')splitReceivables(Number(form.total),Number(form.down_payment),Number(form.installments),form.first_due,'monthly');else if(periods<1)throw new Error('Informe um período válido');await commercialRpc('create_business_operation',{_data:{...form,total:kind==='sale'?Number(form.total):preview,down_payment:kind==='sale'?Number(form.down_payment):0,installments:kind==='sale'?Number(form.installments):periods,rate:kind==='rental'?Number(form.rate):0,deposit:kind==='rental'?Number(form.deposit):0,details:kind==='rental'?{odometer:Number(form.odometer)||0,fuel:form.fuel,notes:form.notes}:{},notes:form.notes},_request_id:crypto.randomUUID()});toast({title:kind==='sale'?'Venda registrada':'Locação criada'});await onSaved();onClose();}catch(err){toast({title:'Não foi possível criar operação',description:(err as Error).message,variant:'destructive'});}finally{setSaving(false)}};return <div className="commercial-overlay" role="dialog" aria-modal="true"><div className="commercial-modal commercial-dialog"><div className="commercial-toolbar"><h2>{kind==='sale'?'Nova venda de celular':'Nova locação de veículo'}</h2><button type="button" className="commercial-secondary" onClick={onClose} aria-label="Fechar"><X size={17}/></button></div><form onSubmit={submit}><div className="commercial-form-grid"><SelectField label="Cliente" value={form.client_id} onChange={v=>setForm({...form,client_id:v})} required><option value="">Selecione</option>{clients.map((c:any)=><option key={c.id} value={c.id}>{c.name||c.full_name||c.cpf_cnpj}</option>)}</SelectField><SelectField label={kind==='sale'?'Celular / IMEI':'Veículo / placa'} value={form.asset_id} onChange={v=>setForm({...form,asset_id:v})} required><option value="">Selecione</option>{assets.map(a=><option key={a.id} value={a.id}>{a.label} · {a.identifier}</option>)}</SelectField>{kind==='sale'?<><Field label="Total da venda (R$)" required type="number" min="0.01" step="0.01" value={form.total} onChange={e=>setForm({...form,total:e.target.value})}/><Field label="Entrada (R$)" type="number" min="0" step="0.01" value={form.down_payment} onChange={e=>setForm({...form,down_payment:e.target.value})}/><Field label="Parcelas" type="number" min="1" max="366" value={form.installments} onChange={e=>setForm({...form,installments:e.target.value})}/><Field label="Primeiro vencimento" type="date" value={form.first_due} onChange={e=>setForm({...form,first_due:e.target.value})}/></>:<><Field label="Início" type="date" required value={form.start_date} onChange={e=>setForm({...form,start_date:e.target.value})}/><Field label="Devolução prevista" type="date" required value={form.end_date} onChange={e=>setForm({...form,end_date:e.target.value})}/><SelectField label="Cobrança" value={form.billing} onChange={v=>setForm({...form,billing:v})}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option></SelectField><Field label="Valor por período (R$)" required type="number" min="0.01" step="0.01" value={form.rate} onChange={e=>setForm({...form,rate:e.target.value})}/><Field label="Caução (R$)" type="number" min="0" step="0.01" value={form.deposit} onChange={e=>setForm({...form,deposit:e.target.value})}/><Field label="Quilometragem na saída" type="number" min="0" step="1" value={form.odometer} onChange={e=>setForm({...form,odometer:e.target.value})}/><Field label="Combustível / observações" value={form.fuel} onChange={e=>setForm({...form,fuel:e.target.value})}/></>}</div><div className="commercial-summary"><strong>Total calculado: {money(preview)}</strong><br/>{kind==='rental'?`${periods} ${billingLabels[form.billing as keyof typeof billingLabels]||'períodos'} cobrados. A caução será devolvida no encerramento.`:'A entrada é registrada na hora e o saldo é dividido em centavos exatos.'}</div><div className="commercial-actions"><button type="button" className="commercial-secondary" onClick={onClose}>Cancelar</button><button className="commercial-primary" disabled={saving||assets.length===0}>{saving?'Registrando…':'Confirmar operação'}</button></div></form></div></div> }

export function CollateralDialog({clients,onClose,onSaved}:{clients:any[];onClose:()=>void;onSaved:()=>Promise<void>}) { const {toast}=useToast();const [clientId,setClientId]=useState('');const [contractId,setContractId]=useState('');const [value,setValue]=useState<CollateralInput>(emptyCollateral());const [contracts,setContracts]=useState<any[]>([]);const [saving,setSaving]=useState(false);const load=async(id:string)=>{setClientId(id);if(!id){setContracts([]);return;}const {data}=await supabase.from('contracts').select('id,capital,created_at').eq('client_id',id).eq('user_id',(await supabase.auth.getUser()).data.user?.id).order('created_at',{ascending:false});setContracts(data||[])};const submit=async(e:React.FormEvent)=>{e.preventDefault();setSaving(true);try{if(!contractId)throw new Error('Selecione o contrato');await commercialRpc('save_loan_collateral',{_contract_id:contractId,_data:value,_request_id:crypto.randomUUID()});toast({title:'Garantia registrada',description:'O bem ficou vinculado ao contrato e entrou sob guarda.'});await onSaved();onClose();}catch(err){toast({title:'Não foi possível registrar',description:(err as Error).message,variant:'destructive'});}finally{setSaving(false)}};return <div className="commercial-overlay" role="dialog" aria-modal="true"><div className="commercial-modal commercial-dialog"><div className="commercial-toolbar"><h2>Registrar garantia voluntária</h2><button type="button" className="commercial-secondary" onClick={onClose} aria-label="Fechar"><X size={17}/></button></div><form onSubmit={submit}><SelectField label="Cliente" value={clientId} onChange={load} required><option value="">Selecione</option>{clients.map((c:any)=><option key={c.id} value={c.id}>{c.name||c.full_name||c.cpf_cnpj}</option>)}</SelectField><SelectField label="Contrato" value={contractId} onChange={setContractId} required><option value="">Selecione um contrato</option>{contracts.map(c=><option key={c.id} value={c.id}>{money(c.capital)} · {new Date(c.created_at).toLocaleDateString('pt-BR')}</option>)}</SelectField><CollateralFields value={value} onChange={setValue}/><p className="commercial-muted">A garantia é apenas voluntária e fica sob guarda até a devolução registrada. Ela não será vendida ou apropriada automaticamente.</p><div className="commercial-actions"><button type="button" className="commercial-secondary" onClick={onClose}>Cancelar</button><button className="commercial-primary" disabled={saving}>{saving?'Salvando…':'Registrar garantia'}</button></div></form></div></div> }
function QuickActions() { return <section className="commercial-quick-actions commercial-page"><div><span className="commercial-eyebrow">Ações rápidas</span><h2>Comece uma operação</h2></div><div className="commercial-quick-action-list"><Link className="commercial-quick-action" to="/comercial/estoque?novo=1"><Package size={17}/><span><strong>Adicionar bem</strong><small>Cadastrar celular, carro ou moto</small></span><ChevronRight size={16}/></Link><Link className="commercial-quick-action" to="/comercial/vendas?novo=1"><Smartphone size={17}/><span><strong>Nova venda</strong><small>Vender um celular do estoque</small></span><ChevronRight size={16}/></Link><Link className="commercial-quick-action" to="/comercial/locacoes?novo=1"><Car size={17}/><span><strong>Nova locação</strong><small>Alugar carro ou moto</small></span><ChevronRight size={16}/></Link></div></section> }
function OperationDialogV2({ kind, assets, clients, onClose, onSaved }: { kind: 'sale' | 'rental'; assets: any[]; clients: any[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [paymentMode, setPaymentMode] = useState<'cash' | 'installments'>('installments');
  const [form, setForm] = useState<any>({ client_id: '', asset_id: '', total: '', down_payment: '0', installments: '1', first_due: today(), start_date: today(), end_date: '', billing: 'monthly', rate: '', deposit: '0', method: 'pix', odometer: '0', fuel: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const periods = kind === 'rental' && form.end_date ? rentalPeriods(form.start_date, form.end_date, form.billing) : Number(form.installments) || 1;
  const saleTotal = Number(form.total) || 0;
  const saleEntry = paymentMode === 'cash' ? saleTotal : Number(form.down_payment) || 0;
  const saleInstallments = paymentMode === 'cash' ? 1 : Number(form.installments) || 1;
  const preview = kind === 'rental' && form.rate ? Number(form.rate) * periods : saleTotal;
  const balance = Math.max(0, saleTotal - saleEntry);
  const set = (key: string, value: string) => setForm((current: any) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.client_id || !form.asset_id) return;
    setSaving(true);
    try {
      if (kind === 'sale') splitReceivables(saleTotal, saleEntry, saleInstallments, paymentMode === 'cash' ? today() : form.first_due, 'monthly');
      else if (periods < 1) throw new Error('Informe um período válido');
      await commercialRpc('create_business_operation', {
        _data: {
          ...form,
          total: kind === 'sale' ? saleTotal : preview,
          down_payment: kind === 'sale' ? saleEntry : 0,
          installments: kind === 'sale' ? saleInstallments : periods,
          first_due: paymentMode === 'cash' ? today() : form.first_due,
          rate: kind === 'rental' ? Number(form.rate) : 0,
          deposit: kind === 'rental' ? Number(form.deposit) || 0 : 0,
          details: kind === 'rental' ? { odometer: Number(form.odometer) || 0, fuel: form.fuel, notes: form.notes } : { payment_mode: paymentMode },
          notes: form.notes,
        },
        _request_id: crypto.randomUUID(),
      });
      toast({ title: kind === 'sale' ? 'Venda registrada' : 'Locação criada' });
      await onSaved();
      onClose();
    } catch (error) {
      toast({ title: 'Não foi possível criar operação', description: (error as Error).message, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return <div className="commercial-overlay" role="dialog" aria-modal="true"><div className="commercial-modal commercial-dialog">
    <div className="commercial-toolbar"><div><span className="commercial-eyebrow">{kind === 'sale' ? 'Venda de celular' : 'Locação de veículo'}</span><h2>{kind === 'sale' ? 'Registrar venda' : 'Nova locação'}</h2></div><button type="button" className="commercial-secondary" onClick={onClose} aria-label="Fechar"><X size={17} /></button></div>
    <form onSubmit={submit}><div className="commercial-form-grid">
      <SelectField label="Cliente" value={form.client_id} onChange={value => set('client_id', value)} required><option value="">Selecione</option>{clients.map((client: any) => <option key={client.id} value={client.id}>{client.name || client.full_name || client.cpf_cnpj}</option>)}</SelectField>
      <SelectField label={kind === 'sale' ? 'Celular / IMEI' : 'Veículo / placa'} value={form.asset_id} onChange={value => set('asset_id', value)} required><option value="">Selecione</option>{assets.map(asset => <option key={asset.id} value={asset.id}>{asset.label} · {asset.identifier}</option>)}</SelectField>
      {kind === 'sale' ? <>
        <div className="commercial-choice commercial-choice-wide"><span>Forma de pagamento</span><div><button type="button" className={paymentMode === 'cash' ? 'is-active' : ''} onClick={() => setPaymentMode('cash')}><CircleDollarSign size={14} /> À vista</button><button type="button" className={paymentMode === 'installments' ? 'is-active' : ''} onClick={() => setPaymentMode('installments')}><Package size={14} /> Parcelado</button></div></div>
        <Field label="Total da venda (R$)" required type="number" min="0.01" step="0.01" value={form.total} onChange={event => set('total', event.target.value)} />
        {paymentMode === 'installments' && <><Field label="Entrada opcional (R$)" type="number" min="0" step="0.01" value={form.down_payment} onChange={event => set('down_payment', event.target.value)} /><Field label="Parcelas" type="number" min="1" max="366" value={form.installments} onChange={event => set('installments', event.target.value)} /><Field label="Primeiro vencimento" type="date" value={form.first_due} onChange={event => set('first_due', event.target.value)} /></>}
        <SelectField label="Recebimento" value={form.method} onChange={value => set('method', value)} required><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option></SelectField>
      </> : <>
        <Field label="Início" type="date" required value={form.start_date} onChange={event => set('start_date', event.target.value)} /><Field label="Devolução prevista" type="date" required value={form.end_date} onChange={event => set('end_date', event.target.value)} />
        <SelectField label="Cobrança" value={form.billing} onChange={value => set('billing', value)}><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option></SelectField><Field label="Valor por período (R$)" required type="number" min="0.01" step="0.01" value={form.rate} onChange={event => set('rate', event.target.value)} />
        <Field label="Caução opcional (R$)" type="number" min="0" step="0.01" value={form.deposit} onChange={event => set('deposit', event.target.value)} /><Field label="Quilometragem na saída" type="number" min="0" step="1" value={form.odometer} onChange={event => set('odometer', event.target.value)} /><Field label="Combustível / observações" value={form.fuel} onChange={event => set('fuel', event.target.value)} />
        <SelectField label="Recebimento da caução" value={form.method} onChange={value => set('method', value)} required><option value="pix">PIX</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="transfer">Transferência</option></SelectField>
      </>}
    </div><div className="commercial-summary"><strong>Total calculado: {money(preview)}</strong><br />{kind === 'rental' ? `${periods} ${billingLabels[form.billing as keyof typeof billingLabels] || 'períodos'} cobrados. A caução opcional fica registrada até a devolução.` : paymentMode === 'cash' ? 'Pagamento à vista: o valor será recebido e a venda ficará concluída.' : `Saldo de ${money(balance)} dividido em ${saleInstallments} parcela${saleInstallments === 1 ? '' : 's'}.`}</div>
    <div className="commercial-actions"><button type="button" className="commercial-secondary" onClick={onClose}>Cancelar</button><button className="commercial-primary" disabled={saving || assets.length === 0}>{saving ? 'Registrando…' : 'Confirmar operação'}</button></div></form>
  </div></div>;
}

export { OperationDialogV2 as OperationDialog };
