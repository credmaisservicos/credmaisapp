import { X, Search } from "lucide-react";
import { ModalPortal } from "@/components/ui/modal-portal";
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
    <ModalPortal>
      <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto overscroll-contain bg-background/80 p-3 backdrop-blur-sm" onClick={onClose}>
        <div className="my-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-6 space-y-4" role="dialog" aria-modal="true" aria-labelledby="edit-address-title" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 id="edit-address-title" className="text-lg font-bold text-foreground">Editar Endereço</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="address-cep" className="text-xs font-medium text-muted-foreground mb-1 block">CEP</label>
              <input id="address-cep" type="text" name="address_cep" aria-label="CEP" placeholder="00000-000" value={addrData.cep || ""} onChange={e => setAddrData({ ...addrData, cep: e.target.value })} className={INPUT} />
            </div>
            <button type="button" onClick={onBuscarCep} aria-label="Buscar CEP" className="self-end px-3 py-2.5 rounded-lg bg-accent border border-border text-foreground hover:bg-accent/70 transition-colors"><Search size={16} /></button>
          </div>
          {FIELDS.map(f => (
            <div key={f.k}>
              <label htmlFor={`address-${f.k}`} className="text-xs font-medium text-muted-foreground mb-1 block">{f.l}</label>
              <input id={`address-${f.k}`} type="text" name={`address_${f.k}`} value={addrData[f.k] || ""} onChange={e => setAddrData({ ...addrData, [f.k]: e.target.value })} className={INPUT} />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground">Cancelar</button>
            <button type="button" onClick={onSave} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground" style={{ background: "var(--gradient-button)" }}>Salvar</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
