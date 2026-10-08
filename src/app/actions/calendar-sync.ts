"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/serviceClient";
import { listConnectedAccounts, getGoogleAccountById, getOwnedGoogleAccount } from "@/lib/google/accounts";
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

/** Compte Google qui porte le miroir : celui enregistré à la création, pas « le premier compte » du créateur. */
async function mirrorAccount(row: Pick<SyncEventRow, "google_connected_account_id">) {
  return row.google_connected_account_id ? getGoogleAccountById(row.google_connected_account_id) : null;
}

/** Google répond 404 / 410 quand le rendez-vous n'existe plus : rien à faire. */
function isGone(err: unknown) {
  const code = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
  return code === 404 || code === 410;
}

/**
 * Pousse un événement du board vers Google Calendar (compte connecté du créateur).
 * Synchro à sens unique — Board → Google uniquement, jamais l'inverse (voir décision
 * du 2026-09-20 : le board reste la source de vérité, Google Calendar en est un miroir).
 * Le miroir porte l'id de l'événement (extendedProperties) pour être nettoyé s'il devient orphelin.
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
  const input: EventInput = {
    summary: row.title,
    description: row.organizer_message ?? "",
    location: row.location ?? "",
    start: row.start_date,
    end: row.end_date,
    allDay: false,
    attendees: [],
    timeZone: "Europe/Paris",
    boardEventId: row.id,
  };

  // Miroir existant : mis à jour avec le compte qui l'a créé. Recréé seulement s'il a disparu côté
  // Google ou si ce compte a été déconnecté — jamais de seconde copie à côté de la première.
  if (row.google_event_id) {
    const existingAccount = await mirrorAccount(row);
    if (existingAccount) {
      try {
        await updateEvent(existingAccount, row.google_event_id, { ...input, calendarId: row.google_calendar_id ?? undefined });
        return { synced: true as const };
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
  }

  const account = await firstGoogleAccount(row.created_by!);
  if (!account) return { synced: false as const };
  const created = await createEvent(account, input);

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

/** Supprime le miroir Google d'un événement supprimé côté board — à appeler avant la suppression board. */
export async function removeEventFromGoogle(eventId: string) {
  await requireUserId();
  // Lecture service : le miroir doit partir même si celui qui supprime ne voit pas ces colonnes.
  const { data: event } = await createServiceClient()
    .from("events")
    .select("created_by, google_event_id, google_calendar_id, google_connected_account_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event?.google_event_id) return;

  const account = (await mirrorAccount(event)) ?? (event.created_by ? await firstGoogleAccount(event.created_by) : null);
  if (!account) return;

  try {
    await deleteEvent(account, event.google_calendar_id ?? undefined, event.google_event_id);
  } catch (err) {
    if (!isGone(err)) console.error("[removeEventFromGoogle]", eventId, err);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Filet de sécurité : supprime de l'agenda Google de l'utilisateur les miroirs dont l'événement
 * du board n'existe plus (supprimé par un autre chemin, ou ancienne copie). Ne touche qu'aux
 * rendez-vous marqués par le board — jamais à ceux créés directement dans Google.
 * Retourne les id Google supprimés.
 */
export async function removeOrphanMirrors(
  accountId: string,
  mirrors: { googleEventId: string; calendarId: string; boardEventId: string }[]
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  const candidates = mirrors.filter((m) => UUID.test(m.boardEventId));
  if (candidates.length === 0) return [];

  // Service : un événement masqué à l'utilisateur (droits) ne doit pas passer pour supprimé.
  const { data, error } = await createServiceClient()
    .from("events")
    .select("id, google_event_id")
    .in("id", [...new Set(candidates.map((m) => m.boardEventId))]);
  if (error) return [];
  const currentMirror = new Map((data ?? []).map((e) => [e.id, e.google_event_id]));

  // Orphelin : l'événement n'existe plus, ou il a un autre miroir (ancienne copie restée dans Google).
  const orphans = candidates.filter((m) => {
    if (!currentMirror.has(m.boardEventId)) return true;
    const current = currentMirror.get(m.boardEventId);
    return !!current && current !== m.googleEventId;
  });

  const removed: string[] = [];
  for (const m of orphans) {
    try {
      await deleteEvent(account, m.calendarId, m.googleEventId);
      removed.push(m.googleEventId);
    } catch (err) {
      if (isGone(err)) removed.push(m.googleEventId);
      else console.error("[removeOrphanMirrors]", m.googleEventId, err);
    }
  }
  return removed;
}
