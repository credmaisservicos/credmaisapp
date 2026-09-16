import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseLocalDate } from "@/lib/dateUtils";

/**
 * Native Web Notification API integration.
 * - Reads `settings.push_notifications_enabled` for the current user.
 * - When enabled, requests permission once and listens to `notifications` table inserts
 *   via Supabase realtime, displaying a desktop notification per row.
 * - Stores last-seen timestamp in localStorage to avoid re-notifying old rows.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const lastSeenRef = useRef<number>(0);

  // ALWAYS call useQuery (never conditionally) — enabled flag controls the fetch
  const { data: settings } = useQuery({
    queryKey: ["push-settings", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("settings")
        .select("push_notifications_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // Request permission when enabled — ALWAYS call useEffect
  useEffect(() => {
    if (!user || !settings?.push_notifications_enabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [user, settings?.push_notifications_enabled]);

  // Subscribe to new notifications — ALWAYS call useEffect
  useEffect(() => {
    if (!user || !settings?.push_notifications_enabled) return;
    if (typeof Notification === "undefined") return;

    // Initialize last-seen
    const key = `push-last-seen-${user.id}`;
    const stored = localStorage.getItem(key);
    const storedNumber = Number(stored);
    lastSeenRef.current = stored && Number.isFinite(storedNumber) ? storedNumber : Date.now();

    const channel = supabase
      .channel(`push-notifs-${user.id}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const row = payload.new;
          if (!row) return;
          const parsedTs = parseLocalDate(row.sent_at || row.created_at)?.getTime() ?? NaN;
          if (!Number.isFinite(parsedTs)) return;
          const ts = parsedTs;
          if (ts <= lastSeenRef.current) return;
          lastSeenRef.current = ts;
          localStorage.setItem(key, String(ts));

          if (Notification.permission === "granted") {
            const n = new Notification(row.from || "Sistema", {
              body: row.message,
              tag: row.id,
              icon: "/favicon.png",
            });
            if (row.link) {
              n.onclick = () => {
                window.focus();
                // Notifications are database content. Only permit same-origin app
                // routes so a compromised row cannot become an open redirect.
                try {
                  const destination = new URL(String(row.link), window.location.origin);
                  if (destination.origin === window.location.origin) {
                    window.location.assign(`${destination.pathname}${destination.search}${destination.hash}`);
                  }
                } catch {
                  // Ignore malformed notification links.
                }
              };
            }
          }

          // Badge no título quando aba não está focada
          if (document.hidden) {
            const baseTitle = document.title.replace(/^\(\d+\)\s*/, "");
            const match = document.title.match(/^\((\d+)\)/);
            const count = match ? Number(match[1]) + 1 : 1;
            document.title = `(${count}) ${baseTitle}`;
          }

          // Som suave (respeita mute do navegador)
          try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
            osc.start();
            osc.stop(ctx.currentTime + 0.28);
          } catch { /* noop */ }
        },
      )
      .subscribe();

    // Limpa badge do título quando volta a olhar a aba
    const onFocus = () => {
      document.title = document.title.replace(/^\(\d+\)\s*/, "");
    };
    window.addEventListener("focus", onFocus);
    const onVisibilityChange = () => {
      if (!document.hidden) onFocus();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user, settings?.push_notifications_enabled]);
}
