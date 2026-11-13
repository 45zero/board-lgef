import type { FiefActor } from "@/lib/fief/actor";

// Qui voit une publication FIEF — miroir de fief_can_see_post() (sql/2026-11-14_fief_visibilite_mentions.sql),
// pour les routes /api/fief/* qui lisent à la clé service.

export interface PostVisibility {
  author_id: string;
  hidden_at: string | null;
  audience: "all" | "custom" | "private";
  audience_ids: string[];
}

export function canSeePost(actor: Pick<FiefActor, "userId" | "member" | "manager">, p: PostVisibility) {
  if (actor.manager || p.author_id === actor.userId) return true;
  if (!actor.member || p.hidden_at) return false;
  return p.audience === "all" || (p.audience === "custom" && p.audience_ids.includes(actor.userId));
}

/** Membres qui voient la publication, parmi `ids` (notifications : mentions, partage). */
export function audienceFilter(p: PostVisibility, ids: string[]) {
  if (p.hidden_at) return [];
  if (p.audience === "all") return ids;
  if (p.audience === "custom") return ids.filter((id) => p.audience_ids.includes(id));
  return [];
}
