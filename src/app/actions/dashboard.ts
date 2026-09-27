"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { getMyExpenses, getMyValidatorScope } from "@/app/actions/expenses";
import type { DbEventType } from "@/lib/board/calendar";
import { getSolicitations } from "@/lib/board/solicitation";

// Tableau de bord : ce que l'utilisateur a À FAIRE (actions, toutes échéances confondues) et son
// PROGRAMME (événements où il est sollicité) sur la journée ou la semaine. Chaque bloc est calculé
// indépendamment : une source en erreur est simplement omise.

/** Élément d'une action, pour le traiter directement depuis la popup du tableau de bord. */
export type DashboardActionItem = { id: string; eventId: string | null; title: string; date: string | null; detail?: string };

export type DashboardAction = {
  id: string;
  items?: DashboardActionItem[];
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
      const { data } = await service
        .from("director_attendance")
        .select("id, event_id, events!inner(title, start_date)")
        .eq("director_id", userId)
        .eq("status", "pending")
        .gte("events.start_date", now.toISOString())
        .limit(30);
      const items = (data ?? []).map((d) => {
        const ev = d.events as unknown as { title: string; start_date: string };
        return { id: d.id, eventId: d.event_id, title: ev.title, date: ev.start_date };
      });
      push({ id: "presence", app: "calendrier", tone: "orange", count: items.length, items, title: "Présences à confirmer", detail: "Invitations du comité directeur" });
    }, undefined),

    // Captations : demandes qui m'attendent (technicien) / à attribuer (admin).
    safe(async () => {
      // Uniquement les événements à venir : les anciennes demandes jamais clôturées ne sont plus des actions.
      const { data: mineRows } = await service
        .from("coverage_requests")
        .select("id, event_id, details, events!inner(title, start_date)")
        .or(`assigned_technician_id.eq.${userId},technician_id.eq.${userId}`)
        .or("technician_response.is.null,technician_response.eq.pending")
        .neq("status", "cancelled")
        .gte("events.start_date", now.toISOString())
        .limit(30);
      const mineItems = (mineRows ?? []).map((c) => {
        const ev = c.events as unknown as { title: string; start_date: string };
        return { id: c.id, eventId: c.event_id, title: ev.title, date: ev.start_date, detail: c.details ?? undefined };
      });
      push({ id: "captation-repondre", app: "calendrier", tone: "red", count: mineItems.length, items: mineItems, title: "Captations à accepter", detail: "Des événements vous sont proposés" });
      if (isAdmin) {
        const { data: toAssign, count: toAssignCount } = await service
          .from("coverage_requests")
          .select("id, event_id, events!inner(title, start_date)", { count: "exact" })
          .eq("status", "pending")
          .gte("events.start_date", now.toISOString())
          .order("created_at")
          .limit(30);
        const assignItems = (toAssign ?? []).map((c) => {
          const ev = c.events as unknown as { title: string; start_date: string };
          return { id: c.id, eventId: c.event_id, title: ev.title, date: ev.start_date };
        });
        push({ id: "captation-attribuer", app: "calendrier", tone: "orange", count: toAssignCount ?? assignItems.length, items: assignItems, title: "Demandes de captation à traiter", detail: "À valider et attribuer à un technicien" });
      }
    }, undefined),

    // Centre de publication.
    safe(async () => {
      if (!isMediaTeam) return;
      const { data: pubs } = await service
        .from("media_publications")
        .select("id, event_id, title, created_at, events(title, start_date)")
        .eq("status", "to_publish")
        .order("created_at", { ascending: false })
        .limit(30);
      const pubItems = (pubs ?? []).map((p) => {
        const ev = p.events as unknown as { title: string; start_date: string } | null;
        return { id: p.id, eventId: p.event_id, title: ev?.title ?? p.title ?? "Publication", date: ev?.start_date ?? p.created_at };
      });
      push({ id: "publier", app: "audiovisuel", tone: "red", count: pubItems.length, items: pubItems, title: "Médias à publier", detail: "Photos et vidéos en attente dans le centre de publication" });
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
    // Uniquement les événements où je suis sollicité (avoir créé l'événement ne suffit pas).
    const roles = await getSolicitations(service, userId, { includePendingDirector: true, includeProposedCoverage: true });
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
