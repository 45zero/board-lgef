"use server";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { getDriveStreamUrl } from "@/app/actions/media-stream";
import { getSocialAccountById } from "@/lib/social/accounts";
import {
  publishFacebookVideo,
  publishFacebookPhoto,
  publishInstagramMedia,
  getFacebookVideoStats,
  getFacebookPostStats,
  getInstagramStats,
  findFacebookVideoNear,
  getFacebookComments,
  getInstagramComments,
  deleteComment,
  type StatsResult,
} from "@/lib/social/graph";
import { SOCIAL_TARGETS, isInstagramCompatible, type SocialComment, type SocialTargetKey } from "@/lib/social/targets";
import type { PublishInfo, SocialPublishTarget } from "@/lib/board/eventFiles";

type FileRow = {
  id: string;
  event_id: string;
  path: string | null;
  content_type: string | null;
  storage_provider: string;
  drive_file_id: string | null;
  publish_info: Json | null;
};

type By = { first_name: string | null; last_name: string | null } | null;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return supabase;
}

async function loadFile(supabase: Awaited<ReturnType<typeof createClient>>, fileId: string): Promise<FileRow> {
  const { data, error } = await supabase
    .from("event_files")
    .select("id, event_id, path, content_type, storage_provider, drive_file_id, publish_info")
    .eq("id", fileId)
    .single();
  if (error || !data) throw new Error("Média introuvable.");
  return data as FileRow;
}

/** Lecture-modification-écriture : relit publish_info juste avant d'écrire (une publication Instagram peut durer ~50s, un autre onglet a pu écrire entre-temps). */
async function patchPublishInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fileId: string,
  updater: (current: PublishInfo) => PublishInfo
) {
  const { data } = await supabase.from("event_files").select("publish_info").eq("id", fileId).single();
  const next = updater((data?.publish_info as PublishInfo | null) ?? {});
  const { error } = await supabase.from("event_files").update({ publish_info: next as unknown as Json }).eq("id", fileId);
  if (error) throw new Error(error.message);
  return next;
}

function getTarget(info: PublishInfo, key: SocialTargetKey): SocialPublishTarget | undefined {
  return key === "instagram" ? info.instagram : info.facebook?.[key];
}

function withTarget(info: PublishInfo, key: SocialTargetKey, value: SocialPublishTarget): PublishInfo {
  if (key === "instagram") return { ...info, instagram: value };
  return { ...info, facebook: { ...info.facebook, [key]: value } };
}

/** URL publique temporaire que Meta va télécharger — lien signé Supabase Storage, ou relais signé pour un fichier Drive. */
async function getPublicMediaUrl(supabase: Awaited<ReturnType<typeof createClient>>, file: FileRow): Promise<string> {
  if (file.storage_provider === "drive" && file.drive_file_id) {
    return getDriveStreamUrl(file.event_id, file.drive_file_id);
  }
  if (file.path) {
    const { data } = await supabase.storage.from("event-files").createSignedUrl(file.path, 3600);
    if (data?.signedUrl) return data.signedUrl;
  }
  throw new Error("Impossible de générer l'URL du média.");
}

export type SocialPublishResult = { key: SocialTargetKey; ok: boolean; error?: string };

/**
 * Publie un média du board sur les pages Facebook et/ou le compte Instagram sélectionnés, en
 * appelant directement la Graph API (remplace l'Edge Function publish-facebook, qui ne renvoyait
 * pas les ids de post — indispensables pour les stats). Les cibles partent en parallèle ; un échec
 * sur l'une n'empêche pas les autres, chaque résultat est renvoyé séparément.
 */
export async function publishSocial(
  fileId: string,
  targets: { key: SocialTargetKey; caption: string }[],
  by: By
): Promise<SocialPublishResult[]> {
  const supabase = await requireUser();
  const file = await loadFile(supabase, fileId);

  const ct = (file.content_type ?? "").toLowerCase();
  const kind = ct.startsWith("video") ? "video" : ct.startsWith("image") ? "image" : null;
  if (!kind) throw new Error("Seuls les photos et les vidéos peuvent être publiés.");

  const mediaUrl = await getPublicMediaUrl(supabase, file);
  const at = new Date().toISOString();

  const settled = await Promise.all(
    targets.map(async ({ key, caption }): Promise<{ key: SocialTargetKey; entry?: SocialPublishTarget; error?: string }> => {
      const target = SOCIAL_TARGETS.find((t) => t.key === key);
      const account = target ? getSocialAccountById(target.accountId) : null;
      if (!target || !account) return { key, error: "Compte non configuré (SOCIAL_ACCOUNTS_JSON)." };

      try {
        if (target.plateforme === "INSTAGRAM") {
          if (!isInstagramCompatible(file.content_type)) throw new Error("Instagram n'accepte que les vidéos et les photos JPEG.");
          const { mediaId } = await publishInstagramMedia(account.externalId, account.accessToken, { url: mediaUrl, caption, kind });
          return { key, entry: { published: true, at, by, postId: mediaId, mediaType: kind } };
        }
        if (kind === "video") {
          const { videoId } = await publishFacebookVideo(account.externalId, account.accessToken, { fileUrl: mediaUrl, description: caption });
          return { key, entry: { published: true, at, by, videoId, mediaType: kind } };
        }
        const { postId } = await publishFacebookPhoto(account.externalId, account.accessToken, { url: mediaUrl, caption });
        return { key, entry: { published: true, at, by, postId, mediaType: kind } };
      } catch (e) {
        return { key, error: e instanceof Error ? e.message : "Erreur inattendue." };
      }
    })
  );

  const successes = settled.filter((s) => s.entry);
  if (successes.length > 0) {
    await patchPublishInfo(supabase, fileId, (current) =>
      successes.reduce((acc, s) => withTarget(acc, s.key, s.entry!), current)
    );
  }

  return settled.map((s) => ({ key: s.key, ok: !!s.entry, error: s.error }));
}

