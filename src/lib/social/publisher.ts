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
  createInstagramContainers,
  advanceInstagramPublish,
  replyToComment,
  editFacebookPost,
  getFacebookVideoStats,
  getFacebookPostStats,
  getInstagramStats,
  findFacebookVideoNear,
  getFacebookComments,
  getInstagramComments,
  deleteComment,
  deleteGraphObject,
  setCommentHidden,
  getInstagramPermalink,
  type StatsResult,
  lookupInstagramAccount,
} from "@/lib/social/graph";
import {
  SOCIAL_TARGETS,
  NETWORK_KEYS,
  getNetworkEntry,
  withNetworkEntry,
  kindFromContentTypes,
  normalizeInstagramUsernames,
  withFacebookMentions,
  type FacebookMention,
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

/** Attente maximale du traitement Instagram dans la requête de publication (maxDuration : 60 s). */
const INSTAGRAM_BUDGET_MS = 30_000;

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

/* ---------- Texte Facebook ---------- */

const igNames = new Map<string, string | null>();

/**
 * Facebook ne comprend pas les @comptes Instagram (le texte est commun à tous les réseaux) : chaque
 * @compte est remplacé par le nom du compte, lu sur Instagram (« @fcmetz » → « FC Metz »). Un compte
 * introuvable ou personnel reste tel quel. Une fois les mentions de Pages autorisées par Meta, ce
 * nom pourra devenir une vraie mention Facebook.
 */
export async function instagramHandlesToNames(text: string): Promise<string> {
  const re = /(^|[\s(«"'’])@([A-Za-z0-9._]{2,30})/g;
  const handles = [...new Set([...text.matchAll(re)].map((m) => m[2].replace(/\.+$/, "").toLowerCase()))];
  if (handles.length === 0) return text;
  const target = SOCIAL_TARGETS.find((t) => t.plateforme === "INSTAGRAM");
  const account = target ? getSocialAccountById(target.accountId) : null;
  if (!account) return text;
  await Promise.all(
    handles
      .filter((h) => !igNames.has(h))
      .map(async (h) => {
        const profile = await lookupInstagramAccount(account.externalId, account.accessToken, h).catch(() => undefined);
        // Erreur passagère (undefined) : pas mise en cache, retentée à la prochaine publication.
        if (profile !== undefined) igNames.set(h, profile?.name?.trim() || null);
      })
  );
  return text.replace(re, (whole, before: string, raw: string) => {
    const handle = raw.replace(/\.+$/, "");
    const name = igNames.get(handle.toLowerCase());
    return name ? `${before}${name}${raw.slice(handle.length)}` : whole;
  });
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
  options: { igUserTags?: string[]; fbMentions?: FacebookMention[] } = {}
): Promise<SocialPublishResult[]> {
  const pub = await loadPublication(client, publicationId);
  const igTags = normalizeInstagramUsernames(options.igUserTags ?? []);
  const fbMessage = async (caption: string) => withFacebookMentions(await instagramHandlesToNames(caption), options.fbMentions);
  const items = await resolveMediaItems(client, pub);
  const kind: PublicationKind = pub.kind ?? kindFromContentTypes(items.map((i) => i.contentType));
  const at = new Date().toISOString();

  const settled = await Promise.all(
    targets.map(async ({ key, caption }): Promise<{ key: SocialTargetKey; entry?: SocialPublishTarget; error?: string; warning?: string; pending?: boolean }> => {
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
          const publishIg = async (userTags?: string[]) => {
            const pending = await createInstagramContainers(account.externalId, account.accessToken, { items: igItems, caption, userTags });
            return advanceInstagramPublish(account.externalId, account.accessToken, pending, INSTAGRAM_BUDGET_MS);
          };

          let warning: string | undefined;
          let outcome: Awaited<ReturnType<typeof publishIg>>;
          const tags = igTags.length > 0 && igItems.some((i) => i.kind === "image") ? igTags : undefined;
          try {
            outcome = await publishIg(tags);
          } catch (e) {
            if (!tags) throw e;
            // Un compte identifié introuvable/privé fait échouer tout le conteneur : on republie sans
            // identification plutôt que de perdre la publication, et on le signale.
            outcome = await publishIg(undefined);
            warning = `identifications ignorées (${e instanceof Error ? e.message : "compte introuvable"})`;
          }
          const mediaType = items.length === 0 ? "text" : igItems.length > 1 ? "gallery" : igItems[0].kind;
          if ("pending" in outcome) {
            // Reel encore en traitement chez Meta : mis en ligne plus tard (finishPendingInstagram).
            return { key, warning, pending: true, entry: { published: false, at, by, mediaType, pending: outcome.pending } };
          }
          // Lien public tout de suite (pour ouvrir/partager la publication depuis le board).
          const permalink = await getInstagramPermalink(outcome.mediaId, account.accessToken).catch(() => undefined);
          return { key, warning, entry: { published: true, at, by, postId: outcome.mediaId, mediaType, permalink } };
        }

        if (items.length === 0) {
          if (!caption.trim()) throw new Error("Le texte de la publication est vide.");
          const { postId } = await publishFacebookText(account.externalId, account.accessToken, { message: await fbMessage(caption) });
          return { key, entry: { published: true, at, by, postId, mediaType: "text" } };
        }
        if (items.length > 1) {
          if (items.some((i) => i.kind === "video")) throw new Error("Une galerie Facebook ne peut contenir que des photos.");
          const { postId } = await publishFacebookGallery(account.externalId, account.accessToken, { urls: items.map((i) => i.url), message: await fbMessage(caption) });
          return { key, entry: { published: true, at, by, postId, mediaType: "gallery" } };
        }
        if (items[0].kind === "video") {
          const { videoId } = await publishFacebookVideo(account.externalId, account.accessToken, { fileUrl: items[0].url, description: await fbMessage(caption) });
          return { key, entry: { published: true, at, by, videoId, mediaType: "video" } };
        }
        const { postId } = await publishFacebookPhoto(account.externalId, account.accessToken, { url: items[0].url, caption: await fbMessage(caption) });
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
  return settled.map((s) => ({ key: s.key, ok: !!s.entry, error: s.error, warning: s.warning, pending: s.pending }));
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

/** Commentaires d'une publication sur un réseau, lus en direct sur la plateforme. */
export async function listNetworkComments(client: Client, key: NetworkKey, entry: SocialPublishTarget | undefined): Promise<SocialComment[]> {
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

export async function listPublicationComments(client: Client, publicationId: string, key: NetworkKey): Promise<SocialComment[]> {
  const pub = await loadPublication(client, publicationId);
  return listNetworkComments(client, key, getNetworkEntry(pub.publish_info, key));
}

/** Masque (retire de la vue publique) ou rétablit un commentaire — YouTube : « retenu pour examen ». */
export async function setNetworkCommentHidden(client: Client, key: NetworkKey, commentId: string, hidden: boolean): Promise<void> {
  if (key === "youtube") {
    await invokeYoutube(client, { action: "moderate_comment", commentId, status: hidden ? "heldForReview" : "published" });
    return;
  }
  const { target, account } = metaTarget(key);
  await setCommentHidden(target.plateforme, commentId, hidden, account.accessToken);
}

export async function deletePublicationComment(client: Client, key: NetworkKey, commentId: string): Promise<void> {
  if (key === "youtube") {
    await invokeYoutube(client, { action: "delete_comment", commentId });
    return;
  }
  const { account } = metaTarget(key);
  try {
    await deleteComment(commentId, account.accessToken);
  } catch (e) {
    // Déjà retiré sur la plateforme (par son auteur, le filtre anti-spam d'Instagram, ou à la main) :
    // le but est atteint. Meta renvoie alors « does not exist, cannot be loaded… » (code 100).
    if (e instanceof Error && /does not exist|not found|cannot be loaded/i.test(e.message)) return;
    throw e;
  }
}

/** Répond à un commentaire au nom de la page / du compte (YouTube non géré : Edge Function sans cette action). */
export async function replyToPublicationComment(key: NetworkKey, comment: { id: string; parentId?: string }, message: string): Promise<{ id: string }> {
  if (key === "youtube") throw new Error("Répondre sur YouTube n'est pas encore possible depuis le board.");
  if (!message.trim()) throw new Error("La réponse est vide.");
  const { target, account } = metaTarget(key);
  // Instagram n'accepte une réponse que sur un commentaire de premier niveau.
  const replyTo = target.plateforme === "INSTAGRAM" && comment.parentId ? comment.parentId : comment.id;
  return replyToComment(target.plateforme, replyTo, message.trim(), account.accessToken);
}

/* ---------- Instagram : mise en ligne différée ---------- */

/**
 * Termine les publications Instagram restées en traitement chez Meta (Reels surtout) : appelé par
 * le board (après une publication, à l'ouverture de « Publiés ») et par le cron toutes les 5 min.
 * `budgetMs` : attente maximale partagée entre les publications de l'appel.
 */
export async function finishPendingInstagram(client: Client, publicationIds: string[], budgetMs = 20_000): Promise<{ key: "instagram"; id: string; state: "published" | "pending" | "failed"; error?: string }[]> {
  const { account } = metaTarget("instagram");
  const deadline = Date.now() + budgetMs;
  const out: { key: "instagram"; id: string; state: "published" | "pending" | "failed"; error?: string }[] = [];

  for (const id of publicationIds.slice(0, 10)) {
    const pub = await loadPublication(client, id).catch(() => null);
    const entry = pub?.publish_info?.instagram;
    if (!pub || !entry?.pending) continue;
    try {
      const outcome = await advanceInstagramPublish(account.externalId, account.accessToken, entry.pending, Math.max(0, deadline - Date.now()));
      if ("pending" in outcome) {
        if (outcome.pending.stage !== entry.pending.stage) {
          await savePublishInfo(client, pub, (current) => withNetworkEntry(current, "instagram", { ...current.instagram!, pending: outcome.pending }));
        }
        out.push({ key: "instagram", id, state: "pending" });
        continue;
      }
      const permalink = await getInstagramPermalink(outcome.mediaId, account.accessToken).catch(() => undefined);
      await savePublishInfo(client, pub, (current) =>
        withNetworkEntry(current, "instagram", {
          ...current.instagram,
          published: true,
          at: new Date().toISOString(),
          postId: outcome.mediaId,
          permalink,
          pending: undefined,
        })
      );
      out.push({ key: "instagram", id, state: "published" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inattendue.";
      const next = await savePublishInfo(client, pub, (current) => ({
        ...withNetworkEntry(current, "instagram", undefined),
        lastError: { at: new Date().toISOString(), message: `Instagram : ${message}` },
      }));
      // Instagram était le seul réseau : la publication revient dans « À publier ».
      if (!NETWORK_KEYS.some((k) => getNetworkEntry(next, k)?.published)) {
        await client.from("media_publications").update({ status: "to_publish", published_at: null }).eq("id", pub.id);
      }
      out.push({ key: "instagram", id, state: "failed", error: message });
    }
  }
  return out;
}

/* ---------- Modification du texte ---------- */

/**
 * Remplace le texte d'une publication déjà en ligne sur les pages Facebook demandées (mentions de
 * Pages comprises) et dans le board. Instagram et YouTube ne sont pas modifiables d'ici.
 */
export async function editPublicationCaption(client: Client, publicationId: string, keys: NetworkKey[], caption: string): Promise<SocialPublishResult[]> {
  const pub = await loadPublication(client, publicationId);
  const mentions = (pub.targets as { fbMentions?: FacebookMention[] } | null)?.fbMentions;
  const results = await Promise.all(
    keys.map(async (key): Promise<SocialPublishResult> => {
      const entry = getNetworkEntry(pub.publish_info, key);
      const target = SOCIAL_TARGETS.find((t) => t.key === key);
      if (!entry?.published || target?.plateforme !== "FACEBOOK") return { key, ok: false, error: "non modifiable depuis le board." };
      try {
        await editFacebookPost(entry, withFacebookMentions(await instagramHandlesToNames(caption), mentions), metaTarget(key as SocialTargetKey).account.accessToken);
        return { key, ok: true };
      } catch (e) {
        return { key, ok: false, error: e instanceof Error ? e.message : "Erreur inattendue." };
      }
    })
  );
  if (results.some((r) => r.ok)) await client.from("media_publications").update({ caption }).eq("id", pub.id);
  return results;
}

/* ---------- Suppression sur les réseaux ---------- */

/** Traduit les erreurs techniques connues en consigne compréhensible. */
function friendlyNetworkError(key: NetworkKey, message: string): string {
  if (key === "youtube" && /insufficient authentication scopes/i.test(message)) {
    return "le jeton YouTube n'a pas encore les droits de gestion (youtube.force-ssl) — à régénérer, puis réessayer.";
  }
  if (key === "instagram" && /permission/i.test(message)) {
    return "le token Instagram n'a pas le droit de supprimer (instagram_manage_contents) — supprimez le post dans l'app Instagram.";
  }
  return message;
}

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
        const message = e instanceof Error ? e.message : "Erreur inattendue.";
        // Déjà supprimé sur la plateforme (à la main, par exemple) : le but est atteint.
        if (/does not exist|not found|videoNotFound|cannot be loaded/i.test(message)) return { key, ok: true };
        return { key, ok: false, error: friendlyNetworkError(key, message) };
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
