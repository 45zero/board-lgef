"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

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
 * + ReplyBox.tsx : liste + envoi de messages via la RPC existante
 * `get_visible_event_comments` (gère déjà la visibilité côté base). Les
 * réactions, mentions et notifications de la version complète ne sont pas
 * portées dans cette passe.
 */
export function useEventComments(eventId: string) {
  const { user } = useAuth();
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

  const postComment = async (body: string) => {
    const trimmed = body.trim();
    if (!trimmed || !user?.id) return false;
    const supabase = createClient();

    const { error } = await supabase
      .from("event_comments")
      .insert({ event_id: eventId, author_id: user.id, body: trimmed });

    if (error) return false;
    await fetchComments();
    return true;
  };

  return { comments, loading, postComment, refetch: fetchComments };
}