async function fetchTargetStats(
  key: SocialTargetKey,
  entry: SocialPublishTarget,
  isVideo: boolean
): Promise<{ entry: SocialPublishTarget; changed: boolean }> {
  const target = SOCIAL_TARGETS.find((t) => t.key === key)!;
  const account = getSocialAccountById(target.accountId);
  if (!account) return { entry, changed: false };

  let next = entry;
  // Publications antérieures (Edge Function) : pas d'id enregistré — on retrouve la vidéo par sa date.
  if (target.plateforme === "FACEBOOK" && !next.videoId && !next.postId && isVideo && next.at) {
    const videoId = await findFacebookVideoNear(account.externalId, account.accessToken, next.at);
    if (!videoId) return { entry, changed: false };
    next = { ...next, videoId, mediaType: "video" };
  }

  let result: StatsResult;
  if (target.plateforme === "INSTAGRAM") {
    if (!next.postId) return { entry, changed: false };
    result = await getInstagramStats(next.postId, account.accessToken);
  } else if (next.videoId) {
    result = await getFacebookVideoStats(account.externalId, next.videoId, account.accessToken);
  } else if (next.postId) {
    result = await getFacebookPostStats(next.postId, account.accessToken);
  } else {
    return { entry, changed: false };
  }

  return { entry: { ...next, stats: result.stats, permalink: result.permalink ?? next.permalink }, changed: true };
}

/**
 * Rafraîchit les stats Meta de chaque publication Facebook/Instagram des médias donnés et les fige
 * dans publish_info (affichage instantané ensuite, sans rappeler Meta à chaque ouverture). Une stat
 * illisible ne bloque pas les autres — on garde l'ancienne valeur.
 */
export async function refreshSocialStats(fileIds: string[]): Promise<{ updated: number }> {
  const supabase = await requireUser();
  let updated = 0;

  await Promise.all(
    fileIds.slice(0, 50).map(async (fileId) => {
      const file = await loadFile(supabase, fileId).catch(() => null);
      if (!file) return;
      const info = (file.publish_info as PublishInfo | null) ?? {};
      const isVideo = (file.content_type ?? "").startsWith("video");

      const results = await Promise.all(
        SOCIAL_TARGETS.map(async ({ key }) => {
          const entry = getTarget(info, key);
          if (!entry?.published) return null;
          try {
            const r = await fetchTargetStats(key, entry, isVideo);
            return r.changed ? { key, entry: r.entry } : null;
          } catch (e) {
            console.error(`[social.refreshSocialStats] ${fileId}/${key}`, e);
            return null;
          }
        })
      );

      const changes = results.filter((r): r is { key: SocialTargetKey; entry: SocialPublishTarget } => !!r);
      if (changes.length === 0) return;
      await patchPublishInfo(supabase, fileId, (current) =>
        changes.reduce((acc, c) => withTarget(acc, c.key, { ...getTarget(acc, c.key), ...c.entry }), current)
      );
      updated += changes.length;
    })
  );

  return { updated };
}

async function resolveCommentTarget(fileId: string, key: SocialTargetKey) {
  const supabase = await requireUser();
  const file = await loadFile(supabase, fileId);
  const entry = getTarget((file.publish_info as PublishInfo | null) ?? {}, key);
  const target = SOCIAL_TARGETS.find((t) => t.key === key);
  const account = target ? getSocialAccountById(target.accountId) : null;
  if (!target || !account) throw new Error("Compte non configuré.");
  const objectId = entry?.videoId ?? entry?.postId;
  if (!objectId) throw new Error("Publication introuvable sur le réseau — rafraîchissez les stats.");
  return { plateforme: target.plateforme, objectId, account };
}

/** Commentaires lus en direct sur la plateforme (jamais stockés côté board). */
export async function getSocialComments(fileId: string, key: SocialTargetKey): Promise<{ error: string | null; comments: SocialComment[] }> {
  try {
    const { plateforme, objectId, account } = await resolveCommentTarget(fileId, key);
    const comments =
      plateforme === "FACEBOOK"
        ? await getFacebookComments(objectId, account.accessToken)
        : await getInstagramComments(objectId, account.accessToken);
    return { error: null, comments };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue.", comments: [] };
  }
}

/** Supprime un commentaire directement sur Facebook/Instagram — irréversible. */
export async function deleteSocialComment(fileId: string, key: SocialTargetKey, commentId: string): Promise<{ error: string | null }> {
  try {
    const { account } = await resolveCommentTarget(fileId, key);
    await deleteComment(commentId, account.accessToken);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}
