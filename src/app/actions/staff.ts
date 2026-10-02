"use server";

import { toResult } from "@/lib/board/actionResult";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { KM_RATE, STAFF_STATUSES, type Engagement, type EngagementRole, type StaffOverview, type StaffPerson, type StaffStatus } from "@/lib/board/staff";
import { travelToEvent } from "@/lib/board/travel";

// Effectif (sql/2026-10-03_staff_costs.sql) : mes N-1 (profiles.expense_validator_id = moi), tout le
// monde pour un administrateur. Le coût d'une personne = son forfait par intervention (staff_rates) —
// ou, pour le réseau, ses kilomètres aller-retour × KM_RATE —, ou le montant ajusté sur l'événement
// (event_cost_adjustments), pour chaque événement où elle est
// sollicitée (même règle que src/lib/board/solicitation.ts, sans le comité directeur) :
// confirmé (équipe, assignation, captation acceptée, match pris) ou prévisionnel (captation proposée).
// Lectures et écritures avec le client de service, après vérification des droits ici.

type Service = ReturnType<typeof createServiceClient>;

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Sans nom";

async function viewer() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  const service = createServiceClient();
  const [{ data: me }, { data: reports }] = await Promise.all([
    service.from("profiles").select("role").eq("id", userId).single(),
    service.from("profiles").select("id").eq("expense_validator_id", userId),
  ]);
  const isAdmin = me?.role === "admin" || me?.role === "super_user";
  const reportIds = (reports ?? []).map((r) => r.id).filter((id) => id !== userId);
  return { userId, service, isAdmin, reportIds };
}
type Viewer = Awaited<ReturnType<typeof viewer>>;

async function requireCanManage(v: Viewer, personId: string) {
  if (v.isAdmin || v.reportIds.includes(personId)) return;
  throw new Error("Vous n'êtes ni le N+1 de cette personne ni administrateur.");
}

