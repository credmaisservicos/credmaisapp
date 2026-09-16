import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, TrendingUp, AlertTriangle, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { todayLocalISO } from "@/lib/dateUtils";

type Briefing = {
  greeting: string;
  summary: string;
  priorities: string[];
  tone: "positivo" | "neutro" | "alerta";
};

const TONE_STYLE = {
  positivo: { color: "text-success", bg: "from-success/10 to-success/0", icon: TrendingUp },
  neutro: { color: "text-primary", bg: "from-primary/10 to-primary/0", icon: Minus },
  alerta: { color: "text-warning", bg: "from-warning/10 to-warning/0", icon: AlertTriangle },
};

const CACHE_KEY_PREFIX = "daily-briefing-";

export default function DailyBriefing() {
  const { user } = useAuth();
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = `${CACHE_KEY_PREFIX}${user?.id}-${todayLocalISO()}`;

  const fetchBriefing = async (force = false) => {
    if (!force) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try { setData(JSON.parse(cached)); return; } catch {}
      }
    }
    setLoading(true);
    setError(null);
    try {
      const { data: res, error } = await supabase.functions.invoke("daily-briefing");
      if (error) throw error;
      if ((res as any)?.error) throw new Error((res as any).error);
      setData(res.briefing);
      localStorage.setItem(cacheKey, JSON.stringify(res.briefing));
    } catch (e: any) {
      setError(e?.message || "Não foi possível gerar o briefing");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchBriefing();

  }, [user?.id]);

  if (!data && !loading && !error) return null;

  const style = TONE_STYLE[data?.tone || "neutro"];
  const Icon = style.icon;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[.08] bg-card/65 animate-fade-in">
      <div className={`absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b ${style.bg}`} />
      <div className="relative p-5 md:p-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Sparkles size={14} className="text-primary" />
            </div>
            <div>
              <p className="text-label">Briefing do Dia</p>
              <p className="text-[9px] text-muted-foreground">Gerado por IA</p>
            </div>
          </div>
          <button
            onClick={() => fetchBriefing(true)}
            disabled={loading}
            className="p-2 rounded-xl hover:bg-muted/40 transition disabled:opacity-50"
            title="Atualizar"
          >
            <RefreshCw size={13} className={`text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading && !data && (
          <div className="space-y-2">
            <div className="h-4 w-2/3 skeleton-shimmer rounded" />
            <div className="h-3 w-full skeleton-shimmer rounded" />
            <div className="h-3 w-5/6 skeleton-shimmer rounded" />
          </div>
        )}

        {error && !data && (
          <p className="text-xs text-muted-foreground">{error}. <button onClick={() => fetchBriefing(true)} className="text-primary underline">Tentar novamente</button></p>
        )}

        {data && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} className={style.color} />
              <h3 className="text-headline text-base text-foreground">{data.greeting}</h3>
            </div>
            <p className="text-sm text-foreground/80 leading-relaxed mb-3">{data.summary}</p>
            <div className="space-y-1.5">
              {data.priorities.map((p, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${style.color.replace("text-", "bg-")}`} />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
