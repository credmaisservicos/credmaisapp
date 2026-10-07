import { X } from "lucide-react";
import { INPUT } from "../constants";
import { ModalPortal } from "@/components/ui/modal-portal";

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
    <ModalPortal>
      <div className="fixed inset-0 z-90 flex items-center justify-center overflow-y-auto overscroll-contain bg-background/80 p-3 backdrop-blur-xs" onClick={onClose}>
        <div className="my-auto max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-6 space-y-4" role="dialog" aria-modal="true" aria-labelledby="edit-client-title" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 id="edit-client-title" className="text-lg font-bold text-foreground">Editar Cliente</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X size={18} /></button>
          </div>
          {FIELDS.map(f => (
            <div key={f.k}>
              <label htmlFor={`edit-client-${f.k}`} className="text-xs font-medium text-muted-foreground mb-1 block">{f.l}</label>
              <input id={`edit-client-${f.k}`} type={f.t} name={`client_${f.k}`} value={editData[f.k] || ""} onChange={e => setEditData({ ...editData, [f.k]: e.target.value })} className={INPUT} />
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:bg-accent transition-colors">Cancelar</button>
            <button type="button" onClick={onSave} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-primary-foreground" style={{ background: "var(--gradient-button)" }}>Salvar</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
