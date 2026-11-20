import "server-only";
import { prisma } from "@/lib/prisma";
import type { ConnectedAccount } from "@/generated/prisma";
import * as google from "@/lib/google/calendar";
import * as icloud from "@/lib/icloud/caldav";
import { ICLOUD_CALENDAR_SCOPE, isIcloud } from "@/lib/icloud/client";
import type { EventInput } from "@/lib/google/calendar";

// Agendas externes, quel que soit le fournisseur : Google Agenda ou iCloud (CalDAV). Mêmes
// signatures et mêmes données que lib/google/calendar.ts (calendrier, tableau de bord).

/** Compte d'agenda de l'utilisateur (Google, ou iCloud avec l'agenda coché à la connexion). */
export async function getOwnedCalendarAccount(accountId: string, userId: string) {
  const account = await prisma.connectedAccount.findFirst({ where: { id: accountId, user_id: userId, provider: { in: ["google", "icloud"] } } });
  if (!account || (isIcloud(account) && !account.scopes.includes(ICLOUD_CALENDAR_SCOPE))) throw new Error("Compte introuvable ou non autorisé");
  return account;
}

type A = ConnectedAccount;

export const listCalendars = (a: A) => (isIcloud(a) ? icloud.listCalendars(a) : google.listCalendars(a));
export const listEvents = (a: A, opts: { calendarId?: string; timeMin: string; timeMax: string }) => (isIcloud(a) ? icloud.listEvents(a, opts) : google.listEvents(a, opts));
export const createEvent = (a: A, params: EventInput) => (isIcloud(a) ? icloud.createEvent(a, params) : google.createEvent(a, params));
export const updateEvent = (a: A, eventId: string, params: EventInput) => (isIcloud(a) ? icloud.updateEvent(a, eventId, params) : google.updateEvent(a, eventId, params));
export const deleteEvent = (a: A, calendarId: string | undefined, eventId: string) =>
  isIcloud(a) ? icloud.deleteEvent(a, calendarId, eventId) : google.deleteEvent(a, calendarId, eventId);
