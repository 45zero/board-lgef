import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { signMediaStreamToken } from "@/lib/board/mediaStreamToken";
import { getSocialAccountById } from "@/lib/social/accounts";
import { signedJpegUrl, signedTextCardUrl } from "@/lib/social/mediaUrls";
import {
  publishFacebookVideo,
  publishFacebookPhoto,
  publishFacebookText,
  publishFacebookGallery,
  publishInstagramMedia,
  publishInstagramCarousel,
  getFacebookVideoStats,
  getFacebookPostStats,
  getInstagramStats,
  findFacebookVideoNear,
  getFacebookComments,
  getInstagramComments,
  deleteComment,
  deleteGraphObject,
  type StatsResult,
} from "@/lib/social/graph";
import {
  SOCIAL_TARGETS,
  NETWORK_KEYS,
  getNetworkEntry,
  withNetworkEntry,
  kindFromContentTypes,
  normalizeInstagramUsernames,
  type NetworkKey,
  type PublicationKind,
  type PublishInfo,
  type SocialComment,
  type SocialPublishResult,
  type SocialPublishTarget,
  type SocialTargetKey,
  type StandaloneMedia,
} from "@/lib/social/targets";

// Cœur du centre de publication, partagé entre les server actions (client Supabase de
// l'utilisateur connecté, src/app/actions/social.ts) et le cron des publications programmées
// (client service role, src/app/api/cron/publications/route.ts).

type Client = SupabaseClient<Database>;
type By = { first_name: string | null; last_name: string | null } | null;

export type PublicationRow = {
  id: string;
  event_id: string | null;
  event_file_id: string | null;
  file_ids: string[];
  media: StandaloneMedia[];
  kind: PublicationKind | null;
  caption: string | null;
  title: string | null;
  publish_info: PublishInfo | null;
  targets: Json;
  events: { title: string } | null;
};

type EventFileRow = {
  id: string;
  event_id: string;
  path: string | null;
  content_type: string | null;
  storage_provider: string;
  drive_file_id: string | null;
};

type MediaItem = { url: string; kind: "image" | "video"; contentType: string | null };

function isJpeg(contentType: string | null) {
  return /^image\/(jpe?g|pjpeg)$/i.test(contentType ?? "");
}

export async function loadPublication(client: Client, id: string): Promise<PublicationRow> {
  const { data, error } = await client
    .from("media_publications")
    .select("id, event_id, event_file_id, file_ids, media, kind, caption, title, publish_info, targets, events(title)")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Publication introuvable.");
  return data as unknown as PublicationRow;
}

function allFileIds(pub: PublicationRow): string[] {
  if (pub.file_ids?.length) return pub.file_ids;
  return pub.event_file_id ? [pub.event_file_id] : [];
}

async function loadEventFiles(client: Client, ids: string[]): Promise<EventFileRow[]> {
  if (ids.length === 0) return [];
  const { data } = await client
    .from("event_files")
    .select("id, event_id, path, content_type, storage_provider, drive_file_id")
    .in("id", ids);
  const byId = new Map(((data as EventFileRow[] | null) ?? []).map((f) => [f.id, f]));
  // Un fichier supprimé depuis l'événement disparaît simplement de la galerie.
  return ids.map((id) => byId.get(id)).filter((f): f is EventFileRow => !!f);
}

