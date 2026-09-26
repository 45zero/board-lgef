"use server";

import { createClient } from "@/lib/supabase/server";
import {
  publishPublicationToSocial,
  refreshPublicationStats,
  listPublicationComments,
  deletePublicationComment,
  deletePublicationPosts,
} from "@/lib/social/publisher";
import {
  publishedNetworks,
  type NetworkKey,
  type PublishInfo,
  type SocialComment,
  type SocialPublishResult,
  type SocialTargetKey,
} from "@/lib/social/targets";

// Server actions du centre de publication — fines enveloppes authentifiées autour du cœur
// src/lib/social/publisher.ts (partagé avec le cron des publications programmées).

type By = { first_name: string | null; last_name: string | null } | null;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return supabase;
}

/** Publie sur les pages Facebook / le compte Instagram sélectionnés (un résultat par cible). */
export async function publishSocial(
  publicationId: string,
  targets: { key: SocialTargetKey; caption: string }[],
  by: By
): Promise<SocialPublishResult[]> {
  const supabase = await requireUser();
  if (targets.length === 0) return [];
  return publishPublicationToSocial(supabase, publicationId, targets, by);
}

/** Relit les stats (Facebook, Instagram, YouTube) et les fige dans publish_info. */
export async function refreshSocialStats(publicationIds: string[]): Promise<{ updated: number; youtubeError?: string }> {
  const supabase = await requireUser();
  return refreshPublicationStats(supabase, publicationIds);
}

/** Commentaires lus en direct sur la plateforme (jamais stockés côté board). */
export async function getSocialComments(publicationId: string, key: NetworkKey): Promise<{ error: string | null; comments: SocialComment[] }> {
  try {
    const supabase = await requireUser();
    return { error: null, comments: await listPublicationComments(supabase, publicationId, key) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue.", comments: [] };
  }
}

/** Supprime un commentaire directement sur la plateforme — irréversible. */
export async function deleteSocialComment(key: NetworkKey, commentId: string): Promise<{ error: string | null }> {
  try {
    const supabase = await requireUser();
    await deletePublicationComment(supabase, key, commentId);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/** Supprime la publication sur les réseaux demandés (irréversible). */
export async function deleteSocialPosts(publicationId: string, keys: NetworkKey[]): Promise<SocialPublishResult[]> {
  const supabase = await requireUser();
  return deletePublicationPosts(supabase, publicationId, keys);
}

export type FilePublicationsSummary = { publicationId: string; networks: NetworkKey[] }[];

/** Publications (déjà en ligne) qui contiennent ce fichier d'événement — pour proposer leur suppression des réseaux avant de supprimer le fichier. */
export async function getPublishedForFile(eventFileId: string): Promise<FilePublicationsSummary> {
  const supabase = await requireUser();
  const { data } = await supabase
    .from("media_publications")
    .select("id, publish_info, file_ids, event_file_id")
    .or(`event_file_id.eq.${eventFileId},file_ids.cs.{${eventFileId}}`);
  return (data ?? [])
    .map((p) => ({ publicationId: p.id, networks: publishedNetworks(p.publish_info as PublishInfo | null) }))
    .filter((p) => p.networks.length > 0);
}

/**
 * Avant la suppression d'un fichier d'événement : supprime (si demandé) ses publications des
 * réseaux, puis le retire des galeries qui le contiennent. La publication dont il est le fichier
 * principal disparaît ensuite d'elle-même (ON DELETE CASCADE sur event_file_id).
 */
export async function detachFileFromPublications(eventFileId: string, deleteFromNetworks: boolean): Promise<SocialPublishResult[]> {
  const supabase = await requireUser();
  const results: SocialPublishResult[] = [];

  if (deleteFromNetworks) {
    for (const { publicationId, networks } of await getPublishedForFile(eventFileId)) {
      results.push(...(await deletePublicationPosts(supabase, publicationId, networks)));
    }
  }

  const { data: pubs } = await supabase
    .from("media_publications")
    .select("id, file_ids, event_file_id")
    .or(`event_file_id.eq.${eventFileId},file_ids.cs.{${eventFileId}}`);
  for (const p of pubs ?? []) {
    const remaining = (p.file_ids ?? []).filter((id: string) => id !== eventFileId);
    // Dernier fichier de la publication : la cascade la supprimera avec le fichier.
    if (remaining.length === 0) continue;
    await supabase
      .from("media_publications")
      .update({
        file_ids: remaining,
        // Le fichier principal d'une galerie passe au suivant, sinon la cascade emporterait toute la galerie.
        event_file_id: p.event_file_id === eventFileId ? remaining[0] : p.event_file_id,
        // null = recalculé d'après le fichier restant (voir publicationKind côté client).
        kind: remaining.length === 1 ? null : "gallery",
      })
      .eq("id", p.id);
  }

  return results;
}
