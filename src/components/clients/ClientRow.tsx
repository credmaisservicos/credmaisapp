import {UploadImage} from '@/components/UploadMedia';
import { memo } from "react";
import { Eye, Trash2, FileText } from "lucide-react";
import RiskBadge from "./RiskBadge";

const scoreColor = (s: number) =>
  s >= 75 ? "text-success bg-success/10 ring-success/20"
  : s >= 50 ? "text-warning bg-warning/10 ring-warning/20"
  : "text-destructive bg-destructive/10 ring-destructive/20";

const PALETTES = [
  "bg-violet-500/10 text-violet-300 ring-violet-400/20",
  "bg-sky-500/10 text-sky-300 ring-sky-400/20",
  "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
  "bg-amber-500/10 text-amber-300 ring-amber-400/20",
  "bg-rose-500/10 text-rose-300 ring-rose-400/20",
  "bg-indigo-500/10 text-indigo-300 ring-indigo-400/20",
];

export type ClientSummary = { contracts: number; active: number; overdue: number };

type Props = {
  client: any;
  summary: ClientSummary;
  isSel: boolean;
  striped: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
};

function ClientRowImpl({ client: c, summary, isSel, striped, onToggle, onOpen, onDelete }: Props) {
  const rawScore = Number(c.credit_score);
  const sc = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  const initial = (c.name?.charAt(0) || "?").toUpperCase();
  const pal = PALETTES[(initial.charCodeAt(0) || 0) % PALETTES.length];
  return (
    <tr
      onClick={() => onOpen(c.id)}
      className={`group border-t border-border/30 hover:bg-primary/4 cursor-pointer transition-colors ${isSel ? "bg-primary/6" : striped ? "bg-muted/4" : ""}`}
    >
      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSel}
          onChange={() => onToggle(c.id)}
          aria-label={`Selecionar ${c.name || "cliente"}`}
          className="check-premium"
        />
      </td>
      <td className="w-[27%] px-5 py-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${pal} ring-1 text-[13px] font-bold`}>
            {c.avatar_url ? <UploadImage src={c.avatar_url} alt="" className="h-10 w-10 rounded-xl object-cover" /> : initial}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate text-[13.5px] leading-tight">{c.name}</p>
            {c.cpf_cnpj && <p className="whitespace-nowrap text-[11px] text-muted-foreground/70 font-mono mt-0.5">{c.cpf_cnpj}</p>}
          </div>
        </div>
      </td>
      <td className="w-[19%] px-5 py-3 text-muted-foreground">
        <div className="space-y-0.5">
          {(c.phone || c.whatsapp) && <p className="whitespace-nowrap text-[12.5px] text-foreground/85">{c.phone || c.whatsapp}</p>}
          {c.email && <p className="text-[11px] text-muted-foreground/70 truncate max-w-[200px]">{c.email}</p>}
          {!c.phone && !c.whatsapp && !c.email && <span className="text-xs text-muted-foreground/40">—</span>}
        </div>
      </td>
      <td className="w-[14%] whitespace-nowrap px-5 py-3">
        {summary.contracts === 0 ? (
          <span className="text-xs text-muted-foreground/50">—</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-[11px] font-bold text-primary ring-1 ring-primary/20">
              <FileText size={10} /> {summary.contracts}
            </span>
            {summary.overdue > 0 && (
              <span className="inline-flex items-center px-1.5 py-1 rounded-lg bg-destructive/15 text-destructive text-[10px] font-bold ring-1 ring-destructive/30" title="Parcelas em atraso">
                {summary.overdue} atras.
              </span>
            )}
          </div>
        )}
      </td>
      <td className="w-[16%] whitespace-nowrap px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1 min-w-[54px]">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md text-center ring-1 ${scoreColor(sc)}`}>{sc}</span>
            <div className="h-1 w-full rounded-full bg-muted/40 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${sc >= 80 ? "bg-emerald-400" : sc >= 50 ? "bg-amber-400" : "bg-rose-400"}`}
                style={{ width: `${Math.min(100, Math.max(4, sc))}%` }}
              />
            </div>
          </div>
          <RiskBadge score={c.credit_score} compact />
        </div>
      </td>
      <td className="w-[90px] whitespace-nowrap px-5 py-2.5">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${c.status === "Ativo" ? "text-emerald-300/90" : "text-muted-foreground"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${c.status === "Ativo" ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
          {c.status}
        </span>
      </td>
      <td className="w-[110px] whitespace-nowrap px-5 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(c.id); }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-primary/90 hover:bg-primary/10 text-[11px] font-medium transition-colors"
            aria-label={`Abrir ${c.name || "cliente"}`}
          >
            <Eye size={13} /> Ver
          </button>
          <button
            onClick={(e) => onDelete(c.id, e)}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label={`Excluir ${c.name || "cliente"}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export const ClientRow = memo(ClientRowImpl, (a, b) =>
  a.client === b.client &&
  a.summary.contracts === b.summary.contracts &&
  a.summary.overdue === b.summary.overdue &&
  a.summary.active === b.summary.active &&
  a.isSel === b.isSel &&
  a.striped === b.striped &&
  a.onToggle === b.onToggle &&
  a.onOpen === b.onOpen &&
  a.onDelete === b.onDelete
);
