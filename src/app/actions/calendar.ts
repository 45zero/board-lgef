"use server";

import { createClient } from "@/lib/supabase/server";
import { getOwnedGoogleAccount } from "@/lib/google/accounts";
import {
  listCalendars,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  type EventInput,
} from "@/lib/google/calendar";

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non authentifié");
  return user.id;
}

export async function listMyCalendars(accountId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return listCalendars(account);
}

export async function listMyEvents(
  accountId: string,
  opts: { calendarId?: string; timeMin: string; timeMax: string }
) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return listEvents(account, opts);
}

export async function createMyEvent(accountId: string, params: EventInput) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return createEvent(account, params);
}

export async function updateMyEvent(accountId: string, eventId: string, params: EventInput) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  return updateEvent(account, eventId, params);
}

export async function deleteMyEvent(accountId: string, calendarId: string | undefined, eventId: string) {
  const userId = await requireUserId();
  const account = await getOwnedGoogleAccount(accountId, userId);
  await deleteEvent(account, calendarId, eventId);
}
