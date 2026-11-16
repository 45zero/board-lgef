import "server-only";
import type { FiefActor } from "@/lib/fief/actor";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { inSelection, type FiefAudienceSel } from "@/lib/fief/audience";

// Qui voit une publication FIEF — miroir de fief_can_see_post() (sql/2026-11-16_fief_evolutions.sql),
// pour les routes /api/fief/* qui lisent à la clé service.

export interface PostVisibility {
  author_id: string;
  hidden_at: string | null;
  audience: "all" | "custom" | "private";
  audience_ids: string[];
  audience_functions: string[];
  audience_clubs: string[];
}

export const POST_VISIBILITY_COLUMNS = "author_id, hidden_at, audience, audience_ids, audience_functions, audience_clubs";

const selOf = (p: { audience_ids: string[]; audience_functions: string[]; audience_clubs: string[] }): FiefAudienceSel => ({
  ids: p.audience_ids,
  functions: p.audience_functions,
  clubs: p.audience_clubs,
});

export function canSeePost(actor: Pick<FiefActor, "userId" | "member" | "manager">, p: PostVisibility) {
  if (actor.manager || p.author_id === actor.userId) return true;
  if (!actor.member || p.hidden_at) return false;
  return p.audience === "all" || (p.audience === "custom" && inSelection(selOf(p), { userId: actor.userId, ...actor.member }));
}

/** Document partagé visible par la personne (équipe FIEF, propriétaire, ou membre du public). */
export function canSeeDocument(
  actor: Pick<FiefActor, "userId" | "member" | "manager">,
  d: { owner_id: string; visibility: string; audience: string; audience_ids: string[]; audience_functions: string[]; audience_clubs: string[] }
) {
  if (actor.manager || d.owner_id === actor.userId) return true;
  if (!actor.member || d.visibility !== "shared") return false;
  return d.audience === "all" || inSelection(selOf(d), { userId: actor.userId, ...actor.member });
}

/** Membres actives qui voient la publication, parmi `ids` (notifications : mentions, partage). */
export async function audienceMembers(p: PostVisibility, ids: string[]) {
  if (p.hidden_at || !ids.length) return [];
  if (p.audience === "private") return [];
  const { data } = await createServiceClient().from("fief_members").select("user_id, functions, club_number").in("user_id", [...new Set(ids)]).eq("status", "active");
  return (data ?? []).filter((m) => p.audience === "all" || inSelection(selOf(p), { userId: m.user_id, functions: m.functions ?? [], clubNumber: m.club_number })).map((m) => m.user_id);
}

/** Toutes les membres actives d'un public « custom » (notification « publication pour vous »). */
export async function selectionMembers(sel: FiefAudienceSel) {
  const { data } = await createServiceClient().from("fief_members").select("user_id, functions, club_number").eq("status", "active");
  return (data ?? []).filter((m) => inSelection(sel, { userId: m.user_id, functions: m.functions ?? [], clubNumber: m.club_number })).map((m) => m.user_id);
}
