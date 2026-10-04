import type { OrgKey, CoverageState } from "@/lib/board/tokens";

/**
 * event_type réel de la base (calendrier-lgef, table `events`).
 * "kanban" existe côté base mais ne correspond à aucune organisation du
 * design — jamais proposé dans le sélecteur du calendrier.
 */
export type DbEventType =
  | "institutionnel"
  | "clubs"
  | "pem_pole_espoirs_mixte"
  | "technique"
  | "arbitrage"
  | "competitions"
  | "formation"
  | "communication"
  | "tirages_coupes"
  | "match_du_week_end"
  | "kanban";

export const EVENT_TYPE_TO_ORG: Record<DbEventType, OrgKey> = {
  institutionnel: "navy",
  clubs: "clubs",
  pem_pole_espoirs_mixte: "pem",
  technique: "technique",
  arbitrage: "steel",
  competitions: "red",
  formation: "teal",
  communication: "amber",
  tirages_coupes: "tirages",
  match_du_week_end: "matchs",
  // "kanban" ne sert jamais aux cartes kanban (celles-ci ont event_type NULL,
  // cf. contrainte events_type_eventtype_consistency) — réutilisé pour "Perso".
  kanban: "perso",
};

export const ORG_TO_EVENT_TYPE: Record<OrgKey, DbEventType> = {
  navy: "institutionnel",
  clubs: "clubs",
  pem: "pem_pole_espoirs_mixte",
  technique: "technique",
  steel: "arbitrage",
  red: "competitions",
  teal: "formation",
  amber: "communication",
  tirages: "tirages_coupes",
  matchs: "match_du_week_end",
  perso: "kanban",
};

/** Les 11 organisations sélectionnables dans le calendrier, "Perso" inclus. */
export const CALENDAR_ORG_KEYS = Object.keys(ORG_TO_EVENT_TYPE) as OrgKey[];

export interface Person {
  id: string;
  name: string;
  initials: string;
  role: string;
}

/** Vue calendrier — événement interne LGEF (table `events` + éventuelle `coverage_requests`). */
export interface CalendarEvent {
  id: string;
  source: "internal";
  title: string;
  org: OrgKey;
  start: string; // ISO
  end: string; // ISO
  location: string;
  onlineMeeting: boolean;
  registrationEnabled: boolean;
  message: string;
  requiresCoverage: boolean;
  coverage: CoverageState | null;
  createdBy: string | null;
  createdAt: string | null;
  /** Dernière modification (trigger set_event_updated_by côté base). Absent pour les événements Google. */
  updatedBy?: string | null;
  updatedAt?: string | null;
  /** Médias de l'événement déjà publiés sur les réseaux (vidéo, photo ou les deux) — sigle entouré dans le calendrier. */
  published?: PublishedMedia | null;
  /** Match du week-end (event_type 'match_du_week_end') — concerné par les filtres CouvVidéo / CouvPhoto. */
  weekendMatch?: boolean;
  /** Présence du comité directeur sollicitée sur l'événement (director_attendance). */
  director?: "approved" | "pending" | "denied" | null;
  /** Match avec un poste photo (réseau Couverture match, table photo_missions). */
  photoCoverage?: boolean;
  /** L'utilisateur connecté est sollicité sur cet événement (voir src/lib/board/solicitation.ts). */
  solicited?: boolean;
  /** L'utilisateur connecté est désigné sur la couverture et doit encore accepter ou refuser. */
  awaitingMyAnswer?: boolean;
  status: "pending" | "approved" | "rejected" | "completed" | null;
}

export type PublishedMedia = "video" | "photo" | "both";

export interface EventRow {
  id: string;
  title: string;
  event_type: DbEventType | null;
  start_date: string;
  end_date: string;
  location: string | null;
  online_meeting: boolean | null;
  registration_enabled: boolean | null;
  organizer_message: string | null;
  requires_coverage: boolean | null;
  created_by: string | null;
  created_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
  status: "pending" | "approved" | "rejected" | "completed" | null;
}

