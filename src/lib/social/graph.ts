import "server-only";
import type { InstagramPending, SocialComment, SocialStats } from "@/lib/social/targets";

// Graph API v25.0 — même version et mêmes tokens de page que le projet IR2F (voir
// ir2f/src/lib/social/graph.ts). Vérifié en réel sur la page Lorraine (septembre 2026) :
// - une vidéo publiée via /{page}/videos n'expose PAS `reactions`/`shares` sur son propre nœud,
//   mais `views`, `likes`, `comments` et `post_id` ; réactions et partages se lisent sur le post
//   `{pageId}_{post_id}` ;
// - /{post}/insights (post_media_view…) revient vide pour une vidéo/reel et /video_insights exige
//   read_insights (non accordé) — d'où `views` lu directement sur le nœud vidéo, sans portée.
const GRAPH_API_BASE = "https://graph.facebook.com/v25.0";

type GraphErrorBody = { error?: { message?: string; code?: number } };

async function graphFetch(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" | "DELETE" = "GET"
): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH_API_BASE}${path}`);
  let body: URLSearchParams | undefined;
  if (method === "POST") {
    // Corps de formulaire plutôt que query string : une légende longue ferait exploser l'URL.
    body = new URLSearchParams(params);
  } else {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), { method, body, cache: "no-store" });
  const json = (await res.json()) as GraphErrorBody & Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Échec de la requête Graph API (${res.status}).`);
  }
  return json;
}

const PHOTO_UPLOAD_CONCURRENCY = 8;

/** map asynchrone limitée à `limit` appels simultanés, résultats dans l'ordre d'entrée. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function summaryCount(edge: unknown): number {
  return Number((edge as { summary?: { total_count?: number } } | undefined)?.summary?.total_count ?? 0);
}

/* ---------- Publication ---------- */

/** Vidéo native sur une page Facebook — `fileUrl` doit être accessible publiquement (lien signé du board). Renvoie l'id de la VIDÉO (pas du post). */
export async function publishFacebookVideo(pageId: string, accessToken: string, { fileUrl, description }: { fileUrl: string; description: string }) {
  const body = await graphFetch(`/${pageId}/videos`, { file_url: fileUrl, description, published: "true", access_token: accessToken }, "POST");
  return { videoId: String(body.id) };
}

/** Photo native sur une page Facebook. /photos renvoie post_id (le post du fil, celui qui porte les stats) en plus de l'id de la photo. */
export async function publishFacebookPhoto(pageId: string, accessToken: string, { url, caption }: { url: string; caption: string }) {
  const body = await graphFetch(`/${pageId}/photos`, { url, caption, access_token: accessToken }, "POST");
  return { postId: String(body.post_id ?? body.id) };
}

/** Post texte seul sur le fil d'une page Facebook. */
export async function publishFacebookText(pageId: string, accessToken: string, { message }: { message: string }) {
  const body = await graphFetch(`/${pageId}/feed`, { message, access_token: accessToken }, "POST");
  return { postId: String(body.id) };
}

/**
 * Galerie photo sur une page Facebook : chaque photo est d'abord envoyée non publiée, puis un seul
 * post du fil les rattache (attached_media) — c'est ce qui donne un vrai album dans le fil plutôt
 * que N posts séparés. Facebook n'accepte pas de vidéo dans attached_media.
 */
export async function publishFacebookGallery(pageId: string, accessToken: string, { urls, message }: { urls: string[]; message: string }) {
  // Envois en parallèle (ordre de l'album conservé) : un par un, chaque photo attend que Meta
  // la télécharge (~1-2 s) et un album de 60 photos dépassait les 60 s de la fonction Vercel.
  const photoIds = await mapPool(urls, PHOTO_UPLOAD_CONCURRENCY, async (url) => {
    const photo = await graphFetch(`/${pageId}/photos`, { url, published: "false", access_token: accessToken }, "POST");
    return String(photo.id);
  });
  const params: Record<string, string> = { message, access_token: accessToken };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const body = await graphFetch(`/${pageId}/feed`, params, "POST");
  return { postId: String(body.id) };
}

