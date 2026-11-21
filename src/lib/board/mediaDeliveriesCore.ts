import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import { managerOf } from "@/lib/board/hierarchy";

// Remise des photos et vidéos par les TeamMedias (sql/2026-11-21_media_deliveries.sql).
// Une remise par personne ayant accepté de couvrir un événement : date limite (choisie à
// l'acceptation, plafonnée par le réglage des administrateurs), remise automatique au dépôt d'une
// photo / vidéo sur l'événement, relances du N+1 (cloche orange puis rouge, pop-up « wizz »).

type Service = ReturnType<typeof createServiceClient>;
/** La table n'est pas encore dans les types générés : accès non typé. */
const db = (service: Service) => service as unknown as SupabaseClient;

export type DeliveryRole = "photo" | "video" | "both";

export type DeliverySettings = { photoDays: number; videoDays: number; maxDays: number };
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { photoDays: 2, videoDays: 7, maxDays: 15 };

export type DeliveryPerson = { id: string; name: string; email: string | null };

export type DeliveryItem = {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  role: DeliveryRole;
  dueAt: string;
  dueConfirmed: boolean;
  /** late : date dépassée ; today : à remettre dans les 24 h ; confirm : date par défaut à confirmer. */
  state: "late" | "today" | "confirm";
  /** Jours de retard (≥ 1 dès que la date est dépassée). */
  lateDays: number;
  reminderLevel: 0 | 1 | 2;
  remindedAt: string | null;
  remindedBy: string | null;
  /** Côté N+1 : la personne qui doit remettre. */
  person?: DeliveryPerson;
  /** Côté TeamMedia : son N+1 (bouton « Contacter mon N+1 »). */
  manager?: DeliveryPerson | null;
  /** Date maximale autorisée (réglage), pour confirmer / changer sa date avant l'échéance. */
  maxDay?: string;
};

export type DeliveriesBoard = { mine: DeliveryItem[]; team: DeliveryItem[] };

export type DeliveryRow = {
  id: string;
  event_id: string;
  user_id: string;
  role: DeliveryRole;
  source: "lead" | "crew";
  due_at: string;
  due_confirmed: boolean;
  delivered_at: string | null;
  reminder_level: number;
  reminded_at: string | null;
  reminded_by: string | null;
};

export const DELIVERY_ROW = "id, event_id, user_id, role, source, due_at, due_confirmed, delivered_at, reminder_level, reminded_at, reminded_by";

export const deliveriesTable = (service: Service) => db(service).from("media_deliveries");

/* ---------- Dates (jour civil de Paris) ---------- */

