import {UploadImage} from '@/components/UploadMedia';
import { memo } from "react";
import { Trash2, Phone, Mail, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ClientSummary } from "./ClientRow";

const scoreColor = (s: number) =>
  s >= 75 ? "text-success bg-success/10 ring-success/20"
  : s >= 50 ? "text-warning bg-warning/10 ring-warning/20"
  : "text-destructive bg-destructive/10 ring-destructive/20";

const scoreLabel = (s: number) => (s >= 75 ? "Bom" : s >= 50 ? "Médio" : "Risco");

type Props = {
  client: any;
  summary: ClientSummary;
  isSel: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
};

function ClientCardImpl({ client: c, summary, isSel, onToggle, onOpen, onDelete }: Props) {
  const parsedScore = Number(c.credit_score ?? 0);
  const sc = Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, parsedScore)) : 0;
  return (
    <div
      onClick={() => onOpen(c.id)}
      className={`group relative cursor-pointer rounded-2xl border bg-card/45 p-5 transition-colors ${isSel ? "border-primary/50 ring-1 ring-primary/30" : "border-border/20 hover:border-primary/30 hover:bg-card/65"}`}
    >
      <div className="absolute top-3 left-3 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSel}
          onChange={() => onToggle(c.id)}
          aria-label={`Selecionar ${c.name || "cliente"}`}
          className="check-premium"
        />
      </div>
      <button
        onClick={(e) => onDelete(c.id, e)}
        className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-destructive/10 text-destructive ring-1 ring-destructive/20 hover:bg-destructive/20 text-[10px] font-semibold transition-colors"
        aria-label={`Excluir ${c.name || "cliente"}`}
      >
        <Trash2 size={11} /> Excluir
      </button>

      {summary.overdue > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive text-[10px] font-bold ring-1 ring-destructive/30">
          {summary.overdue} em atraso
        </div>
      )}

      <div className="flex flex-col items-center text-center mb-3 mt-2">
        <div className="relative w-16 h-16 mb-2">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-xl font-bold text-primary">
            {c.avatar_url ? <UploadImage src={c.avatar_url} alt="" className="h-16 w-16 rounded-2xl object-cover" /> : c.name?.charAt(0)?.toUpperCase()}
          </div>
          <span className={`absolute -bottom-1 -right-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md ring-2 ring-card ${scoreColor(sc)}`}>{sc}</span>
        </div>
        <p className="font-semibold text-foreground text-sm truncate w-full">{c.name}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{scoreLabel(sc)}{c.cpf_cnpj ? ` • ${c.cpf_cnpj}` : ""}</p>
      </div>

      <div className="space-y-1.5 mb-3 min-h-[42px]">
        {(c.phone || c.whatsapp) && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Phone size={11} className="shrink-0" />
            <span className="truncate">{c.phone || c.whatsapp}</span>
          </div>
        )}
        {c.email && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail size={11} className="shrink-0" />
            <span className="truncate">{c.email}</span>
          </div>
        )}
        {!c.phone && !c.whatsapp && !c.email && (
          <p className="text-[11px] text-muted-foreground/50 italic">Sem contato</p>
        )}
      </div>

      <div className="flex items-center justify-between pt-2.5 border-t border-border/40">
        <Badge variant="outline" className={`text-[9px] ${c.status === "Ativo" ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground"}`}>
          {c.status}
        </Badge>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <FileText size={10} /> {summary.contracts} contrato{summary.contracts !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

export const ClientCard = memo(ClientCardImpl, (a, b) =>
  a.client === b.client &&
  a.summary.contracts === b.summary.contracts &&
  a.summary.overdue === b.summary.overdue &&
  a.summary.active === b.summary.active &&
  a.isSel === b.isSel &&
  a.onToggle === b.onToggle &&
  a.onOpen === b.onOpen &&
  a.onDelete === b.onDelete
);
