"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface EventComment {
  id: string;
  event_id: string;
  author_id: string;
  body: string;
  created_at: string;
  parent_id: string | null;
  author: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

/**
 * Version simplifiée de calendrier-lgef/src/components/discussion/EventDiscussion.tsx
 * : liste des messages via la RPC existante
 * `get_visible_event_comments` (gère déjà la visibilité côté base). L'envoi, les
 * mentions, ❤️ et pièces jointes passent par la conversation (EventChat, actions chat.ts).
 */
export function useEventComments(eventId: string) {
  const [comments, setComments] = useState<EventComment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_visible_event_comments", { p_event_id: eventId });
    if (error) console.error("[useEventComments]", error);
    setComments(((data as EventComment[] | null) ?? []).slice().reverse());
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  return { eventId, comments, loading, refetch: fetchComments };
}