/** Décalage horaire de Paris un jour donné (« +01:00 » l'hiver, « +02:00 » l'été). */
export function parisOffset(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const paris = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const min = Math.round((paris.getTime() - utc.getTime()) / 60000);
  return `${min >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;
}

export const parisDay = (d: Date | string) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Échéance d'un jour : 23 h 59, heure de Paris. */
export const dueAtOf = (day: string) => new Date(`${day}T23:59:00${parisOffset(day)}`).toISOString();

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());

/* ---------- Réglages ---------- */

export async function deliverySettings(service: Service): Promise<DeliverySettings> {
  const { data, error } = await db(service)
    .from("board_settings")
    .select("media_delivery_photo_days, media_delivery_video_days, media_delivery_max_days")
    .eq("id", true)
    .single();
  // Colonnes absentes (migration pas encore appliquée) : réglages par défaut.
  if (error || !data) return DEFAULT_DELIVERY_SETTINGS;
  const r = data as { media_delivery_photo_days: number | null; media_delivery_video_days: number | null; media_delivery_max_days: number | null };
  return {
    photoDays: r.media_delivery_photo_days ?? DEFAULT_DELIVERY_SETTINGS.photoDays,
    videoDays: r.media_delivery_video_days ?? DEFAULT_DELIVERY_SETTINGS.videoDays,
    maxDays: r.media_delivery_max_days ?? DEFAULT_DELIVERY_SETTINGS.maxDays,
  };
}

/**
 * Bornes de la date de remise pour un rôle : au plus tôt la fin de l'événement (ou aujourd'hui s'il
 * est passé), par défaut fin + délai du rôle, au plus tard fin + délai maximum (jours civils de Paris).
 */
export function deliveryBounds(eventEnd: string, role: DeliveryRole, s: DeliverySettings) {
  const endDay = parisDay(eventEnd);
  const today = parisDay(new Date());
  const minDay = today > endDay ? today : endDay;
  const maxDay = [addDays(endDay, Math.max(s.maxDays, 0)), minDay].sort()[1];
  const wanted = addDays(endDay, role === "photo" ? s.photoDays : s.videoDays);
  const defaultDay = wanted < minDay ? minDay : wanted > maxDay ? maxDay : wanted;
  return { endDay, minDay, defaultDay, maxDay };
}

/* ---------- Personnes ---------- */

const personName = (p: { first_name: string | null; last_name: string | null; email: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || p.email || "Sans nom";

export async function peopleById(service: Service, ids: (string | null | undefined)[]): Promise<Map<string, DeliveryPerson>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map();
  const { data } = await service.from("profiles").select("id, first_name, last_name, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, { id: p.id, name: personName(p), email: p.email }]));
}

/** Administrateurs (relances des personnes sans N+1). */
async function adminIds(service: Service) {
  const { data } = await service.from("profiles").select("id").in("role", ["admin", "super_user"]);
  return (data ?? []).map((p) => p.id);
}

/** Qui relance / est contacté pour une personne : son N+1, sinon les administrateurs. */
export async function managersFor(service: Service, userId: string): Promise<string[]> {
  const m = await managerOf(service, userId).catch(() => null);
  return m ? [m] : (await adminIds(service)).filter((id) => id !== userId);
}

/* ---------- Lecture ---------- */

function toItem(r: DeliveryRow, ev: { title: string; start_date: string } | undefined, now: Date, people: Map<string, DeliveryPerson>): DeliveryItem {
  const due = new Date(r.due_at);
  const late = due < now;
  const dayMs = 86400000;
  const lateDays = late ? Math.max(1, Math.round((new Date(`${parisDay(now)}T12:00:00Z`).getTime() - new Date(`${parisDay(due)}T12:00:00Z`).getTime()) / dayMs)) : 0;
  const state: DeliveryItem["state"] = late ? "late" : due.getTime() - now.getTime() < dayMs ? "today" : "confirm";
  return {
    id: r.id,
    eventId: r.event_id,
    eventTitle: ev?.title ?? "Événement",
    eventDate: ev?.start_date ?? r.due_at,
    role: r.role,
    dueAt: r.due_at,
    dueConfirmed: r.due_confirmed,
    state,
    lateDays,
    reminderLevel: r.reminder_level === 2 ? 2 : r.reminder_level === 1 ? 1 : 0,
    remindedAt: r.reminded_at,
    remindedBy: r.reminded_by ? (people.get(r.reminded_by)?.name ?? null) : null,
  };
}

/**
 * Encart de l'accueil.
 *   mine : mes remises en retard, à faire dans les 24 h, ou dont la date par défaut est à confirmer.
 *   team : remises en retard des personnes dont je suis le N+1 (sans N+1 : les administrateurs).
 */
export async function deliveriesBoard(service: Service, userId: string, isAdmin: boolean): Promise<DeliveriesBoard> {
  const now = new Date();
  const soon = new Date(now.getTime() + 86400000).toISOString();
  const [{ data: mineRows, error: e1 }, { data: lateRows, error: e2 }] = await Promise.all([
    deliveriesTable(service).select(DELIVERY_ROW).eq("user_id", userId).is("delivered_at", null).or(`due_at.lt.${soon},due_confirmed.eq.false`).order("due_at").limit(30),
    deliveriesTable(service).select(DELIVERY_ROW).is("delivered_at", null).lt("due_at", now.toISOString()).neq("user_id", userId).order("due_at").limit(200),
  ]);
  // Table absente (migration pas encore appliquée) : pas d'encart.
  if (e1 || e2) return { mine: [], team: [] };
  const mine = (mineRows ?? []) as DeliveryRow[];
  const late = (lateRows ?? []) as DeliveryRow[];

  // Mes équipiers en retard : ceux dont je suis le N+1 (calculé par personne, la liste est courte).
  const lateUsers = [...new Set(late.map((r) => r.user_id))];
  const managerByUser = new Map(await Promise.all(lateUsers.map(async (u) => [u, await managerOf(service, u).catch(() => null)] as const)));
  const team = late.filter((r) => {
    const m = managerByUser.get(r.user_id);
    return m === userId || (!m && isAdmin);
  });

  if (!mine.length && !team.length) return { mine: [], team: [] };
  const myManager = mine.length ? await managerOf(service, userId).catch(() => null) : null;
  const all = [...mine, ...team];
  const [{ data: events }, people, settings] = await Promise.all([
    service.from("events").select("id, title, start_date, end_date").in("id", [...new Set(all.map((r) => r.event_id))]),
    peopleById(service, [...all.map((r) => r.reminded_by), ...team.map((r) => r.user_id), myManager]),
    deliverySettings(service),
  ]);
  const evById = new Map((events ?? []).map((e) => [e.id, e]));
  return {
    mine: mine.map((r) => {
      const ev = evById.get(r.event_id);
      return {
        ...toItem(r, ev, now, people),
        manager: myManager ? (people.get(myManager) ?? null) : null,
        maxDay: ev ? deliveryBounds(ev.end_date ?? ev.start_date, r.role, settings).maxDay : undefined,
      };
    }),
    team: team.map((r) => ({ ...toItem(r, evById.get(r.event_id), now, people), person: people.get(r.user_id) })),
  };
}

/* ---------- Publicateurs ---------- */

/**
 * Personnes désignées pour publier (règle d'accès du module « audiovisuel », Paramètres → Publication) :
 * même règle que public.module_rule_matches, sans les administrateurs qui y ont accès d'office.
 * `null` : règle ouverte à tout le monde (ou pas de règle).
 */
export async function publisherNames(service: Service): Promise<string[] | null> {
  const { data: rule } = await db(service)
    .from("module_access")
    .select("everyone, roles, specialty_slugs, include_user_ids, exclude_user_ids, hidden")
    .eq("module_id", "audiovisuel")
    .maybeSingle();
  if (!rule) return null;
  const r = rule as { everyone: boolean; roles: string[] | null; specialty_slugs: string[] | null; include_user_ids: string[] | null; exclude_user_ids: string[] | null; hidden?: boolean };
  if (r.hidden) return [];
  if (r.everyone) return null;
  const ids = new Set(r.include_user_ids ?? []);
  const [byRole, bySpecialty] = await Promise.all([
    r.roles?.length ? db(service).from("profiles").select("id").in("role", r.roles) : Promise.resolve({ data: [] as { id: string }[] }),
    r.specialty_slugs?.length
      ? db(service).from("profile_specialties").select("user_id, specialties!inner(slug)").in("specialties.slug", r.specialty_slugs)
      : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]);
  for (const p of (byRole.data ?? []) as { id: string }[]) ids.add(p.id);
  for (const p of (bySpecialty.data ?? []) as { user_id: string }[]) ids.add(p.user_id);
  for (const x of r.exclude_user_ids ?? []) ids.delete(x);
  if (!ids.size) return [];
  const { data: people } = await service.from("profiles").select("first_name, last_name, email").in("id", [...ids]);
  return (people ?? [])
    .map((p) => [p.first_name, p.last_name ? `${p.last_name.charAt(0)}.` : null].filter(Boolean).join(" ") || p.email || "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "fr"));
}
