"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Discussion d'un événement : message (droits de l'auteur, RLS) et notification « event_mentioned »
// de chaque personne mentionnée avec @ — cloche, e-mail et push ouvrent l'onglet Discussion.

async function postEventCommentImpl(eventId: string, body: string, mentionIds: string[]) {
  const text = body.trim();
  if (!text) throw new Error("Message vide.");
  if (text.length > 4000) throw new Error("Message trop long.");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");

  const mentions = [...new Set(mentionIds)].filter((id) => id !== userId).slice(0, 50);
  const { error } = await supabase.from("event_comments").insert({ event_id: eventId, author_id: userId, body: text, mentions: mentions.length ? mentions : null });
  if (error) throw new Error(error.message);
  if (mentions.length === 0) return;

  const service = createServiceClient();
  const [{ data: event }, { data: author }] = await Promise.all([
    service.from("events").select("title").eq("id", eventId).single(),
    service.from("profiles").select("first_name, last_name").eq("id", userId).single(),
  ]);
  const actor = `${author?.first_name ?? ""} ${author?.last_name ?? ""}`.trim() || "Quelqu'un";
  const excerpt = text.length > 160 ? `${text.slice(0, 157)}…` : text;
  const { error: notifError } = await service.from("notifications").insert(
    mentions.map((uid) => ({
      user_id: uid,
      type: "event_mentioned" as const,
      title: "Vous avez été mentionné",
      message: `${actor} vous a mentionné dans la discussion de « ${event?.title ?? "l'événement"} » : ${excerpt}`,
      actor_name: actor,
      event_id: eventId,
      data: { event_id: eventId, tab: "discussion" },
    }))
  );
  if (notifError) console.error("[event-comments.mentions]", notifError);
}

export async function postEventComment(eventId: string, body: string, mentionIds: string[] = []) {
  return toResult(() => postEventCommentImpl(eventId, body, mentionIds));
}