/** Lien signé (30 min) vers un fichier du Drive du board, lisible par Meta/YouTube sans session. */
function driveStreamUrl(scope: string, driveFileId: string) {
  const expiresAt = Date.now() + 30 * 60_000;
  const sig = signMediaStreamToken(driveFileId, expiresAt);
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/events/${scope}/attachments/${driveFileId}/stream?expires=${expiresAt}&sig=${sig}`;
}

async function resolveMediaItems(client: Client, pub: PublicationRow): Promise<MediaItem[]> {
  const toKind = (ct: string | null): "image" | "video" => ((ct ?? "").startsWith("video") ? "video" : "image");

  if (pub.media?.length) {
    return pub.media.map((m) => ({ url: driveStreamUrl("publication", m.drive_file_id), kind: toKind(m.content_type), contentType: m.content_type }));
  }

  const files = await loadEventFiles(client, allFileIds(pub));
  const items: MediaItem[] = [];
  for (const f of files) {
    let url: string | null = null;
    if (f.storage_provider === "drive" && f.drive_file_id) url = driveStreamUrl(f.event_id, f.drive_file_id);
    else if (f.path) url = (await client.storage.from("event-files").createSignedUrl(f.path, 3600)).data?.signedUrl ?? null;
    if (!url) throw new Error("Impossible de générer l'URL d'un média.");
    items.push({ url, kind: toKind(f.content_type), contentType: f.content_type });
  }
  return items;
}

/**
 * Écrit l'état de publication (relu juste avant : une publication Instagram peut durer ~50s) sur la
 * publication, et le recopie sur le fichier d'événement quand la publication n'en porte qu'un —
 * c'est ce que lisent les pastilles de l'onglet Fichiers d'un événement.
 */
export async function savePublishInfo(client: Client, pub: PublicationRow, updater: (current: PublishInfo) => PublishInfo) {
  const { data } = await client.from("media_publications").select("publish_info").eq("id", pub.id).single();
  const next = updater((data?.publish_info as PublishInfo | null) ?? {});
  const { error } = await client.from("media_publications").update({ publish_info: next as unknown as Json }).eq("id", pub.id);
  if (error) throw new Error(error.message);

  const fileIds = allFileIds(pub);
  if (fileIds.length === 1 && !pub.media?.length) {
    await client.from("event_files").update({ publish_info: next as unknown as Json }).eq("id", fileIds[0]);
  }
  return next;
}

/**
 * Publie une publication (texte, photo, vidéo ou galerie) sur les pages Facebook et/ou le compte
 * Instagram sélectionnés. Les cibles partent en parallèle ; un échec sur l'une n'empêche pas les
 * autres, chaque résultat est renvoyé séparément. YouTube n'est pas géré ici (voir
 * publishToYoutube côté client : l'upload d'une longue vidéo dépasse le budget d'une fonction).
 */
export async function publishPublicationToSocial(
  client: Client,
  publicationId: string,
  targets: { key: SocialTargetKey; caption: string }[],
  by: By,
  options: { igUserTags?: string[] } = {}
): Promise<SocialPublishResult[]> {
  const pub = await loadPublication(client, publicationId);
  const igTags = normalizeInstagramUsernames(options.igUserTags ?? []);
  const items = await resolveMediaItems(client, pub);
  const kind: PublicationKind = pub.kind ?? kindFromContentTypes(items.map((i) => i.contentType));
  const at = new Date().toISOString();

  const settled = await Promise.all(
    targets.map(async ({ key, caption }): Promise<{ key: SocialTargetKey; entry?: SocialPublishTarget; error?: string; warning?: string }> => {
      const target = SOCIAL_TARGETS.find((t) => t.key === key);
      const account = target ? getSocialAccountById(target.accountId) : null;
      if (!target || !account) return { key, error: "Compte non configuré (SOCIAL_ACCOUNTS_JSON)." };

      try {
        if (target.plateforme === "INSTAGRAM") {
          if (items.length === 0 && !caption.trim()) throw new Error("Le texte de la publication est vide.");
          // Post texte : Instagram exige un média — on publie un visuel généré à partir du texte.
          // Sinon, Instagram n'accepte que le JPEG : les autres images (PNG, WebP…) passent par la conversion.
          const igItems =
            items.length === 0
              ? [{ url: signedTextCardUrl(caption), kind: "image" as const, contentType: "image/jpeg" }]
              : items.slice(0, 10).map((i) => (i.kind === "image" && !isJpeg(i.contentType) ? { ...i, url: signedJpegUrl(i.url) } : i));
          const publishIg = (userTags?: string[]) =>
            igItems.length > 1
              ? publishInstagramCarousel(account.externalId, account.accessToken, { items: igItems, caption, userTags })
              : publishInstagramMedia(account.externalId, account.accessToken, { url: igItems[0].url, caption, kind: igItems[0].kind, userTags });

          let warning: string | undefined;
          let mediaId: string;
          const tags = igTags.length > 0 && igItems.some((i) => i.kind === "image") ? igTags : undefined;
          try {
            ({ mediaId } = await publishIg(tags));
          } catch (e) {
            if (!tags) throw e;
            // Un compte identifié introuvable/privé fait échouer tout le conteneur : on republie sans
            // identification plutôt que de perdre la publication, et on le signale.
            ({ mediaId } = await publishIg(undefined));
            warning = `identifications ignorées (${e instanceof Error ? e.message : "compte introuvable"})`;
          }
          const mediaType = items.length === 0 ? "text" : igItems.length > 1 ? "gallery" : igItems[0].kind;
          return { key, warning, entry: { published: true, at, by, postId: mediaId, mediaType } };
        }

        if (items.length === 0) {
          if (!caption.trim()) throw new Error("Le texte de la publication est vide.");
          const { postId } = await publishFacebookText(account.externalId, account.accessToken, { message: caption });
          return { key, entry: { published: true, at, by, postId, mediaType: "text" } };
        }
        if (items.length > 1) {
          if (items.some((i) => i.kind === "video")) throw new Error("Une galerie Facebook ne peut contenir que des photos.");
          const { postId } = await publishFacebookGallery(account.externalId, account.accessToken, { urls: items.map((i) => i.url), message: caption });
          return { key, entry: { published: true, at, by, postId, mediaType: "gallery" } };
        }
        if (items[0].kind === "video") {
          const { videoId } = await publishFacebookVideo(account.externalId, account.accessToken, { fileUrl: items[0].url, description: caption });
          return { key, entry: { published: true, at, by, videoId, mediaType: "video" } };
        }
        const { postId } = await publishFacebookPhoto(account.externalId, account.accessToken, { url: items[0].url, caption });
        return { key, entry: { published: true, at, by, postId, mediaType: "image" } };
      } catch (e) {
        return { key, error: e instanceof Error ? e.message : "Erreur inattendue." };
      }
    })
  );

  if (kind !== pub.kind) await client.from("media_publications").update({ kind }).eq("id", pub.id);

  const successes = settled.filter((s) => s.entry);
  if (successes.length > 0) {
    await savePublishInfo(client, pub, (current) => successes.reduce((acc, s) => withNetworkEntry(acc, s.key, s.entry!), current));
  }
  return settled.map((s) => ({ key: s.key, ok: !!s.entry, error: s.error, warning: s.warning }));
}

/* ---------- YouTube (Edge Function youtube-manage) ---------- */

async function invokeYoutube<T>(client: Client, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke("youtube-manage", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error(detail?.error ?? error.message);
  }
  if (data?.success === false) throw new Error(data.error ?? "Erreur YouTube.");
  return data as T;
}

/**
 * Publication YouTube côté serveur — utilisée par le cron des publications programmées (en
 * interactif, le navigateur appelle publish-youtube directement, sans limite de durée Vercel).
 */
export async function publishPublicationToYoutubeServer(client: Client, publicationId: string, by: By): Promise<SocialPublishResult> {
  try {
    const pub = await loadPublication(client, publicationId);
    const video = (await resolveMediaItems(client, pub)).find((i) => i.kind === "video");
    if (!video) throw new Error("Aucune vidéo à publier sur YouTube.");
    const title = pub.events?.title ?? pub.title ?? "Vidéo LGEF";

    const { data, error } = await client.functions.invoke("publish-youtube", {
      body: { videoUrl: video.url, title, description: pub.caption ?? "" },
    });
    if (error || !data?.success) throw new Error(data?.error ?? error?.message ?? "Échec de la publication YouTube.");

    const videoId = data.youtube?.videoId as string | undefined;
    await savePublishInfo(client, pub, (current) =>
      withNetworkEntry(current, "youtube", {
        published: true,
        at: new Date().toISOString(),
        by,
        videoId,
        mediaType: "video",
        permalink: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
      })
    );
    return { key: "youtube", ok: true };
  } catch (e) {
    return { key: "youtube", ok: false, error: e instanceof Error ? e.message : "Erreur inattendue." };
  }
}

/* ---------- Statistiques ---------- */

async function fetchMetaStats(
  client: Client,
  pub: PublicationRow,
  key: SocialTargetKey,
  entry: SocialPublishTarget
): Promise<SocialPublishTarget | null> {
  const target = SOCIAL_TARGETS.find((t) => t.key === key)!;
  const account = getSocialAccountById(target.accountId);
  if (!account) return null;

  let next = entry;
  // Publications de l'ancienne Edge Function : pas d'id enregistré — on retrouve la vidéo par sa date.
  if (target.plateforme === "FACEBOOK" && !next.videoId && !next.postId && next.at) {
    const [file] = await loadEventFiles(client, allFileIds(pub).slice(0, 1));
    if (!file || !(file.content_type ?? "").startsWith("video")) return null;
    const videoId = await findFacebookVideoNear(account.externalId, account.accessToken, next.at);
    if (!videoId) return null;
    next = { ...next, videoId, mediaType: "video" };
  }

  let result: StatsResult;
  if (target.plateforme === "INSTAGRAM") {
    if (!next.postId) return null;
    result = await getInstagramStats(next.postId, account.accessToken);
  } else if (next.videoId) {
    result = await getFacebookVideoStats(account.externalId, next.videoId, account.accessToken);
  } else if (next.postId) {
    result = await getFacebookPostStats(next.postId, account.accessToken);
  } else {
    return null;
  }
  return { ...next, stats: result.stats, permalink: result.permalink ?? next.permalink };
}

/**
 * Rafraîchit les stats de chaque réseau des publications données et les fige dans publish_info
 * (affichage instantané ensuite). Une stat illisible ne bloque pas les autres — on garde l'ancienne.
 */
export async function refreshPublicationStats(client: Client, publicationIds: string[]): Promise<{ updated: number; youtubeError?: string }> {
  const pubs = (await Promise.all(publicationIds.slice(0, 50).map((id) => loadPublication(client, id).catch(() => null)))).filter(
    (p): p is PublicationRow => !!p
  );

  // YouTube : un seul appel groupé pour toutes les vidéos.
  const ytIds = pubs.map((p) => p.publish_info?.youtube?.videoId).filter((id): id is string => !!id);
  let ytStats: Record<string, { views: number; likes: number; comments: number }> = {};
  let youtubeError: string | undefined;
  if (ytIds.length > 0) {
    try {
      ytStats = (await invokeYoutube<{ stats: typeof ytStats }>(client, { action: "stats", videoIds: ytIds })).stats ?? {};
    } catch (e) {
      youtubeError = e instanceof Error ? e.message : "Stats YouTube indisponibles.";
      console.error("[publisher.refreshPublicationStats] youtube", e);
    }
  }

  let updated = 0;
  await Promise.all(
    pubs.map(async (pub) => {
      const info = pub.publish_info ?? {};
      const changes: { key: NetworkKey; entry: SocialPublishTarget }[] = [];

      const yt = info.youtube;
      if (yt?.published && yt.videoId && ytStats[yt.videoId]) {
        changes.push({
          key: "youtube",
          entry: {
            ...yt,
            stats: { ...ytStats[yt.videoId], fetchedAt: new Date().toISOString() },
            permalink: `https://www.youtube.com/watch?v=${yt.videoId}`,
          },
        });
      }

      await Promise.all(
        SOCIAL_TARGETS.map(async ({ key }) => {
          const entry = getNetworkEntry(info, key);
          if (!entry?.published) return;
          try {
            const next = await fetchMetaStats(client, pub, key, entry);
            if (next) changes.push({ key, entry: next });
          } catch (e) {
            console.error(`[publisher.refreshPublicationStats] ${pub.id}/${key}`, e);
          }
        })
      );

      if (changes.length === 0) return;
      await savePublishInfo(client, pub, (current) =>
        changes.reduce((acc, c) => withNetworkEntry(acc, c.key, { ...getNetworkEntry(acc, c.key), ...c.entry }), current)
      );
      updated += changes.length;
    })
  );

  return { updated, youtubeError };
}

