import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { friendlyError } from "@/lib/friendlyError";
import { usePlatformSettings } from "@/hooks/usePlatformSettings";

/**
 * Libera acesso para um assinante — teste por N dias ou vitalício.
 *
 * As edge functions `admin-create-trial` e `admin-create-lifetime` já existiam,
 * mas nenhuma tela as chamava: só dava para usá-las por linha de comando. Como
 * agora exigem admin da plataforma, esta é a porta de entrada delas.
 *
 * Se o e-mail já existir, a função preserva a senha atual e renova apenas o
 * direito de acesso. A senha inicial é usada somente na criação da conta.
 */
const GrantAccessDialog = ({ open, onClose, onDone }: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) => {
  const { toast } = useToast();
  const { settings: platform } = usePlatformSettings();
  const [mode, setMode] = useState<"trial" | "lifetime">("trial");
  const [form, setForm] = useState({ name: "", email: "", password: "", days: "" });
  const [saving, setSaving] = useState(false);

  // O padrão vem da configuração da plataforma, não de um número fixo no código.
  useEffect(() => {
    if (open) setForm((f) => ({ ...f, days: String(platform.default_trial_days) }));
  }, [open, platform.default_trial_days]);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim());
  const passwordOk = !form.password || form.password.length >= 8;
  const podeSalvar = emailOk && passwordOk && !saving;

  const submit = async () => {
    setSaving(true);
    const fn = mode === "trial" ? "admin-create-trial" : "admin-create-lifetime";
    const body: Record<string, unknown> = {
      email: form.email.trim().toLowerCase(),
      password: form.password,
      name: form.name.trim() || undefined,
    };
    if (mode === "trial") body.days = Number(form.days) || platform.default_trial_days;

    const { data, error } = await supabase.functions.invoke(fn, { body });
    setSaving(false);

    if (error || (data as any)?.error) {
      toast({
        ...friendlyError(error ?? new Error(String((data as any)?.error)), "Não foi possível liberar o acesso."),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "✓ Acesso liberado",
      description: mode === "trial"
        ? `${form.email} tem acesso por ${body.days} dia(s).`
        : `${form.email} ficou com acesso vitalício.`,
    });
    setForm({ name: "", email: "", password: "", days: String(platform.default_trial_days) });
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={16} className="text-primary" /> Liberar acesso
          </DialogTitle>
          <DialogDescription>
            Cria a conta já com acesso ativo, sem passar pelo pagamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {([
              { v: "trial" as const, label: "Por tempo", desc: "acesso de teste" },
              { v: "lifetime" as const, label: "Vitalício", desc: "sem vencimento" },
            ]).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setMode(opt.v)}
                className={`p-3 rounded-xl border text-left transition ${
                  mode === opt.v ? "border-primary/50 bg-primary/8" : "border-border hover:border-primary/25"
                }`}
              >
                <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Nome (opcional)</label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome do assinante" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">E-mail</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="pessoa@empresa.com"
              />
              {form.email && !emailOk && (
                <p className="text-[10px] text-destructive mt-1">E-mail inválido.</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Senha inicial (somente conta nova)</label>
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Deixe vazia se a conta já existe"
              />
              {form.password && !passwordOk && (
                <p className="text-[10px] text-destructive mt-1">A senha inicial deve ter pelo menos 8 caracteres.</p>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                Usada apenas em contas novas. Contas existentes mantêm a senha atual.
              </p>
            </div>
            {mode === "trial" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Dias de acesso</label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Padrão da plataforma: {platform.default_trial_days} dia(s). Ajuste em Plataforma.
                </p>
              </div>
            )}
          </div>

          <div className="p-3 rounded-xl border border-warning/30 bg-warning/5">
            <p className="text-[11px] text-warning-foreground/90 leading-relaxed">
              <strong>Conta existente:</strong> apenas o período de acesso será renovado;{" "}
              <strong>a senha atual será preservada</strong>.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} disabled={!podeSalvar}>
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            {saving ? "Liberando..." : "Liberar acesso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GrantAccessDialog;
