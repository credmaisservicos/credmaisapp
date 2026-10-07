import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAll } from "@/lib/fetchAll";
import {readLocalPreference} from '@/lib/browserStorage';

/**
 * Counts unread chat messages across all channels the user is a member of
 * and all DM threads. Channels use chat_channel_members.last_read_at as the
 * watermark; DMs use a per-thread localStorage timestamp updated when the
 * Chat page opens that thread.
 *
 * Recomputes on:
 *  - mount
 *  - any insert into chat_messages (realtime)
 *  - tab focus
 *  - same-tab "chat:read" custom event (dispatched by Chat page when scope changes)
 */
export function useChatUnread() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }

    let cancelled = false;

    const compute = async () => {
      try {
        const [members, dms] = await Promise.all([
          fetchAll<any>((from, to) => supabase
            .from("chat_channel_members")
            .select("channel_id, last_read_at")
            .eq("user_id", user.id)
            .range(from, to)),
          fetchAll<any>((from, to) => supabase
            .from("chat_dm_threads")
            .select("id")
            .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
            .range(from, to)),
        ]);

        const channelCounts = members.map(async (member) => {
          const { count: unread, error } = await supabase
            .from("chat_messages")
            .select("*", { count: "exact", head: true })
            .eq("channel_id", member.channel_id)
            .neq("user_id", user.id)
            .gt("created_at", member.last_read_at || new Date(0).toISOString());
          if (error) throw error;
          return unread || 0;
        });
        const dmCounts = dms.map(async (dm) => {
          const watermark = readLocalPreference(`chat-dm-read-${dm.id}`) || new Date(0).toISOString();
          const { count: unread, error } = await supabase
            .from("chat_messages")
            .select("*", { count: "exact", head: true })
            .eq("dm_thread_id", dm.id)
            .neq("user_id", user.id)
            .gt("created_at", watermark);
          if (error) throw error;
          return unread || 0;
        });
        const counts = await Promise.all([...channelCounts, ...dmCounts]);
        if (!cancelled) setCount(counts.reduce((total, unread) => total + unread, 0));
      } catch (error) {
        // Preserve the last known badge instead of falsely reporting zero.
        console.error("Não foi possível atualizar mensagens não lidas", error);
      }
    };

    compute();

    // Realtime: any new message → recompute (cheap counts)
    const channel = supabase
      .channel(`chat-unread-${user.id}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "chat_messages" },
        () => compute(),
      )
      .subscribe();

    const onFocus = () => compute();
    const onRead = () => compute();
    window.addEventListener("focus", onFocus);
    window.addEventListener("chat:read", onRead);

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("chat:read", onRead);
    };
  }, [user]);

  return count;
}