/** Interventions des personnes (null : toutes) sur les événements commençant dans [from, to[. */
async function loadEngagements(service: Service, userIds: string[] | null, fromISO: string, toISO: string, onlyEventIds?: string[]): Promise<Engagement[]> {
  if (userIds && userIds.length === 0) return [];
  let evQ = service.from("events").select("id, title, start_date, created_by").gte("start_date", fromISO).lt("start_date", toISO);
  if (onlyEventIds) evQ = evQ.in("id", onlyEventIds);
  const { data: events, error } = await evQ;
  if (error) throw new Error(error.message);
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  const eventIds = [...eventById.keys()];
  if (!eventIds.length) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < eventIds.length; i += 200) chunks.push(eventIds.slice(i, i + 200));
  const rows = await Promise.all(
    chunks.map(async (ids) => {
      const [team, assigned, coverage, photo] = await Promise.all([
        service.from("event_team_members").select("event_id, user_id").in("event_id", ids),
        service.from("event_assignments").select("event_id, user_id").in("event_id", ids),
        service
          .from("coverage_requests")
          .select("event_id, status, technician_response, assigned_technician_id, technician_id")
          .in("event_id", ids)
          .not("status", "in", "(cancelled,rejected)"),
        service.from("photo_missions").select("event_id, photographer_id").in("event_id", ids).eq("status", "taken"),
      ]);
      return { team: team.data ?? [], assigned: assigned.data ?? [], coverage: coverage.data ?? [], photo: photo.data ?? [] };
    })
  );

  const wanted = userIds ? new Set(userIds) : null;
  const map = new Map<string, { userId: string; eventId: string; roles: Set<EngagementRole>; confirmed: boolean }>();
  const add = (userId: string | null, eventId: string | null, role: EngagementRole, confirmed: boolean) => {
    if (!userId || !eventId || !eventById.has(eventId) || (wanted && !wanted.has(userId))) return;
    const key = `${userId}|${eventId}`;
    const cur = map.get(key) ?? { userId, eventId, roles: new Set<EngagementRole>(), confirmed: false };
    cur.roles.add(role);
    cur.confirmed ||= confirmed;
    map.set(key, cur);
  };
  for (const r of rows) {
    for (const t of r.team) add(t.user_id, t.event_id, "Équipe", true);
    // L'auto-assignation du créateur (appli calendrier) n'est pas une sollicitation.
    for (const a of r.assigned) if (eventById.get(a.event_id ?? "")?.created_by !== a.user_id) add(a.user_id, a.event_id, "Assigné", true);
    for (const c of r.coverage) {
      if (c.technician_response === "rejected") continue;
      // Technicien assigné ; l'ancienne colonne technician_id ne compte que s'il n'y en a pas (voir technicianFilter).
      add(c.assigned_technician_id ?? c.technician_id, c.event_id, "Captation", c.technician_response === "accepted");
    }
    for (const p of r.photo) add(p.photographer_id, p.event_id, "Photo", true);
  }

  const list = [...map.values()];
  const people = [...new Set(list.map((e) => e.userId))];
  const involvedEvents = [...new Set(list.map((e) => e.eventId))];
  const [{ data: rates }, adjustments] = await Promise.all([
    people.length ? service.from("staff_rates").select("user_id, amount_eur").in("user_id", people) : Promise.resolve({ data: [] }),
    (async () => {
      const out: { event_id: string; user_id: string; amount_eur: number; note: string | null }[] = [];
      for (let i = 0; i < involvedEvents.length; i += 200) {
        const { data } = await service.from("event_cost_adjustments").select("event_id, user_id, amount_eur, note").in("event_id", involvedEvents.slice(i, i + 200));
        out.push(...(data ?? []));
      }
      return out;
    })(),
  ]);
  const rateBy = new Map((rates ?? []).map((r) => [r.user_id, Number(r.amount_eur)]));
  const adjBy = new Map(adjustments.map((a) => [`${a.user_id}|${a.event_id}`, a]));
  const kmBy = await mileage(service, list);

  return list
    .map((e) => {
      const ev = eventById.get(e.eventId)!;
      const adj = adjBy.get(`${e.userId}|${e.eventId}`);
      const km = kmBy.get(`${e.userId}|${e.eventId}`) ?? null;
      const base = km !== null ? Math.round(km * KM_RATE * 100) / 100 : (rateBy.get(e.userId) ?? 0);
      return {
        userId: e.userId,
        eventId: e.eventId,
        title: ev.title,
        start: ev.start_date,
        roles: [...e.roles],
        confirmed: e.confirmed,
        amount: adj ? Number(adj.amount_eur) : base,
        adjusted: !!adj,
        note: adj?.note ?? null,
        km,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Réseau : kilomètres aller-retour domicile → événement de chaque intervention (clé « user|event »).
 * Trajet déjà calculé pour les frais (travel_distances), sinon calculé (Google, mis en cache) ;
 * absent quand le domicile ou le lieu est inconnu.
 */
async function mileage(service: Service, list: { userId: string; eventId: string }[]) {
  const out = new Map<string, number>();
  const userIds = [...new Set(list.map((e) => e.userId))];
  if (!userIds.length) return out;
  const { data: links } = await service.from("profile_specialties").select("user_id, specialties!inner(slug)").eq("specialties.slug", "tech-reseau").in("user_id", userIds);
  const reseau = new Set((links ?? []).map((l) => l.user_id));
  const byEvent = new Map<string, string[]>();
  for (const e of list) if (reseau.has(e.userId)) byEvent.set(e.eventId, [...(byEvent.get(e.eventId) ?? []), e.userId]);
  const events = [...byEvent.entries()];
  // Quelques événements à la fois : les appels Google restent raisonnables.
  for (let i = 0; i < events.length; i += 5) {
    await Promise.all(
      events.slice(i, i + 5).map(async ([eventId, ids]) => {
        try {
          const travel = await travelToEvent(service, eventId, ids);
          for (const [uid, t] of Object.entries(travel)) out.set(`${uid}|${eventId}`, Math.round(t.km * 2 * 10) / 10);
        } catch (e) {
          console.error("[staff.mileage]", e);
        }
      })
    );
  }
  return out;
}

async function loadPeople(service: Service, ids: string[] | null): Promise<StaffPerson[]> {
  if (ids && ids.length === 0) return [];
  let q = service.from("profiles").select("id, first_name, last_name, email, expense_validator_id").order("last_name");
  if (ids) q = q.in("id", ids);
  const { data: profiles, error } = await q;
  if (error) throw new Error(error.message);
  const allIds = (profiles ?? []).map((p) => p.id);
  const managerIds = [...new Set((profiles ?? []).map((p) => p.expense_validator_id).filter((id): id is string => !!id))];
  const [{ data: links }, { data: rates }, { data: managers }] = await Promise.all([
    service.from("profile_specialties").select("user_id, specialties!inner(slug)").in("specialties.slug", STAFF_STATUSES).in("user_id", allIds),
    service.from("staff_rates").select("user_id, amount_eur").in("user_id", allIds),
    managerIds.length ? service.from("profiles").select("id, first_name, last_name, email").in("id", managerIds) : Promise.resolve({ data: [] }),
  ]);
  const statusBy = new Map(((links ?? []) as unknown as { user_id: string; specialties: { slug: string } }[]).map((l) => [l.user_id, l.specialties.slug as StaffStatus]));
  const rateBy = new Map((rates ?? []).map((r) => [r.user_id, Number(r.amount_eur)]));
  const managerBy = new Map((managers ?? []).map((m) => [m.id, personName(m)]));
  return (profiles ?? []).map((p) => ({
    id: p.id,
    name: personName(p),
    email: p.email,
    status: statusBy.get(p.id) ?? null,
    managerId: p.expense_validator_id,
    managerName: p.expense_validator_id ? (managerBy.get(p.expense_validator_id) ?? null) : null,
    rate: rateBy.has(p.id) ? rateBy.get(p.id)! : null,
  }));
}

/** Module Effectif : personnes, tarifs et interventions de l'année. scope « all » : administrateurs. */
export const getStaffOverview = async (year: number, scope: "mine" | "all") =>
  toResult(async (): Promise<StaffOverview> => {
    const v = await viewer();
    const all = scope === "all" && v.isAdmin;
    const loaded = await loadPeople(v.service, all ? null : v.reportIds);
    // Vue « tous » : les personnes qui ont un statut (salarié, réseau, prestataire, bénévole).
    const people = all ? loaded.filter((p) => p.status) : loaded;
    const engagements = await loadEngagements(v.service, people.map((p) => p.id), new Date(year, 0, 1).toISOString(), new Date(year + 1, 0, 1).toISOString());
    return { viewer: { id: v.userId, isAdmin: v.isAdmin, hasReports: v.reportIds.length > 0 }, year, people, engagements };
  });

/** Forfait par intervention (null : retirer). */
export const setStaffRate = async (personId: string, amount: number | null) =>
  toResult(async () => {
    const v = await viewer();
    await requireCanManage(v, personId);
    if (amount === null) {
      const { error } = await v.service.from("staff_rates").delete().eq("user_id", personId);
      if (error) throw new Error(error.message);
      return;
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) throw new Error("Montant invalide.");
    const { error } = await v.service
      .from("staff_rates")
      .upsert({ user_id: personId, amount_eur: Math.round(amount * 100) / 100, updated_by: v.userId, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
  });

/** Montant ajusté pour une personne sur un événement (null : revenir au forfait). */
export const setEventCostAdjustment = async (eventId: string, personId: string, amount: number | null, note?: string) =>
  toResult(async () => {
    const v = await viewer();
    await requireCanManage(v, personId);
    if (amount === null) {
      const { error } = await v.service.from("event_cost_adjustments").delete().eq("event_id", eventId).eq("user_id", personId);
      if (error) throw new Error(error.message);
      return;
    }
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) throw new Error("Montant invalide.");
    const { error } = await v.service.from("event_cost_adjustments").upsert({
      event_id: eventId,
      user_id: personId,
      amount_eur: Math.round(amount * 100) / 100,
      note: note?.trim() || null,
      updated_by: v.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  });

export type EventCostLine = Engagement & { name: string; status: StaffStatus; rate: number | null };

/**
 * Coût d'un événement pour son lecteur : les personnes sollicitées dont il a la charge (ses N-1, ou
 * tout le monde pour un administrateur). null : rien à montrer (ni N+1, ni administrateur).
 */
export const getEventCosts = async (eventId: string) =>
  toResult(async (): Promise<EventCostLine[] | null> => {
    const v = await viewer();
    if (!v.isAdmin && !v.reportIds.length) return null;
    const { data: ev } = await v.service.from("events").select("start_date").eq("id", eventId).maybeSingle();
    if (!ev) return null;
    const day = new Date(ev.start_date).getTime();
    const engagements = await loadEngagements(
      v.service,
      v.isAdmin ? null : v.reportIds,
      new Date(day - 1000).toISOString(),
      new Date(day + 1000).toISOString(),
      [eventId]
    );
    const people = new Map((await loadPeople(v.service, [...new Set(engagements.map((e) => e.userId))])).map((p) => [p.id, p]));
    return engagements.map((e) => ({ ...e, name: people.get(e.userId)?.name ?? "—", status: people.get(e.userId)?.status ?? null, rate: people.get(e.userId)?.rate ?? null }));
  });

/** Coût d'une période (week-end) pour le lecteur : ses N-1, ou tout le monde pour un administrateur. */
export const getPeriodCosts = async (fromISO: string, toISO: string) =>
  toResult(async (): Promise<{ confirmed: number; pending: number; people: number } | null> => {
    const v = await viewer();
    if (!v.isAdmin && !v.reportIds.length) return null;
    const engagements = (await loadEngagements(v.service, v.isAdmin ? null : v.reportIds, fromISO, toISO)).filter((e) => e.amount > 0);
    return {
      confirmed: engagements.filter((e) => e.confirmed).reduce((n, e) => n + e.amount, 0),
      pending: engagements.filter((e) => !e.confirmed).reduce((n, e) => n + e.amount, 0),
      people: new Set(engagements.map((e) => e.userId)).size,
    };
  });