/**
 * Retrouve une Page Facebook à mentionner à partir de ce que l'utilisateur colle : lien
 * (facebook.com/NomDeLaPage, facebook.com/profile.php?id=…), @nom ou identifiant numérique.
 */
export async function resolveFacebookPage(ref: string, accessToken: string): Promise<{ id: string; name: string }> {
  let key = ref.trim().replace(/^@/, "");
  const url = /facebook\.com|fb\.com/i.test(key) ? new URL(key.startsWith("http") ? key : `https://${key}`) : null;
  if (url) {
    key = url.searchParams.get("id") ?? url.pathname.split("/").filter(Boolean).filter((p) => p !== "pg" && p !== "pages")[0] ?? "";
  }
  if (!/^[\w.-]+$/.test(key)) throw new Error("Lien ou identifiant de Page invalide.");
  try {
    const body = await graphFetch(`/${encodeURIComponent(key)}`, { fields: "id,name", access_token: accessToken });
    return { id: String(body.id), name: String(body.name ?? key) };
  } catch (e) {
    // Lire une Page tierce exige « Page Public Metadata Access » (non accordé) : seules nos propres
    // Pages se résolvent par leur nom. Un identifiant numérique suffit pour mentionner (@[id]) —
    // on l'accepte sans pouvoir afficher le nom.
    if (/^\d{6,}$/.test(key)) return { id: key, name: `Page ${key}` };
    throw new Error(
      /permission|feature/i.test(e instanceof Error ? e.message : "")
        ? "Meta ne permet pas de retrouver cette Page par son nom : collez son identifiant numérique (sur la Page : À propos → Transparence de la Page → ID de la Page)."
        : e instanceof Error ? e.message : "Page introuvable."
    );
  }
}

/** Supprime un post, une vidéo ou un média (Facebook comme Instagram — même appel Graph). */
export async function deleteGraphObject(objectId: string, accessToken: string): Promise<void> {
  await graphFetch(`/${objectId}`, { access_token: accessToken }, "DELETE");
}

// Une image se traite en quelques secondes ; une vidéo (Reel) de 30s à plusieurs minutes côté Meta.
// On n'attend donc que brièvement dans la requête : au-delà, les conteneurs sont gardés dans
// publish_info (`pending`) et la publication est terminée plus tard (board ouvert ou cron, voir
// advanceInstagramPublish). Un conteneur Instagram reste publiable 24 h.
const INSTAGRAM_POLL_MS = 4000;

type ContainerStatus = "FINISHED" | "IN_PROGRESS" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** `detail` : explication d'Instagram en cas d'échec (champ `status`, ex. « … 2207026 »). */
async function containerStatus(containerId: string, accessToken: string): Promise<{ code: ContainerStatus; detail?: string }> {
  const body = await graphFetch(`/${containerId}`, { fields: "status_code,status", access_token: accessToken });
  return { code: (body.status_code as ContainerStatus) ?? "IN_PROGRESS", detail: typeof body.status === "string" ? body.status : undefined };
}

/** Message d'échec Instagram : le détail renvoyé par Meta, avec une consigne pour le cas le plus courant (vidéo hors normes). */
function instagramFailure(detail: string | undefined): string {
  const hint = /2207026/.test(detail ?? "")
    ? "vidéo hors normes Instagram : 1920 px max de large, H.264, 60 i/s max — exportez-la en 1080p"
    : "format non supporté ?";
  return `Le traitement du média Instagram a échoué — ${hint}${detail ? ` (${detail})` : ""}.`;
}

/**
 * Identifications de comptes sur une photo Instagram (`user_tags`) : positions réparties sur le bas
 * de l'image (x, y entre 0 et 1) — l'API exige des coordonnées, sans intérêt ici puisque la
 * personne identifiée est notifiée quel que soit l'endroit. Photos uniquement.
 */
function userTagsParam(usernames: string[] | undefined): Record<string, string> {
  if (!usernames?.length) return {};
  const tags = usernames.slice(0, 20).map((username, i) => ({
    username,
    x: Number(((i + 1) / (Math.min(usernames.length, 20) + 1)).toFixed(3)),
    y: 0.9,
  }));
  return { user_tags: JSON.stringify(tags) };
}

