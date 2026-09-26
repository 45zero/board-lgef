"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getMyExpenses, getMyValidatorScope } from "@/app/actions/expenses";
import type { DbEventType } from "@/lib/board/calendar";

// Tableau de bord : ce que l'utilisateur a À FAIRE (actions, toutes échéances confondues) et son
// PROGRAMME (événements où il est sollicité) sur la journée ou la semaine. Chaque bloc est calculé
// indépendamment : une source en erreur est simplement omise.

export type DashboardAction = {
  id: string;
  /** Module du board à ouvrir. */
  app: string;
  tone: "red" | "orange" | "navy";
  count: number;
  title: string;
  detail: string;
};

export type ProgrammeItem = {
  eventId: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  eventType: DbEventType | null;
  roles: string[];
};

export type Dashboard = {
  firstName: string | null;
  actions: DashboardAction[];
  programme: ProgrammeItem[];
};

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error("[dashboard]", e);
    return fallback;
  }
}

export async function getDashboard(period: "day" | "week"): Promise<Dashboard> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();

  const { data: me } = await service.from("profiles").select("first_name, role").eq("id", userId).single();
  const isAdmin = me?.role === "admin" || me?.role === "super_user";
  const isMediaTeam = isAdmin || me?.role === "technician";

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from);
  if (period === "day") to.setDate(to.getDate() + 1);
  else to.setDate(to.getDate() + 7 - ((from.getDay() + 6) % 7)); // jusqu'à dimanche inclus

  const actions: DashboardAction[] = [];
  const push = (a: DashboardAction) => {
    if (a.count > 0) actions.push(a);
  };

  await Promise.all([
    // Frais à déclarer (moi) et à valider (mon équipe, en tant que N+1).
    safe(async () => {
      const [mine, scope] = await Promise.all([getMyExpenses(), getMyValidatorScope()]);
      const toDeclare = mine.filter((m) => m.status === "a_declarer").length;
      const rejected = mine.filter((m) => m.status === "rejected").length;
      push({ id: "frais-valider", app: "frais", tone: "red", count: scope.pending, title: "Notes de frais à valider", detail: "Votre équipe attend votre validation" });
      push({ id: "frais-refuses", app: "frais", tone: "red", count: rejected, title: "Frais refusés à corriger", detail: "Voir le motif et redéclarer" });
      push({ id: "frais-declarer", app: "frais", tone: "orange", count: toDeclare, title: "Frais à déclarer", detail: "Événements où vous étiez sollicité" });
    }, undefined),

    // Présence au comité directeur à confirmer.
    safe(async () => {
      const { count } = await service
        .from("director_attendance")
        .select("id, events!inner(start_date)", { count: "exact", head: true })
        .eq("director_id", userId)
        .eq("status", "pending")
        .gte("events.start_date", now.toISOString());
      push({ id: "presence", app: "calendrier", tone: "orange", count: count ?? 0, title: "Présences à confirmer", detail: "Invitations du comité directeur" });
    }, undefined),

    // Captations : demandes qui m'attendent (technicien) / à attribuer (admin).
    safe(async () => {
      // Uniquement les événements à venir : les anciennes demandes jamais clôturées ne sont plus des actions.
      const { count: mine } = await service
        .from("coverage_requests")
        .select("id, events!inner(start_date)", { count: "exact", head: true })
        .or(`assigned_technician_id.eq.${userId},technician_id.eq.${userId}`)
        .or("technician_response.is.null,technician_response.eq.pending")
        .neq("status", "cancelled")
        .gte("events.start_date", now.toISOString());
      push({ id: "captation-repondre", app: "calendrier", tone: "red", count: mine ?? 0, title: "Captations à accepter", detail: "Des événements vous sont proposés" });
      if (isAdmin) {
        const { count: toAssign } = await service
          .from("coverage_requests")
          .select("id, events!inner(start_date)", { count: "exact", head: true })
          .eq("status", "pending")
          .gte("events.start_date", now.toISOString());
        push({ id: "captation-attribuer", app: "calendrier", tone: "orange", count: toAssign ?? 0, title: "Demandes de captation à traiter", detail: "À valider et attribuer à un technicien" });
      }
    }, undefined),

    // Centre de publication.
    safe(async () => {
      if (!isMediaTeam) return;
      const { count } = await service.from("media_publications").select("id", { count: "exact", head: true }).eq("status", "to_publish");
      push({ id: "publier", app: "audiovisuel", tone: "red", count: count ?? 0, title: "Médias à publier", detail: "Photos et vidéos en attente dans le centre de publication" });
      const { count: flagged } = await service
        .from("comment_moderation")
        .select("id", { count: "exact", head: true })
        .neq("verdict", "ok")
        .in("action", ["none", "hide_failed"]);
      push({ id: "commentaires", app: "audiovisuel", tone: "orange", count: flagged ?? 0, title: "Commentaires à vérifier", detail: "Signalés par la modération automatique" });
    }, undefined),

    // Inscriptions : invitations pas encore envoyées sur mes campagnes (toutes pour un admin).
    safe(async () => {
      let q = service.from("event_registration_campaigns").select("id, events!inner(start_date)").gte("events.start_date", from.toISOString());
      if (!isAdmin) q = q.eq("created_by", userId);
      const { data: campaigns } = await q;
      const ids = (campaigns ?? []).map((c) => c.id);
      if (ids.length === 0) return;
      const { count } = await service
        .from("event_registration_recipients")
        .select("id", { count: "exact", head: true })
        .in("campaign_id", ids)
        .is("sent_at", null)
        .is("whatsapp_sent_at", null);
      push({ id: "inscriptions", app: "inscription", tone: "orange", count: count ?? 0, title: "Invitations en attente d'envoi", detail: "Destinataires pas encore contactés" });
    }, undefined),
  ]);

  // Programme : événements de la période où je suis sollicité (ou que j'organise).
  const programme = await safe(async () => {
    const [team, assigned, directors, coverage, created] = await Promise.all([
      service.from("event_team_members").select("event_id, role").eq("user_id", userId),
      service.from("event_assignments").select("event_id").eq("user_id", userId),
      service.from("director_attendance").select("event_id, status").eq("director_id", userId).neq("status", "denied"),
      service
        .from("coverage_requests")
        .select("event_id")
        .or(`assigned_technician_id.eq.${userId},technician_id.eq.${userId}`)
        .eq("technician_response", "accepted")
        .neq("status", "cancelled"),
      service.from("events").select("id").eq("created_by", userId).gte("start_date", from.toISOString()).lt("start_date", to.toISOString()),
    ]);
    const roles = new Map<string, Set<string>>();
    const add = (id: string | null, role: string) => {
      if (!id) return;
      if (!roles.has(id)) roles.set(id, new Set());
      roles.get(id)!.add(role);
    };
    for (const t of team.data ?? []) add(t.event_id, t.role === "responsable" ? "Responsable" : "Membre");
    for (const a of assigned.data ?? []) add(a.event_id, "Assigné");
    for (const d of directors.data ?? []) add(d.event_id, d.status === "approved" ? "Comité directeur" : "Comité directeur (à confirmer)");
    for (const c of coverage.data ?? []) add(c.event_id, "Captation");
    for (const e of created.data ?? []) add(e.id, "Organisateur");
    const ids = [...roles.keys()];
    if (ids.length === 0) return [];
    const { data: events } = await service
      .from("events")
      .select("id, title, start_date, end_date, location, event_type")
      .in("id", ids)
      .lt("start_date", to.toISOString())
      .gte("end_date", from.toISOString())
      .order("start_date");
    return (events ?? []).map((e) => ({
      eventId: e.id,
      title: e.title,
      start: e.start_date,
      end: e.end_date,
      location: e.location,
      eventType: e.event_type as DbEventType | null,
      roles: [...(roles.get(e.id) ?? [])],
    }));
  }, [] as ProgrammeItem[]);

  const toneOrder = { red: 0, orange: 1, navy: 2 };
  actions.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone] || b.count - a.count);
  return { firstName: me?.first_name ?? null, actions, programme };
}
