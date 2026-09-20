"use client";

import { createClient } from "@/lib/supabase/client";
import type { EventFile } from "@/lib/board/eventFiles";
import type { Json } from "@/lib/supabase/database.types";

export type PublicationStatus = "to_publish" | "scheduled" | "published";

export interface PublicationTargets {
  youtube?: boolean;
  facebook?: { lorraine?: boolean; champagne_ardenne?: boolean; alsace?: boolean };
  tiktok?: boolean;
  instagram?: boolean;
}

export interface MediaPublication {
  id: string;
  event_file_id: string;
  event_id: string;
  status: PublicationStatus;
  scheduled_at: string | null;
  caption: string | null;
  targets: PublicationTargets;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  event_files: EventFile;
  events: { title: string; start_date: string } | null;
}

/** Ajoute automatiquement un média (photo/vidéo) fraîchement uploadé sur un événement à la file "à publier". */
export async function queueMediaForPublication(eventFileId: string, eventId: string) {
  const supabase = createClient();
  await supabase.from("media_publications").insert({
    event_file_id: eventFileId,
    event_id: eventId,
    status: "to_publish",
  });
}

export async function listMediaPublications(status: PublicationStatus): Promise<MediaPublication[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("media_publications")
    .select(
      "*, event_files(*, uploaded_by_profile:profiles(first_name, last_name, email)), events(title, start_date)"
    )
    .eq("status", status)
    .order(status === "scheduled" ? "scheduled_at" : "created_at", { ascending: status !== "published" });
  if (error) {
    console.error("[mediaPublications.listMediaPublications]", error);
    return [];
  }
  return (data as unknown as MediaPublication[]) ?? [];
}

export async function scheduleMediaPublication(
  id: string,
  params: { caption: string; targets: PublicationTargets; scheduledAt: string }
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("media_publications")
    .update({
      caption: params.caption,
      targets: params.targets as unknown as Json,
      scheduled_at: params.scheduledAt,
      status: "scheduled",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function cancelScheduledPublication(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("media_publications")
    .update({ status: "to_publish", scheduled_at: null })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markMediaPublished(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("media_publications")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
