import { X, Search } from "lucide-react";
import { INPUT } from "../constants";

type Props = {
  addrData: any;
  setAddrData: (v: any) => void;
  onClose: () => void;
  onSave: () => void;
  onBuscarCep: () => void;
};

const FIELDS = [
  { k: "street", l: "Rua" },
  { k: "number", l: "Número" },
  { k: "neighborhood", l: "Bairro" },
  { k: "city", l: "Cidade" },
  { k: "state", l: "Estado" },
];

export default function EditAddressModal({ addrData, setAddrData, onClose, onSave, onBuscarCep }: Props) {
  return (
    <div className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center bg-background/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto overscroll-contain" onClick={onClose}>
      <div className="w-full max-w-lg sm:max-h-[85vh] sm:overflow-y-auto my-auto rounded-2xl border border-border bg-card p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Editar Endereço</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">CEP</label>
            <input type="text" name="address_cep" aria-label="CEP" placeholder="00000-000" value={addrData.cep || ""} onChange={e => setAddrData({ ...addrData, cep: e.target.value })} className={INPUT} />
          </div>
          <button type="button" onClick={onBuscarCep} aria-label="Buscar CEP" className="self-end px-3 py-2.5 rounded-lg bg-accent border border-border text-foreground hover:bg-accent/70 transition-colors"><Search size={16} /></button>
        </div>
        {FIELDS.map(f => (
          <div key={f.k}>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{f.l}</label>
              <input type="text" name={`address_${f.k}`} aria-label={f.l} value={addrData[f.k] || ""} onChange={e => setAddrData({ ...addrData, [f.k]: e.target.value })} className={INPUT} />
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground">Cancelar</button>
          <button type="submit" onClick={onSave} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground" style={{ background: "var(--gradient-button)" }}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
