import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, AlertTriangle, TrendingUp, CheckCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBR, parseLocalDate } from "@/lib/dateUtils";

export type ClientNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
  contract_id?: string | null;
  installment_id?: string | null;
};

interface Props {
  /** Token de sessão do portal (emitido por portal_client_login). */
  token?: string | null;
}

const timeAgo = (iso: string) => {
  const date = parseLocalDate(iso);
  if (!date) return "data indisponível";
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d`;
  return formatBR(iso);
};

export const NotificationsBell = ({ token }: Props) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ClientNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data } = await supabase.rpc("portal_notifications_by_token", {
        _token: token,
        _limit: 30,
      });
      const rows = Array.isArray(data) ? data as unknown as Array<Partial<ClientNotification>> : [];
      setItems(rows.map((row: Partial<ClientNotification>, index) => ({
        id: String(row.id || `portal-notification-${index}`),
        type: String(row.type || "update"),
        title: String(row.title || "Notificação"),
        message: String(row.message || ""),
        metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : null,
        is_read: Boolean(row.is_read),
        created_at: String(row.created_at || new Date().toISOString()),
        contract_id: row.contract_id || null,
        installment_id: row.installment_id || null,
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);

  }, [token]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const unread = useMemo(() => items.filter((i) => !i.is_read).length, [items]);

  const markAllRead = async () => {
    if (unread === 0 || !token) return;
    await supabase.rpc("portal_mark_notifications_read_by_token", { _token: token, _ids: undefined });
    setItems((prev) => prev.map((i) => ({ ...i, is_read: true })));
  };

  const openDropdown = async () => {
    setOpen((v) => !v);
    if (!open) await load();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={openDropdown}
        className="portal-chip relative hover:brightness-125"
        aria-label="Notificações"
      >
        <Bell size={12} /> Notificações
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-black/40">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220] shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="text-sm font-bold text-white">Notificações</p>
              <p className="text-[11px] text-white/50">
                {unread > 0 ? `${unread} não lida(s)` : "Tudo em dia"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="rounded-lg px-2 py-1 text-[11px] text-white/70 hover:bg-white/5 hover:text-white"
                  title="Marcar todas como lidas"
                >
                  <CheckCheck size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-white/60 hover:bg-white/5 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="p-8 text-center text-sm text-white/50">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-white/50">
                <Bell size={28} className="text-white/30" />
                Nenhuma notificação
              </div>
            ) : (
              items.map((n) => {
                const isOverdue = n.type === "installment_overdue";
                const Icon = isOverdue ? AlertTriangle : TrendingUp;
                const meta = (n.metadata || {}) as Record<string, unknown>;
                return (
                  <div
                    key={n.id}
                    className={`flex gap-3 border-b border-white/5 px-4 py-3 transition-colors hover:bg-white/[0.03] ${
                      n.is_read ? "opacity-60" : ""
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isOverdue
                          ? "bg-red-500/15 text-red-400"
                          : "bg-amber-500/15 text-amber-400"
                      }`}
                    >
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{n.title}</p>
                        {!n.is_read && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-white/70">{n.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-white/40">
                        <span>{timeAgo(n.created_at)}</span>
                        {typeof meta.days_overdue === "number" && (
                          <span className="rounded-full bg-white/5 px-2 py-0.5">
                            {meta.days_overdue} dia(s) atraso
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
