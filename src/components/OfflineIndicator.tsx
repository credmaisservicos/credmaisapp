import { useEffect, useState } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useQueryClient } from "@tanstack/react-query";
import { formatSyncAge, loadLastSuccessfulSync, saveLastSuccessfulSync } from "@/lib/offlineSync";

const OfflineIndicator = () => {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [justReconnected, setJustReconnected] = useState(false);
  const [wasOffline, setWasOffline] = useState(!online);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(loadLastSuccessfulSync);

  useEffect(() => {
    let lastRecorded = lastSync || 0;
    return queryClient.getQueryCache().subscribe((event) => {
      const action = "action" in event ? event.action : undefined;
      if (!navigator.onLine || action?.type !== "success") return;
      const now = Date.now();
      if (now - lastRecorded < 30_000) return;
      lastRecorded = saveLastSuccessfulSync(now);
      setLastSync(now);
    });
  }, [queryClient, lastSync]);

  useEffect(() => {
    if (!online) {
      setWasOffline(true);
      setJustReconnected(false);
      return;
    }
    if (wasOffline) {
      setJustReconnected(true);
      setWasOffline(false);
      setSyncing(true);
      void queryClient
        .refetchQueries({ type: "active" }, { throwOnError: true })
        .then(() => {
          const now = saveLastSuccessfulSync();
          setLastSync(now);
        })
        .catch(() => undefined)
        .finally(() => setSyncing(false));
    }
  }, [online, queryClient, wasOffline]);

  useEffect(() => {
    if (!justReconnected) return;
    const timer = window.setTimeout(() => setJustReconnected(false), 4000);
    return () => window.clearTimeout(timer);
  }, [justReconnected]);

  if (online && !justReconnected) return null;

  return (
    <div
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-100 px-4 py-2 rounded-full shadow-2xl backdrop-blur-md border text-xs font-semibold flex items-center gap-2 transition-all duration-300 ${
        online
          ? "bg-success/15 border-success/40 text-success"
          : "bg-destructive/15 border-destructive/40 text-destructive"
      }`}
      role="status"
      aria-live="polite"
    >
      {online ? <Wifi size={13} /> : <WifiOff size={13} />}
      {online
        ? syncing ? "Conexão restaurada — sincronizando dados…" : "Conexão restaurada — dados atualizados"
        : `Modo offline — ${formatSyncAge(lastSync)}`}
    </div>
  );
};

export default OfflineIndicator;
