"use server";

import { toResult } from "@/lib/board/actionResult";
import { managerChain } from "@/lib/board/hierarchy";
import {
  DELIVERY_ROW,
  deliveriesTable,
  deliveryBounds,
  deliverySettings,
  dueAtOf,
  isDay,
  managersFor,
  parisDay,
  peopleById,
  type DeliveryRole,
  type DeliveryRow,
  type DeliverySettings,
} from "@/lib/board/mediaDeliveriesCore";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";

// Remise des photos et vidéos (voir mediaDeliveriesCore.ts et sql/2026-11-21_media_deliveries.sql).
// Toutes les écritures passent ici (client service) après contrôle des droits : la table n'a aucune
// policy d'écriture.

type Service = ReturnType<typeof createServiceClient>;

async function session() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) throw new Error("Non authentifié");
  return { userId, service: createServiceClient() };
}

async function isAdmin(service: Service, userId: string) {
  const { data } = await service.from("profiles").select("role").eq("id", userId).single();
  return data?.role === "admin" || data?.role === "super_user";
}

const WHAT: Record<DeliveryRole, string> = { photo: "les photos", video: "la vidéo", both: "les photos et la vidéo" };
const longDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

async function loadRow(service: Service, id: string) {
  const { data, error } = await deliveriesTable(service).select(DELIVERY_ROW).eq("id", id).single();
  if (error || !data) throw new Error("Remise introuvable.");
  return data as DeliveryRow;
}

/** N+1, N+2… de la personne, ou administrateur (jamais soi-même). */
async function canManage(service: Service, row: DeliveryRow, userId: string) {
  if (row.user_id === userId) return false;
  if (await isAdmin(service, userId)) return true;
  return (await managerChain(service, row.user_id).catch(() => [] as string[])).includes(userId);
}

async function eventOf(service: Service, eventId: string) {
  const { data } = await service.from("events").select("title, start_date, end_date").eq("id", eventId).single();
  if (!data) throw new Error("Événement introuvable.");
  return data;
}

/** Notification du board (cloche, push) ; l'e-mail part par /api/cron/notification-emails. */
async function notify(service: Service, userIds: string[], n: { title: string; message: string; actor: string; eventId: string; deliveryId: string; kind: string }) {
  const results = await Promise.all(
    [...new Set(userIds)].map((uid) =>
      service.rpc("create_notification", {
        p_user_id: uid,
        p_type: "media_delivery" as never,
        p_title: n.title,
        p_message: n.message,
        p_actor_name: n.actor,
        p_data: { event_id: n.eventId, media_delivery_id: n.deliveryId, kind: n.kind },
      })
    )
  );
  // Une notification ratée ne bloque pas l'action, mais doit se voir dans les journaux.
  for (const r of results) if (r.error) console.error("[media-deliveries.notify]", r.error.message);
}

const nameOf = async (service: Service, id: string) => (await peopleById(service, [id])).get(id)?.name ?? "Quelqu'un";
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Date de remise ---------- */

/** Ma participation acceptée à un événement (technicien principal ou renfort) et son rôle. */
async function myParticipation(service: Service, eventId: string, userId: string): Promise<{ source: "lead" | "crew"; role: DeliveryRole } | null> {
  const [{ data: lead }, { data: crew }] = await Promise.all([
    service
      .from("coverage_requests")
      .select("technician_role")
      .eq("event_id", eventId)
      .eq("assigned_technician_id", userId)
      .eq("technician_response", "accepted")
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle(),
    service.from("coverage_crew").select("role").eq("event_id", eventId).eq("user_id", userId).eq("status", "accepted").maybeSingle(),
  ]);
  if (lead) return { source: "lead", role: ((lead as { technician_role: string | null }).technician_role ?? "both") as DeliveryRole };
  if (crew) return { source: "crew", role: (crew as { role: DeliveryRole }).role };
  return null;
}

/** Bornes du sélecteur de date au moment d'accepter : par défaut, au plus tôt, au plus tard. */
export const deliveryDateBounds = async (eventId: string, role: DeliveryRole | null) =>
  toResult(async () => {
    const { service } = await session();
    const [ev, settings] = await Promise.all([eventOf(service, eventId), deliverySettings(service)]);
    return deliveryBounds(ev.end_date ?? ev.start_date, role ?? "both", settings);
  });

/**
 * La personne fixe sa date de remise : à l'acceptation, ou depuis l'encart (date par défaut à
 * confirmer). Jamais au-delà du délai maximum ; une fois la date dépassée, seul le N+1 la décale.
 */