/* ---------- Commentaires ---------- */

function metaTarget(key: SocialTargetKey) {
  const target = SOCIAL_TARGETS.find((t) => t.key === key);
  const account = target ? getSocialAccountById(target.accountId) : null;
  if (!target || !account) throw new Error("Compte non configuré.");
  return { target, account };
}

export async function listPublicationComments(client: Client, publicationId: string, key: NetworkKey): Promise<SocialComment[]> {
  const pub = await loadPublication(client, publicationId);
  const entry = getNetworkEntry(pub.publish_info, key);
  if (key === "youtube") {
    if (!entry?.videoId) throw new Error("Vidéo YouTube introuvable.");
    return (await invokeYoutube<{ comments: SocialComment[] }>(client, { action: "comments", videoId: entry.videoId })).comments ?? [];
  }
  const objectId = entry?.videoId ?? entry?.postId;
  if (!objectId) throw new Error("Publication introuvable sur le réseau — rafraîchissez les stats.");
  const { target, account } = metaTarget(key);
  return target.plateforme === "FACEBOOK"
    ? getFacebookComments(objectId, account.accessToken)
    : getInstagramComments(objectId, account.accessToken);
}

export async function deletePublicationComment(client: Client, key: NetworkKey, commentId: string): Promise<void> {
  if (key === "youtube") {
    await invokeYoutube(client, { action: "delete_comment", commentId });
    return;
  }
  const { account } = metaTarget(key);
  await deleteComment(commentId, account.accessToken);
}

