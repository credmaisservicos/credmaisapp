import { X } from "lucide-react";
import { INPUT } from "../constants";

type Props = {
  editData: any;
  setEditData: (v: any) => void;
  onClose: () => void;
  onSave: () => void;
};

const FIELDS = [
  { k: "name", l: "Nome", t: "text" },
  { k: "phone", l: "Telefone", t: "tel" },
  { k: "whatsapp", l: "WhatsApp", t: "tel" },
  { k: "email", l: "E-mail", t: "email" },
  { k: "cpf_cnpj", l: "CPF/CNPJ", t: "text" },
  // Sem este campo, o cliente não consegue entrar no portal: o login pede
  // A data permanece útil para cadastro e automação de aniversário; o portal usa apenas CPF.
  { k: "birth_date", l: "Data de nascimento", t: "date" },
];

export default function EditClienteModal({ editData, setEditData, onClose, onSave }: Props) {
  return (
    <div className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center bg-background/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto overscroll-contain" onClick={onClose}>
      <div className="w-full max-w-lg sm:max-h-[85vh] sm:overflow-y-auto my-auto rounded-2xl border border-border bg-card p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Editar Cliente</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
        </div>
        {FIELDS.map(f => (
          <div key={f.k}>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{f.l}</label>
            <input type={f.t} name={`client_${f.k}`} aria-label={f.l} value={editData[f.k] || ""} onChange={e => setEditData({ ...editData, [f.k]: e.target.value })} className={INPUT} />
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors">Cancelar</button>
          <button type="submit" onClick={onSave} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground" style={{ background: "var(--gradient-button)" }}>Salvar</button>
        </div>
      </div>
    </div>
  );
}
