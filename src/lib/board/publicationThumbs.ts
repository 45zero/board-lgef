import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { signMediaStreamToken } from "@/lib/board/mediaStreamToken";
import { getNetworkEntry, NETWORK_KEYS, type PublishInfo, type StandaloneMedia } from "@/lib/social/targets";

// Miniature et vues d'une publication du centre (accueil : « Médias à publier », « Derniers médias
// publiés ») : premier média — Drive ou photo du stockage (miniature 480 px via /api/media/thumb),
// sinon vidéo YouTube.

type Service = ReturnType<typeof createServiceClient>;
export type PubForThumb = { id: string; file_ids: string[] | null; media: unknown; publish_info: unknown; media_purged_at?: string | null };

/** Miniature signée jusqu'au lendemain (même URL toute la journée : le cache navigateur sert). */
function signedThumb(param: "f" | "p", value: string) {
  const expiresAt = Math.ceil(Date.now() / 86_400_000 + 1) * 86_400_000;
  const key = param === "p" ? `p:${value}` : value;
  return `/api/media/thumb?${param}=${encodeURIComponent(value)}&e=${expiresAt}&s=${signMediaStreamToken(`thumb:${key}`, expiresAt)}`;
}

export async function publicationThumbs(service: Service, pubs: PubForThumb[]): Promise<Map<string, string | null>> {
  const firstIds = pubs.map((p) => p.file_ids?.[0]).filter((id): id is string => !!id);
  const { data: files } = firstIds.length
    ? await service.from("event_files").select("id, storage_provider, path, drive_file_id, content_type, drive_purged_at").in("id", firstIds)
    : { data: [] };
  const fileBy = new Map((files ?? []).map((f) => [f.id, f]));
  const out = new Map<string, string | null>();
  for (const p of pubs) {
    const file = p.file_ids?.[0] ? fileBy.get(p.file_ids[0]) : undefined;
    const media = (p.media as StandaloneMedia[] | null)?.[0];
    const youtubeId = getNetworkEntry(p.publish_info as PublishInfo | null, "youtube")?.videoId;
    let url: string | null = null;
    // Retiré du Drive après publication : plus de miniature Drive (YouTube ou icône à la place).
    if (file?.drive_purged_at) url = youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null;
    else if (file?.storage_provider === "drive" && file.drive_file_id) url = signedThumb("f", file.drive_file_id);
    // Photo du stockage : réduite à 480 px par la route (l'original pèse souvent plusieurs Mo).
    else if (file?.path && (file.content_type ?? "").startsWith("image")) url = signedThumb("p", file.path);
    else if (media?.drive_file_id && !p.media_purged_at) url = signedThumb("f", media.drive_file_id);
    else if (youtubeId) url = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
    out.set(p.id, url);
  }
  return out;
}

/** Vues cumulées sur tous les réseaux (dernier relevé des statistiques) ; null si aucune n'est connue. */
export function totalViews(info: unknown): number | null {
  let total: number | null = null;
  for (const k of NETWORK_KEYS) {
    const views = getNetworkEntry(info as PublishInfo | null, k)?.stats?.views;
    if (typeof views === "number") total = (total ?? 0) + views;
  }
  return total;
}
