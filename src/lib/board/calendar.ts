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
  kanban: "navy", // pas de sens calendrier ; jamais choisi par l'utilisateur
};

export const ORG_TO_EVENT_TYPE: Record<Exclude<OrgKey, "perso">, DbEventType> = {
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
};

/** Les 10 organisations réellement sélectionnables (design en a 11, "perso" est sans équivalent base). */
export const CALENDAR_ORG_KEYS = Object.keys(ORG_TO_EVENT_TYPE) as Exclude<OrgKey, "perso">[];

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
  message: string;
  requiresCoverage: boolean;
  coverage: CoverageState | null;
  createdBy: string | null;
  createdAt: string | null;
  status: "pending" | "approved" | "rejected" | "completed" | null;
}

export interface EventRow {
  id: string;
  title: string;
  event_type: DbEventType | null;
  start_date: string;
  end_date: string;
  location: string | null;
  organizer_message: string | null;
  requires_coverage: boolean | null;
  created_by: string | null;
  created_at: string | null;
  status: "pending" | "approved" | "rejected" | "completed" | null;
}

export interface CoverageRequestRow {
  event_id: string | null;
  status: "pending" | "approved" | "rejected" | null;
  coverage_symbol: string | null;
  technician_response: string | null;
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
  if (!request || request.status === "pending") return "wait";
  if (request.status === "rejected") return "no";
  if (request.status === "approved" && request.technician_response === "accepted") {
    const symbol = request.coverage_symbol ?? "";
    const hasPhoto = symbol.includes("📷");
    const hasVideo = symbol.includes("🎥") || symbol.includes("📹");
    if (hasPhoto && hasVideo) return "both";
    if (hasPhoto) return "photo";
    return "video";
  }
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
    onlineMeeting: false,
    message: row.organizer_message ?? "",
    requiresCoverage,
    coverage: deriveCoverageState(requiresCoverage, coverageRequest),
    createdBy: row.created_by,
    createdAt: row.created_at,
    status: row.status,
  };
}
