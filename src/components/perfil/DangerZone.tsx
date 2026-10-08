import { useState } from "react";
import { Download, Trash2, AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { supabaseFetch } from "@/integrations/supabase/transport";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const DangerZone = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sua sessão expirou. Entre novamente para exportar os dados.");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-user-data`;
      const resp = await supabaseFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const a = document.createElement("a");
      const downloadUrl = URL.createObjectURL(blob);
      a.href = downloadUrl;
      a.download = `meus-dados-${Date.now()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(downloadUrl);
      toast({ title: "Download iniciado", description: "Seu arquivo JSON com todos os dados foi gerado." });
    } catch (e: any) {
      toast({ title: "Falha ao exportar", description: e?.message || "Tente novamente.", variant: "destructive" });
    } finally { setExporting(false); }
  };

  const handleDelete = async () => {
    if (!user?.email) return;
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      toast({ title: "Email não confere", description: "Digite exatamente o email da sua conta.", variant: "destructive" });
      return;
    }
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-user-account", {
        body: { email_confirmation: confirmEmail.trim() },
      });
      if (error || (data as any)?.error) throw new Error((data as any)?.message || error?.message || "Erro");
      toast({ title: "Conta apagada", description: "Todos os seus dados foram removidos. Adeus 👋" });
      await signOut();
      window.location.href = "/";
    } catch (e: any) {
      toast({ title: "Falha ao apagar conta", description: e?.message || "Tente novamente.", variant: "destructive" });
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-destructive/15 flex items-center justify-center">
            <ShieldAlert size={16} className="text-destructive" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Meus dados (LGPD)</h2>
            <p className="text-[11px] text-muted-foreground">Exporte ou apague tudo — direito garantido pela lei.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-card border border-border text-sm font-medium hover:bg-accent/50 transition disabled:opacity-50"
          >
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {exporting ? "Gerando..." : "Baixar meus dados (JSON)"}
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-sm font-medium text-destructive hover:bg-destructive/20 transition"
          >
            <Trash2 size={16} /> Apagar minha conta
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 text-warning shrink-0" />
          Apagar a conta é <strong>permanente</strong>: remove clientes, contratos, parcelas, mensagens e histórico. Não há como desfazer.
        </p>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => { setConfirmOpen(o); if (!o) setConfirmEmail(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle size={18} /> Apagar minha conta
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span className="block">
                Esta ação é <strong>irreversível</strong>. Todos os seus clientes, contratos, parcelas,
                mensagens, histórico e configurações serão apagados imediatamente.
              </span>
              <span className="block">
                Recomendamos <strong>baixar seus dados</strong> antes.
              </span>
              <span className="block text-xs">
                Para confirmar, digite seu email <code className="text-destructive font-mono">{user?.email}</code>:
              </span>
              <input
                type="email"
                autoFocus
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={user?.email || ""}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting || confirmEmail.trim().toLowerCase() !== (user?.email || "").toLowerCase()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <><Loader2 size={14} className="animate-spin mr-2" /> Apagando...</> : "Apagar permanentemente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DangerZone;
