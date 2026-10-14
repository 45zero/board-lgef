import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { travelFromHome } from "@/lib/board/travel";
import { DEPARTURE_MARGIN_MIN, formatTravel } from "@/lib/board/geo";
import { sendPush } from "@/lib/push/sendPush";

export const maxDuration = 60;

/** Rappels plus anciens ignorés (pas de rattrapage d'une panne longue). */
const WINDOW_MS = 15 * 60 * 1000;
const BATCH = 100;

const OFFSET_LABELS: Record<string, string> = {
  "10min": "10 minutes",
  "20min": "20 minutes",
  "30min": "30 minutes",
  "1h": "1 heure",
  "2h": "2 heures",
  "1d": "1 jour",
};

const timeFR = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

/**
 * Rappels d'événement (event_reminders) — appelé chaque minute par pg_cron (job « event-reminders »,
 * sql/2026-10-14_departure_reminders.sql) avec le secret CRON_SECRET ; remplace la fonction
 * process_event_reminders de l'ancien calendrier. Chaque rappel dû devient une notification du board
 * (cloche ; e-mail via /api/cron/notification-emails si le canal e-mail était choisi) et un push si
 * demandé. « depart » : l'heure de partir, avec le temps de route depuis le domicile.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const service = createServiceClient();
  const now = new Date();

  const { data: due, error } = await service
    .from("event_reminders")
    .select("id")
    .is("sent_at", null)
    .lte("remind_at", now.toISOString())
    .gte("remind_at", new Date(now.getTime() - WINDOW_MS).toISOString())
    .order("remind_at")
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due?.length) return NextResponse.json({ sent: 0 });

  // Réservation : sent_at passe de null à maintenant une seule fois, même si deux appels se croisent.
  const { data: claimed } = await service
    .from("event_reminders")
    .update({ sent_at: now.toISOString() })
    .in("id", due.map((r) => r.id))
    .is("sent_at", null)
    .select("id, event_id, user_id, reminder_offset, channels");
  if (!claimed?.length) return NextResponse.json({ sent: 0 });

  const { data: events } = await service
    .from("events")
    .select("id, title, start_date, end_date, location, event_address, event_coordinates, online_meeting")
    .in("id", [...new Set(claimed.map((r) => r.event_id))]);
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));

  const notifications = [];
  const pushes: { userId: string; title: string; body: string; eventId: string }[] = [];
  for (const r of claimed) {
    const ev = eventById.get(r.event_id);
    if (!ev) continue;
    const start = timeFR(ev.start_date);
    const place = ev.location || ev.event_address || "";
    let title: string;
    let message: string;
    if (r.reminder_offset === "depart") {
      const travel = ev.online_meeting ? undefined : (await travelFromHome(service, r.user_id, [ev]))[ev.id];
      title = `🚗 C'est l'heure de partir — ${ev.title}`;
      message = [`Début à ${start}`, travel ? `${formatTravel(travel)} de route (+${DEPARTURE_MARGIN_MIN} min de marge)` : "", place]
        .filter(Boolean)
        .join(" · ");
    } else {
      const label = OFFSET_LABELS[r.reminder_offset];
      title = label ? `🔔 ${ev.title} dans ${label}` : `🔔 ${ev.title} commence maintenant`;
      message = [`${start}${ev.end_date ? ` → ${timeFR(ev.end_date)}` : ""}`, place].filter(Boolean).join(" · ");
    }
    const channels = r.channels ?? [];
    notifications.push({
      user_id: r.user_id,
      type: "event_reminder" as const,
      title,
      message,
      event_id: ev.id,
      // board_reminder : envoyé par l'e-mail des notifications (les rappels de l'ancien calendrier ne l'étaient pas).
      data: { event_id: ev.id, route: `/?openEvent=${ev.id}`, board_reminder: true, skip_email: !channels.includes("email") },
      read: false,
    });
    if (channels.includes("push")) pushes.push({ userId: r.user_id, title, body: message, eventId: ev.id });
  }

  if (notifications.length) {
    const { error: insertError } = await service.from("notifications").insert(notifications);
    if (insertError) console.error("[event-reminders] notifications", insertError);
  }

  // Push mobile : service commun (fonction Supabase send_push_v1), icône LGEF par défaut.
  let pushed = 0;
  for (const p of pushes) {
    if (await sendPush({ userId: p.userId, title: p.title, body: p.body, type: "event_reminder", data: { event_id: p.eventId, route: `/?openEvent=${p.eventId}` } })) pushed++;
  }

  return NextResponse.json({ sent: notifications.length, pushed });
}