/**
 * Première étape d'une publication Instagram : crée le conteneur (photo JPEG ou Reel), ou pour un
 * carrousel (2 à 10 médias) un conteneur enfant par média — le conteneur CAROUSEL qui porte la
 * légende n'est créé qu'une fois les enfants traités.
 */
export async function createInstagramContainers(
  igUserId: string,
  accessToken: string,
  { items, caption, userTags }: { items: { url: string; kind: "image" | "video" }[]; caption: string; userTags?: string[] }
): Promise<InstagramPending> {
  const since = new Date().toISOString();
  if (items.length === 1) {
    const [item] = items;
    const params: Record<string, string> =
      item.kind === "video"
        ? { media_type: "REELS", video_url: item.url, caption, access_token: accessToken }
        : { image_url: item.url, caption, access_token: accessToken, ...userTagsParam(userTags) };
    const container = await graphFetch(`/${igUserId}/media`, params, "POST");
    return { stage: "container", containers: [String(container.id)], caption, since };
  }
  if (items.length < 2 || items.length > 10) throw new Error("Un carrousel Instagram contient de 2 à 10 médias.");

  const children = await mapPool(items, PHOTO_UPLOAD_CONCURRENCY, async (item) => {
    const params: Record<string, string> =
      item.kind === "video"
        ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: "true", access_token: accessToken }
        : { image_url: item.url, is_carousel_item: "true", access_token: accessToken, ...userTagsParam(userTags) };
    const child = await graphFetch(`/${igUserId}/media`, params, "POST");
    return String(child.id);
  });
  return { stage: "children", containers: children, caption, since };
}

/**
 * Fait avancer une publication Instagram en attente, en attendant au plus `budgetMs` : conteneurs
 * traités → (carrousel : création du conteneur CAROUSEL) → media_publish. Renvoie l'id du média
 * publié, ou l'état en attente à reprendre plus tard. Lève une erreur si Instagram a refusé un média.
 */
export async function advanceInstagramPublish(
  igUserId: string,
  accessToken: string,
  pending: InstagramPending,
  budgetMs: number
): Promise<{ mediaId: string } | { pending: InstagramPending }> {
  const deadline = Date.now() + budgetMs;
  let state = pending;
  for (;;) {
    const statuses = await Promise.all(state.containers.map((id) => containerStatus(id, accessToken)));
    const failed = statuses.find((s) => s.code === "ERROR");
    if (failed) throw new Error(instagramFailure(failed.detail));
    if (statuses.some((s) => s.code === "EXPIRED")) throw new Error("Le média Instagram a expiré avant sa mise en ligne (plus de 24 h) — republiez.");

    if (statuses.every((s) => s.code === "FINISHED")) {
      if (state.stage === "children") {
        const container = await graphFetch(
          `/${igUserId}/media`,
          { media_type: "CAROUSEL", children: state.containers.join(","), caption: state.caption, access_token: accessToken },
          "POST"
        );
        state = { ...state, stage: "container", containers: [String(container.id)] };
        continue;
      }
      const published = await graphFetch(`/${igUserId}/media_publish`, { creation_id: state.containers[0], access_token: accessToken }, "POST");
      return { mediaId: String(published.id) };
    }

    if (Date.now() + INSTAGRAM_POLL_MS > deadline) return { pending: state };
    await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_POLL_MS));
  }
}

/** Permalien public d'un média Instagram (non reconstructible à partir de son id). */
export async function getInstagramPermalink(mediaId: string, accessToken: string): Promise<string | undefined> {
  const body = await graphFetch(`/${mediaId}`, { fields: "permalink", access_token: accessToken });
  return typeof body.permalink === "string" ? body.permalink : undefined;
}

/* ---------- Statistiques ---------- */

export type StatsResult = { stats: SocialStats; permalink?: string };

