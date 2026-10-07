import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { 
  MessageCircle, QrCode, RefreshCcw, Power, CheckCircle2, 
  AlertCircle, Settings2, ShieldCheck, Loader2, Bot,
  MessageSquare, FileCheck, Headphones, Zap, Clock, Plus, Trash2, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BusinessHoursCard } from "@/components/whatsapp/BusinessHoursCard";

const invokeEvolution = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("evolution-api", { body });
  const upstreamStatus = Number((data as any)?.upstream_status || 0);
  if (error || (data as any)?.error || upstreamStatus >= 400) {
    throw error || new Error(String((data as any)?.message || (data as any)?.error || "A Evolution API não respondeu corretamente."));
  }
  return data as any;
};

const WhatsAppConfig = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [instanceData, setInstanceData] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (user) {
      fetchSettings();
    }
  }, [user]);

  // Poll status while QR code is visible / connecting
  useEffect(() => {
    if (status === "connected") return;
    if (!settings?.whatsapp_instance) return;
    if (!qrCode && status !== "connecting") return;

    const interval = setInterval(async () => {
      try {
        const data = await invokeEvolution({ action: "getInstance", instanceName: settings.whatsapp_instance });
        const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : null;
        const inst = arr ? arr[0] : (data?.instance ?? data);
        const connStatus = inst?.connectionStatus || inst?.status;
        if (connStatus === "open") {
          setStatus("connected");
          setQrCode(null);
          toast({ title: "WhatsApp Conectado!", description: "Conexão estabelecida com sucesso." });
          // auto-configure webhook
          try {
            const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
            await invokeEvolution({
              action: "setWebhook",
              instanceName: settings.whatsapp_instance,
              data: { url: `${supabaseUrl}/functions/v1/whatsapp-webhook` }
            });
          } catch (e) {
            console.warn("Auto webhook setup failed", e);
          }
        }
      } catch (e) {
        console.warn("Status polling error", e);
      }
    }, 3000);

    // Auto-refresh QR every 40s (Evolution QR expires ~60s)
    const qrRefresh = setInterval(() => {
      if (qrCode) {
        handleConnect(settings.whatsapp_instance);
      }
    }, 40000);

    return () => {
      clearInterval(interval);
      clearInterval(qrRefresh);
    };
  }, [qrCode, status, settings?.whatsapp_instance]);

  const fetchSettings = async () => {
    const { data, error } = await (supabase as any)
      .from("settings_safe")
      .select("*")
      .eq("user_id", user!.id)
      .maybeSingle();
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível carregar as configurações."), variant: "destructive" });
      return;
    }

    setSettings(data);
    if (data?.whatsapp_instance) {
      checkStatus(data.whatsapp_instance);
    }
  };

  const updateSettings = async (updates: any) => {
    const { error } = await supabase
      .from("settings")
      .update(updates)
      .eq("user_id", user!.id);
    
    if (error) {
      toast({ ...friendlyError(error, "Não foi possível salvar as configurações."), variant: "destructive" });
      return false;
    } else {
      setSettings((prev: any) => ({ ...prev, ...updates }));
      return true;
    }
  };

  const checkStatus = async (instanceName: string) => {
    try {
      const data = await invokeEvolution({ action: "getInstance", instanceName });

      // Instância inexistente (404) ou erro retorna como desconectado, sem toast
      if (data?.status === 404 || data?.error || !data) {
        setStatus("disconnected");
        return;
      }

      setInstanceData(data);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : null;
      const inst = arr ? arr[0] : (data.instance ?? data);
      if (inst?.status === "open" || inst?.connectionStatus === "open" || inst?.state === "open") {
        setStatus("connected");
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  };

  const handleCreateInstance = async () => {
    if (!settings?.whatsapp_api_url || !settings?.whatsapp_api_key_configured) {
      toast({
        title: "Credenciais não configuradas",
        description: "Informe a URL e a chave da Evolution API em Configurações → WhatsApp antes de conectar.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    try {
      const previousInstance = settings?.whatsapp_instance;
      if (previousInstance) {
        await invokeEvolution({ action: "deleteInstance", instanceName: previousInstance });
      }

      // Um nome novo evita conflito com registros órfãos que a Evolution ainda
      // esteja finalizando após a desconexão do número anterior.
      const instanceName = `instancia-${user!.id.split("-")[0]}-${Date.now().toString(36)}`;
      if (!(await updateSettings({ whatsapp_instance: instanceName }))) return;

      await invokeEvolution({ action: "createInstance", instanceName });

      toast({ title: "Instância Criada", description: "Iniciando conexão..." });
      handleConnect(instanceName);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (instanceName: string) => {
    setStatus("connecting");
    try {
      const data = await invokeEvolution({ action: "connectInstance", instanceName });

      const qrRaw = data?.base64 || data?.qrcode?.base64 || data?.qrcode?.code || data?.code;
      const qr = typeof qrRaw === "string" && qrRaw.trim() ? qrRaw : null;
      
      if (qr) {
        const src = qr.startsWith("data:") ? qr : `data:image/png;base64,${qr.replace(/^data:image\/[a-z]+;base64,/, "")}`;
        setQrCode(src);
      } else if (data.instance?.status === "open" || data.status === "open" || data.upstream_status === 200) {
        setStatus("connected");
        toast({ title: "Conectado!", description: "WhatsApp pronto para uso." });
      } else {
        throw new Error("A API não retornou um QR Code válido. Tente novamente.");
      }
    } catch (err: any) {
      toast({ title: "Erro de conexão", description: err.message, variant: "destructive" });
      setStatus("disconnected");
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const currentInstance = settings?.whatsapp_instance;
      if (!currentInstance) return;
      await invokeEvolution({ action: "deleteInstance", instanceName: currentInstance });

      setStatus("disconnected");
      setQrCode(null);
      setInstanceData(null);
      setSettings((prev: any) => ({ ...prev, whatsapp_instance: null }));
      toast({ title: "Desconectado", description: "A instância antiga foi removida. Você já pode conectar outro número." });
    } catch (err: any) {
      toast({ title: "Erro ao desconectar", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSetWebhook = async () => {
    setLoading(true);
    try {
      // Get the Supabase URL from the environment or use a generic one if not available
      const supabaseUrl = (import.meta as any).env.VITE_SUPABASE_URL;
      const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;

      await invokeEvolution({
        action: "setWebhook",
        instanceName: settings.whatsapp_instance,
        data: { url: webhookUrl }
      });

      toast({ title: "Webhook Configurado", description: "O bot agora está pronto para receber mensagens." });
    } catch (err: any) {
      toast({ title: "Erro no Webhook", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-8 animate-fade-in">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-emerald-500/10 via-card to-card p-6">
        <div className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between gap-4 flex-wrap">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_30px_rgb(16_185_129/0.25)]">
              <MessageCircle size={24} className="text-emerald-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">Integração</p>
              <h1 className="text-display text-2xl md:text-3xl font-bold text-foreground tracking-tight">WhatsApp Business</h1>
              <p className="text-xs text-muted-foreground mt-1">Conecte sua conta via Evolution API e ative o agente SDR.</p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`capitalize px-3 py-1.5 text-xs ${
              status === "connected" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" :
              status === "connecting" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" :
              "bg-muted text-muted-foreground border-border"
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full mr-2 ${
              status === "connected" ? "bg-emerald-500 animate-pulse" :
              status === "connecting" ? "bg-amber-500 animate-pulse" :
              "bg-muted-foreground"
            }`} />
            {status === "connected" ? "Conectado" : status === "connecting" ? "Conectando..." : "Desconectado"}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Connection Card */}
        <Card className="md:col-span-2 p-6 border-border/50 bg-card/50 backdrop-blur-sm">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Power size={16} className="text-primary" />
                Status da Conexão
              </h3>
              {status === "connected" && (
                <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={loading} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  {loading ? <Loader2 className="animate-spin" size={14} /> : "Desconectar"}
                </Button>
              )}
            </div>

            {status === "disconnected" && !qrCode && (
              <div className="py-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                  <MessageSquare size={32} className="text-muted-foreground/30" />
                </div>
                <div>
                  <h4 className="font-medium">Nenhuma instância ativa</h4>
                  <p className="text-sm text-muted-foreground mt-1">Clique abaixo para criar e gerar o QR Code.</p>
                </div>
                <Button onClick={handleCreateInstance} disabled={loading || !settings} className="btn-premium">
                  {loading ? <Loader2 className="animate-spin mr-2" size={16} /> : <Zap size={16} className="mr-2" />}
                  Gerar QR Code de Conexão
                </Button>
              </div>
            )}

            {qrCode && status !== "connected" && (
              <div className="py-4 text-center space-y-4">
                <div className="p-4 bg-white rounded-2xl inline-block shadow-xl border-4 border-primary/20">
                  <img src={qrCode} alt="WhatsApp QR Code" className="h-auto w-full max-w-64" />
                </div>
                <div className="max-w-xs mx-auto">
                  <p className="text-sm font-medium">Aponte a câmera do seu WhatsApp</p>
                  <p className="text-xs text-muted-foreground mt-1">Vá em Configurações &gt; Aparelhos Conectados &gt; Conectar um Aparelho</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleConnect(settings?.whatsapp_instance)} className="rounded-xl">
                  <RefreshCcw size={14} className="mr-2" />
                  Atualizar QR Code
                </Button>
              </div>
            )}

            {status === "connected" && (
              <div className="py-8 text-center space-y-6">
                <div className="relative inline-block">
                  <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                    <CheckCircle2 size={40} className="text-emerald-500" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-card border-2 border-emerald-500 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-lg">Bot de WhatsApp Ativo</h4>
                  <p className="text-sm text-muted-foreground mt-1">Sua instância <span className="text-primary font-mono">{settings?.whatsapp_instance}</span> está pronta.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 max-w-sm mx-auto sm:grid-cols-2">
                  <div className="p-3 rounded-xl bg-muted/30 text-left">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Instância</p>
                    <p className="text-sm font-medium truncate">{settings?.whatsapp_instance}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-muted/30 text-left">
                    <p className="text-[10px] text-muted-foreground uppercase font-bold">Status</p>
                    <p className="text-sm font-medium text-emerald-500">Operacional</p>
                  </div>
                </div>
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={handleSetWebhook} disabled={loading} className="rounded-xl border-primary/20 hover:bg-primary/5">
                    {loading ? <Loader2 className="animate-spin mr-2" size={14} /> : <Zap size={14} className="mr-2 text-amber-500" />}
                    Configurar Webhook Automático
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="p-5 border-border/50 bg-card/50">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Automações do Bot</h4>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Headphones size={14} className="text-violet-500" />
                  <span className="text-xs font-medium">Processar Áudios</span>
                </div>
                <Switch 
                  checked={settings?.bot_process_audio} 
                  onCheckedChange={(v) => updateSettings({ bot_process_audio: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCheck size={14} className="text-blue-500" />
                  <span className="text-xs font-medium">Analisar Comprovantes</span>
                </div>
                <Switch 
                  checked={settings?.bot_process_receipts} 
                  onCheckedChange={(v) => updateSettings({ bot_process_receipts: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  <span className="text-xs font-medium">Baixa Automática</span>
                </div>
                <Switch 
                  checked={settings?.bot_auto_confirm_payment} 
                  onCheckedChange={(v) => updateSettings({ bot_auto_confirm_payment: v })}
                />
              </div>
            </div>
          </Card>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck size={16} />
              <h4 className="text-xs font-bold uppercase">Segurança</h4>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Suas credenciais são armazenadas de forma segura. O bot respeita os limites de envio para evitar banimentos no WhatsApp.
            </p>
          </div>
        </div>
      </div>
      
      {/* Help Card */}
      <Card className="p-6 border-border/50 bg-card/50">
        <div className="flex flex-col md:flex-row gap-6 items-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <Bot size={32} className="text-primary" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <h3 className="font-bold">Como funciona o Bot?</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Após conectar, o bot monitorará as mensagens recebidas. Ele pode transcrever áudios, identificar pagamentos via comprovante e responder dúvidas básicas de seus clientes usando inteligência artificial avançada.
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-xl border-primary/30 text-primary hover:bg-primary/5">
            <a href="https://doc.evolution-api.com/" target="_blank" rel="noreferrer">Ver documentação</a>
          </Button>
        </div>
      </Card>

      <BusinessHoursCard settings={settings} onUpdate={updateSettings} />
    </div>
  );
};

export default WhatsAppConfig;
