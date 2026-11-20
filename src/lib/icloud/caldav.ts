import "server-only";
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import ICAL from "ical.js";
import type { ConnectedAccount } from "@/generated/prisma";
import { ICLOUD_CALDAV, icloudCredentials } from "@/lib/icloud/client";
import type { CalendarEventItem, CalendarListItem, EventInput } from "@/lib/google/calendar";

// Agenda iCloud (CalDAV caldav.icloud.com) avec les mêmes formes de données que Google Agenda
// (lib/google/calendar.ts) : le calendrier et le tableau de bord ne voient pas la différence.
//
// Identifiants : agenda = URL de la collection CalDAV, événement = URL de l'objet .ics ; une
// occurrence d'événement répétitif = « URL#date ISO de l'occurrence ». Modifier une occurrence
// change la série (titre, lieu, description, invités) sans déplacer ses dates ; supprimer une
// occurrence ne retire que ce jour-là (EXDATE), jamais toute la série.

const MARKER = "x-lgef-event-id";

async function dav(account: ConnectedAccount | { user: string; pass: string }) {
  const creds = "access_token" in account ? icloudCredentials(account) : account;
  return createDAVClient({
    serverUrl: ICLOUD_CALDAV,
    credentials: { username: creds.user, password: creds.pass },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

type Client = Awaited<ReturnType<typeof dav>>;

async function eventCalendars(client: Client) {
  const all = await client.fetchCalendars();
  return all.filter((c) => !c.components || c.components.includes("VEVENT"));
}

const calendarName = (c: DAVCalendar) => (typeof c.displayName === "string" && c.displayName) || "Agenda iCloud";

/** « primary » (agenda par défaut du board) : le premier agenda d'événements du compte. */
async function resolveCalendar(client: Client, calendarId?: string) {
  const calendars = await eventCalendars(client);
  const found = calendarId && calendarId !== "primary" ? calendars.find((c) => c.url === calendarId) : calendars[0];
  if (!found) throw new Error("Aucun agenda iCloud trouvé pour ce compte.");
  return found;
}

/* ---------- Dates ---------- */

/** Heure locale de Paris (« AAAA-MM-JJTHH:mm », sans fuseau, comme l'envoie la fiche) → instant UTC. */
function parisToDate(local: string): Date {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(local)) return new Date(local);
  const [d, t = "00:00"] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [hh, mm, ss = 0] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm, ss);
  const offset = (at: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(at))
        .map((x) => [x.type, x.value])
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at;
  };
  return new Date(guess - offset(guess - offset(guess)));
}

const dateOnly = (t: ICAL.Time) => `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
const asIso = (t: ICAL.Time) => (t.isDate ? dateOnly(t) : t.toJSDate().toISOString());

/* ---------- Lecture ---------- */

function parse(data: string) {
  const root = new ICAL.Component(ICAL.parse(data));
  for (const tz of root.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // fuseau déjà connu ou illisible : ical.js se rabat sur l'heure flottante
    }
  }
  return root;
}

function toItem(calendarUrl: string, id: string, ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time, vevent: ICAL.Component): CalendarEventItem {
  return {
    id,
    calendarId: calendarUrl,
    summary: ev.summary || "(sans titre)",
    description: ev.description ?? "",
    location: ev.location ?? "",
    start: asIso(start),
    end: asIso(end),
    allDay: start.isDate,
    attendees: vevent.getAllProperties("attendee").map((p) => ({
      email: String(p.getFirstValue() ?? "").replace(/^mailto:/i, ""),
      responseStatus: String(p.getParameter("partstat") ?? "NEEDS-ACTION").toLowerCase().replace("needs-action", "needsAction"),
    })),
    htmlLink: "",
    boardEventId: (vevent.getFirstPropertyValue(MARKER) as string | null) ?? null,
  };
}

/** Événements d'un objet .ics dans la période, occurrences des séries comprises (exceptions appliquées). */
export function expand(obj: DAVCalendarObject, calendarUrl: string, from: Date, to: Date): CalendarEventItem[] {
  if (!obj.data) return [];
  const root = parse(obj.data);
  const vevents = root.getAllSubcomponents("vevent");
  const master = vevents.find((v) => !v.hasProperty("recurrence-id"));
  if (!master) return [];
  const ev = new ICAL.Event(master, { exceptions: vevents.filter((v) => v.hasProperty("recurrence-id")), strictExceptions: false });
  if (!ev.isRecurring()) {
    const s = ev.startDate;
    const e = ev.endDate ?? s;
    return e.toJSDate() > from && s.toJSDate() < to ? [toItem(calendarUrl, obj.url, ev, s, e, master)] : [];
  }
  const out: CalendarEventItem[] = [];
  const it = ev.iterator();
  for (let next = it.next(), guard = 0; next && guard < 2000; next = it.next(), guard++) {
    const occ = ev.getOccurrenceDetails(next);
    if (occ.startDate.toJSDate() >= to) break;
    if (occ.endDate.toJSDate() <= from) continue;
    out.push(toItem(calendarUrl, `${obj.url}#${asIso(occ.recurrenceId)}`, occ.item, occ.startDate, occ.endDate, occ.item.component));
  }
  return out;
}

