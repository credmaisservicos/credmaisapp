import { useState } from 'react';
import { X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { commercialRpc } from '@/hooks/useCommercial';
import { assetLabels, type AssetKind } from '@/lib/commercial';
import { Field, SelectField } from './CommercialFields';

const initialAsset = { kind: 'phone' as AssetKind, label: '', identifier: '', cost: '', price: '', condition: 'Novo', notes: '' };
type AssetForm = typeof initialAsset;

export default function AssetDialog({ onClose, onSaved, initial }: { onClose: () => void; onSaved: () => Promise<unknown>; initial?: Partial<AssetForm> & { id?: string; status?: string } }) {
  const { toast } = useToast();
  const [asset, setAsset] = useState<AssetForm>({ ...initialAsset, ...initial, cost: initial?.cost == null ? '' : String(initial.cost), price: initial?.price == null ? '' : String(initial.price) });
  const [saving, setSaving] = useState(false);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return; setSaving(true);
    try { await commercialRpc('save_business_asset', { _data: { ...asset, cost: Number(asset.cost) || 0, price: Number(asset.price) || 0, status: initial?.status || 'available' }, _id: initial?.id || null }); toast({ title: initial?.id ? 'Bem atualizado' : 'Bem cadastrado', description: `${assetLabels[asset.kind]} disponível no estoque.` }); await onSaved(); onClose(); }
    catch (error) { toast({ title: 'Não foi possível salvar', description: (error as Error).message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  return <div className="commercial-overlay" role="dialog" aria-modal="true"><div className="commercial-modal commercial-dialog"><div className="commercial-toolbar"><div><span className="commercial-eyebrow">Estoque</span><h2>{initial?.id ? 'Editar bem comercial' : 'Novo bem comercial'}</h2></div><button type="button" className="commercial-secondary" onClick={onClose} aria-label="Fechar"><X size={17}/></button></div><form onSubmit={save}><div className="commercial-form-grid"><SelectField label="Tipo de bem" value={asset.kind} onChange={value => setAsset({ ...asset, kind: value as AssetKind })} required><option value="phone">Celular</option><option value="car">Carro</option><option value="motorcycle">Moto</option></SelectField><Field label="Nome / modelo" required minLength={2} value={asset.label} onChange={event => setAsset({ ...asset, label: event.target.value })}/><Field label={asset.kind === 'phone' ? 'IMEI (15 dígitos)' : 'Placa'} required inputMode={asset.kind === 'phone' ? 'numeric' : 'text'} maxLength={asset.kind === 'phone' ? 15 : 7} pattern={asset.kind === 'phone' ? '[0-9]{15}' : '[A-Za-z]{3}[0-9][A-Za-z0-9][0-9]{2}'} placeholder={asset.kind === 'phone' ? 'Digite os 15 números' : 'ABC1D23'} value={asset.identifier} onChange={event => setAsset({ ...asset, kind: asset.kind, identifier: asset.kind === 'phone' ? event.target.value.replace(/\D/g, '').slice(0, 15) : event.target.value.toUpperCase() })}/><Field label="Custo de aquisição (R$)" type="number" min="0" step="0.01" value={asset.cost} onChange={event => setAsset({ ...asset, cost: event.target.value })}/><Field label={asset.kind === 'phone' ? 'Preço de venda (R$)' : 'Valor de referência (R$)'} type="number" min="0" step="0.01" value={asset.price} onChange={event => setAsset({ ...asset, price: event.target.value })}/><Field label="Condição" value={asset.condition} onChange={event => setAsset({ ...asset, condition: event.target.value })}/><Field label="Observações" value={asset.notes} onChange={event => setAsset({ ...asset, notes: event.target.value })}/></div><div className="commercial-actions"><button type="button" className="commercial-secondary" onClick={onClose}>Cancelar</button><button className="commercial-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar bem'}</button></div></form></div></div>;
}
