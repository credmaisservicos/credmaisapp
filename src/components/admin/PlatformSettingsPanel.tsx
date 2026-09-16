import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import {
  fetchPlatformSettings,
  PLATFORM_SETTINGS_DEFAULTS,
  PLATFORM_SETTINGS_KEY,
  type PlatformSettings,
} from "@/hooks/usePlatformSettings";

/**
 * Configuração da PLATAFORMA — vale para todos os assinantes de uma vez.
 * Grava na tabela `platform_settings` (linha única, escrita restrita a admin
 * por RLS). Não confundir com /configuracoes, que é do assinante.
 *
 * A versão anterior gravava em `settings` filtrando por user_id (ou seja, na
 * linha do próprio admin, não na plataforma) e só persistia 1 dos 5 campos —
 * os outros 4 mostravam "salvo" sem salvar nada.
 */
const PlatformSettingsPanel = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PlatformSettings>(PLATFORM_SETTINGS_DEFAULTS);

  const { data, isLoading } = useQuery({
    queryKey: PLATFORM_SETTINGS_KEY,
    queryFn: fetchPlatformSettings,
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = async () => {
    setSaving(true);
    // upsert na linha única: o trigger do banco força id=true e carimba quem alterou.
    const { error } = await supabase
      .from("platform_settings")
      .upsert({ id: true, ...form }, { onConflict: "id" });
    setSaving(false);

    if (error) {
      toast({ ...friendlyError(error, "Não foi possível salvar a configuração da plataforma."), variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: PLATFORM_SETTINGS_KEY });
    toast({ title: "✓ Configuração da plataforma salva", description: "Vale para todos os assinantes." });
  };

  const fieldCls = "w-full bg-input border border-border rounded-lg px-3 py-2 text-sm";

  if (isLoading) {
    return <p className="text-sm text-muted-foreground animate-pulse">Carregando configuração da plataforma...</p>;
  }

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <Globe className="text-primary" size={20} />
          <div>
            <h3 className="font-bold">Configuração da Plataforma</h3>
            <p className="text-xs text-muted-foreground">
              Afeta todos os assinantes. Configurações de cada empresa ficam em Configurações.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-accent/20">
            <div>
              <p className="text-sm font-semibold">Modo Manutenção</p>
              <p className="text-xs text-muted-foreground">
                Tranca o app para todos os assinantes. Você continua entrando para poder desligar.
              </p>
            </div>
            <input
              type="checkbox"
              name="platform-maintenance-mode"
              aria-label="Modo de manutenção"
              checked={form.maintenance_mode}
              onChange={(e) => setForm({ ...form, maintenance_mode: e.target.checked })}
              className="w-5 h-5 accent-primary shrink-0"
            />
          </div>

          {form.maintenance_mode && (
            <div className="space-y-1.5 p-3 rounded-xl bg-warning/5 border border-warning/20">
              <p className="text-sm font-semibold">Aviso mostrado na manutenção</p>
              <textarea
                rows={2}
                value={form.maintenance_message ?? ""}
                onChange={(e) => setForm({ ...form, maintenance_message: e.target.value })}
                placeholder="Estamos fazendo uma manutenção rápida. Volte em alguns minutos."
                className={`${fieldCls} resize-none`}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-accent/20">
            <div>
              <p className="text-sm font-semibold">Novos Cadastros</p>
              <p className="text-xs text-muted-foreground">
                Desligado, a aba de criar conta some do login e o link de checkout
                deixa de ser entregue — ninguém novo consegue assinar.
              </p>
            </div>
            <input
              type="checkbox"
              name="platform-new-registrations"
              aria-label="Permitir novos cadastros"
              checked={form.allow_new_registrations}
              onChange={(e) => setForm({ ...form, allow_new_registrations: e.target.checked })}
              className="w-5 h-5 accent-primary shrink-0"
            />
          </div>

          {!form.allow_new_registrations && (
            <div className="p-3 rounded-xl border border-warning/30 bg-warning/5">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Vale saber:</strong> isto fecha o cadastro
                dentro do app. Criar conta chamando a API de autenticação do Supabase
                diretamente é controlado por outra chave — para fechar também esse caminho,
                ative <em>Disable sign-ups</em> no painel do Supabase, em Authentication →
                Sign In / Providers.
              </p>
            </div>
          )}

          <div className="space-y-1.5 p-3 rounded-xl bg-primary/10 border border-primary/20">
            <p className="text-sm font-semibold flex items-center gap-2">
              <CreditCard size={14} className="text-primary" /> Link de checkout do cadastro
            </p>
            <input
              type="text"
              name="platform-checkout-url"
              aria-label="Link de checkout do cadastro"
              value={form.checkout_url ?? ""}
              onChange={(e) => setForm({ ...form, checkout_url: e.target.value })}
              placeholder="https://mpago.la/... ou link de assinatura do Mercado Pago"
              className={fieldCls}
            />
            <p className="text-[10px] text-muted-foreground italic">
              É para cá que o botão "Criar conta" manda quem ainda não assinou. Webhook do
              Mercado Pago em <code>/functions/v1/mercadopago-webhook</code>.
            </p>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-accent/20">
            <p className="text-sm font-semibold">Dias de trial padrão</p>
            <input
              type="number"
              name="platform-default-trial-days"
              aria-label="Dias de trial padrão"
              min={0}
              max={365}
              value={form.default_trial_days}
              onChange={(e) => setForm({ ...form, default_trial_days: Math.max(0, Math.min(365, parseInt(e.target.value) || 0)) })}
              className={fieldCls}
            />
            <p className="text-[10px] text-muted-foreground italic">
              Usado quando você libera um acesso de teste sem informar o prazo.
            </p>
          </div>

          <div className="space-y-1.5 p-3 rounded-xl bg-accent/20">
            <p className="text-sm font-semibold">Comunicado global</p>
            <textarea
              rows={3}
              value={form.global_announcement ?? ""}
              onChange={(e) => setForm({ ...form, global_announcement: e.target.value })}
              placeholder="Aparece como faixa no topo do painel de todos os assinantes. Deixe vazio para não mostrar nada."
              className={`${fieldCls} resize-none`}
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full rounded-xl py-6">
          {saving ? "Salvando..." : "Salvar configuração da plataforma"}
        </Button>
      </div>
    </div>
  );
};

export default PlatformSettingsPanel;
