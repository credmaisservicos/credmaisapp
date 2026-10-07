import { WifiOff } from "lucide-react";
import { Link } from "react-router-dom";

export default function OfflineDataUnavailable() {
  return <div role="status" className="rounded-2xl border border-border bg-card p-6 text-center space-y-4">
    <WifiOff size={28} className="mx-auto text-muted-foreground" aria-hidden="true" />
    <h1 className="text-lg font-semibold">Dados indisponíveis sem internet</h1>
    <p className="text-sm text-muted-foreground">Ainda não há informações salvas desta tela neste dispositivo. Conecte-se à internet para carregá-las.</p>
    <Link to="/dashboard" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Voltar ao painel</Link>
  </div>;
}
