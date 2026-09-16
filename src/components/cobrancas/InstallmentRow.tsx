import { memo } from "react";
import {
  CheckSquare, Square, CalendarDays, MessageSquare, Copy, Mail, Check, Clock, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { computeLateFeeBreakdown } from "@/lib/lateFee";

const fmt = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const relTime = (iso: string) => {
  const d = new Date(iso).getTime();
  if (!Number.isFinite(d)) return "agora";
  const diff = Math.max(0, Date.now() - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

export interface InstallmentRowProps {
  inst: any;
  isSel: boolean;
  hasPixKey: boolean;
  lastAttempt: { channel?: string; created_at?: string } | null;
  onRowClick: (clientId: string) => void;
  onToggleSelect: (id: string) => void;
  onWhatsApp: (inst: any) => void;
  onCopyPix: (inst: any) => void;
  onEmail: (inst: any) => void;
  onMarkPaid: (id: string) => void;
  onShowHistory: (id: string, clientName: string) => void;
}

const InstallmentRowInner = ({
  inst, isSel, hasPixKey, lastAttempt,
  onRowClick, onToggleSelect, onWhatsApp, onCopyPix, onEmail, onMarkPaid, onShowHistory,
}: InstallmentRowProps) => {
  const isOverdue = inst.status === "overdue";
  const isPaid = inst.status === "paid";
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dueDate = parseLocalDate(inst.due_date);
  const daysDiff = dueDate
    ? Math.floor((now.getTime() - new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime()) / 86400000)
    : 0;
  const daysText = !dueDate ? "" : isOverdue ? `${daysDiff}d atrasada` : !isPaid ? (daysDiff < 0 ? `em ${Math.abs(daysDiff)}d` : daysDiff === 0 ? "vence hoje" : "") : "";
  const fee = computeLateFeeBreakdown(inst);
  const showFee = !isPaid && fee.total > 0;

  const persistedAt = inst.last_collected_at;
  const persistedCh = inst.last_collected_channel;
  const rawCount = Number(inst.collection_count);
  const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
  const channel = lastAttempt?.channel || persistedCh;
  const at = lastAttempt?.created_at || persistedAt;
  const showCollected = !isPaid && (lastAttempt || persistedAt);
  const icon = channel === "whatsapp" ? "💬" : channel === "email" ? "✉️" : channel === "pix_copy" ? "🔑" : channel === "sms" ? "📱" : "✍️";

  const tone = isOverdue ? "danger" : isPaid ? "ok" : (daysDiff === 0 ? "warn" : "neutral");
  const rowBg =
    isSel ? "border-primary/40 bg-primary/[0.06] ring-1 ring-primary/20" :
    tone === "danger" ? "border-destructive/25 bg-gradient-to-r from-destructive/[0.06] via-card to-card" :
    tone === "warn" ? "border-amber-500/30 bg-gradient-to-r from-amber-500/[0.06] via-card to-card" :
    isPaid ? "border-success/15 bg-success/[0.03] opacity-90" :
    "border-border/70 bg-card/50 hover:bg-card";
  const badgeStyle =
    tone === "danger" ? "bg-destructive/12 text-destructive ring-destructive/25" :
    tone === "warn" ? "bg-amber-500/12 text-amber-500 ring-amber-500/25" :
    isPaid ? "bg-success/12 text-success ring-success/25" :
    "bg-muted/60 text-muted-foreground ring-border";
  const statusChip =
    tone === "danger" ? { cls: "bg-destructive/12 text-destructive border-destructive/25", Icon: AlertTriangle, label: "Atrasada" } :
    tone === "warn" ? { cls: "bg-amber-500/12 text-amber-500 border-amber-500/25", Icon: Clock, label: "Vence hoje" } :
    isPaid ? { cls: "bg-success/12 text-success border-success/25", Icon: CheckCircle2, label: "Paga" } :
    { cls: "bg-muted/50 text-muted-foreground border-border", Icon: Clock, label: "Pendente" };
  const StatusIcon = statusChip.Icon;

  return (
    <div
      className={`collection-installment-row group/row relative rounded-xl border p-3 flex items-center gap-3 transition-all cursor-pointer ${rowBg}`}
      onClick={() => onRowClick(inst.client_id)}
    >
      {!isPaid && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(inst.id); }}
          className="shrink-0 p-1 rounded hover:bg-accent transition-colors focus-ring"
          title="Selecionar" aria-label="Selecionar parcela"
        >
          {isSel ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} className="text-muted-foreground" />}
        </button>
      )}

      {/* Installment number */}
      <div className={`shrink-0 w-11 h-11 rounded-xl ring-1 ${badgeStyle} flex flex-col items-center justify-center leading-none`}>
        <span className="text-[8px] font-semibold uppercase tracking-wider opacity-70">Parc</span>
        <span className="text-base font-black tabular-nums">{inst.installment_number}</span>
      </div>

      {/* Main info */}
      <div className="collection-installment-info flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${statusChip.cls}`}>
            <StatusIcon size={10} /> {statusChip.label}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarDays size={11} /> <span className="tabular-nums text-foreground font-medium">{formatBR(inst.due_date)}</span>
          </span>
          {daysText && (
            <span className={`text-[11px] font-semibold ${tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-500" : "text-muted-foreground"}`}>
              · {daysText}
            </span>
          )}
          {isPaid && inst.paid_at && (
            <span className="text-[11px] text-success font-medium">· Pago {formatBR(inst.paid_at)}</span>
          )}
          {showCollected && at && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onShowHistory(inst.id, inst.client_name); }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-warning/15 text-warning hover:bg-warning/25 text-[10px] font-medium border border-warning/25"
              title={`Cobrado via ${channel}${count > 0 ? ` • ${count}x` : ""} — clique para ver histórico`}
            >
              {icon} há {relTime(at)}{count > 1 ? ` · ${count}x` : ""}
            </button>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
          <span className="text-[15px] font-bold text-foreground tabular-nums">R$ {fmt(Number(inst.amount))}</span>
          {showFee && (
            <>
              <span className="text-[11px] text-destructive font-semibold tabular-nums" title={`Juros de atraso ${fee.jurosPct}% ao dia (composto)${fee.daysLate ? ` · ${fee.daysLate}d` : ""}`}>
                + R$ {fmt(fee.total)} juros atraso
              </span>
              <span className="text-[13px] font-black text-destructive tabular-nums">= R$ {fmt(fee.withFees)}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="collection-installment-actions flex items-center gap-1.5 shrink-0">
        {!isPaid && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onWhatsApp(inst); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-gradient-to-br from-success to-success/85 text-success-foreground text-xs font-semibold hover:shadow-md hover:shadow-success/30 transition-all active:scale-95 focus-ring"
              title="Cobrar via WhatsApp" aria-label="Cobrar via WhatsApp"
            >
              <MessageSquare size={13} /> <span className="collection-action-label hidden sm:inline">WhatsApp</span>
            </button>
            {hasPixKey && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCopyPix(inst); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-primary/10 text-primary border border-primary/25 text-xs font-semibold hover:bg-primary/20 transition-all active:scale-95 focus-ring"
                title="Copiar chave PIX" aria-label="Copiar chave PIX"
              >
                <Copy size={13} /> <span className="collection-action-label hidden md:inline">PIX</span>
              </button>
            )}
            {inst.client_email && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEmail(inst); }}
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-primary/10 text-primary border border-primary/25 text-xs font-semibold hover:bg-primary/20 transition-all active:scale-95 focus-ring"
                title="Cobrar via E-mail" aria-label="Cobrar via E-mail"
              >
                <Mail size={13} />
              </button>
            )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMarkPaid(inst.id); }}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-success/12 text-success border border-success/25 text-xs font-semibold hover:bg-success/20 transition-all active:scale-95 focus-ring"
              title="Marcar como paga" aria-label="Marcar como paga"
            >
              <Check size={13} /> <span className="collection-action-label hidden sm:inline">Paga</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const InstallmentRow = memo(InstallmentRowInner);
export default InstallmentRow;
