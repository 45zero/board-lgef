"use client";

import { createClient } from "@/lib/supabase/client";
import type { EventFile } from "@/lib/board/eventFiles";
import type { Json } from "@/lib/supabase/database.types";
import { getDriveStreamUrl } from "@/app/actions/media-stream";
import type { DbEventType } from "@/lib/board/calendar";
import {
  kindFromContentTypes,
  type PublicationKind,
  type PublishInfo,
  type StandaloneMedia,
} from "@/lib/social/targets";

export type PublicationStatus = "to_publish" | "scheduled" | "published";

export interface PublicationTargets {
  youtube?: boolean;
  facebook?: { lorraine?: boolean; champagne_ardenne?: boolean; alsace?: boolean };
  tiktok?: boolean;
  instagram?: boolean;
  /** Comptes Instagram identifiés sur les photos (sans @). */
  igTags?: string[];
}

/**
 * Une publication du centre : soit rattachée à un événement (un ou plusieurs de ses fichiers —
 * `file_ids`, le premier étant aussi `event_file_id`), soit autonome (créée depuis le centre, sans
 * événement : `title` + `category`, médias sur le Drive du board dans `media`). Sans aucun média,
 * c'est un post texte.
 */
export interface MediaPublication {
  id: string;
  event_file_id: string | null;
  event_id: string | null;
  status: PublicationStatus;
  scheduled_at: string | null;
  caption: string | null;
  targets: PublicationTargets;
  created_by: string | null;
  created_at: string;
  published_at: string | null;
  kind: PublicationKind | null;
  file_ids: string[];
  media: StandaloneMedia[];
  title: string | null;
  category: DbEventType | null;
  publish_info: PublishInfo | null;
  event_files: EventFile | null;
  events: { title: string; start_date: string; event_type: DbEventType | null } | null;
  /** Tous les fichiers d'événement de la publication, dans l'ordre (résolus à la lecture). */
  files: EventFile[];
}

const FILE_SELECT = "*, uploaded_by_profile:profiles(first_name, last_name, email)";

export function publicationTitle(pub: MediaPublication): string {
  return pub.events?.title ?? pub.title ?? "Publication";
}

export function publicationCategory(pub: MediaPublication): DbEventType | null {
  return pub.events?.event_type ?? pub.category ?? null;
}

export function publicationKind(pub: MediaPublication): PublicationKind {
  if (pub.kind) return pub.kind;
  if (pub.media.length > 0) return kindFromContentTypes(pub.media.map((m) => m.content_type));
  return kindFromContentTypes(pub.files.map((f) => f.content_type));
}

/** Ajoute automatiquement un média (photo/vidéo) fraîchement uploadé sur un événement à la file "à publier". */
export async function queueMediaForPublication(eventFileId: string, eventId: string, contentType?: string | null) {
  const supabase = createClient();
  await supabase.from("media_publications").insert({
    event_file_id: eventFileId,
    event_id: eventId,
    file_ids: [eventFileId],
    kind: contentType ? kindFromContentTypes([contentType]) : null,
    status: "to_publish",
  });
}

export async function countMediaPublications(): Promise<Record<PublicationStatus, number>> {
  const supabase = createClient();
  const statuses: PublicationStatus[] = ["to_publish", "scheduled", "published"];
  const results = await Promise.all(
    statuses.map((status) =>
      supabase.from("media_publications").select("id", { count: "exact", head: true }).eq("status", status)
    )
  );
  return {
    to_publish: results[0].count ?? 0,
    scheduled: results[1].count ?? 0,
    published: results[2].count ?? 0,
  };
}

export async function listMediaPublications(status: PublicationStatus): Promise<MediaPublication[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("media_publications")
    .select(`*, event_files(${FILE_SELECT}), events(title, start_date, event_type)`)
    .eq("status", status)
    .order(status === "scheduled" ? "scheduled_at" : status === "published" ? "published_at" : "created_at", {
      ascending: status === "scheduled",
      nullsFirst: false,
    });
  if (error) {
    console.error("[mediaPublications.listMediaPublications]", error);
    return [];
  }
  const rows = (data as unknown as Omit<MediaPublication, "files">[]) ?? [];

  // Fichiers des galeries (au-delà du fichier principal déjà joint) : une seule requête.
  const extraIds = [...new Set(rows.flatMap((r) => (r.file_ids ?? []).filter((id) => id !== r.event_file_id)))];
  const extra = new Map<string, EventFile>();
  if (extraIds.length > 0) {
    const { data: files } = await supabase.from("event_files").select(FILE_SELECT).in("id", extraIds);
    for (const f of (files as unknown as EventFile[]) ?? []) extra.set(f.id, f);
  }

  return rows.map((r) => {
    const ids = r.file_ids?.length ? r.file_ids : r.event_file_id ? [r.event_file_id] : [];
    const files = ids
      .map((id) => (id === r.event_file_id ? r.event_files : extra.get(id)))
      .filter((f): f is EventFile => !!f);
    return { ...r, media: (r.media as StandaloneMedia[] | null) ?? [], file_ids: ids, files };
  });
}

export interface NewPublicationInput {
  eventId: string | null;
  fileIds: string[];
  media: StandaloneMedia[];
  title: string | null;
  category: DbEventType | null;
  caption: string;
}