export interface CoverageRequestRow {
  event_id: string | null;
  status: "pending" | "approved" | "rejected" | null;
  coverage_symbol: string | null;
  technician_response: string | null;
  assigned_technician_id?: string | null;
}

/**
 * Heuristique : la base stocke la couverture comme emoji libre
 * (`coverage_symbol`, ex. "📹", "🎥❗", "🚫🎥") plutôt que comme les 5 états
 * propres du design. À affiner une fois qu'on peut inspecter un échantillon
 * réel de valeurs en production.
 */
function deriveCoverageState(
  requiresCoverage: boolean,
  request: CoverageRequestRow | undefined
): CoverageState | null {
  if (!requiresCoverage) return null;
  if (!request) return "wait";
  if (request.status === "rejected") return "no";
  // La personne désignée a refusé : signalé (rouge) tant que personne d'autre n'est désigné.
  if (request.technician_response === "rejected" && request.status !== "approved") return "no";
  if (request.status === "approved" && request.technician_response === "accepted") {
    const symbol = request.coverage_symbol ?? "";
    const hasPhoto = symbol.includes("📷");
    const hasVideo = symbol.includes("🎥") || symbol.includes("📹");
    if (hasPhoto && hasVideo) return "both";
    if (hasPhoto) return "photo";
    return "video";
  }
  // Demande traitée : quelqu'un est désigné, sa réponse est attendue.
  if (request.assigned_technician_id && request.technician_response !== "rejected") return "assigned";
  return "wait";
}

export function mapEventRow(row: EventRow, coverageRequest?: CoverageRequestRow): CalendarEvent {
  const requiresCoverage = row.requires_coverage ?? false;
  return {
    id: row.id,
    source: "internal",
    title: row.title,
    org: row.event_type ? EVENT_TYPE_TO_ORG[row.event_type] : "navy",
    start: row.start_date,
    end: row.end_date,
    location: row.location ?? "",
    onlineMeeting: row.online_meeting ?? false,
    registrationEnabled: row.registration_enabled ?? false,
    message: row.organizer_message ?? "",
    requiresCoverage,
    coverage: deriveCoverageState(requiresCoverage, coverageRequest),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    status: row.status,
  };
}

/* ---------- Événements sur plusieurs jours (bandeaux) ---------- */

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Dernier jour occupé : une fin pile à minuit appartient au jour précédent. */
const lastDay = (endISO: string) => dayStart(new Date(new Date(endISO).getTime() - 1));
const dayIndex = (d: Date, origin: Date) => Math.round((dayStart(d).getTime() - origin.getTime()) / DAY_MS);

/** Événement qui s'étend sur plus d'une journée calendaire (affiché en bandeau). */
export function isMultiDayEvent(e: { start: string; end: string }) {
  return lastDay(e.end).getTime() > dayStart(new Date(e.start)).getTime();
}

/**
 * Bandeaux des événements de plusieurs jours sur une rangée de jours consécutifs (une semaine du
 * mois, les jours de la vue Semaine) : colonnes couvertes et ligne, chaque bandeau prenant la
 * première ligne libre.
 */
export function layoutBanners<T extends { start: string; end: string }>(events: T[], days: Date[]) {
  if (days.length === 0) return [];
  const origin = dayStart(days[0]);
  const last = days.length - 1;
  const placed: { event: T; colStart: number; colEnd: number; lane: number }[] = [];
  const lanes: number[] = []; // dernière colonne occupée par ligne
  const inRow = events
    .filter(isMultiDayEvent)
    .map((event) => ({ event, from: dayIndex(new Date(event.start), origin), to: dayIndex(lastDay(event.end), origin) }))
    .filter(({ from, to }) => to >= 0 && from <= last)
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from));
  for (const { event, from, to } of inRow) {
    const colStart = Math.max(0, from);
    const colEnd = Math.min(last, to);
    let lane = lanes.findIndex((end) => end < colStart);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = colEnd;
    placed.push({ event, colStart, colEnd, lane });
  }
  return placed;
}
