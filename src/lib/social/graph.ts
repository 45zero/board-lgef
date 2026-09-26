import "server-only";
import type { SocialComment, SocialStats } from "@/lib/social/targets";

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
  const photoIds: string[] = [];
  for (const url of urls) {
    const photo = await graphFetch(`/${pageId}/photos`, { url, published: "false", access_token: accessToken }, "POST");
    photoIds.push(String(photo.id));
  }
  const params: Record<string, string> = { message, access_token: accessToken };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const body = await graphFetch(`/${pageId}/feed`, params, "POST");
  return { postId: String(body.id) };
}

/** Supprime un post, une vidéo ou un média (Facebook comme Instagram — même appel Graph). */
export async function deleteGraphObject(objectId: string, accessToken: string): Promise<void> {
  await graphFetch(`/${objectId}`, { access_token: accessToken }, "DELETE");
}

// Une image se traite en quelques secondes ; une vidéo (Reel) de 30s à 2min côté Meta. Le budget
// vidéo (6 × 8s) tient sous le maxDuration de 60s déclaré sur src/app/page.tsx.
const INSTAGRAM_IMAGE_POLL = { attempts: 5, delayMs: 1500 };
const INSTAGRAM_VIDEO_POLL = { attempts: 6, delayMs: 8000 };

async function waitForInstagramContainer(containerId: string, accessToken: string, { attempts, delayMs }: { attempts: number; delayMs: number }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const body = await graphFetch(`/${containerId}`, { fields: "status_code", access_token: accessToken });
    if (body.status_code === "FINISHED") return;
    if (body.status_code === "ERROR") throw new Error("Le traitement du média Instagram a échoué (format non supporté ?).");
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("Le média Instagram n'a pas terminé son traitement à temps — réessayez, ou utilisez un fichier plus court.");
}

/** Image (JPEG) ou Reel sur le compte Instagram pro — mécanique conteneur → attente → media_publish. */
export async function publishInstagramMedia(
  igUserId: string,
  accessToken: string,
  { url, caption, kind }: { url: string; caption: string; kind: "image" | "video" }
) {
  const params: Record<string, string> =
    kind === "video"
      ? { media_type: "REELS", video_url: url, caption, access_token: accessToken }
      : { image_url: url, caption, access_token: accessToken };
  const container = await graphFetch(`/${igUserId}/media`, params, "POST");
  const containerId = String(container.id);

  await waitForInstagramContainer(containerId, accessToken, kind === "video" ? INSTAGRAM_VIDEO_POLL : INSTAGRAM_IMAGE_POLL);

  const published = await graphFetch(`/${igUserId}/media_publish`, { creation_id: containerId, access_token: accessToken }, "POST");
  return { mediaId: String(published.id) };
}

/**
 * Carrousel Instagram (2 à 10 médias, photos JPEG et/ou vidéos) : un conteneur enfant par média,
 * puis un conteneur CAROUSEL qui les regroupe avec la légende, puis media_publish.
 */
export async function publishInstagramCarousel(
  igUserId: string,
  accessToken: string,
  { items, caption }: { items: { url: string; kind: "image" | "video" }[]; caption: string }
) {
  if (items.length < 2 || items.length > 10) throw new Error("Un carrousel Instagram contient de 2 à 10 médias.");

  const children: string[] = [];
  for (const item of items) {
    const params: Record<string, string> =
      item.kind === "video"
        ? { media_type: "VIDEO", video_url: item.url, is_carousel_item: "true", access_token: accessToken }
        : { image_url: item.url, is_carousel_item: "true", access_token: accessToken };
    const child = await graphFetch(`/${igUserId}/media`, params, "POST");
    children.push(String(child.id));
  }
  const hasVideo = items.some((i) => i.kind === "video");
  await Promise.all(
    children.map((id) => waitForInstagramContainer(id, accessToken, hasVideo ? INSTAGRAM_VIDEO_POLL : INSTAGRAM_IMAGE_POLL))
  );

  const container = await graphFetch(
    `/${igUserId}/media`,
    { media_type: "CAROUSEL", children: children.join(","), caption, access_token: accessToken },
    "POST"
  );
  await waitForInstagramContainer(String(container.id), accessToken, INSTAGRAM_IMAGE_POLL);

  const published = await graphFetch(`/${igUserId}/media_publish`, { creation_id: String(container.id), access_token: accessToken }, "POST");
  return { mediaId: String(published.id) };
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
  return {
    stats: {
      likes: summaryCount(post.reactions),
      comments: summaryCount(post.comments),
      shares: Number((post.shares as { count?: number } | undefined)?.count ?? 0),
      fetchedAt: new Date().toISOString(),
    },
    permalink: typeof post.permalink_url === "string" ? post.permalink_url : undefined,
  };
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

/** Commentaires lus en direct (jamais stockés) — `objectId` = id de vidéo ou de post Facebook. */
export async function getFacebookComments(objectId: string, accessToken: string): Promise<SocialComment[]> {
  const body = await graphFetch(`/${objectId}/comments`, {
    fields: "id,message,from{name},created_time",
    limit: "50",
    order: "reverse_chronological",
    access_token: accessToken,
  });
  const data = (body.data as { id: string; message?: string; from?: { name?: string }; created_time?: string }[] | undefined) ?? [];
  return data.map((c) => ({ id: c.id, author: c.from?.name ?? "Anonyme", text: c.message ?? "", createdAt: c.created_time ?? "" }));
}

export async function getInstagramComments(mediaId: string, accessToken: string): Promise<SocialComment[]> {
  const body = await graphFetch(`/${mediaId}/comments`, { fields: "id,text,username,timestamp", limit: "50", access_token: accessToken });
  const data = (body.data as { id: string; text?: string; username?: string; timestamp?: string }[] | undefined) ?? [];
  return data.map((c) => ({ id: c.id, author: c.username ?? "Anonyme", text: c.text ?? "", createdAt: c.timestamp ?? "" }));
}

/** Supprime un commentaire (Facebook ou Instagram, même appel) — irréversible. */
export async function deleteComment(commentId: string, accessToken: string): Promise<void> {
  await graphFetch(`/${commentId}`, { access_token: accessToken }, "DELETE");
}