export async function listCalendars(account: ConnectedAccount): Promise<CalendarListItem[]> {
  const client = await dav(account);
  return (await eventCalendars(client)).map((c, i) => ({ id: c.url, summary: calendarName(c), primary: i === 0, backgroundColor: c.calendarColor ?? "#FF3B30" }));
}

/** `calendarId` « primary » ou absent : tous les agendas d'événements du compte. */
export async function listEvents(account: ConnectedAccount, opts: { calendarId?: string; timeMin: string; timeMax: string }) {
  const client = await dav(account);
  const all = await eventCalendars(client);
  const calendars = opts.calendarId && opts.calendarId !== "primary" ? all.filter((c) => c.url === opts.calendarId) : all;
  const from = new Date(opts.timeMin);
  const to = new Date(opts.timeMax);
  const lists = await Promise.all(
    calendars.map((calendar) =>
      client
        .fetchCalendarObjects({ calendar, timeRange: { start: from.toISOString(), end: to.toISOString() } })
        .then((objs) => objs.flatMap((o) => expand(o, calendar.url, from, to)))
        .catch(() => [] as CalendarEventItem[])
    )
  );
  return lists.flat().sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/* ---------- Écriture ---------- */

function setTimes(vevent: ICAL.Component, params: EventInput) {
  vevent.removeAllProperties("dtstart");
  vevent.removeAllProperties("dtend");
  vevent.removeAllProperties("duration");
  const time = (v: string) => (params.allDay ? ICAL.Time.fromDateString(v.slice(0, 10)) : ICAL.Time.fromJSDate(parisToDate(v), true));
  vevent.addPropertyWithValue("dtstart", time(params.start));
  vevent.addPropertyWithValue("dtend", time(params.end));
}

function setFields(vevent: ICAL.Component, params: EventInput) {
  const text = (name: string, value?: string) => {
    vevent.removeAllProperties(name);
    if (value) vevent.addPropertyWithValue(name, value);
  };
  text("summary", params.summary || "(sans titre)");
  text("description", params.description);
  text("location", params.location);
  vevent.removeAllProperties("attendee");
  for (const email of params.attendees) {
    const p = vevent.addPropertyWithValue("attendee", `mailto:${email}`);
    p.setParameter("rsvp", "TRUE");
  }
  if (params.boardEventId) text(MARKER, params.boardEventId);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  vevent.updatePropertyWithValue("last-modified", ICAL.Time.now());
}

const fileName = (uid: string) => `${uid.replace(/[^a-zA-Z0-9-]/g, "")}.ics`;

export async function createEvent(account: ConnectedAccount, params: EventInput) {
  const client = await dav(account);
  const calendar = await resolveCalendar(client, params.calendarId);
  const uid = `${crypto.randomUUID()}-board-lgef`;
  const root = new ICAL.Component(["vcalendar", [], []]);
  root.updatePropertyWithValue("prodid", "-//LGEF//Board//FR");
  root.updatePropertyWithValue("version", "2.0");
  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", uid);
  setTimes(vevent, params);
  setFields(vevent, params);
  root.addSubcomponent(vevent);
  const res = await client.createCalendarObject({ calendar, filename: fileName(uid), iCalString: root.toString() });
  if (!res.ok) throw new Error(`iCloud a refusé l'événement (${res.status}).`);
  const ev = new ICAL.Event(vevent);
  return toItem(calendar.url, new URL(fileName(uid), calendar.url).toString(), ev, ev.startDate, ev.endDate ?? ev.startDate, vevent);
}

/** Objet .ics à jour (etag compris) de l'événement, et l'agenda qui le contient. */
async function loadObject(client: Client, eventId: string) {
  const [url, occurrence] = eventId.split("#");
  const calendars = await eventCalendars(client);
  const calendar = calendars.find((c) => url.startsWith(c.url));
  if (!calendar) throw new Error("Agenda de l'événement introuvable.");
  const [obj] = await client.fetchCalendarObjects({ calendar, objectUrls: [url], useMultiGet: true });
  if (!obj?.data) throw new Error("Événement introuvable (supprimé ailleurs ?).");
  return { calendar, obj: { ...obj, url, data: obj.data as string }, occurrence: occurrence ?? null };
}

export async function updateEvent(account: ConnectedAccount, eventId: string, params: EventInput) {
  const client = await dav(account);
  const { calendar, obj, occurrence } = await loadObject(client, eventId);
  const root = parse(obj.data);
  const vevent = root.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
  if (!vevent) throw new Error("Événement illisible.");
  setFields(vevent, params);
  // Série : dates laissées telles quelles (modifier une occurrence ne déplace pas toute la série).
  if (!occurrence && !vevent.hasProperty("rrule")) setTimes(vevent, params);
  const res = await client.updateCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: root.toString() } });
  if (!res.ok) throw new Error(`iCloud a refusé la modification (${res.status}).`);
  const ev = new ICAL.Event(vevent);
  return toItem(calendar.url, eventId, ev, ev.startDate, ev.endDate ?? ev.startDate, vevent);
}

