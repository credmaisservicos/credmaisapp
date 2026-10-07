import { useEffect, useState } from "react";

/**
 * Uma conexão lenta pode levar mais de 15s para carregar uma tela.
 * Mantém a requisição em andamento e oferece recuperação sem apagar o offline.
 */
const SuspenseWatchdog = ({
  children,
  timeoutMs = 15000,
}: {
  children: React.ReactNode;
  timeoutMs?: number;
}) => {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), timeoutMs);

    return () => window.clearTimeout(id);
  }, [timeoutMs]);

  return <>{children}{slow && <div className="px-4 pb-6 text-center space-y-3" role="status">
    <p className="text-sm text-muted-foreground">A conexão está demorando. Você pode aguardar ou tentar novamente.</p>
    <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
      Tentar novamente
    </button>
  </div>}</>;
};

export default SuspenseWatchdog;