/** Stats d'une vidéo de page Facebook : vues/j'aime/commentaires sur le nœud vidéo, réactions/partages sur le post associé (voir note en tête). */
export async function getFacebookVideoStats(pageId: string, videoId: string, accessToken: string): Promise<StatsResult> {
  const video = await graphFetch(`/${videoId}`, {
    fields: "views,post_id,permalink_url,likes.summary(true).limit(0),comments.summary(true).limit(0)",
    access_token: accessToken,
  });

  const stats: SocialStats = {
    views: Number(video.views ?? 0),
    likes: summaryCount(video.likes),
    comments: summaryCount(video.comments),
    fetchedAt: new Date().toISOString(),
  };

  if (video.post_id) {
    try {
      const post = await graphFetch(`/${pageId}_${video.post_id}`, {
        fields: "reactions.summary(true).limit(0),shares",
        access_token: accessToken,
      });
      // Les réactions (j'aime, j'adore, bravo…) englobent les simples « j'aime » du nœud vidéo.
      stats.likes = Math.max(stats.likes, summaryCount(post.reactions));
      stats.shares = Number((post.shares as { count?: number } | undefined)?.count ?? 0);
    } catch {
      // Les partages sont un bonus : on garde vues/j'aime/commentaires si le post est illisible.
    }
  }

  const permalink = typeof video.permalink_url === "string" ? new URL(video.permalink_url, "https://www.facebook.com").toString() : undefined;
  return { stats, permalink };
}

/** Stats d'un post photo de page Facebook (pas de vues disponibles sans read_insights). */
export async function getFacebookPostStats(postId: string, accessToken: string): Promise<StatsResult> {
  const post = await graphFetch(`/${postId}`, {
    fields: "permalink_url,reactions.summary(true).limit(0),comments.summary(true).limit(0),shares",
    access_token: accessToken,
  });
  const stats: SocialStats = {
    likes: summaryCount(post.reactions),
    comments: summaryCount(post.comments),
    shares: Number((post.shares as { count?: number } | undefined)?.count ?? 0),
    fetchedAt: new Date().toISOString(),
  };
  // Vues/portée d'un post photo/texte/galerie : post_media_view et post_total_media_view_unique
  // (remplaçants de post_impressions depuis juin 2026, cf. IR2F). Meta renvoie parfois une liste
  // vide (post trop récent, reel) — on laisse alors les vues non renseignées plutôt qu'à 0.
  try {
    const insights = await graphFetch(`/${postId}/insights`, {
      metric: "post_media_view,post_total_media_view_unique",
      access_token: accessToken,
    });
    stats.views = extractInsightMetric(insights.data, "post_media_view");
    stats.reach = extractInsightMetric(insights.data, "post_total_media_view_unique");
  } catch {
    // Les vues sont un bonus : réactions/commentaires/partages restent à jour.
  }
  return { stats, permalink: typeof post.permalink_url === "string" ? post.permalink_url : undefined };
}

type InsightMetric = { name?: string; values?: { value?: number }[]; total_value?: { value?: number } };

function extractInsightMetric(data: unknown, name: string): number | undefined {
  const metric = (data as InsightMetric[] | undefined)?.find((m) => m.name === name);
  if (!metric) return undefined;
  if (metric.total_value?.value !== undefined) return Number(metric.total_value.value);
  return Number(metric.values?.[0]?.value ?? 0);
}

/** Stats d'un média Instagram — j'aime/commentaires sur le nœud, vues/portée via /insights (instagram_manage_insights). */
export async function getInstagramStats(mediaId: string, accessToken: string): Promise<StatsResult> {
  const media = await graphFetch(`/${mediaId}`, { fields: "like_count,comments_count,permalink", access_token: accessToken });
  const stats: SocialStats = {
    likes: Number(media.like_count ?? 0),
    comments: Number(media.comments_count ?? 0),
    fetchedAt: new Date().toISOString(),
  };
  try {
    const insights = await graphFetch(`/${mediaId}/insights`, { metric: "views,reach", access_token: accessToken });
    stats.views = extractInsightMetric(insights.data, "views");
    stats.reach = extractInsightMetric(insights.data, "reach");
  } catch {
    // Les insights arrivent parfois avec un délai après publication : on garde j'aime/commentaires.
  }
  return { stats, permalink: typeof media.permalink === "string" ? media.permalink : undefined };
}

