import { CredinhoAvatar } from "@/components/brand/Credinho";
import { lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Bot, Zap, MessageCircle, Sparkles, Activity, BarChart3,
  CheckCircle2, XCircle, AlertTriangle, Loader2, ArrowRight, Inbox, CalendarClock,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { fetchAll } from "@/lib/fetchAll";

const WhatsAppConfig = lazy(() => import("./WhatsAppConfig"));
const AgenteIA = lazy(() => import("./AgenteIA"));
const BotSettings = lazy(() => import("@/components/agent/BotSettings"));
const WhatsAppInbox = lazy(() => import("./WhatsAppInbox"));

const VALID_TABS = ["overview", "bot", "agente", "cobrancas", "inbox", "revisoes"] as const;
type TabKey = (typeof VALID_TABS)[number];
const LEGACY_TABS: Record<string, TabKey> = {
  automacoes: "cobrancas",
  whatsapp: "bot",
  performance: "overview",
};

const Fallback = () => (
  <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
    <Loader2 className="animate-spin mr-3" size={16} /> Carregando...
  </div>
);

const HealthRow = ({
  label, ok, warn, detail,
}: { label: string; ok: boolean; warn?: boolean; detail?: string }) => (
  <div className="flex items-start justify-between gap-3 py-3 border-b border-border/40 last:border-0">
    <div className="min-w-0">
      <p className="text-sm font-medium">{label}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
    <div className="shrink-0">
      {ok ? (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 gap-1">
          <CheckCircle2 size={12} /> OK
        </Badge>
      ) : warn ? (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 gap-1">
          <AlertTriangle size={12} /> Atenção
        </Badge>
      ) : (
        <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
          <XCircle size={12} /> Falha
        </Badge>
      )}
    </div>
  </div>
);

const Overview = () => {
  const { user } = useAuth();

  const { data: settings, isLoading, isError: settingsError, refetch: retrySettings } = useQuery({
    queryKey: ["central-bot-settings", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings_safe")
        .select("bot_enabled, bot_auto_send, whatsapp_api_url, whatsapp_instance, whatsapp_api_key_configured, company_name, bot_tone")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: instances, isLoading: instancesLoading, isError: instancesError, refetch: retryInstances } = useQuery({
    queryKey: ["central-bot-instances", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("id, is_active, is_default")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const {data:health,isLoading:healthLoading,isError:healthError,refetch:retryHealth}=useQuery({
    queryKey:["central-bot-health",user?.id],
    queryFn:async()=>{const {data,error}=await supabase.functions.invoke("whatsapp-health");if(error||data?.error)throw error||Error(data.error);return data;},
    enabled:!!user,staleTime:30_000,refetchOnWindowFocus:false,
  });

  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: retryStats } = useQuery({
    queryKey: ["central-bot-stats", user?.id],
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [msgs, actions] = await Promise.all([
        supabase.from("whatsapp_messages").select("id", { count: "exact", head: true })
          .eq("user_id", user!.id).gte("created_at", sinceIso),
        // A coluna se chama `tool_name`. Pedindo `action`, o PostgREST devolvia
        // 400 e a consulta inteira falhava: o painel mostrava 0 ações e 100% de
        // sucesso desde sempre, mesmo com o bot trabalhando.
        fetchAll((from, to) => supabase.from("bot_actions_log").select("id, tool_name, success")
          .eq("user_id", user!.id).gte("created_at", sinceIso).range(from, to)),
      ]);
      if (msgs.error) throw msgs.error;
      const total = actions.length;
      const ok = actions.filter((a: any) => a.success === true).length;
      return {
        messages24h: msgs.count || 0,
        actions24h: total,
        successRate: total ? Math.round((ok / total) * 100) : null,
      };
    },
    enabled: !!user,
    refetchInterval: 60000,
  });

  const hasInstance = !!(settings?.whatsapp_instance && settings?.whatsapp_api_url && settings?.whatsapp_api_key_configured)
    || (instances && instances.some((i: any) => i.is_active));
  const botEnabled = !!settings?.bot_enabled;
  const autoSend = !!settings?.bot_auto_send;

  return (
    <div className="space-y-5">
      {statsError && <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">Não foi possível carregar os indicadores. <button type="button" className="underline min-h-11 px-2" onClick={() => void retryStats()}>Tentar novamente</button></div>}
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-5 border-border/50 bg-linear-to-br from-primary/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <MessageCircle size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsError ? "—" : stats?.messages24h ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Mensagens (24h)</p>
            </div>
          </div>
        </Card>
        <Card className="p-5 border-border/50 bg-linear-to-br from-emerald-500/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <Bot size={18} className="text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{statsError ? "—" : stats?.actions24h ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Ações do bot (24h)</p>
            </div>
          </div>
        </Card>
        <Card className="p-5 border-border/50 bg-linear-to-br from-amber-500/5 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Activity size={18} className="text-amber-500" />
            </div>
            <div>
              <p className="text-lg font-bold" role="status">{statsError ? "Indisponível" : statsLoading ? "Carregando…" : stats?.successRate == null ? "Sem atividade" : `${stats.successRate}%`}</p>
              <p className="text-xs text-muted-foreground">Taxa de sucesso (24h)</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Health check */}
      <Card className="p-6 border-border/50 bg-card/60">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-primary" />
          <h3 className="font-bold">Diagnóstico do Bot</h3>
        </div>
        {settingsError || instancesError || healthError ? (
          <div role="alert" className="text-sm">Não foi possível verificar o atendimento. <button type="button" className="underline min-h-11 px-2" onClick={() => { void retrySettings(); void retryInstances(); void retryHealth(); }}>Tentar novamente</button></div>
        ) : isLoading || instancesLoading || healthLoading ? (
          <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
            <Loader2 className="animate-spin" size={14} /> Verificando...
          </div>
        ) : (
          <div>
            <HealthRow
              label="Bot habilitado"
              ok={botEnabled}
              detail={botEnabled ? "Atendimento habilitado. Confira abaixo a disponibilidade do servidor e da conexão." : "Ative o bot em Configurações → Comunicação para começar a atender."}
            />
            <HealthRow
              label="WhatsApp configurado"
              ok={!!hasInstance}
              detail={hasInstance ? "Configuração cadastrada. Confira a conexão atual na aba WhatsApp." : "Configure uma conexão na aba WhatsApp."}
            />
            <HealthRow
              label="Envio automático"
              ok={autoSend}
              warn={!autoSend && botEnabled}
              detail={autoSend ? "Respostas da IA são enviadas automaticamente ao cliente." : "Modo revisão: bot sugere, operador aprova."}
            />
            <HealthRow
              label="Identidade da empresa"
              ok={!!settings?.company_name}
              warn={!settings?.company_name}
              detail={settings?.company_name ? `Bot se identifica como "${settings.company_name}".` : "Defina o nome da empresa em Configurações para o bot se apresentar corretamente."}
            />
            <HealthRow label="Recepção de mensagens" ok={!!health?.webhook_ready} detail={health?.webhook_ready?"Autenticação do webhook configurada.":"Recepção indisponível; a configuração do servidor precisa de atenção."}/>
            <HealthRow label="Rotinas automáticas" ok={!!health?.cron_ready} detail={health?.cron_ready?"Autenticação das rotinas configurada.":"Agendamento indisponível no servidor."}/>
            <HealthRow label="Conexão do WhatsApp" ok={health?.connection==="open"} detail={health?.connection==="open"?"Conexão aberta no provedor.":"Não foi possível confirmar a conexão. Confira a aba WhatsApp."}/>
            <HealthRow label="Inteligência artificial" ok={!!health?.ai_ready} warn={!health?.ai_ready} detail={health?.ai_ready?"Integração disponível.":"Atendimento por menus e regras locais; análise pela equipe."}/>
            <p className="pt-3 text-sm text-muted-foreground">{health?.pending_approval||0} mensagem(ns) para aprovação · {health?.uncertain||0} entrega(s) incerta(s) · {health?.failed24h||0} falha(s) nas últimas 24h. A aceitação pelo provedor não confirma leitura ou entrega ao destinatário.</p>
          </div>
        )}
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Link to="/comunicacao?tab=inbox">
          <Card className="p-5 border-border/50 hover:border-primary/40 transition-colors cursor-pointer h-full">
            <Inbox size={18} className="text-primary mb-2" />
            <p className="font-semibold text-sm">Abrir conversas</p>
            <p className="text-xs text-muted-foreground mt-1">Ver e responder conversas em tempo real</p>
            <div className="flex items-center gap-1 text-xs text-primary mt-3">Acessar <ArrowRight size={12} /></div>
          </Card>
        </Link>
        <Link to="/chat">
          <Card className="p-5 border-border/50 hover:border-primary/40 transition-colors cursor-pointer h-full">
            <MessageCircle size={18} className="text-primary mb-2" />
            <p className="font-semibold text-sm">Chat interno</p>
            <p className="text-xs text-muted-foreground mt-1">Fale com sua equipe</p>
            <div className="flex items-center gap-1 text-xs text-primary mt-3">Acessar <ArrowRight size={12} /></div>
          </Card>
        </Link>
        <Card className="p-5 border-border/50 bg-linear-to-br from-primary/5 to-transparent h-full">
          <Sparkles size={18} className="text-primary mb-2" />
          <p className="font-semibold text-sm">Precisão nas cobranças</p>
          <p className="text-xs text-muted-foreground mt-1">
            O bot valida valores contra o banco (subset-sum), nunca inventa parcelas e escala pra humano quando em dúvida.
          </p>
        </Card>
      </div>
    </div>
  );
};

const CentralBot = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = raw && (VALID_TABS as readonly string[]).includes(raw)
    ? (raw as TabKey) : LEGACY_TABS[raw || ""] || "overview";
  const setTab = (value: string) => {
    const next = new URLSearchParams(params); next.set("tab", value); setParams(next);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-hero">
        <div className="page-hero-content flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="page-hero-icon">
              <CredinhoAvatar size={44} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-shimmer">Atendimento</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Agente, cobranças e atendimento em um só lugar
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link to="/comunicacao?tab=inbox">
              <Inbox size={14} className="mr-2" /> Conversas
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
        <TabsList aria-label="Módulo de atendimento" className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto gap-1 rounded-2xl bg-card border border-border p-1">
          <TabsTrigger value="overview" className="min-h-11 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold text-xs sm:text-sm flex items-center gap-1.5">
            <Activity size={14} /><span >Resumo</span>
          </TabsTrigger>
          <TabsTrigger value="bot" className="min-h-11 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold text-xs sm:text-sm flex items-center gap-1.5">
            <MessageCircle size={14} /><span >Conexão</span>
          </TabsTrigger>
          <TabsTrigger value="agente" className="min-h-11 rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold text-xs sm:text-sm flex items-center gap-1.5">
            <Bot size={14} /><span >Assistente</span>
          </TabsTrigger>
          <TabsTrigger value="inbox" className="min-h-11 rounded-xl gap-1.5 text-xs sm:text-sm"><Inbox size={14}/>Conversas</TabsTrigger>
          <TabsTrigger value="revisoes" className="min-h-11 rounded-xl gap-1.5 text-xs sm:text-sm"><CheckCircle2 size={14}/>Revisões</TabsTrigger>
          <TabsTrigger value="cobrancas" className="min-h-11 rounded-xl gap-1.5 text-xs sm:text-sm"><CalendarClock size={14}/>Configurações</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5 focus-visible:outline-hidden">
          <Overview />
        </TabsContent>
        <TabsContent value="bot" className="mt-5 focus-visible:outline-hidden">
          <Suspense fallback={<Fallback />}><WhatsAppConfig /></Suspense>
        </TabsContent>
        <TabsContent value="agente" className="mt-5 focus-visible:outline-hidden">
          <Suspense fallback={<Fallback />}><AgenteIA key="chat" embedded view="chat" /></Suspense>
        </TabsContent>
        <TabsContent value="revisoes" className="mt-5"><Suspense fallback={<Fallback/>}><AgenteIA key="reviews" embedded view="documentos"/></Suspense></TabsContent>
        <TabsContent value="inbox" className="mt-5"><Suspense fallback={<Fallback/>}><WhatsAppInbox/></Suspense></TabsContent>
        <TabsContent value="cobrancas" className="mt-5"><Suspense fallback={<Fallback/>}><BotSettings/></Suspense></TabsContent>
      </Tabs>
    </div>
  );
};

export default CentralBot;
