"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useLiveRefresh } from "@/components/board/live/LiveProvider";
import { requestsFromRows, type PresenceRequests } from "@/lib/board/presence";

export type PresenceRow = {
  user_id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  profiles: { first_name: string | null; last_name: string | null } | null;
};

/**
 * Présences d'un événement de plusieurs jours : jours déclarés par chacun (event_presence_days) et
 * présences souhaitées par rôle (event_presence_requests). Mis à jour en direct.
 */
export function useEventPresence(eventId: string | null | undefined) {
  const [rows, setRows] = useState<PresenceRow[] | null>(null);
  const [requests, setRequests] = useState<PresenceRequests | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    const supabase = createClient() as unknown as SupabaseClient;
    const [presence, wanted] = await Promise.all([
      supabase.from("event_presence_days").select("user_id, day, start_time, end_time, profiles(first_name, last_name)").eq("event_id", eventId).order("day"),
      supabase.from("event_presence_requests").select("kind, day, start_time, end_time").eq("event_id", eventId),
    ]);
    setRows((presence.data ?? []) as unknown as PresenceRow[]);
    setRequests(requestsFromRows((wanted.data ?? []) as { kind: string; day: string; start_time: string | null; end_time: string | null }[]));
  }, [eventId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);
  useLiveRefresh(["event_presence_days", "event_presence_requests"], () => void load());

  return { rows, requests, reload: load };
}
