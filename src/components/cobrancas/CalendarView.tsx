import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageSquare, Check } from "lucide-react";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";
import { isEmAtraso, isEmAberto } from "@/lib/dashboardMetrics";

interface Props {
  installments: any[];
  onWhatsApp: (i: any) => void;
  onMarkPaid: (id: string) => void;
  onClickInstallment?: (i: any) => void;
}

const fmt = (v: number) => safeNumber(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

const safeNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const CalendarView = ({ installments, onWhatsApp, onMarkPaid, onClickInstallment }: Props) => {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { days, byDay } = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startWeekday = first.getDay();
    const totalDays = last.getDate();
    const grid: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) grid.push(null);
    for (let d = 1; d <= totalDays; d++) grid.push(new Date(year, month, d));
    while (grid.length % 7 !== 0) grid.push(null);

    const map = new Map<string, any[]>();
    installments.forEach((i: any) => {
      const dt = parseLocalDate(i.due_date);
      if (!dt) return;
      const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
      const list = map.get(key) || [];
      list.push(i);
      map.set(key, list);
    });
    return { days: grid, byDay: map };
  }, [cursor, installments]);

  const monthName = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  const selectedItems = selectedDay ? byDay.get(selectedDay) || [] : [];
  const selectedTotal = selectedItems.reduce((acc, i) => acc + safeNumber(i.amount), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between bg-card border border-border rounded-2xl p-4">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="p-2 rounded-lg hover:bg-accent focus-ring"
          aria-label="Mês anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <h3 className="text-headline text-lg capitalize">{monthName}</h3>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="p-2 rounded-lg hover:bg-accent focus-ring"
          aria-label="Próximo mês"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="collection-calendar bg-card border border-border rounded-2xl p-3">
        <div className="collection-calendar-weekdays grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
            <div key={d} className="py-1"><span className="sm:hidden">{d.slice(0, 1)}</span><span className="hidden sm:inline">{d}</span></div>
          ))}
        </div>
        <div className="collection-calendar-grid grid grid-cols-7 gap-1">
          {days.map((d, idx) => {
            if (!d) return <div key={idx} className="collection-calendar-day h-20 rounded-lg bg-muted/10" />;
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            const items = byDay.get(key) || [];
            // Vencidas e em aberto pela regra do painel: contar por status
            // específico deixava parcela fora dos dois números do dia.
            const overdueCount = items.filter((i) => isEmAtraso(i as any, today)).length;
            const pendingCount = items.filter((i) => isEmAberto(i as any) && !isEmAtraso(i as any, today)).length;
            const paidCount = items.filter((i) => i.status === "paid").length;
            const total = items.reduce((acc, i) => acc + safeNumber(i.amount), 0);
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;

            return (
              <button
                type="button"
                key={idx}
                onClick={() => setSelectedDay(items.length > 0 ? key : null)}
                aria-label={`${d.toLocaleDateString("pt-BR")}: ${items.length} parcela${items.length === 1 ? "" : "s"}`}
                aria-pressed={isSelected}
                className={`collection-calendar-day h-20 min-w-0 overflow-hidden rounded-lg border p-1.5 text-left transition-all focus-ring ${
                  isSelected
                    ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                    : isToday
                    ? "border-primary/40 bg-primary/5"
                    : items.length > 0
                    ? "border-border bg-card hover:bg-accent/40"
                    : "border-transparent bg-muted/5"
                }`}
              >
                <div className={`text-xs font-bold mb-1 ${isToday ? "text-primary" : "text-foreground"}`}>
                  {d.getDate()}
                </div>
                {items.length > 0 && (
                  <div className="collection-calendar-counts space-y-0.5">
                    {overdueCount > 0 && (
                      <div className="text-[9px] px-1 rounded bg-destructive/15 text-destructive font-semibold">
                        {overdueCount} atras.
                      </div>
                    )}
                    {pendingCount > 0 && (
                      <div className="text-[9px] px-1 rounded bg-warning/15 text-warning font-semibold">
                        {pendingCount} pend.
                      </div>
                    )}
                    {paidCount > 0 && (
                      <div className="text-[9px] px-1 rounded bg-success/15 text-success font-semibold">
                        {paidCount} pagas
                      </div>
                    )}
                    <div className="collection-calendar-total text-[9px] text-muted-foreground truncate">R$ {fmt(total)}</div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDay && selectedItems.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
            <h4 className="text-sm font-semibold text-foreground">
              Parcelas — {formatBR(selectedItems[0].due_date)}
            </h4>
            <span className="text-xs text-muted-foreground">Total: <strong className="text-foreground">R$ {fmt(selectedTotal)}</strong></span>
          </div>
          <div className="space-y-2">
            {selectedItems.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/50">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate cursor-pointer hover:text-primary" onClick={() => onClickInstallment?.(i)}>
                    {i.client_name} <span className="text-muted-foreground text-xs">#{i.installment_number}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">R$ {fmt(i.amount)} · {i.status === "overdue" ? "Atrasada" : i.status === "paid" ? "Paga" : "Pendente"}</p>
                </div>
                {i.status !== "paid" && (
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => onWhatsApp(i)} className="p-2 rounded-lg bg-success text-success-foreground hover:opacity-90 active:scale-95 focus-ring" title="WhatsApp" aria-label={`Enviar WhatsApp para ${i.client_name || "cliente"}`}>
                      <MessageSquare size={14} />
                    </button>
                    <button type="button" onClick={() => onMarkPaid(i.id)} className="p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-95 focus-ring" title="Marcar como paga" aria-label="Marcar parcela como paga">
                      <Check size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarView;
