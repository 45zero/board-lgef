import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Règle unique « l'utilisateur est sollicité sur un événement » (calendrier, frais, programme) :
 * - membre ou responsable de l'équipe (choisi explicitement à la création ou ensuite) ;
 * - assigné — sauf l'auto-assignation du créateur faite par l'appli calendrier ;
 * - comité directeur invité (présence confirmée ou à confirmer ; pas s'il a décliné) ;
 * - technicien de la captation (acceptée, ou qui lui est proposée) ;
 * - photographe d'un match du week-end qu'il a pris.
 * Avoir simplement créé l'événement ne suffit PAS.
 */
export type SolicitationRole = "Responsable" | "Membre" | "Assigné" | "Comité directeur" | "Comité directeur (à confirmer)" | "Captation";

export async function getSolicitations(
  client: SupabaseClient<Database>,
  userId: string,
  opts: { includePendingDirector?: boolean; includeProposedCoverage?: boolean } = {}
): Promise<Map<string, Set<SolicitationRole>>> {
  const [team, assigned, directors, coverage, photo] = await Promise.all([
    client.from("event_team_members").select("event_id, role").eq("user_id", userId),
    client.from("event_assignments").select("event_id").eq("user_id", userId),
    client.from("director_attendance").select("event_id, status").eq("director_id", userId).neq("status", "denied"),
    client
      .from("coverage_requests")
      .select("event_id, technician_response")
      .or(`assigned_technician_id.eq.${userId},technician_id.eq.${userId}`)
      .neq("status", "cancelled"),
    // Réseau photo : match pris (sql/2026-09-29_reseau_photo.sql) — frais déclarables comme une captation.
    client.from("photo_missions").select("event_id").eq("photographer_id", userId).eq("status", "taken"),
  ]);

  const roles = new Map<string, Set<SolicitationRole>>();
  const add = (eventId: string | null, role: SolicitationRole) => {
    if (!eventId) return;
    if (!roles.has(eventId)) roles.set(eventId, new Set());
    roles.get(eventId)!.add(role);
  };
  for (const t of team.data ?? []) add(t.event_id, t.role === "responsable" ? "Responsable" : "Membre");
  // Assignations : on écarte celles du créateur sur son propre événement (auto-assignation du calendrier).
  const assignedIds = (assigned.data ?? []).map((a) => a.event_id).filter((id): id is string => !!id);
  if (assignedIds.length > 0) {
    const { data: created } = await client.from("events").select("id").in("id", assignedIds).eq("created_by", userId);
    const own = new Set((created ?? []).map((e) => e.id));
    for (const id of assignedIds) if (!own.has(id)) add(id, "Assigné");
  }
  for (const d of directors.data ?? []) {
    if (d.status === "approved") add(d.event_id, "Comité directeur");
    else if (opts.includePendingDirector) add(d.event_id, "Comité directeur (à confirmer)");
  }
  for (const c of coverage.data ?? []) {
    if (c.technician_response === "accepted" || (opts.includeProposedCoverage && c.technician_response !== "rejected")) add(c.event_id, "Captation");
  }
  for (const p of photo.data ?? []) add(p.event_id, "Captation");
  return roles;
}
