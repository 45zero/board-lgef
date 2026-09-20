"use server";

import { createClient } from "@/lib/supabase/server";
import { listConnectedAccounts } from "@/lib/google/accounts";
import { createEvent, updateEvent, deleteEvent, type EventInput } from "@/lib/google/calendar";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

interface SyncEventRow {
  id: string;
  title: string;
  organizer_message: string | null;
  location: string | null;
  start_date: string;
  end_date: string;
  created_by: string | null;
  google_event_id: string | null;
  google_calendar_id: string | null;
  google_connected_account_id: string | null;
}

async function firstGoogleAccount(userId: string) {
  const accounts = await listConnectedAccounts(userId);
  return accounts.find((a) => a.provider === "google") ?? null;
}

/**
 * Pousse un événement du board vers Google Calendar (compte connecté du créateur).
 * Synchro à sens unique — Board → Google uniquement, jamais l'inverse (voir décision
 * du 2026-09-20 : le board reste la source de vérité, Google Calendar en est un miroir).
 */
export async function syncEventToGoogle(eventId: string) {
  await requireUserId();
  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from("events")
    .select(
      "id, title, organizer_message, location, start_date, end_date, created_by, google_event_id, google_calendar_id, google_connected_account_id"
    )
    .eq("id", eventId)
    .single();
  if (error || !event || !event.created_by) return { synced: false as const };

  const row = event as SyncEventRow;
  const account = await firstGoogleAccount(event.created_by);
  if (!account) return { synced: false as const };

  const isSameAccount = row.google_connected_account_id === account.id;

  if (row.google_event_id && row.google_calendar_id && isSameAccount) {
    const input: EventInput = {
      calendarId: row.google_calendar_id,
      summary: row.title,
      description: row.organizer_message ?? "",
      location: row.location ?? "",
      start: row.start_date,
      end: row.end_date,
      allDay: false,
      attendees: [],
      timeZone: "Europe/Paris",
    };
    await updateEvent(account, row.google_event_id, input);
    return { synced: true as const };
  }

  const created = await createEvent(account, {
    summary: row.title,
    description: row.organizer_message ?? "",
    location: row.location ?? "",
    start: row.start_date,
    end: row.end_date,
    allDay: false,
    attendees: [],
    timeZone: "Europe/Paris",
  });

  await supabase
    .from("events")
    .update({
      google_event_id: created.id,
      google_calendar_id: created.calendarId,
      google_connected_account_id: account.id,
    })
    .eq("id", eventId);

  return { synced: true as const };
}

/** Supprime le miroir Google d'un événement supprimé côté board — best-effort, ne bloque jamais la suppression board. */
export async function removeEventFromGoogle(eventId: string) {
  await requireUserId();
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("created_by, google_event_id, google_calendar_id")
    .eq("id", eventId)
    .single();
  if (!event?.google_event_id || !event.created_by) return;

  const account = await firstGoogleAccount(event.created_by);
  if (!account) return;

  try {
    await deleteEvent(account, event.google_calendar_id ?? undefined, event.google_event_id);
  } catch {
    // déjà supprimé côté Google, ou token expiré — jamais bloquant pour la suppression board
  }
}