export const setMyDeliveryDate = async (eventId: string, day: string) =>
  toResult(async () => {
    const { userId, service } = await session();
    if (!isDay(day)) throw new Error("Date invalide.");
    const [ev, settings, part, { data: existing }] = await Promise.all([
      eventOf(service, eventId),
      deliverySettings(service),
      myParticipation(service, eventId, userId),
      deliveriesTable(service).select(DELIVERY_ROW).eq("event_id", eventId).eq("user_id", userId).maybeSingle(),
    ]);
    if (!part) throw new Error("Vous n'êtes pas confirmé sur cet événement.");
    const row = existing as DeliveryRow | null;
    if (row?.delivered_at) throw new Error("Vos fichiers sont déjà remis.");
    if (row && new Date(row.due_at) < new Date()) throw new Error("La date est dépassée : contactez votre N+1 pour la décaler.");
    const b = deliveryBounds(ev.end_date ?? ev.start_date, part.role, settings);
    if (day < b.minDay) throw new Error("La date de remise ne peut pas être passée.");
    if (day > b.maxDay) throw new Error(`Au plus tard le ${longDay(dueAtOf(b.maxDay))}.`);
    const { error } = await deliveriesTable(service).upsert(
      { event_id: eventId, user_id: userId, role: part.role, source: part.source, due_at: dueAtOf(day), due_confirmed: true, updated_at: new Date().toISOString() },
      { onConflict: "event_id,user_id" }
    );
    if (error) throw new Error(error.message);
    return dueAtOf(day);
  });

/** Le N+1 (ou un administrateur) fixe une nouvelle date, même après échéance. La relance repart de zéro. */
export const setDeliveryDate = async (deliveryId: string, day: string) =>
  toResult(async () => {
    const { userId, service } = await session();
    if (!isDay(day)) throw new Error("Date invalide.");
    if (day < parisDay(new Date())) throw new Error("La nouvelle date ne peut pas être passée.");
    const row = await loadRow(service, deliveryId);
    if (!(await canManage(service, row, userId))) throw new Error("Seul le N+1 de la personne peut changer cette date.");
    const { error } = await deliveriesTable(service)
      .update({ due_at: dueAtOf(day), due_confirmed: true, reminder_level: 0, reminded_at: null, reminded_by: null, updated_at: new Date().toISOString() })
      .eq("id", deliveryId);
    if (error) throw new Error(error.message);
    const [ev, actor] = await Promise.all([eventOf(service, row.event_id), nameOf(service, userId)]);
    await notify(service, [row.user_id], {
      title: `${actor} a fixé une nouvelle date de remise`,
      message: `${capital(WHAT[row.role])} de « ${ev.title} » : à remettre au plus tard le ${longDay(dueAtOf(day))}.`,
      actor,
      eventId: row.event_id,
      deliveryId,
      kind: "new_date",
    });
  });

/* ---------- Remis ---------- */

/** « C'est remis » : la personne elle-même (fichiers envoyés autrement) ou son N+1. */
export const markDelivered = async (deliveryId: string) =>
  toResult(async () => {
    const { userId, service } = await session();
    const row = await loadRow(service, deliveryId);
    const self = row.user_id === userId;
    if (!self && !(await canManage(service, row, userId))) throw new Error("Action réservée à la personne ou à son N+1.");
    if (row.delivered_at) return;
    const { error } = await deliveriesTable(service)
      .update({ delivered_at: new Date().toISOString(), delivered_via: "manual", reminder_level: 0, updated_at: new Date().toISOString() })
      .eq("id", deliveryId);
    if (error) throw new Error(error.message);
    if (self && new Date(row.due_at) < new Date()) {
      // Remise en retard déclarée par la personne : son N+1 est prévenu (l'alerte quitte son accueil).
      const [ev, actor, managers] = await Promise.all([eventOf(service, row.event_id), nameOf(service, userId), managersFor(service, userId)]);
      await notify(service, managers, { title: `${actor} a remis ${WHAT[row.role]}`, message: `« ${ev.title} » — remise déclarée sur le board.`, actor, eventId: row.event_id, deliveryId, kind: "delivered" });
    }
  });

/* ---------- Relances (cloche orange puis rouge) ---------- */

/**
 * Relance du N+1 sur une remise en retard : notification (cloche + e-mail). 1re relance : orange ;
 * sans réaction, la suivante passe au rouge (pop-up plein écran avec « wizz » sur le board de la personne).
 */
