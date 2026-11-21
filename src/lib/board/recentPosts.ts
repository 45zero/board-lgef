import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { publicationThumbs, totalViews } from "@/lib/board/publicationThumbs";
import { getNetworkEntry, NETWORK_KEYS, networkUrl, publishedNetworks, type PublishInfo } from "@/lib/social/targets";

// Accueil — « Derniers médias publiés » : ce qui est parti récemment sur les réseaux de la Ligue,
// avec le réseau (Facebook, Instagram, YouTube) et le lien vers le post. Servi par la route GET
// /api/dashboard/recent-posts : en parallèle des server actions de l'accueil (exécutées une par une).

export type RecentPost = {
  id: string;
  title: string;
  publishedAt: string;
  kind: string | null;
  thumbUrl: string | null;
  /** Vues cumulées sur tous les réseaux (dernier relevé des statistiques). */
  views: number | null;
  /** Likes et commentaires cumulés sur tous les réseaux (même relevé) ; null sans statistiques. */
  likes: number | null;
  comments: number | null;
  networks: { network: "facebook" | "instagram" | "youtube"; url: string | null }[];
  /** Type de l'événement rattaché (pôle), pour les filtres de l'accueil ; null sans événement. */
  eventType: string | null;
};

/** Somme d'une statistique (likes, commentaires) sur tous les réseaux ; null si aucun relevé. */
function totalStat(info: PublishInfo | null, key: "likes" | "comments"): number | null {
  let total: number | null = null;
  for (const k of NETWORK_KEYS) {
    const v = getNetworkEntry(info, k)?.stats?.[key];
    if (typeof v === "number") total = (total ?? 0) + v;
  }
  return total;
}

/** Recherche (loupe de l'accueil) : nettoyée des caractères qui casseraient le filtre PostgREST. */
const cleanQuery = (q: string) => q.replace(/[%_,()*\\.:"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

export async function getRecentPosts(service: ReturnType<typeof createServiceClient>, limit = 24, q?: string): Promise<RecentPost[]> {
  const query = q ? cleanQuery(q) : "";
  let req = service
    .from("media_publications")
    .select("id, title, caption, kind, published_at, publish_info, file_ids, media, media_purged_at, events(title, event_type)")
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);
  // Avec une recherche : toutes les publications publiées dont le titre ou la légende contient le texte.
  if (query) req = req.or(`title.ilike.%${query}%,caption.ilike.%${query}%`);
  const { data: pubs } = await req;
  const list = pubs ?? [];

  const thumbs = await publicationThumbs(service, list);

  return list.map((p) => {
    const info = p.publish_info as PublishInfo | null;
    const keys = publishedNetworks(info);
    const networks: RecentPost["networks"] = [];
    const fb = keys.filter((k) => k !== "instagram" && k !== "youtube");
    if (fb.length) networks.push({ network: "facebook", url: fb.map((k) => networkUrl(k, getNetworkEntry(info, k))).find(Boolean) ?? null });
    if (keys.includes("instagram")) networks.push({ network: "instagram", url: networkUrl("instagram", getNetworkEntry(info, "instagram")) });
    if (keys.includes("youtube")) networks.push({ network: "youtube", url: networkUrl("youtube", getNetworkEntry(info, "youtube")) });

    const event = p.events as unknown as { title: string; event_type: string | null } | null;
    return {
      id: p.id,
      title: p.title || event?.title || p.caption?.split("\n")[0]?.slice(0, 80) || "Publication",
      publishedAt: p.published_at!,
      kind: p.kind,
      thumbUrl: thumbs.get(p.id) ?? null,
      views: totalViews(info),
      likes: totalStat(info, "likes"),
      comments: totalStat(info, "comments"),
      networks,
      eventType: event?.event_type ?? null,
    };
  });
}