/* ---------- Suppression sur les réseaux ---------- */

/**
 * Supprime la publication sur les réseaux demandés (irréversible) et retire les entrées
 * correspondantes de publish_info. Les réseaux non supprimés (échec) restent affichés.
 */
export async function deletePublicationPosts(client: Client, publicationId: string, keys: NetworkKey[]): Promise<SocialPublishResult[]> {
  const pub = await loadPublication(client, publicationId);
  const info = pub.publish_info ?? {};

  const results = await Promise.all(
    keys.map(async (key): Promise<SocialPublishResult> => {
      const entry = getNetworkEntry(info, key);
      if (!entry?.published) return { key, ok: true };
      try {
        if (key === "youtube") {
          if (!entry.videoId) throw new Error("Id de la vidéo YouTube inconnu.");
          await invokeYoutube(client, { action: "delete", videoId: entry.videoId });
        } else {
          const objectId = entry.videoId ?? entry.postId;
          if (!objectId) throw new Error("Id de la publication inconnu — rafraîchissez les stats puis réessayez.");
          await deleteGraphObject(objectId, metaTarget(key).account.accessToken);
        }
        return { key, ok: true };
      } catch (e) {
        return { key, ok: false, error: e instanceof Error ? e.message : "Erreur inattendue." };
      }
    })
  );

  const deleted = results.filter((r) => r.ok).map((r) => r.key);
  if (deleted.length > 0) {
    const next = await savePublishInfo(client, pub, (current) => deleted.reduce((acc, key) => withNetworkEntry(acc, key, undefined), current));
    // Plus en ligne nulle part : la publication quitte « Publiés » et revient dans « À publier ».
    if (!NETWORK_KEYS.some((k) => getNetworkEntry(next, k)?.published)) {
      await client.from("media_publications").update({ status: "to_publish", published_at: null }).eq("id", pub.id);
    }
  }
  return results;
}