export async function deleteEvent(account: ConnectedAccount, _calendarId: string | undefined, eventId: string) {
  const client = await dav(account);
  const { obj, occurrence } = await loadObject(client, eventId);
  if (occurrence) {
    // Une seule occurrence : exclue de la série (EXDATE), le reste de la série est gardé.
    const root = parse(obj.data);
    const vevent = root.getAllSubcomponents("vevent").find((v) => !v.hasProperty("recurrence-id"));
    if (!vevent) throw new Error("Événement illisible.");
    const exdate = /^\d{4}-\d{2}-\d{2}$/.test(occurrence) ? ICAL.Time.fromDateString(occurrence) : ICAL.Time.fromJSDate(new Date(occurrence), true);
    vevent.addPropertyWithValue("exdate", exdate);
    const res = await client.updateCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: root.toString() } });
    if (!res.ok) throw new Error(`iCloud a refusé la suppression (${res.status}).`);
    return;
  }
  const res = await client.deleteCalendarObject({ calendarObject: { url: obj.url, etag: obj.etag, data: obj.data } });
  if (!res.ok && res.status !== 404) throw new Error(`iCloud a refusé la suppression (${res.status}).`);
}

/** Vérifie l'adresse et le mot de passe pour app (connexion d'un compte avec l'agenda coché). */
export async function verifyCaldavLogin(creds: { user: string; pass: string }) {
  const client = await dav(creds);
  await eventCalendars(client);
}