/** Crée une publication « à publier » depuis le centre (rattachée ou non à un événement). */
export async function createPublication(input: NewPublicationInput, createdBy: string | null): Promise<string> {
  const supabase = createClient();
  let kind: PublicationKind;
  if (input.fileIds.length > 0) {
    const { data } = await supabase.from("event_files").select("content_type").in("id", input.fileIds);
    kind = kindFromContentTypes((data ?? []).map((f) => f.content_type));
  } else {
    kind = kindFromContentTypes(input.media.map((m) => m.content_type));
  }

  const { data, error } = await supabase
    .from("media_publications")
    .insert({
      event_id: input.eventId,
      event_file_id: input.fileIds[0] ?? null,
      file_ids: input.fileIds,
      media: input.media as unknown as Json,
      title: input.title,
      category: input.category,
      caption: input.caption,
      kind,
      status: "to_publish",
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Impossible de créer la publication.");
  return data.id;
}

/** Change les fichiers d'événement d'une publication (composition d'une galerie depuis le compositeur). */
export async function setPublicationFiles(id: string, files: EventFile[]) {
  const supabase = createClient();
  const { error } = await supabase
    .from("media_publications")
    .update({
      file_ids: files.map((f) => f.id),
      event_file_id: files[0]?.id ?? null,
      kind: kindFromContentTypes(files.map((f) => f.content_type)),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Retire une publication du centre (ne touche ni aux fichiers de l'événement, ni aux réseaux). */
export async function deletePublication(id: string) {
  const supabase = createClient();
  const { error } = await supabase.from("media_publications").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Publication unique (un seul fichier) correspondant à un fichier d'événement, créée au besoin — utilisée par la publication depuis l'onglet Fichiers d'un événement. */
export async function ensureFilePublication(file: EventFile): Promise<string> {
  const supabase = createClient();
  const { data } = await supabase.from("media_publications").select("id, file_ids").eq("event_file_id", file.id);
  const single = (data ?? []).find((p) => (p.file_ids?.length ?? 0) <= 1);
  if (single) return single.id;

  const { data: created, error } = await supabase
    .from("media_publications")
    .insert({
      event_file_id: file.id,
      event_id: file.event_id,
      file_ids: [file.id],
      kind: kindFromContentTypes([file.content_type]),
      status: "to_publish",
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Impossible de créer la publication.");
  return created.id;
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

export async function markMediaPublished(id: string, caption?: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("media_publications")
    .update({ status: "published", published_at: new Date().toISOString(), ...(caption !== undefined ? { caption } : {}) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Écrit l'état YouTube sur la publication (et sur le fichier d'événement quand elle n'en porte qu'un). */
async function saveYoutubeInfo(pubId: string, youtube: NonNullable<PublishInfo["youtube"]>) {
  const supabase = createClient();
  const { data } = await supabase.from("media_publications").select("publish_info, file_ids, media").eq("id", pubId).single();
  const next: PublishInfo = { ...((data?.publish_info as PublishInfo | null) ?? {}), youtube };
  await supabase.from("media_publications").update({ publish_info: next as unknown as Json }).eq("id", pubId);

  const fileIds = data?.file_ids ?? [];
  if (fileIds.length === 1 && !((data?.media as unknown[] | null)?.length)) {
    const { data: file } = await supabase.from("event_files").select("publish_info").eq("id", fileIds[0]).single();
    const fileInfo: PublishInfo = { ...((file?.publish_info as PublishInfo | null) ?? {}), youtube };
    await supabase.from("event_files").update({ publish_info: fileInfo as unknown as Json }).eq("id", fileIds[0]);
  }
}

/**
 * Publication YouTube — appelle l'Edge Function publish-youtube depuis le navigateur (l'upload
 * d'une longue vidéo dépasserait le budget d'une fonction Vercel). Publie sur la chaîne publique
 * de la ligue : ne jamais appeler sans confirmation explicite de l'utilisateur.
 */
export async function publishPublicationToYoutube(
  pub: Pick<MediaPublication, "id" | "files" | "media">,
  { title, description }: { title: string; description?: string },
  by: { first_name: string | null; last_name: string | null } | null
) {
  const supabase = createClient();
  let videoUrl: string | null = null;
  const standalone = pub.media.find((m) => (m.content_type ?? "").startsWith("video"));
  const file = pub.files.find((f) => (f.content_type ?? "").startsWith("video"));
  if (standalone) {
    videoUrl = await getDriveStreamUrl("publication", standalone.drive_file_id);
  } else if (file?.storage_provider === "drive" && file.drive_file_id) {
    videoUrl = await getDriveStreamUrl(file.event_id, file.drive_file_id);
  } else if (file?.path) {
    videoUrl = (await supabase.storage.from("event-files").createSignedUrl(file.path, 3600)).data?.signedUrl ?? null;
  }
  if (!videoUrl) throw new Error("Aucune vidéo à publier sur YouTube.");

  const { data, error } = await supabase.functions.invoke("publish-youtube", {
    body: { videoUrl, title, description: description ?? "" },
  });
  if (error || !data?.success) {
    throw new Error(data?.error ?? error?.message ?? "Échec de la publication YouTube.");
  }

  await saveYoutubeInfo(pub.id, {
    published: true,
    videoId: data.youtube?.videoId,
    title,
    at: data.youtube?.at ?? new Date().toISOString(),
    by,
    permalink: data.youtube?.videoId ? `https://www.youtube.com/watch?v=${data.youtube.videoId}` : undefined,
  });
}
