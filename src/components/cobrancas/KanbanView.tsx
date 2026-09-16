import { useMemo } from "react";
import { MessageSquare, Check, AlertTriangle, Clock, CheckCircle, CalendarDays } from "lucide-react";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { isEmAtraso, isEmAberto } from "@/lib/dashboardMetrics";

interface Props {
  installments: any[];
  onWhatsApp: (i: any) => void;
  onMarkPaid: (id: string) => void;
  onClickInstallment?: (i: any) => void;
}

const fmt = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const KanbanView = ({ installments, onWhatsApp, onMarkPaid, onClickInstallment }: Props) => {
  const columns = useMemo(() => {
    const now = Date.now();
    const dueTs = (i: any) => parseLocalDate(i.due_date)?.getTime() ?? null;
    // A coluna de atraso vinha de `status === "overdue"` e as outras duas
    // exigiam `status === "pending"`. Uma parcela vencida que o check-overdue
    // ainda não marcou não caía em nenhuma das três: sumia do quadro.
    const agora = new Date(now);
    const abertas = installments.filter((i) => isEmAberto(i as any));
    const overdue = abertas.filter((i) => isEmAtraso(i as any, agora));
    const dueSoon = abertas.filter((i) => {
      if (isEmAtraso(i as any, agora)) return false;
      const due = dueTs(i);
      return due !== null && (due - now) / 86400000 <= 7;
    });
    const future = abertas.filter((i) => {
      if (isEmAtraso(i as any, agora)) return false;
      const due = dueTs(i);
      return due !== null && (due - now) / 86400000 > 7;
    });
    const paid = installments.filter((i) => i.status === "paid").slice(0, 30);
    return [
      { key: "overdue", label: "Atrasadas", icon: AlertTriangle, items: overdue, headerBg: "bg-destructive/5", iconBg: "bg-destructive/10", iconColor: "text-destructive", countColor: "text-destructive" },
      { key: "due", label: "Vence em 7 dias", icon: Clock, items: dueSoon, headerBg: "bg-warning/5", iconBg: "bg-warning/10", iconColor: "text-warning", countColor: "text-warning" },
      { key: "future", label: "Futuras", icon: CalendarDays, items: future, headerBg: "bg-primary/5", iconBg: "bg-primary/10", iconColor: "text-primary", countColor: "text-primary" },
      { key: "paid", label: "Pagas (recentes)", icon: CheckCircle, items: paid, headerBg: "bg-success/5", iconBg: "bg-success/10", iconColor: "text-success", countColor: "text-success" },
    ];
  }, [installments]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 animate-fade-in">
      {columns.map((col) => {
        const total = col.items.reduce((acc, i) => {
          const amount = Number(i.amount);
          return acc + (Number.isFinite(amount) ? amount : 0);
        }, 0);
        const Icon = col.icon;
        return (
          <div key={col.key} className="bg-card border border-border rounded-2xl flex flex-col max-h-[70vh]">
            <div className={`p-3 border-b border-border ${col.headerBg} rounded-t-2xl`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg ${col.iconBg} flex items-center justify-center`}>
                    <Icon size={13} className={col.iconColor} />
                  </div>
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{col.label}</span>
                </div>
                <span className={`text-xs font-bold ${col.countColor}`}>{col.items.length}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">R$ {fmt(total)}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {col.items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma parcela</p>
              ) : (
                col.items.map((i) => (
                  <div key={i.id} className="p-3 rounded-xl bg-muted/20 border border-border/50 hover:border-primary/30 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <p
                        className="text-xs font-semibold text-foreground truncate cursor-pointer hover:text-primary"
                        onClick={() => onClickInstallment?.(i)}
                      >
                        {i.client_name}
                      </p>
                      <span className="text-[9px] text-muted-foreground shrink-0">#{i.installment_number}</span>
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-foreground">R$ {fmt(Number(i.amount))}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatBR(i.due_date)}
                      </span>
                    </div>
                    {col.key !== "paid" && (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onWhatsApp(i)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-success/10 text-success text-[10px] font-medium hover:bg-success/20 active:scale-95 focus-ring"
                        >
                          <MessageSquare size={11} /> WhatsApp
                        </button>
                        <button
                          type="button"
                          onClick={() => onMarkPaid(i.id)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-primary/10 text-primary text-[10px] font-medium hover:bg-primary/20 active:scale-95 focus-ring"
                        >
                          <Check size={11} /> Pago
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default KanbanView;