/**
 * Retrouve la vidéo publiée par l'ancienne Edge Function (qui ne renvoyait pas l'id) : la plus
 * proche de la date de publication enregistrée, dans une fenêtre de -10 min / +60 min (le
 * traitement d'une vidéo côté Meta peut décaler created_time).
 */
export async function findFacebookVideoNear(pageId: string, accessToken: string, atIso: string): Promise<string | null> {
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return null;
  const since = Math.floor(at / 1000) - 600;
  const until = Math.floor(at / 1000) + 3600;

  const body = await graphFetch(`/${pageId}/videos`, {
    fields: "id,created_time",
    since: String(since),
    until: String(until),
    limit: "25",
    access_token: accessToken,
  });
  const candidates = ((body.data as { id: string; created_time?: string }[] | undefined) ?? [])
    .map((v) => ({ id: v.id, t: Date.parse(v.created_time ?? "") / 1000 }))
    .filter((v) => Number.isFinite(v.t) && v.t >= since && v.t <= until)
    .sort((a, b) => Math.abs(a.t - at / 1000) - Math.abs(b.t - at / 1000));
  return candidates[0]?.id ?? null;
}

/* ---------- Commentaires ---------- */

/** Plafond de sécurité par post (pages de 100) — largement au-dessus du volume d'un post de la Ligue. */
const MAX_COMMENT_PAGES = 20;

/** Suit la pagination Graph (`paging.next`, URL complète déjà signée avec le token). */
async function graphFetchAllPages<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let body = await graphFetch(path, params);
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    items.push(...((body.data as T[] | undefined) ?? []));
    const next = (body.paging as { next?: string } | undefined)?.next;
    if (!next) break;
    const res = await fetch(next, { cache: "no-store" });
    body = (await res.json()) as Record<string, unknown>;
    if (!res.ok || body.error) break;
  }
  return items;
}

/**
 * Tous les commentaires d'un post ou d'une vidéo Facebook, réponses comprises (`filter=stream` :
 * liste à plat, les réponses portent un `parent`) — lus en direct, jamais stockés tels quels.
 */
export async function getFacebookComments(objectId: string, accessToken: string): Promise<SocialComment[]> {
  const data = await graphFetchAllPages<{ id: string; message?: string; from?: { name?: string }; created_time?: string; parent?: { id: string } }>(
    `/${objectId}/comments`,
    { fields: "id,message,from{name},created_time,parent{id}", filter: "stream", order: "reverse_chronological", limit: "100", access_token: accessToken }
  );
  return data.map((c) => ({
    id: c.id,
    author: c.from?.name ?? "Anonyme",
    text: c.message ?? "",
    createdAt: c.created_time ?? "",
    parentId: c.parent?.id,
  }));
}

/** Tous les commentaires d'un média Instagram, réponses comprises (champ `replies` de chaque commentaire). */
export async function getInstagramComments(mediaId: string, accessToken: string): Promise<SocialComment[]> {
  type IgComment = { id: string; text?: string; username?: string; timestamp?: string; replies?: { data?: IgComment[] } };
  const data = await graphFetchAllPages<IgComment>(`/${mediaId}/comments`, {
    fields: "id,text,username,timestamp,replies{id,text,username,timestamp}",
    limit: "100",
    access_token: accessToken,
  });
  const toComment = (c: IgComment, parentId?: string): SocialComment => ({
    id: c.id,
    author: c.username ?? "Anonyme",
    text: c.text ?? "",
    createdAt: c.timestamp ?? "",
    parentId,
  });
  return data.flatMap((c) => [toComment(c), ...(c.replies?.data ?? []).map((r) => toComment(r, c.id))]);
}

/**
 * Masque/démasque un commentaire. Facebook (`is_hidden`, pages_manage_engagement) : invisible du
 * public, toujours visible par son auteur et ses amis, qui ne savent pas qu'il est masqué.
 * Instagram (`hide`, instagram_manage_comments) : même principe.
 */
