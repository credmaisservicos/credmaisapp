import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, FileCheck2, FileSignature, Headphones, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";

type PendingItem = {
  label: string;
  description: string;
  count: number;
  path: string;
  icon: typeof AlertCircle;
  tone: string;
};

/** Reúne tarefas operacionais que antes ficavam escondidas em telas diferentes. */
const PendingCenter = ({ overdueCount }: { overdueCount: number }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["pending-center", user?.id],
    queryFn: async () => {
      const [signatures, handoffs, receipts, leads] = await Promise.all([
        supabase.from("contracts").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).eq("status", "active").eq("signature_status", "pending"),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).eq("needs_human", true),
        (supabase as any).from("whatsapp_receipt_reviews").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).eq("status", "pending"),
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).is("converted_client_id", null),
      ]);
      return {
        signatures: signatures.count || 0,
        handoffs: handoffs.count || 0,
        receipts: receipts.count || 0,
        leads: leads.count || 0,
      };
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const items: PendingItem[] = [
    { label: "Cobranças atrasadas", description: "Priorize os recebimentos", count: overdueCount, path: "/cobrancas?filter=overdue", icon: AlertCircle, tone: "text-destructive bg-destructive/10" },
    { label: "Assinaturas", description: "Contratos aguardando cliente", count: data?.signatures || 0, path: "/clientes", icon: FileSignature, tone: "text-warning bg-warning/10" },
    { label: "Comprovantes", description: "Pagamentos para conferir", count: data?.receipts || 0, path: "/agente-ia?tab=documentos", icon: FileCheck2, tone: "text-primary bg-primary/10" },
    { label: "Atendimento humano", description: "Conversas transferidas pelo bot", count: data?.handoffs || 0, path: "/comunicacao/inbox", icon: Headphones, tone: "text-info bg-info/10" },
    { label: "Solicitações novas", description: "Cadastros ainda não convertidos", count: data?.leads || 0, path: "/agente-ia?tab=documentos", icon: Inbox, tone: "text-success bg-success/10" },
  ];
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/40 bg-card/50 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 px-4 py-4 md:px-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">Central de pendências</h2>
            {!isLoading && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${total ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}>{total}</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Tudo que precisa da sua atenção, em um só lugar</p>
        </div>
        {total === 0 && <span className="text-xs font-semibold text-success">Tudo em dia</span>}
      </div>
      <div className="grid grid-cols-1 divide-y divide-border/20 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5">
        {items.map((item) => (
          <motion.button key={item.label} onClick={() => navigate(item.path)} whileHover={{ y: -2, backgroundColor: "rgba(255,255,255,.045)" }} transition={{ type: "spring", stiffness: 340, damping: 26 }} className="group flex items-center gap-3 p-4 text-left transition-colors lg:border-r lg:border-border/20 lg:last:border-r-0">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.tone}`}><item.icon size={16} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-xs font-semibold text-foreground"><strong className="text-base tabular-nums">{isLoading ? "—" : item.count}</strong> {item.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{item.description}</span>
            </span>
            <ArrowRight size={13} className="shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
          </motion.button>
        ))}
      </div>
    </section>
  );
};

export default PendingCenter;
