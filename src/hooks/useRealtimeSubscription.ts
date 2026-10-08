import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Subscribe to Supabase realtime changes on a table and
 * invalidate the given React Query keys on any change.
 *
 * Channels are scoped per-tenant (`tenant:<uid>:...`) so the
 * Realtime RLS policy can isolate broadcasts between users.
 */
export function useRealtimeSubscription(tableName: string, queryKeys: string[][]) {
  useMultiTableRealtime([tableName], queryKeys);
}

/**
 * Subscribe to multiple tables at once, invalidating the same query key(s).
 */
export function useMultiTableRealtime(
  tables: string[],
  queryKeys: string[][],
) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Callers use inline arrays. Resubscribe only when their contents change.
  const tableSignature = JSON.stringify([...new Set(tables)]);
  const keySignature = JSON.stringify(queryKeys);

  useEffect(() => {
    if (!user?.id) return;
    const subscribedTables: string[] = JSON.parse(tableSignature);
    if (!subscribedTables.length) return;
    const keys: string[][] = JSON.parse(keySignature);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let healthTimer: ReturnType<typeof setTimeout> | undefined;
    let degraded = false;
    let closed = false;
    const scheduleRefresh = () => {
      if (closed || timer !== undefined) return;
      // Bulk changes can emit hundreds of events. Refresh complete queries once
      // per short window instead of repeatedly cancelling their requests.
      timer = setTimeout(() => {
        timer = undefined;
        if (closed) return;
        keys.forEach(key => { void queryClient.invalidateQueries({ queryKey: key }); });
      }, 250);
    };
    const refreshIfAvailable = () => {
      if (!closed && degraded && navigator.onLine && document.visibilityState === "visible") scheduleRefresh();
    };
    const startFallback = () => {
      if (closed || degraded) return;
      degraded = true;
      refreshIfAvailable();
      // A blocked WebSocket must not leave financial data permanently stale.
      // Refresh reads only, with a bounded interval and only in a visible tab.
      poll = setInterval(refreshIfAvailable, 30_000);
    };
    const stopFallback = () => {
      const wasDegraded = degraded;
      degraded = false;
      clearInterval(poll); poll = undefined;
      clearTimeout(healthTimer); healthTimer = undefined;
      if (wasDegraded) scheduleRefresh();
    };
    const channel = supabase.channel(
      `tenant:${user.id}:rt-multi-${Math.random().toString(36).slice(2)}`,
    );
    subscribedTables.forEach(table => {
      channel.on("postgres_changes" as any,
        { event: "*", schema: "public", table }, scheduleRefresh);
    });
    healthTimer = setTimeout(startFallback, 15_000);
    try {
      channel.subscribe(status => {
        if (closed) return;
        if (status === "SUBSCRIBED") stopFallback();
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") startFallback();
      });
    } catch { startFallback(); }
    window.addEventListener("online", refreshIfAvailable);
    document.addEventListener("visibilitychange", refreshIfAvailable);

    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(healthTimer);
      clearInterval(poll);
      window.removeEventListener("online", refreshIfAvailable);
      document.removeEventListener("visibilitychange", refreshIfAvailable);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id, tableSignature, keySignature]);
}