export async function setCommentHidden(plateforme: "FACEBOOK" | "INSTAGRAM", commentId: string, hidden: boolean, accessToken: string) {
  const params: Record<string, string> = plateforme === "FACEBOOK" ? { is_hidden: String(hidden) } : { hide: String(hidden) };
  await graphFetch(`/${commentId}`, { ...params, access_token: accessToken }, "POST");
}

/** Supprime un commentaire (Facebook ou Instagram, même appel) — irréversible. */
export async function deleteComment(commentId: string, accessToken: string): Promise<void> {
  await graphFetch(`/${commentId}`, { access_token: accessToken }, "DELETE");
}

/**
 * Répond à un commentaire au nom de la page / du compte. Facebook : sous-commentaire
 * (/{comment}/comments). Instagram : /{comment}/replies — uniquement sur un commentaire de premier
 * niveau, d'où `parentId` pour répondre à une réponse (même fil, comme dans l'app).
 */
export async function replyToComment(
  plateforme: "FACEBOOK" | "INSTAGRAM",
  commentId: string,
  message: string,
  accessToken: string
): Promise<{ id: string }> {
  const body =
    plateforme === "FACEBOOK"
      ? await graphFetch(`/${commentId}/comments`, { message, access_token: accessToken }, "POST")
      : await graphFetch(`/${commentId}/replies`, { message, access_token: accessToken }, "POST");
  return { id: String(body.id) };
}

/**
 * Modifie le texte d'une publication Facebook déjà en ligne : `message` d'un post (photo, galerie,
 * texte), `description` d'une vidéo. Instagram n'expose pas la modification de légende dans son API.
 */
export async function editFacebookPost(
  { postId, videoId }: { postId?: string; videoId?: string },
  message: string,
  accessToken: string
): Promise<void> {
  if (videoId) {
    await graphFetch(`/${videoId}`, { description: message, access_token: accessToken }, "POST");
    return;
  }
  if (!postId) throw new Error("Id de la publication inconnu — rafraîchissez les stats puis réessayez.");
  await graphFetch(`/${postId}`, { message, access_token: accessToken }, "POST");
}

/* ---------- Comptes Instagram (identifications, mentions) ---------- */

export type InstagramProfile = { username: string; name: string | null; pictureUrl: string | null; followers: number | null };

/**
 * Compte Instagram professionnel ou créateur, lu par son nom exact (Business Discovery). Instagram
 * n'offre aucune recherche par début de nom : seul un nom complet peut être vérifié. `null` : compte
 * introuvable, ou compte personnel (non lisible par l'API).
 */
export async function lookupInstagramAccount(igUserId: string, accessToken: string, username: string): Promise<InstagramProfile | null> {
  try {
    const json = await graphFetch(`/${igUserId}`, {
      fields: `business_discovery.username(${username}){username,name,profile_picture_url,followers_count}`,
      access_token: accessToken,
    });
    const bd = json.business_discovery as { username: string; name?: string; profile_picture_url?: string; followers_count?: number } | undefined;
    if (!bd) return null;
    return { username: bd.username, name: bd.name ?? null, pictureUrl: bd.profile_picture_url ?? null, followers: bd.followers_count ?? null };
  } catch (e) {
    // 110 / « Cannot find User » : nom inexistant ou compte personnel.
    if (e instanceof Error && /Invalid user id|cannot be found/i.test(e.message)) return null;
    throw e;
  }
}

/** Légendes des dernières publications du compte (pages de 50), avec leur date. */
export async function listInstagramCaptions(igUserId: string, accessToken: string, maxPages = 10): Promise<{ caption: string; timestamp: string }[]> {
  const out: { caption: string; timestamp: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const json = await graphFetch(`/${igUserId}/media`, {
      fields: "caption,timestamp",
      limit: "50",
      access_token: accessToken,
      ...(after ? { after } : {}),
    });
    const data = (json.data as { caption?: string; timestamp?: string }[] | undefined) ?? [];
    for (const m of data) if (m.caption) out.push({ caption: m.caption, timestamp: m.timestamp ?? "" });
    after = (json.paging as { cursors?: { after?: string }; next?: string } | undefined)?.next
      ? (json.paging as { cursors?: { after?: string } }).cursors?.after
      : undefined;
    if (!after) break;
  }
  return out;
}
