import "server-only";
import { google, calendar_v3 } from "googleapis";
import { createOAuth2Client } from "@/lib/google/oauth";
import { getValidGoogleAccessToken } from "@/lib/google/accounts";
import type { ConnectedAccount } from "@/generated/prisma";

async function calendarClient(account: ConnectedAccount) {
  const accessToken = await getValidGoogleAccessToken(account);
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export interface CalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string;
}

export interface EventAttendee {
  email: string;
  responseStatus: string;
}

export interface CalendarEventItem {
  id: string;
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: EventAttendee[];
  htmlLink: string;
}

function mapEvent(calendarId: string, e: calendar_v3.Schema$Event): CalendarEventItem {
  return {
    id: e.id!,
    calendarId,
    summary: e.summary ?? "(sans titre)",
    description: e.description ?? "",
    location: e.location ?? "",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: !!e.start?.date,
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.email ?? "",
      responseStatus: a.responseStatus ?? "needsAction",
    })),
    htmlLink: e.htmlLink ?? "",
  };
}

export async function listCalendars(account: ConnectedAccount): Promise<CalendarListItem[]> {
  const calendar = await calendarClient(account);
  const { data } = await calendar.calendarList.list();
  return (data.items ?? []).map((c) => ({
    id: c.id!,
    summary: c.summaryOverride || c.summary || c.id!,
    primary: !!c.primary,
    backgroundColor: c.backgroundColor ?? "#4285F4",
  }));
}

export async function listEvents(
  account: ConnectedAccount,
  opts: { calendarId?: string; timeMin: string; timeMax: string }
) {
  const calendar = await calendarClient(account);
  const calendarId = opts.calendarId ?? "primary";
  const { data } = await calendar.events.list({
    calendarId,
    timeMin: opts.timeMin,
    timeMax: opts.timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
  });
  return (data.items ?? []).map((e) => mapEvent(calendarId, e));
}

export interface EventInput {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: string[];
  timeZone?: string;
}

export async function createEvent(account: ConnectedAccount, params: EventInput) {
  const calendar = await calendarClient(account);
  const calendarId = params.calendarId ?? "primary";
  const { data } = await calendar.events.insert({
    calendarId,
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: params.allDay
        ? { date: params.start }
        : { dateTime: params.start, timeZone: params.timeZone ?? "Europe/Paris" },
      end: params.allDay
        ? { date: params.end }
        : { dateTime: params.end, timeZone: params.timeZone ?? "Europe/Paris" },
      attendees: params.attendees.map((email) => ({ email })),
    },
  });
  return mapEvent(calendarId, data);
}

export async function updateEvent(account: ConnectedAccount, eventId: string, params: EventInput) {
  const calendar = await calendarClient(account);
  const calendarId = params.calendarId ?? "primary";
  const { data } = await calendar.events.update({
    calendarId,
    eventId,
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: params.allDay
        ? { date: params.start }
        : { dateTime: params.start, timeZone: params.timeZone ?? "Europe/Paris" },
      end: params.allDay
        ? { date: params.end }
        : { dateTime: params.end, timeZone: params.timeZone ?? "Europe/Paris" },
      attendees: params.attendees.map((email) => ({ email })),
    },
  });
  return mapEvent(calendarId, data);
}

export async function deleteEvent(account: ConnectedAccount, calendarId: string | undefined, eventId: string) {
  const calendar = await calendarClient(account);
  await calendar.events.delete({
    calendarId: calendarId ?? "primary",
    eventId,
    sendUpdates: "all",
  });
}
