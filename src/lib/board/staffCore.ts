import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { KM_RATE, type Engagement, type EngagementRole, type StaffInvoice } from "@/lib/board/staff";
import { travelToEvent } from "@/lib/board/travel";

// Interventions (Effectif) indépendantes de la session : utilisées par les actions serveur
// (src/app/actions/staff.ts, droits vérifiés là-bas) ET par le tableau de bord (factures à déposer).
// Règles de sollicitation et de coût : voir l'en-tête de staff.ts.

type Service = ReturnType<typeof createServiceClient>;

/** Interventions des personnes (null : toutes) sur les événements commençant dans [from, to[. */
export async function loadEngagements(service: Service, userIds: string[] | null, fromISO: string, toISO: string, onlyEventIds?: string[]): Promise<Engagement[]> {
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
  const [kmBy, invoiceBy] = await Promise.all([mileage(service, list), invoices(service, list)]);

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
        invoice: invoiceBy.get(`${e.userId}|${e.eventId}`) ?? null,
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
  // Véhicule de service (profil) : pas d'indemnités kilométriques, comme dans l'ancien calendrier.
  const { data: companyCars } = reseau.size
    ? await service.from("profiles").select("id").in("id", [...reseau]).eq("has_company_car", true)
    : { data: [] };
  const serviceCar = new Set((companyCars ?? []).map((p) => p.id));
  const byEvent = new Map<string, string[]>();
  for (const e of list) {
    if (!reseau.has(e.userId)) continue;
    if (serviceCar.has(e.userId)) out.set(`${e.userId}|${e.eventId}`, 0);
    else byEvent.set(e.eventId, [...(byEvent.get(e.eventId) ?? []), e.userId]);
  }
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

/** Factures déposées (event_invoices) pour ces interventions (clé « user|event ») ; la plus récente. */
async function invoices(service: Service, list: { userId: string; eventId: string }[]) {
  const out = new Map<string, StaffInvoice>();
  const eventIds = [...new Set(list.map((e) => e.eventId))];
  const userIds = [...new Set(list.map((e) => e.userId))];
  if (!eventIds.length) return out;
  const rows: { id: string; event_id: string | null; user_id: string | null; status: string | null; amount_ttc: number | null; file_url: string | null; created_at: string | null; admin_comment: string | null; payment_status: string | null; paid_at: string | null }[] = [];
  for (let i = 0; i < eventIds.length; i += 200) {
    const { data } = await service
      .from("event_invoices")
      .select("id, event_id, user_id, status, amount_ttc, file_url, created_at, admin_comment, payment_status, paid_at")
      .in("event_id", eventIds.slice(i, i + 200))
      .in("user_id", userIds)
      .order("created_at");
    rows.push(...(data ?? []));
  }
  const ids = rows.map((r) => r.id);
  const { data: atts } = ids.length ? await service.from("event_invoice_attachments").select("invoice_id").in("invoice_id", ids) : { data: [] };
  const attCount = new Map<string, number>();
  for (const a of atts ?? []) if (a.invoice_id) attCount.set(a.invoice_id, (attCount.get(a.invoice_id) ?? 0) + 1);
  for (const r of rows) {
    if (!r.event_id || !r.user_id) continue;
    out.set(`${r.user_id}|${r.event_id}`, {
      id: r.id,
      status: r.status,
      amountTtc: r.amount_ttc === null ? null : Number(r.amount_ttc),
      files: (r.file_url ? 1 : 0) + (attCount.get(r.id) ?? 0),
      comment: r.admin_comment,
      paidAt: r.payment_status === "paid" ? (r.paid_at ?? r.created_at) : null,
    });
  }
  return out;
}
