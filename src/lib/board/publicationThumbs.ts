import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { signMediaStreamToken } from "@/lib/board/mediaStreamToken";
import { getNetworkEntry, NETWORK_KEYS, type PublishInfo, type StandaloneMedia } from "@/lib/social/targets";

// Miniature et vues d'une publication du centre (accueil : « Médias à publier », « Derniers médias
// publiés ») : premier média — Drive (miniature Google via /api/media/thumb), Storage (URL signée)
// ou vidéo YouTube.

type Service = ReturnType<typeof createServiceClient>;
export type PubForThumb = { id: string; file_ids: string[] | null; media: unknown; publish_info: unknown };

/** Miniature Drive signée jusqu'au lendemain (même URL toute la journée : le cache navigateur sert). */
function driveThumb(fileId: string) {
  const expiresAt = Math.ceil(Date.now() / 86_400_000 + 1) * 86_400_000;
  return `/api/media/thumb?f=${encodeURIComponent(fileId)}&e=${expiresAt}&s=${signMediaStreamToken(`thumb:${fileId}`, expiresAt)}`;
}

export async function publicationThumbs(service: Service, pubs: PubForThumb[]): Promise<Map<string, string | null>> {
  const firstIds = pubs.map((p) => p.file_ids?.[0]).filter((id): id is string => !!id);
  const { data: files } = firstIds.length
    ? await service.from("event_files").select("id, storage_provider, path, drive_file_id, content_type").in("id", firstIds)
    : { data: [] };
  const fileBy = new Map((files ?? []).map((f) => [f.id, f]));
  const out = new Map<string, string | null>();
  await Promise.all(
    pubs.map(async (p) => {
      const file = p.file_ids?.[0] ? fileBy.get(p.file_ids[0]) : undefined;
      const media = (p.media as StandaloneMedia[] | null)?.[0];
      const youtubeId = getNetworkEntry(p.publish_info as PublishInfo | null, "youtube")?.videoId;
      let url: string | null = null;
      if (file?.storage_provider === "drive" && file.drive_file_id) url = driveThumb(file.drive_file_id);
      else if (file?.path && (file.content_type ?? "").startsWith("image")) {
        url = (await service.storage.from("event-files").createSignedUrl(file.path, 3600)).data?.signedUrl ?? null;
      } else if (media?.drive_file_id) url = driveThumb(media.drive_file_id);
      else if (youtubeId) url = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
      out.set(p.id, url);
    })
  );
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
