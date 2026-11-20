// Présences jour par jour sur un événement de plusieurs jours (sql/2026-11-21_event_presence_*.sql) :
// présences souhaitées (vidéo, photo, comité directeur) et présences déclarées par chacun.

import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

export type PresenceKind = "video" | "photo" | "cd";
export const PRESENCE_KINDS: PresenceKind[] = ["video", "photo", "cd"];
export const PRESENCE_KIND_LABEL: Record<PresenceKind, string> = { video: "Vidéo", photo: "Photo", cd: "Comité directeur" };

/** Un jour et son créneau (« HH:MM », chaîne vide si non précisé). */
export type Slot = { start: string; end: string };
/** Jour « AAAA-MM-JJ » → créneau. */
export type DaySlots = Record<string, Slot>;
export type PresenceRequests = Record<PresenceKind, DaySlots>;

export const emptyRequests = (): PresenceRequests => ({ video: {}, photo: {}, cd: {} });

/** Jours (« AAAA-MM-JJ ») couverts par un événement, 31 au plus. */
export function eventDays(startISO: string, endISO: string): string[] {
  const start = parseISO(startISO);
  const last = new Date(parseISO(endISO).getTime() - 1);
  const n = Math.max(0, differenceInCalendarDays(last, start));
  return Array.from({ length: Math.min(n + 1, 31) }, (_, i) => format(addDays(start, i), "yyyy-MM-dd"));
}

export const hourLabel = (t: string) => t.replace(":", "h").replace(/h00$/, "h");
export const slotLabel = (s: Slot) => (s.start || s.end ? `${hourLabel(s.start || "…")}–${hourLabel(s.end || "…")}` : "");
export const dayLabel = (day: string, pattern = "EEE d MMM") => format(new Date(`${day}T12:00:00`), pattern, { locale: fr });

/** « mar. 15 déc. 14h–17h, mer. 16 déc. » */
export function describeSlots(slots: DaySlots): string {
  return Object.keys(slots)
    .sort()
    .map((d) => [dayLabel(d), slotLabel(slots[d])].filter(Boolean).join(" "))
    .join(", ");
}

/** Rôle de captation → demandes qui le concernent (photo + vidéo : les deux). */
export const kindsOfRole = (role: string | null | undefined): PresenceKind[] => (role === "photo" ? ["photo"] : role === "video" ? ["video"] : ["video", "photo"]);

/** Lignes event_presence_requests → présences souhaitées par rôle. */
export function requestsFromRows(rows: { kind: string; day: string; start_time: string | null; end_time: string | null }[]): PresenceRequests {
  const out = emptyRequests();
  for (const r of rows) {
    if (r.kind !== "video" && r.kind !== "photo" && r.kind !== "cd") continue;
    out[r.kind][r.day] = { start: r.start_time?.slice(0, 5) ?? "", end: r.end_time?.slice(0, 5) ?? "" };
  }
  return out;
}

export const requestCount = (r: PresenceRequests) => PRESENCE_KINDS.reduce((n, k) => n + Object.keys(r[k]).length, 0);