export const remindDelivery = async (deliveryId: string) =>
  toResult(async () => {
    const { userId, service } = await session();
    const row = await loadRow(service, deliveryId);
    if (!(await canManage(service, row, userId))) throw new Error("Seul le N+1 de la personne peut la relancer.");
    if (row.delivered_at) throw new Error("C'est déjà remis.");
    const level = Math.min(2, (row.reminder_level ?? 0) + 1) as 1 | 2;
    const { error } = await deliveriesTable(service)
      .update({ reminder_level: level, reminded_at: new Date().toISOString(), reminded_by: userId, updated_at: new Date().toISOString() })
      .eq("id", deliveryId);
    if (error) throw new Error(error.message);
    const [ev, actor] = await Promise.all([eventOf(service, row.event_id), nameOf(service, userId)]);
    await notify(service, [row.user_id], {
      title: level === 2 ? `${actor} vous relance à nouveau : ${WHAT[row.role]} de « ${ev.title} »` : `${actor} vous relance : ${WHAT[row.role]} de « ${ev.title} »`,
      message: `Attendue le ${longDay(row.due_at)}. Déposez vos fichiers sur l'événement, ou répondez-lui depuis le board.`,
      actor,
      eventId: row.event_id,
      deliveryId,
      kind: level === 2 ? "reminder_red" : "reminder",
    });
    return level;
  });

/** Clic sur la cloche orange par la personne : « vu ». La rouge ne part qu'en remettant ou en répondant. */
export const ackDeliveryReminder = async (deliveryId: string) =>
  toResult(async () => {
    const { userId, service } = await session();
    const { error } = await deliveriesTable(service).update({ reminder_level: 0 }).eq("id", deliveryId).eq("user_id", userId).eq("reminder_level", 1);
    if (error) throw new Error(error.message);
  });

/** « Contacter mon N+1 » : message à son N+1 (sans N+1 : les administrateurs). Répond à la relance. */
export const contactManagerAboutDelivery = async (deliveryId: string, message: string) =>
  toResult(async () => {
    const { userId, service } = await session();
    const text = message.trim().slice(0, 1000);
    if (!text) throw new Error("Écrivez un message.");
    const row = await loadRow(service, deliveryId);
    if (row.user_id !== userId) throw new Error("Cette remise ne vous concerne pas.");
    const [ev, actor, managers] = await Promise.all([eventOf(service, row.event_id), nameOf(service, userId), managersFor(service, userId)]);
    if (!managers.length) throw new Error("Aucun N+1 n'est renseigné pour vous : prévenez un administrateur.");
    await notify(service, managers, {
      title: `${actor} vous écrit au sujet de ${WHAT[row.role]} de « ${ev.title} »`,
      message: text,
      actor,
      eventId: row.event_id,
      deliveryId,
      kind: "contact_manager",
    });
    await deliveriesTable(service).update({ reminder_level: 0 }).eq("id", deliveryId).eq("user_id", userId);
    return (await peopleById(service, managers)).get(managers[0])?.name ?? null;
  });

/** Relances rouges en attente pour moi : pop-up plein écran tant que je n'ai ni remis ni répondu. */
export const myRedDeliveryReminders = async () =>
  toResult(async () => {
    const { userId, service } = await session();
    const { data, error } = await deliveriesTable(service).select(DELIVERY_ROW).eq("user_id", userId).eq("reminder_level", 2).is("delivered_at", null);
    // Table absente (migration pas encore appliquée) : aucune relance.
    if (error) return [];
    const rows = (data ?? []) as DeliveryRow[];
    if (!rows.length) return [];
    const managerId = (await managersFor(service, userId))[0] ?? null;
    const [{ data: events }, people] = await Promise.all([
      service.from("events").select("id, title").in("id", rows.map((r) => r.event_id)),
      peopleById(service, [...rows.map((r) => r.reminded_by), managerId]),
    ]);
    const manager = managerId ? (people.get(managerId) ?? null) : null;
    return rows.map((r) => ({
      manager,
      id: r.id,
      eventId: r.event_id,
      eventTitle: events?.find((e) => e.id === r.event_id)?.title ?? "Événement",
      role: r.role,
      dueAt: r.due_at,
      remindedAt: r.reminded_at,
      by: r.reminded_by ? (people.get(r.reminded_by)?.name ?? null) : null,
    }));
  });

/* ---------- Réglages (administrateurs) ---------- */

export const getDeliverySettings = async () =>
  toResult(async () => {
    const { service } = await session();
    return deliverySettings(service);
  });

export const saveDeliverySettings = async (s: DeliverySettings) =>
  toResult(async () => {
    const { userId, service } = await session();
    if (!(await isAdmin(service, userId))) throw new Error("Réservé aux administrateurs.");
    const days = [s.photoDays, s.videoDays, s.maxDays];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 90)) throw new Error("Les délais vont de 0 à 90 jours.");
    if (s.maxDays < Math.max(s.photoDays, s.videoDays)) throw new Error("Le délai maximum doit être au moins égal aux délais par défaut.");
    const { error } = await service
      .from("board_settings")
      .update({ media_delivery_photo_days: s.photoDays, media_delivery_video_days: s.videoDays, media_delivery_max_days: s.maxDays, updated_by: userId, updated_at: new Date().toISOString() } as never)
      .eq("id", true);
    if (error) throw new Error(error.message.includes("media_delivery") ? "La mise à jour de la base (remises) n'est pas encore appliquée." : error.message);
  });
