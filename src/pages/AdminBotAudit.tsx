import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, ShieldAlert, ShieldCheck, RefreshCw, Search, Bot } from "lucide-react";
import ErrorState from "@/components/feedback/ErrorState";
import { formatBRDateTime } from "@/lib/dateUtils";

type AuditRow = {
  id: string;
  user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action: string;
  details: any;
  created_at: string;
};

type BotAction = {
  id: string;
  user_id: string | null;
  client_id: string | null;
  conversation_id: string | null;
  tool_name: string | null;
  tool_input: any;
  tool_output: any;
  success: boolean | null;
  error_message: string | null;
  created_at: string;
};

const ACTION_LABEL: Record<string, { label: string; tone: "red" | "amber" | "emerald" | "slate" }> = {
  reply_blocked_by_guardrail: { label: "Bloqueado (guardrail)", tone: "red" },
  reply_recovered_by_tools: { label: "Recuperado (tools)", tone: "emerald" },
  reply_soft_hits: { label: "Alerta (softhit)", tone: "amber" },
  pix_reply_corrected: { label: "PIX corrigido", tone: "amber" },
};

const toneCls = {
  red: "bg-red-500/15 text-red-300 border-red-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  slate: "bg-slate-500/15 text-slate-300 border-slate-500/30",
} as const;

const formatAuditDate = (value: unknown) => formatBRDateTime(typeof value === "string" ? value : null) || "data indisponível";

