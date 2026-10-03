"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { publicationThumbs, totalViews } from "@/lib/board/publicationThumbs";
import { getNetworkEntry, networkUrl, publishedNetworks, type PublishInfo } from "@/lib/social/targets";

// Accueil — « Derniers médias publiés » : ce qui est parti récemment sur les réseaux de la Ligue,
// avec le réseau (Facebook, Instagram, YouTube) et le lien vers le post.

export type RecentPost = {
  id: string;
  title: string;
  publishedAt: string;
  kind: string | null;
  thumbUrl: string | null;
  /** Vues cumulées sur tous les réseaux (dernier relevé des statistiques). */
  views: number | null;
  networks: { network: "facebook" | "instagram" | "youtube"; url: string | null }[];
};

export async function getRecentPosts(limit = 8): Promise<RecentPost[]> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return [];
  const service = createServiceClient();
  const { data: pubs } = await service
    .from("media_publications")
    .select("id, title, caption, kind, published_at, publish_info, file_ids, media, events(title)")
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);
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

    const event = p.events as unknown as { title: string } | null;
    return {
      id: p.id,
      title: p.title || event?.title || p.caption?.split("\n")[0]?.slice(0, 80) || "Publication",
      publishedAt: p.published_at!,
      kind: p.kind,
      thumbUrl: thumbs.get(p.id) ?? null,
      views: totalViews(info),
      networks,
    };
  });
}