export default function AdminBotAudit() {
  const { user, isPlatformAdmin, loading: authLoading } = useAuth();
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [actions, setActions] = useState<BotAction[]>([]);
  const [fsm, setFsm] = useState<Array<{ id: string; phone: string; contact_name: string | null; agent_state: string | null; agent_state_updated_at: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [tone, setTone] = useState<"all" | "blocked" | "soft" | "corrected">("all");

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    const [auditResult, actionResult, conversationResult] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("*")
        .eq("entity_type", "whatsapp_bot")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("bot_actions_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("whatsapp_conversations")
        // whatsapp_conversations não tem FK declarada com clients no schema
        // PostgREST; fazer o embed clients(name) faz a página inteira falhar.
        .select("id, phone, contact_name, agent_state, agent_state_updated_at")
        .not("agent_state", "is", null)
        .neq("agent_state", "UNKNOWN")
        .order("agent_state_updated_at", { ascending: false })
        .limit(50),
    ]);
    const error = auditResult.error || actionResult.error || conversationResult.error;
    if (error) {
      setLoadError(error);
      setLoading(false);
      return;
    }
    setAudits((auditResult.data || []) as AuditRow[]);
    setActions((actionResult.data || []) as BotAction[]);
    setFsm((conversationResult.data || []) as any);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();

  }, [user?.id]);

  const kpis = useMemo(() => {
    const blocked = audits.filter((a) => a.action === "reply_blocked_by_guardrail").length;
    const soft = audits.filter((a) => a.action === "reply_soft_hits").length;
    const corrected = audits.filter((a) => a.action === "pix_reply_corrected").length;
    const escalated = actions.filter((a) => a.tool_name === "escalate_human" || (a.tool_output as any)?.needs_human).length;
    return { blocked, soft, corrected, escalated };
  }, [audits, actions]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return audits.filter((a) => {
      if (tone !== "all") {
        if (tone === "blocked" && a.action !== "reply_blocked_by_guardrail") return false;
        if (tone === "soft" && a.action !== "reply_soft_hits") return false;
        if (tone === "corrected" && a.action !== "pix_reply_corrected") return false;
      }
      if (!needle) return true;
      const hay = JSON.stringify(a.details || {}).toLowerCase() + " " + (a.action || "").toLowerCase();
      return hay.includes(needle);
    });
  }, [audits, q, tone]);

  if (authLoading) return null;
  if (!user || !isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Bot className="h-4 w-4" /> Auditoria do agente WhatsApp
            </div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">Bot Audit</h1>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">
              Últimas 300 decisões do guardrail e 200 chamadas de ferramentas do bot. Use para revisar bloqueios,
              correções automáticas e escalonamentos.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </header>

        {loadError && <ErrorState error={loadError} onRetry={() => void load()} />}

        {!loadError && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={<ShieldAlert className="h-5 w-5" />} label="Bloqueados" value={kpis.blocked} tone="red" />
          <KpiCard icon={<Shield className="h-5 w-5" />} label="Soft hits" value={kpis.soft} tone="amber" />
          <KpiCard icon={<ShieldCheck className="h-5 w-5" />} label="PIX corrigido" value={kpis.corrected} tone="amber" />
          <KpiCard icon={<Bot className="h-5 w-5" />} label="Escalados humano" value={kpis.escalated} tone="slate" />
        </div>}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">Decisões do guardrail</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {(["all", "blocked", "soft", "corrected"] as const).map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={tone === t ? "default" : "outline"}
                    onClick={() => setTone(t)}
                    className="h-8"
                  >
                    {t === "all" ? "Todos" : t === "blocked" ? "Bloqueados" : t === "soft" ? "Soft hits" : "Corrigidos"}
                  </Button>
                ))}
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="buscar motivo/cliente…"
                    name="bot-audit-search"
                    aria-label="Buscar na auditoria do bot"
                    className="h-8 w-56 pl-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-10">Nada por aqui.</div>
            ) : (
              <div className="divide-y divide-border/60">
                {filtered.map((row) => {
                  const meta = ACTION_LABEL[row.action] || { label: row.action, tone: "slate" as const };
                  const d = row.details || {};
                  const reasons: string[] = Array.isArray(d.reasons) ? d.reasons : [];
                  const softHits: string[] = Array.isArray(d.softHits) ? d.softHits : [];
                  return (
                    <div key={row.id} className="py-3 flex items-start gap-3">
                      <Badge variant="outline" className={toneCls[meta.tone] + " whitespace-nowrap"}>
                        {meta.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-muted-foreground truncate">
                          entity: {row.entity_id?.slice(0, 8) || "—"}
                        </div>
                        {reasons.length > 0 && (
                          <div className="text-sm text-red-300 mt-0.5">
                            <span className="text-muted-foreground">motivos:</span> {reasons.slice(0, 5).join(" · ")}
                          </div>
                        )}
                        {softHits.length > 0 && (
                          <div className="text-xs text-amber-300 mt-0.5">
                            <span className="text-muted-foreground">soft:</span> {softHits.slice(0, 5).join(" · ")}
                          </div>
                        )}
                        {d.reasons?.length ? null : (
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {JSON.stringify(d).slice(0, 160)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatAuditDate(row.created_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Conversas ativas (FSM) — {fsm.length}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-32 w-full" />
            ) : fsm.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">Nenhuma conversa em estado ativo.</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[360px] overflow-y-auto">
                {fsm.map((f) => {
                  const stateTone: "red" | "amber" | "emerald" | "slate" =
                    f.agent_state === "INTENT_HUMANO" ? "red" :
                    f.agent_state === "INTENT_PAGAR" ? "amber" :
                    f.agent_state === "INTENT_PROMESSA" ? "emerald" : "slate";
                  return (
                    <div key={f.id} className="py-2.5 flex items-center gap-3 text-sm">
                      <Badge variant="outline" className={toneCls[stateTone] + " whitespace-nowrap font-mono text-xs"}>
                        {f.agent_state}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{f.contact_name || "—"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{f.phone}</div>
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatAuditDate(f.agent_state_updated_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Últimas ações do bot ({actions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : actions.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">Sem ações registradas.</div>
            ) : (
              <div className="divide-y divide-border/60 max-h-[420px] overflow-y-auto">
                {actions.slice(0, 80).map((a) => (
                  <div key={a.id} className="py-2.5 flex items-start gap-3 text-sm">
                    <Badge
                      variant="outline"
                      className={a.success === false ? toneCls.red : toneCls.emerald}
                    >
                      {a.tool_name || "?"}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground truncate">
                        client: {a.client_id?.slice(0, 8) || "—"} · convo: {a.conversation_id?.slice(0, 8) || "—"}
                      </div>
                      {a.error_message && (
                        <div className="text-xs text-red-300 mt-0.5 truncate">{a.error_message}</div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatAuditDate(a.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "red" | "amber" | "emerald" | "slate";
}) {
  const bg = {
    red: "from-red-500/10 to-red-500/5 border-red-500/20 text-red-300",
    amber: "from-amber-500/10 to-amber-500/5 border-amber-500/20 text-amber-300",
    emerald: "from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 text-emerald-300",
    slate: "from-slate-500/10 to-slate-500/5 border-slate-500/20 text-slate-300",
  }[tone];
  return (
    <Card className={`bg-linear-to-br ${bg} border`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 opacity-80">{icon}<span className="text-xs">{label}</span></div>
        <div className="text-3xl font-bold mt-1 text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}
